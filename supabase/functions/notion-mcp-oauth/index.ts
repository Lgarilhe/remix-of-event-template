import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
import { buildCorsHeaders } from '../_shared/cors.ts';
import { requireOrgAccess } from '../_shared/require-auth.ts';
import {
  buildNotionAuthorizationUrl,
  buildNotionReturnUrl,
  normalizeNotionReturnUrl,
  selectNotionReadScopes,
} from '../_shared/notion-oauth-policy.mjs';
import {
  decryptNotionSecret,
  decryptNotionTokens,
  encryptNotionSecret,
  encryptNotionTokens,
} from '../_shared/notion-secret-crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
const APP_URL = Deno.env.get('APP_URL') || 'https://konekt-app-navy.vercel.app';
const EXTRA_RETURN_ORIGINS = Deno.env.get('NOTION_ALLOWED_RETURN_ORIGINS') || '';
const NOTION_MCP_URL = 'https://mcp.notion.com/mcp';
const PROVIDER = 'notion';
const CALLBACK_URL = `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/notion-mcp-oauth`;
const STATE_TTL_MS = 10 * 60 * 1000;

const clientSecretContext = (provider: string) => `notion-oauth-client:${provider}`;
const stateVerifierContext = (stateHash: string) => `notion-oauth-state:${stateHash}`;
const memberGrantContext = (organizationId: string, userId: string) =>
  `notion-member-grant:${organizationId}:${userId}`;

type AdminClient = ReturnType<typeof createClient>;

interface OAuthMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

interface OAuthClientRow {
  provider: string;
  client_id: string;
  client_secret_ciphertext: string | null;
  client_secret_nonce: string | null;
  secret_key_version: number;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string | null;
  revocation_endpoint: string | null;
  resource: string;
  requested_scope: string | null;
}

interface OAuthStateRow {
  organization_id: string;
  user_id: string;
  return_to: string;
  redirect_uri: string;
  code_verifier_ciphertext: string;
  code_verifier_nonce: string;
  verifier_key_version: number;
  oauth_provider: string;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function redirect(location: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function randomBase64Url(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = await sha256Bytes(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await sha256Bytes(value);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function firstJson(urls: string[]): Promise<Record<string, unknown>> {
  let lastStatus = 0;
  for (const url of [...new Set(urls)]) {
    try {
      const response = await fetchWithTimeout(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Konekt-Copilot/1.0' },
      });
      lastStatus = response.status;
      if (response.ok) return await readJson(response);
    } catch {
      // Try the next standards-compatible discovery location.
    }
  }
  throw new HttpError(502, `Notion OAuth discovery failed (${lastStatus || 'network'})`);
}

async function discoverOAuth(): Promise<{
  metadata: OAuthMetadata;
  resource: string;
  scopes: string[];
}> {
  const origin = new URL(NOTION_MCP_URL).origin;
  const protectedResource = await firstJson([
    `${origin}/.well-known/oauth-protected-resource/mcp`,
    `${origin}/.well-known/oauth-protected-resource`,
    `${NOTION_MCP_URL.replace(/\/+$/, '')}/.well-known/oauth-protected-resource`,
  ]);

  const authorizationServers = Array.isArray(protectedResource.authorization_servers)
    ? protectedResource.authorization_servers.filter((value): value is string => typeof value === 'string')
    : [];
  if (authorizationServers.length === 0) {
    throw new HttpError(502, 'Notion did not advertise an authorization server');
  }

  const authorizationServer = authorizationServers[0];
  const serverUrl = new URL(authorizationServer);
  const metadataRaw = await firstJson([
    authorizationServer.includes('/.well-known/') ? authorizationServer : '',
    new URL('/.well-known/oauth-authorization-server', serverUrl).toString(),
    `${authorizationServer.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`,
  ].filter(Boolean));

  const metadata = metadataRaw as unknown as OAuthMetadata;
  if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.registration_endpoint) {
    throw new HttpError(502, 'Notion OAuth metadata is incomplete');
  }
  if (
    Array.isArray(metadata.code_challenge_methods_supported) &&
    !metadata.code_challenge_methods_supported.includes('S256')
  ) {
    throw new HttpError(502, 'Notion OAuth does not advertise PKCE S256');
  }

  const resource = typeof protectedResource.resource === 'string'
    ? protectedResource.resource
    : NOTION_MCP_URL;
  const advertisedScopes = Array.isArray(protectedResource.scopes_supported)
    ? protectedResource.scopes_supported
    : metadata.scopes_supported;
  const scopes = selectNotionReadScopes(advertisedScopes);

  return {
    metadata,
    resource,
    scopes,
  };
}

async function getOrCreateOAuthClient(adminClient: AdminClient): Promise<OAuthClientRow> {
  const { data: existing } = await adminClient
    .from('notion_mcp_oauth_clients')
    .select('provider, client_id, client_secret_ciphertext, client_secret_nonce, secret_key_version, authorization_endpoint, token_endpoint, registration_endpoint, revocation_endpoint, resource, requested_scope')
    .eq('provider', PROVIDER)
    .maybeSingle();
  if (existing?.client_id) return existing as OAuthClientRow;

  const { metadata, resource, scopes } = await discoverOAuth();
  const registrationResponse = await fetchWithTimeout(metadata.registration_endpoint!, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Konekt-Copilot/1.0',
    },
    body: JSON.stringify({
      client_name: 'Konekt Copilot',
      client_uri: APP_URL,
      redirect_uris: [CALLBACK_URL],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(scopes.length > 0 ? { scope: scopes.join(' ') } : {}),
    }),
  });
  const registration = await readJson(registrationResponse);
  if (!registrationResponse.ok || typeof registration.client_id !== 'string') {
    throw new HttpError(502, 'Notion refused the secure connection registration');
  }

  const encryptedClientSecret = typeof registration.client_secret === 'string'
    ? await encryptNotionSecret(registration.client_secret, clientSecretContext(PROVIDER))
    : null;
  const candidate: OAuthClientRow = {
    provider: PROVIDER,
    client_id: registration.client_id,
    client_secret_ciphertext: encryptedClientSecret?.ciphertext ?? null,
    client_secret_nonce: encryptedClientSecret?.nonce ?? null,
    secret_key_version: encryptedClientSecret?.keyVersion ?? 1,
    authorization_endpoint: metadata.authorization_endpoint,
    token_endpoint: metadata.token_endpoint,
    registration_endpoint: metadata.registration_endpoint || null,
    revocation_endpoint: metadata.revocation_endpoint || null,
    resource,
    requested_scope: scopes.length > 0 ? scopes.join(' ') : null,
  };

  // A simultaneous first connection may have won the singleton insert. Reuse
  // that durable client instead of replacing it and orphaning prior grants.
  const { error: insertError } = await adminClient
    .from('notion_mcp_oauth_clients')
    .insert(candidate);
  if (insertError && insertError.code !== '23505') throw insertError;

  const { data: stored, error: storedError } = await adminClient
    .from('notion_mcp_oauth_clients')
    .select('provider, client_id, client_secret_ciphertext, client_secret_nonce, secret_key_version, authorization_endpoint, token_endpoint, registration_endpoint, revocation_endpoint, resource, requested_scope')
    .eq('provider', PROVIDER)
    .single();
  if (storedError || !stored) throw storedError ?? new Error('OAuth client was not stored');
  return stored as OAuthClientRow;
}

async function decryptClientSecret(oauthClient: OAuthClientRow): Promise<string | null> {
  if (!oauthClient.client_secret_ciphertext || !oauthClient.client_secret_nonce) return null;
  return decryptNotionSecret(
    oauthClient.client_secret_ciphertext,
    oauthClient.client_secret_nonce,
    oauthClient.secret_key_version,
    clientSecretContext(oauthClient.provider),
  );
}

async function getRole(adminClient: AdminClient, userId: string, organizationId: string): Promise<string | null> {
  const { data } = await adminClient
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  return typeof data?.role === 'string' ? data.role.toLowerCase() : null;
}

const isMember = (role: string | null) => role !== null;

async function handleStart(
  adminClient: AdminClient,
  userId: string,
  organizationId: string,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
) {
  const role = await getRole(adminClient, userId, organizationId);
  if (!isMember(role)) throw new HttpError(403, 'Tu ne fais pas partie de cette organisation.');

  const returnTo = normalizeNotionReturnUrl(body.return_to, APP_URL, EXTRA_RETURN_ORIGINS);
  if (!returnTo) throw new HttpError(400, 'Adresse de retour Konekt invalide.');

  const oauthClient = await getOrCreateOAuthClient(adminClient);
  const state = randomBase64Url();
  const codeVerifier = randomBase64Url();
  const [stateHash, codeChallenge] = await Promise.all([
    sha256Hex(state),
    sha256Base64Url(codeVerifier),
  ]);
  const encryptedVerifier = await encryptNotionSecret(codeVerifier, stateVerifierContext(stateHash));

  await adminClient
    .from('notion_oauth_states')
    .delete()
    .lt('expires_at', new Date(Date.now() - 60_000).toISOString());

  const { error: stateError } = await adminClient.from('notion_oauth_states').insert({
    state_hash: stateHash,
    organization_id: organizationId,
    user_id: userId,
    return_to: returnTo,
    redirect_uri: CALLBACK_URL,
    code_verifier_ciphertext: encryptedVerifier.ciphertext,
    code_verifier_nonce: encryptedVerifier.nonce,
    verifier_key_version: encryptedVerifier.keyVersion,
    oauth_provider: PROVIDER,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  if (stateError) throw stateError;

  const authorizationUrl = buildNotionAuthorizationUrl({
    authorizationEndpoint: oauthClient.authorization_endpoint,
    clientId: oauthClient.client_id,
    redirectUri: CALLBACK_URL,
    codeChallenge,
    state,
    scopes: oauthClient.requested_scope?.split(/\s+/).filter(Boolean) ?? [],
    resource: oauthClient.resource,
  });

  return json({ success: true, authorization_url: authorizationUrl }, 200, corsHeaders);
}

async function handleStatus(
  adminClient: AdminClient,
  userId: string,
  organizationId: string,
  corsHeaders: Record<string, string>,
) {
  const [role, result] = await Promise.all([
    getRole(adminClient, userId, organizationId),
    adminClient
      .from('organization_notion_connections')
      .select('connected, needs_reauthorization, workspace_id, email_domain, connected_at, expires_at, last_error')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  if (result.error) throw result.error;

  const row = result.data;
  return json({
    success: true,
    can_manage: isMember(role),
    connection: row ? {
      connected: row.connected === true,
      needs_reauthorization: row.needs_reauthorization === true,
      workspace_id: row.workspace_id ?? null,
      email_domain: row.email_domain ?? null,
      connected_at: row.connected_at ?? null,
      expires_at: row.expires_at ?? null,
      has_error: Boolean(row.last_error),
    } : null,
  }, 200, corsHeaders);
}

async function handleDisconnect(
  adminClient: AdminClient,
  userId: string,
  organizationId: string,
  corsHeaders: Record<string, string>,
) {
  const role = await getRole(adminClient, userId, organizationId);
  if (!isMember(role)) throw new HttpError(403, 'Tu ne fais pas partie de cette organisation.');

  const [{ data: connection }, { data: oauthClient }] = await Promise.all([
    adminClient
      .from('organization_notion_connections')
      .select('token_ciphertext, token_nonce, token_key_version, oauth_provider')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle(),
    adminClient
      .from('notion_mcp_oauth_clients')
      .select('provider, client_id, client_secret_ciphertext, client_secret_nonce, secret_key_version, authorization_endpoint, token_endpoint, registration_endpoint, revocation_endpoint, resource, requested_scope')
      .eq('provider', PROVIDER)
      .maybeSingle(),
  ]);

  let remotelyRevoked = false;
  if (connection?.token_ciphertext && connection?.token_nonce && oauthClient?.revocation_endpoint) {
    try {
      const tokens = await decryptNotionTokens(
        connection.token_ciphertext,
        connection.token_nonce,
        connection.token_key_version,
        memberGrantContext(organizationId, userId),
      );
      const clientSecret = await decryptClientSecret(oauthClient as OAuthClientRow);
      const params = new URLSearchParams({
        token: tokens.accessToken,
        client_id: oauthClient.client_id,
      });
      if (clientSecret) params.set('client_secret', clientSecret);
      const response = await fetchWithTimeout(oauthClient.revocation_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: params.toString(),
      });
      remotelyRevoked = response.ok;
    } catch {
      remotelyRevoked = false;
    }
  }

  const { error } = await adminClient
    .from('organization_notion_connections')
    .update({
      connected: false,
      needs_reauthorization: false,
      token_ciphertext: null,
      token_nonce: null,
      token_type: null,
      expires_at: null,
      grant_id: crypto.randomUUID(),
      refresh_lease_id: null,
      refresh_locked_until: null,
      notion_user_id: null,
      workspace_id: null,
      email_domain: null,
      connected_at: null,
      last_refresh_at: null,
      last_used_at: null,
      last_error: null,
    })
    .eq('organization_id', organizationId)
    .eq('user_id', userId);
  if (error) throw error;

  return json({ success: true, remotely_revoked: remotelyRevoked }, 200, corsHeaders);
}

async function consumeState(adminClient: AdminClient, rawState: string): Promise<OAuthStateRow | null> {
  const stateHash = await sha256Hex(rawState);
  const now = new Date().toISOString();
  const { data, error } = await adminClient
    .from('notion_oauth_states')
    .update({ used_at: now })
    .eq('state_hash', stateHash)
    .is('used_at', null)
    .gt('expires_at', now)
    .select('organization_id, user_id, return_to, redirect_uri, code_verifier_ciphertext, code_verifier_nonce, verifier_key_version, oauth_provider')
    .maybeSingle();
  if (error) throw error;
  return data as OAuthStateRow | null;
}

async function exchangeCode(
  oauthClient: OAuthClientRow,
  state: OAuthStateRow,
  stateHash: string,
  code: string,
): Promise<Record<string, unknown>> {
  const [codeVerifier, clientSecret] = await Promise.all([
    decryptNotionSecret(
      state.code_verifier_ciphertext,
      state.code_verifier_nonce,
      state.verifier_key_version,
      stateVerifierContext(stateHash),
    ),
    decryptClientSecret(oauthClient),
  ]);
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: oauthClient.client_id,
    redirect_uri: state.redirect_uri,
    code_verifier: codeVerifier,
  });
  if (clientSecret) params.set('client_secret', clientSecret);
  if (oauthClient.resource) params.set('resource', oauthClient.resource);

  const response = await fetchWithTimeout(oauthClient.token_endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Konekt-Copilot/1.0',
    },
    body: params.toString(),
  });
  const payload = await readJson(response);
  if (!response.ok || typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string') {
    throw new HttpError(502, 'Notion token exchange failed');
  }
  return payload;
}

async function handleCallback(req: Request, adminClient: AdminClient) {
  const url = new URL(req.url);
  const rawState = url.searchParams.get('state');
  const fallback = normalizeNotionReturnUrl(
    `${APP_URL.replace(/\/+$/, '')}/settings?tab=agent-actions`,
    APP_URL,
    EXTRA_RETURN_ORIGINS,
  )!;
  if (!rawState) return redirect(buildNotionReturnUrl(fallback, 'error', 'state_missing'));

  const stateHash = await sha256Hex(rawState);
  const state = await consumeState(adminClient, rawState);
  if (!state) return redirect(buildNotionReturnUrl(fallback, 'error', 'state_expired'));

  const safeReturn = normalizeNotionReturnUrl(state.return_to, APP_URL, EXTRA_RETURN_ORIGINS) || fallback;
  const role = await getRole(adminClient, state.user_id, state.organization_id);
  if (!isMember(role)) {
    return redirect(buildNotionReturnUrl(safeReturn, 'error', 'permission_changed'));
  }

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const code = oauthError === 'access_denied' ? 'access_denied' : 'authorization_failed';
    return redirect(buildNotionReturnUrl(safeReturn, 'error', code));
  }

  const code = url.searchParams.get('code');
  if (!code) return redirect(buildNotionReturnUrl(safeReturn, 'error', 'code_missing'));

  try {
    const { data: oauthClient, error: clientError } = await adminClient
      .from('notion_mcp_oauth_clients')
      .select('provider, client_id, client_secret_ciphertext, client_secret_nonce, secret_key_version, authorization_endpoint, token_endpoint, registration_endpoint, revocation_endpoint, resource, requested_scope')
      .eq('provider', state.oauth_provider)
      .single();
    if (clientError || !oauthClient) throw clientError ?? new Error('OAuth client missing');

    const tokens = await exchangeCode(oauthClient as OAuthClientRow, state, stateHash, code);
    const expiresIn = Number(tokens.expires_in);
    const expiresAt = new Date(Date.now() + (
      Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 7 * 60 * 60 * 1000
    )).toISOString();
    const now = new Date().toISOString();
    const encryptedTokens = await encryptNotionTokens(
      tokens.access_token as string,
      tokens.refresh_token as string,
      memberGrantContext(state.organization_id, state.user_id),
    );

    const { error: upsertError } = await adminClient
      .from('organization_notion_connections')
      .upsert({
        organization_id: state.organization_id,
        user_id: state.user_id,
        oauth_provider: state.oauth_provider,
        connected: true,
        needs_reauthorization: false,
        token_ciphertext: encryptedTokens.ciphertext,
        token_nonce: encryptedTokens.nonce,
        token_key_version: encryptedTokens.keyVersion,
        token_type: typeof tokens.token_type === 'string' ? tokens.token_type : 'Bearer',
        expires_at: expiresAt,
        grant_id: crypto.randomUUID(),
        refresh_lease_id: null,
        refresh_locked_until: null,
        notion_user_id: typeof tokens.user_id === 'string' ? tokens.user_id : null,
        workspace_id: typeof tokens.workspace_id === 'string' ? tokens.workspace_id : null,
        email_domain: typeof tokens.email_domain === 'string' ? tokens.email_domain : null,
        connected_at: now,
        last_refresh_at: now,
        last_error: null,
      }, { onConflict: 'organization_id,user_id' });
    if (upsertError) throw upsertError;

    return redirect(buildNotionReturnUrl(safeReturn, 'connected'));
  } catch (error) {
    console.error('[notion-mcp-oauth] callback failed:', error instanceof Error ? error.message : 'unknown');
    return redirect(buildNotionReturnUrl(safeReturn, 'error', 'exchange_failed'));
  }
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
  if (req.method === 'GET') {
    try {
      return await handleCallback(req, adminClient);
    } catch (error) {
      console.error('[notion-mcp-oauth] public callback error:', error instanceof Error ? error.message : 'unknown');
      const fallback = `${APP_URL.replace(/\/+$/, '')}/settings?tab=agent-actions`;
      return redirect(buildNotionReturnUrl(fallback, 'error', 'callback_failed'));
    }
  }

  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405, corsHeaders);

  try {
    const body = await req.json() as Record<string, unknown>;
    const { userId, organizationId } = await requireOrgAccess(req, body, corsHeaders);
    const action = typeof body.action === 'string' ? body.action : '';

    if (action === 'start') return await handleStart(adminClient, userId, organizationId, body, corsHeaders);
    if (action === 'status') return await handleStatus(adminClient, userId, organizationId, corsHeaders);
    if (action === 'disconnect') return await handleDisconnect(adminClient, userId, organizationId, corsHeaders);
    throw new HttpError(400, 'Action Notion inconnue.');
  } catch (error) {
    if (error instanceof Response) return error;
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError
      ? error.message
      : 'La connexion Notion est temporairement indisponible.';
    console.error('[notion-mcp-oauth] request failed:', error instanceof Error ? error.message : 'unknown');
    return json({ success: false, error: message }, status, corsHeaders);
  }
});
