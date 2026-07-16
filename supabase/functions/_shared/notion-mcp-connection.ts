import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
import {
  decryptNotionSecret,
  decryptNotionTokens,
  encryptNotionTokens,
} from './notion-secret-crypto.ts';

const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';
const NOTION_READ_TOOLS = ['notion-search', 'notion-fetch'];
const REFRESH_AHEAD_MS = 5 * 60 * 1000;

interface NotionConnectionRow {
  organization_id: string;
  user_id: string;
  oauth_provider: string;
  connected: boolean;
  needs_reauthorization: boolean;
  token_ciphertext: string | null;
  token_nonce: string | null;
  token_key_version: number;
  expires_at: string | null;
  grant_id: string;
  refresh_lease_id: string | null;
}
interface OAuthClientRow {
  provider: string;
  client_id: string;
  client_secret_ciphertext: string | null;
  client_secret_nonce: string | null;
  secret_key_version: number;
  token_endpoint: string;
  resource: string | null;
}

const memberGrantContext = (organizationId: string, userId: string) =>
  `notion-member-grant:${organizationId}:${userId}`;
const clientSecretContext = (provider: string) => `notion-oauth-client:${provider}`;

function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function isFresh(expiresAt: string | null, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) && expires > now + REFRESH_AHEAD_MS;
}

function isUsableForThirtySeconds(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) && expires > Date.now() + 30_000;
}

function connectorRow(accessToken: string) {
  return {
    name: 'notion',
    url: NOTION_MCP_URL,
    authorization_token: accessToken,
    allowed_tools: NOTION_READ_TOOLS,
    enabled: true,
  };
}

function fencedConnectionUpdate(
  adminClient: SupabaseClient,
  organizationId: string,
  userId: string,
  grantId: string,
  leaseId: string,
  values: Record<string, unknown>,
) {
  return adminClient
    .from('organization_notion_connections')
    .update(values)
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .eq('grant_id', grantId)
    .eq('refresh_lease_id', leaseId)
    .select('grant_id');
}

async function markReauthorizationRequired(
  adminClient: SupabaseClient,
  organizationId: string,
  userId: string,
  grantId: string,
  leaseId: string,
) {
  await fencedConnectionUpdate(adminClient, organizationId, userId, grantId, leaseId, {
    connected: false,
    needs_reauthorization: true,
    token_ciphertext: null,
    token_nonce: null,
    expires_at: null,
    refresh_lease_id: null,
    refresh_locked_until: null,
    last_error: 'reauthorization_required',
  });
}

async function decryptClientSecret(client: OAuthClientRow): Promise<string | null> {
  if (!client.client_secret_ciphertext || !client.client_secret_nonce) return null;
  return decryptNotionSecret(
    client.client_secret_ciphertext,
    client.client_secret_nonce,
    client.secret_key_version,
    clientSecretContext(client.provider),
  );
}

/**
 * Resolve and, when needed, safely rotate this member's personal Notion MCP
 * OAuth grant. The returned shape still passes through the existing MCP
 * deny-by-default policy before being attached to Anthropic.
 */
export async function resolveNotionMcpConnectorRow(
  adminClient: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await adminClient
      .from('organization_notion_connections')
      .select('organization_id, user_id, oauth_provider, connected, needs_reauthorization, token_ciphertext, token_nonce, token_key_version, expires_at, grant_id, refresh_lease_id')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    if (
      error || !data?.connected || data.needs_reauthorization ||
      !data.token_ciphertext || !data.token_nonce
    ) return null;

    const current = data as NotionConnectionRow;
    const currentTokens = await decryptNotionTokens(
      current.token_ciphertext,
      current.token_nonce,
      current.token_key_version,
      memberGrantContext(organizationId, userId),
    );

    if (isFresh(current.expires_at)) {
      await adminClient
        .from('organization_notion_connections')
        .update({ last_used_at: new Date().toISOString() })
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .eq('grant_id', current.grant_id);
      return connectorRow(currentTokens.accessToken);
    }

    const leaseId = crypto.randomUUID();
    const { data: claimed, error: claimError } = await adminClient
      .rpc('claim_notion_token_refresh', {
        p_organization_id: organizationId,
        p_user_id: userId,
        p_lease_id: leaseId,
      });
    const claimedRow = Array.isArray(claimed) ? claimed[0] as NotionConnectionRow | undefined : undefined;

    if (claimError || !claimedRow) {
      // Another request may be rotating the same token. The existing access
      // token is safe to use only if it remains valid for the current round.
      return isUsableForThirtySeconds(current.expires_at)
        ? connectorRow(currentTokens.accessToken)
        : null;
    }

    const claimedTokens = await decryptNotionTokens(
      claimedRow.token_ciphertext!,
      claimedRow.token_nonce!,
      claimedRow.token_key_version,
      memberGrantContext(organizationId, userId),
    );
    const { data: oauthClient, error: oauthError } = await adminClient
      .from('notion_mcp_oauth_clients')
      .select('provider, client_id, client_secret_ciphertext, client_secret_nonce, secret_key_version, token_endpoint, resource')
      .eq('provider', claimedRow.oauth_provider || 'notion')
      .maybeSingle();
    if (oauthError || !oauthClient) {
      await fencedConnectionUpdate(adminClient, organizationId, userId, claimedRow.grant_id, leaseId, {
        refresh_lease_id: null,
        refresh_locked_until: null,
        last_error: 'oauth_client_missing',
      });
      return null;
    }

    const client = oauthClient as OAuthClientRow;
    const clientSecret = await decryptClientSecret(client);
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: claimedTokens.refreshToken,
      client_id: client.client_id,
    });
    if (clientSecret) params.set('client_secret', clientSecret);
    if (client.resource) params.set('resource', client.resource);

    const response = await fetchWithTimeout(client.token_endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Konekt-Copilot/1.0',
      },
      body: params.toString(),
    });
    const payload = await readJson(response);

    if (!response.ok) {
      if (payload.error === 'invalid_grant' || payload.error === 'invalid_client') {
        await markReauthorizationRequired(
          adminClient, organizationId, userId, claimedRow.grant_id, leaseId,
        );
      } else {
        await fencedConnectionUpdate(adminClient, organizationId, userId, claimedRow.grant_id, leaseId, {
          refresh_lease_id: null,
          refresh_locked_until: null,
          last_error: `refresh_failed_${response.status}`,
        });
      }
      return null;
    }

    if (typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string') {
      await fencedConnectionUpdate(adminClient, organizationId, userId, claimedRow.grant_id, leaseId, {
        refresh_lease_id: null,
        refresh_locked_until: null,
        last_error: 'refresh_response_incomplete',
      });
      return null;
    }

    const encryptedTokens = await encryptNotionTokens(
      payload.access_token,
      payload.refresh_token,
      memberGrantContext(organizationId, userId),
    );
    const expiresIn = Number(payload.expires_in);
    const expiresAt = new Date(Date.now() + (
      Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 7 * 60 * 60 * 1000
    )).toISOString();
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await fencedConnectionUpdate(
      adminClient,
      organizationId,
      userId,
      claimedRow.grant_id,
      leaseId,
      {
        token_ciphertext: encryptedTokens.ciphertext,
        token_nonce: encryptedTokens.nonce,
        token_key_version: encryptedTokens.keyVersion,
        token_type: typeof payload.token_type === 'string' ? payload.token_type : 'Bearer',
        expires_at: expiresAt,
        refresh_lease_id: null,
        refresh_locked_until: null,
        needs_reauthorization: false,
        last_refresh_at: now,
        last_used_at: now,
        last_error: null,
      },
    );
    if (updateError || !updated || updated.length !== 1) {
      // A reconnect/disconnect changed grant_id while the network call was in
      // flight. Discard this rotated result; never revive the stale grant.
      return null;
    }

    return connectorRow(payload.access_token);
  } catch (error) {
    console.warn('[notion-mcp] personal connector unavailable:', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}
