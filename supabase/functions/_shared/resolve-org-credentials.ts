/**
 * Shared credential resolver for multi-tenant edge functions.
 * Reads per-org credentials from organization_integrations, falls back to Deno.env.
 *
 * Usage:
 *   import { resolveUnipileCredentials, resolveNotionCredentials } from '../_shared/resolve-org-credentials.ts';
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UnipileCredentials {
  apiKey: string;
  dsn: string; // always https://... format
}

export interface NotionCredentials {
  apiKey: string;
  candidatsDbId: string | null;
  shortlistDbId: string | null;
  postesDbId: string | null;
}

// ─── Internal cache ──────────────────────────────────────────────────────────

const unipileCache = new Map<string, UnipileCredentials | null>();
const notionCache = new Map<string, NotionCredentials | null>();

export function clearCredentialCaches() {
  unipileCache.clear();
  notionCache.clear();
}

// ─── Service client singleton ────────────────────────────────────────────────

let _svc: SupabaseClient | null = null;

function getServiceClient(): SupabaseClient {
  if (!_svc) {
    _svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
  }
  return _svc;
}

// ─── Unipile ─────────────────────────────────────────────────────────────────

function normalizeDsn(raw: string): string {
  const cleaned = raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${cleaned}`;
}

/**
 * Resolve Unipile credentials for an organization.
 * Tries organization_integrations first, then falls back to Deno.env.
 * Returns null if neither source has valid credentials.
 */
export async function resolveUnipileCredentials(
  organizationId?: string | null,
  supabaseClient?: SupabaseClient
): Promise<UnipileCredentials | null> {
  // Try org-specific
  if (organizationId) {
    const cached = unipileCache.get(organizationId);
    if (cached !== undefined) return cached;

    try {
      const sb = supabaseClient ?? getServiceClient();
      const { data } = await sb
        .from("organization_integrations")
        .select("unipile_api_key, unipile_dsn, unipile_connected")
        .eq("organization_id", organizationId)
        .single();

      if (data?.unipile_connected && data?.unipile_api_key && data?.unipile_dsn) {
        const creds: UnipileCredentials = {
          apiKey: data.unipile_api_key,
          dsn: normalizeDsn(data.unipile_dsn),
        };
        console.log(`[resolve-creds] Using org-specific Unipile credentials for org ${organizationId}`);
        unipileCache.set(organizationId, creds);
        return creds;
      }
    } catch (e) {
      console.warn(`[resolve-creds] Failed to resolve org Unipile credentials:`, e);
    }

    // Mark as checked but not found — will fall through to env
    unipileCache.set(organizationId, null);
  }

  // Fallback to env
  const envKey = Deno.env.get("UNIPILE_API_KEY");
  const envDsn = Deno.env.get("UNIPILE_DSN");
  if (envKey && envDsn) {
    return { apiKey: envKey, dsn: normalizeDsn(envDsn) };
  }

  return null;
}

// ─── Notion ──────────────────────────────────────────────────────────────────

/**
 * Resolve Notion credentials for an organization.
 * Tries organization_integrations first, then falls back to Deno.env.
 * Returns null if neither source has a valid API key.
 */
export async function resolveNotionCredentials(
  organizationId?: string | null,
  supabaseClient?: SupabaseClient
): Promise<NotionCredentials | null> {
  // Try org-specific
  if (organizationId) {
    const cached = notionCache.get(organizationId);
    if (cached !== undefined) return cached;

    try {
      const sb = supabaseClient ?? getServiceClient();
      const { data } = await sb
        .from("organization_integrations")
        .select("notion_api_key, notion_candidats_db_id, notion_shortlist_db_id, notion_postes_db_id, notion_connected")
        .eq("organization_id", organizationId)
        .single();

      if (data?.notion_connected && data?.notion_api_key) {
        const creds: NotionCredentials = {
          apiKey: data.notion_api_key,
          candidatsDbId: data.notion_candidats_db_id || null,
          shortlistDbId: data.notion_shortlist_db_id || null,
          postesDbId: data.notion_postes_db_id || null,
        };
        console.log(`[resolve-creds] Using org-specific Notion credentials for org ${organizationId}`);
        notionCache.set(organizationId, creds);
        return creds;
      }
    } catch (e) {
      console.warn(`[resolve-creds] Failed to resolve org Notion credentials:`, e);
    }

    notionCache.set(organizationId, null);
  }

  // Fallback to env
  const envKey = Deno.env.get("NOTION_API_KEY");
  if (envKey) {
    return {
      apiKey: envKey,
      candidatsDbId: Deno.env.get("NOTION_CANDIDATS_DB_ID") || null,
      shortlistDbId: Deno.env.get("NOTION_SHORTLIST_DB_ID") || null,
      postesDbId: Deno.env.get("NOTION_POSTES_DB_ID") || null,
    };
  }

  return null;
}

/**
 * Resolve organization_id from a user's profile.
 * Useful when only the user JWT is available.
 */
export async function resolveOrgIdFromUser(
  userId: string,
  supabaseClient?: SupabaseClient
): Promise<string | null> {
  try {
    const sb = supabaseClient ?? getServiceClient();
    const { data } = await sb
      .from("profiles")
      .select("active_organization_id")
      .eq("user_id", userId)
      .single();
    return data?.active_organization_id || null;
  } catch {
    return null;
  }
}
