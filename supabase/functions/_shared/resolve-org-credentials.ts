/**
 * Shared credential resolver for multi-tenant edge functions.
 * Reads per-org credentials from organization_integrations, falls back to Deno.env.
 *
 * Usage:
 *   import { resolveUnipileCredentials, resolveNotionCredentials, resolveApolloCredentials, resolvePDLCredentials, resolveCoresignalCredentials, resolveAnthropicCredentials } from '../_shared/resolve-org-credentials.ts';
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
type SupabaseClient = ReturnType<typeof createClient>;

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

export interface ApolloCredentials {
  apiKey: string;
}

export interface PDLCredentials {
  apiKey: string;
}

export interface CoresignalCredentials {
  apiKey: string;
}

export interface AnthropicCredentials {
  apiKey: string;
}

// ─── Internal caches ─────────────────────────────────────────────────────────

const unipileCache = new Map<string, UnipileCredentials | null>();
const notionCache = new Map<string, NotionCredentials | null>();
const apolloCache = new Map<string, ApolloCredentials | null>();
const pdlCache = new Map<string, PDLCredentials | null>();
const coresignalCache = new Map<string, CoresignalCredentials | null>();
const anthropicCache = new Map<string, AnthropicCredentials | null>();

export function clearCredentialCaches() {
  unipileCache.clear();
  notionCache.clear();
  apolloCache.clear();
  pdlCache.clear();
  coresignalCache.clear();
  anthropicCache.clear();
}

// ─── Service client singleton ────────────────────────────────────────────────

let _svc: SupabaseClient | null = null;

function getServiceClient(): SupabaseClient {
  if (!_svc) {
    _svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
    );
  }
  return _svc;
}

// ─── Unipile ─────────────────────────────────────────────────────────────────

function normalizeDsn(raw: string): string {
  const cleaned = raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${cleaned}`;
}

export async function resolveUnipileCredentials(
  organizationId?: string | null,
  supabaseClient?: SupabaseClient
): Promise<UnipileCredentials | null> {
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

    unipileCache.set(organizationId, null);
  }

  const envKey = Deno.env.get("UNIPILE_API_KEY");
  const envDsn = Deno.env.get("UNIPILE_DSN");
  if (envKey && envDsn) {
    return { apiKey: envKey, dsn: normalizeDsn(envDsn) };
  }

  return null;
}

// ─── Notion ──────────────────────────────────────────────────────────────────

export async function resolveNotionCredentials(
  organizationId?: string | null,
  supabaseClient?: SupabaseClient
): Promise<NotionCredentials | null> {
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

// ─── Apollo ──────────────────────────────────────────────────────────────────

export async function resolveApolloCredentials(
  organizationId?: string | null,
  supabaseClient?: SupabaseClient
): Promise<ApolloCredentials | null> {
  if (organizationId) {
    const cached = apolloCache.get(organizationId);
    if (cached !== undefined) return cached;

    try {
      const sb = supabaseClient ?? getServiceClient();
      const { data } = await sb
        .from("organization_integrations")
        .select("apollo_api_key")
        .eq("organization_id", organizationId)
        .single();

      if (data?.apollo_api_key) {
        const creds: ApolloCredentials = { apiKey: data.apollo_api_key };
        console.log(`[resolve-creds] Using org-specific Apollo credentials for org ${organizationId}`);
        apolloCache.set(organizationId, creds);
        return creds;
      }
    } catch (e) {
      console.warn(`[resolve-creds] Failed to resolve org Apollo credentials:`, e);
    }
    apolloCache.set(organizationId, null);
  }

  const envKey = Deno.env.get("APOLLO_API_KEY");
  if (envKey) return { apiKey: envKey };
  return null;
}

// ─── PDL (PeopleDataLabs) ────────────────────────────────────────────────────

export async function resolvePDLCredentials(
  organizationId?: string | null,
  supabaseClient?: SupabaseClient
): Promise<PDLCredentials | null> {
  if (organizationId) {
    const cached = pdlCache.get(organizationId);
    if (cached !== undefined) return cached;

    try {
      const sb = supabaseClient ?? getServiceClient();
      const { data } = await sb
        .from("organization_integrations")
        .select("pdl_api_key")
        .eq("organization_id", organizationId)
        .single();

      if (data?.pdl_api_key) {
        const creds: PDLCredentials = { apiKey: data.pdl_api_key };
        console.log(`[resolve-creds] Using org-specific PDL credentials for org ${organizationId}`);
        pdlCache.set(organizationId, creds);
        return creds;
      }
    } catch (e) {
      console.warn(`[resolve-creds] Failed to resolve org PDL credentials:`, e);
    }
    pdlCache.set(organizationId, null);
  }

  const envKey = Deno.env.get("PDL_API_KEY");
  if (envKey) return { apiKey: envKey };
  return null;
}

// ─── Coresignal (Base Konekt) ────────────────────────────────────────────────

export async function resolveCoresignalCredentials(
  organizationId?: string | null,
  supabaseClient?: SupabaseClient
): Promise<CoresignalCredentials | null> {
  if (organizationId) {
    const cached = coresignalCache.get(organizationId);
    if (cached !== undefined) return cached;

    try {
      const sb = supabaseClient ?? getServiceClient();
      const { data } = await sb
        .from("organization_integrations")
        .select("coresignal_api_key")
        .eq("organization_id", organizationId)
        .single();

      if (data?.coresignal_api_key) {
        const creds: CoresignalCredentials = { apiKey: data.coresignal_api_key };
        console.log(`[resolve-creds] Using org-specific Coresignal credentials for org ${organizationId}`);
        coresignalCache.set(organizationId, creds);
        return creds;
      }
    } catch (e) {
      console.warn(`[resolve-creds] Failed to resolve org Coresignal credentials:`, e);
    }
    coresignalCache.set(organizationId, null);
  }

  const envKey = Deno.env.get("CORESIGNAL_API_KEY");
  if (envKey) return { apiKey: envKey };
  return null;
}

// ─── Anthropic ───────────────────────────────────────────────────────────────

export async function resolveAnthropicCredentials(
  organizationId?: string | null,
  supabaseClient?: SupabaseClient
): Promise<AnthropicCredentials | null> {
  if (organizationId) {
    const cached = anthropicCache.get(organizationId);
    if (cached !== undefined) return cached;

    try {
      const sb = supabaseClient ?? getServiceClient();
      const { data } = await sb
        .from("organization_integrations")
        .select("anthropic_api_key")
        .eq("organization_id", organizationId)
        .single();

      if (data?.anthropic_api_key) {
        const creds: AnthropicCredentials = { apiKey: data.anthropic_api_key };
        console.log(`[resolve-creds] Using org-specific Anthropic credentials for org ${organizationId}`);
        anthropicCache.set(organizationId, creds);
        return creds;
      }
    } catch (e) {
      console.warn(`[resolve-creds] Failed to resolve org Anthropic credentials:`, e);
    }
    anthropicCache.set(organizationId, null);
  }

  const envKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (envKey) return { apiKey: envKey };
  return null;
}

// ─── Resolve org from user ───────────────────────────────────────────────────

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
