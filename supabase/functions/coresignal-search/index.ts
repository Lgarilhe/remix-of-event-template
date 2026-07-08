// Coresignal (Base Konekt) — recherche & collecte de profils.
// Cf. docs/coresignal-integration-audit.md.
//
// Actions :
//   - preview : recherche → 20 cards (identité visible), pour le browsing
//   - search  : recherche → IDs + total (estimation de volume / bulk)
//   - collect : profil complet par id/linkedin_url (avec cache), pour le scoring
//
// Conventions : Search = POST, Collect = GET, header `apikey`. Crédits Konekt
// settle en interne (pas d'appel LLM). Le nom « Coresignal » ne doit jamais
// remonter côté UI → « Base Konekt » (CLAUDE.md).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { resolveCoresignalCredentials } from "../_shared/resolve-org-credentials.ts";
import {
  mapFiltersToEsDsl,
  coresignalToLinkedInProfile,
  coresignalPreviewToProfile,
  type LinkedInFiltersLite,
} from "../_shared/coresignal-mapping.ts";
import { settleCredits } from "../_shared/settle-credits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CORESIGNAL_BASE = "https://api.coresignal.com/cdapi/v2";
const EMPLOYEE = "employee_multi_source";
const PREVIEW_PAGE_SIZE = 20;
const PREVIEW_MAX_PAGES = 5; // Coresignal plafonne le preview à 100 résultats
const MAX_ES_DSL_CHARS = 15000;

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
  );
}

/** Résout l'org depuis le body, sinon l'org active du user. */
async function resolveOrg(
  svc: ReturnType<typeof serviceClient>,
  userId: string,
  bodyOrgId?: string,
): Promise<string | null> {
  if (bodyOrgId) return bodyOrgId;
  const { data } = await svc
    .from("profiles")
    .select("active_organization_id")
    .eq("id", userId)
    .maybeSingle();
  return (data?.active_organization_id as string) ?? null;
}

interface CoresignalHttp {
  ok: boolean;
  status: number;
  totalResults: number | null;
  creditsRemaining: number | null;
  body: unknown;
}

async function callCoresignal(
  apiKey: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<CoresignalHttp> {
  const res = await fetchWithTimeout(`${CORESIGNAL_BASE}/${path}`, {
    method: init.method,
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: init.body ? JSON.stringify(init.body) : undefined,
  }, 20000);

  const totalResults = res.headers.get("x-total-results");
  const creditsRemaining = res.headers.get("x-credits-remaining");
  let body: unknown = null;
  try { body = await res.json(); } catch { /* peut être vide sur erreur */ }

  return {
    ok: res.ok,
    status: res.status,
    totalResults: totalResults != null ? Number(totalResults) : null,
    creditsRemaining: creditsRemaining != null ? Number(creditsRemaining) : null,
    body,
  };
}

/** Mappe les erreurs Coresignal → réponse Konekt (sans nommer le fournisseur). */
function mapCoresignalError(http: CoresignalHttp): Response {
  if (http.status === 402) {
    return json(402, { success: false, error: "Quota Base Konekt épuisé", errorType: "CREDITS", retryable: false });
  }
  if (http.status === 429) {
    return json(429, { success: false, error: "Trop de requêtes, réessayez dans un instant", errorType: "RATE_LIMIT", retryable: true });
  }
  return json(502, { success: false, error: "La Base Konekt est momentanément indisponible", errorType: "UPSTREAM", retryable: true });
}

/** Débite les crédits Konekt (action non-LLM, floor utilisé car tokens=0). */
async function settle(svc: ReturnType<typeof serviceClient>, orgId: string | null, userId: string | null, action: string, description: string) {
  if (!orgId) return;
  try {
    await settleCredits(svc, {
      organizationId: orgId,
      userId: userId ?? "",
      aiAction: action,
      modelId: "claude-haiku-4-5", // factice : tokens=0 → floor de l'action
      tokensInput: 0,
      tokensOutput: 0,
      description,
    });
  } catch (e) {
    console.warn("[coresignal-search] settleCredits failed (non-blocking):", e);
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handlePreview(apiKey: string, svc: ReturnType<typeof serviceClient>, orgId: string | null, userId: string | null, params: Record<string, unknown>): Promise<Response> {
  const filters = (params.filters ?? {}) as LinkedInFiltersLite;
  const page = Math.max(1, Math.min(PREVIEW_MAX_PAGES, Number(params.page) || 1));

  const { query, sort } = mapFiltersToEsDsl(filters);
  const dsl = { query, sort };
  if (JSON.stringify(dsl).length > MAX_ES_DSL_CHARS) {
    return json(400, { success: false, error: "Recherche trop complexe, réduisez le nombre de critères", errorType: "QUERY_TOO_LARGE" });
  }

  const http = await callCoresignal(apiKey, `${EMPLOYEE}/search/es_dsl/preview?page=${page}`, { method: "POST", body: dsl });
  if (!http.ok) return mapCoresignalError(http);

  const rawList = Array.isArray(http.body) ? (http.body as Record<string, unknown>[]) : [];
  const results = rawList.map(coresignalPreviewToProfile);
  const total = http.totalResults;

  // Pagination preview : page suivante si pleine ET dans le plafond de 100.
  const hasMore = results.length === PREVIEW_PAGE_SIZE && page < PREVIEW_MAX_PAGES && (total == null || page * PREVIEW_PAGE_SIZE < total);
  const cursor = hasMore ? String(page + 1) : null;

  await settle(svc, orgId, userId, "coresignal_preview", `Base Konekt — aperçu (page ${page})`);
  console.log(`[coresignal-search] preview page=${page} results=${results.length} total=${total} credits=${http.creditsRemaining}`);

  return json(200, { success: true, results, cursor, total });
}

async function handleSearch(apiKey: string, svc: ReturnType<typeof serviceClient>, orgId: string | null, userId: string | null, params: Record<string, unknown>): Promise<Response> {
  const filters = (params.filters ?? {}) as LinkedInFiltersLite;
  const after = params.cursor as string | undefined;

  const { query, sort } = mapFiltersToEsDsl(filters);
  const dsl = { query, sort };
  if (JSON.stringify(dsl).length > MAX_ES_DSL_CHARS) {
    return json(400, { success: false, error: "Recherche trop complexe, réduisez le nombre de critères", errorType: "QUERY_TOO_LARGE" });
  }

  const qs = after ? `?after=${encodeURIComponent(after)}` : "";
  const http = await callCoresignal(apiKey, `${EMPLOYEE}/search/es_dsl${qs}`, { method: "POST", body: dsl });
  if (!http.ok) return mapCoresignalError(http);

  const ids = Array.isArray(http.body) ? (http.body as unknown[]).map(String) : [];

  await settle(svc, orgId, userId, "coresignal_preview", "Base Konekt — recherche (IDs)");
  console.log(`[coresignal-search] search ids=${ids.length} total=${http.totalResults} credits=${http.creditsRemaining}`);

  return json(200, { success: true, ids, total: http.totalResults, cursor: null });
}

async function handleCollect(apiKey: string, svc: ReturnType<typeof serviceClient>, orgId: string | null, userId: string | null, params: Record<string, unknown>): Promise<Response> {
  const id = params.id != null ? String(params.id) : undefined;
  const linkedinUrl = params.linkedin_url ? String(params.linkedin_url).replace(/\/+$/, "") : undefined;
  if (!id && !linkedinUrl) {
    return json(400, { success: false, error: "id ou linkedin_url requis", errorType: "BAD_REQUEST" });
  }

  // 1. Cache (par org)
  if (orgId) {
    const q = svc.from("coresignal_profile_cache").select("profile_data, expires_at").eq("organization_id", orgId);
    const { data: cached } = id
      ? await q.eq("coresignal_id", id).maybeSingle()
      : await q.eq("linkedin_url", linkedinUrl!).maybeSingle();
    if (cached?.profile_data && new Date(cached.expires_at as string) > new Date()) {
      console.log(`[coresignal-search] collect cache HIT id=${id ?? linkedinUrl}`);
      return json(200, { success: true, profile: cached.profile_data, cached: true });
    }
  }

  // 2. Collect live (par id, sinon par shorthand extrait de l'URL)
  const key = id ?? linkedinUrl!.split("/in/").pop()!.replace(/\/+$/, "");
  const http = await callCoresignal(apiKey, `${EMPLOYEE}/collect/${encodeURIComponent(key)}`, { method: "GET" });
  if (!http.ok) {
    if (http.status === 404) return json(404, { success: false, error: "Profil introuvable en Base Konekt", errorType: "NOT_FOUND" });
    return mapCoresignalError(http);
  }

  const raw = (http.body ?? {}) as Record<string, unknown>;
  const profile = coresignalToLinkedInProfile(raw);

  // 3. Upsert cache — réécrire explicitement fetched_at/expires_at : sur un
  // UPDATE (conflit), les DEFAULT ne se réappliquent pas, donc sans ça une
  // fiche re-collectée après expiration garderait un expires_at périmé et
  // serait considérée expirée à vie → on repaierait chaque collect indéfiniment.
  if (orgId) {
    try {
      const now = new Date();
      const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30j
      await svc.from("coresignal_profile_cache").upsert({
        organization_id: orgId,
        coresignal_id: String(raw.id ?? key),
        linkedin_url: profile.public_profile_url ?? linkedinUrl ?? null,
        profile_data: profile,
        fetched_at: now.toISOString(),
        expires_at: expires.toISOString(),
        credits_consumed: 2,
      }, { onConflict: "organization_id,coresignal_id" });
    } catch (e) {
      console.warn("[coresignal-search] cache upsert failed (non-blocking):", e);
    }
  }

  await settle(svc, orgId, userId, "coresignal_collect", "Base Konekt — fiche complète");
  console.log(`[coresignal-search] collect LIVE id=${key} credits=${http.creditsRemaining}`);

  return json(200, { success: true, profile, cached: false });
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (r) {
      return r as Response;
    }
    const userId = auth.userId;

    const { action, organization_id, ...params } = await req.json();

    const svc = serviceClient();

    // Résolution org + vérif membership (sauf appels service-role internes)
    let orgId: string | null = null;
    if (userId) {
      orgId = await resolveOrg(svc, userId, organization_id);
      if (organization_id && !(await verifyOrgMembership(svc, userId, organization_id))) {
        return json(403, { success: false, error: "Forbidden" });
      }
    } else {
      orgId = organization_id ?? null;
    }

    // Rate limit (par user), sauf service-role
    if (userId) {
      const { data: allowed } = await svc.rpc("check_rate_limit", {
        p_user_id: userId,
        p_action: "coresignal_search",
        p_max_requests: 30,
        p_window_seconds: 60,
      });
      if (allowed === false) {
        return json(429, { success: false, error: "Trop de requêtes, réessayez dans un instant", errorType: "RATE_LIMIT", retryable: true });
      }
    }

    // Credentials par requête (org → env fallback)
    const creds = await resolveCoresignalCredentials(orgId);
    if (!creds) {
      return json(500, { success: false, error: "Base Konekt non configurée", errorType: "NOT_CONFIGURED" });
    }

    switch (action) {
      case "preview": return await handlePreview(creds.apiKey, svc, orgId, userId, params);
      case "search":  return await handleSearch(creds.apiKey, svc, orgId, userId, params);
      case "collect": return await handleCollect(creds.apiKey, svc, orgId, userId, params);
      default:        return json(400, { success: false, error: "Action non reconnue", errorType: "BAD_ACTION" });
    }
  } catch (e) {
    console.error("[coresignal-search] error:", e);
    return json(500, { success: false, error: e instanceof Error ? e.message : "Erreur interne" });
  }
});
