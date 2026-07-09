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
  type LinkedInProfileLite,
} from "../_shared/coresignal-mapping.ts";
import { settleCredits } from "../_shared/settle-credits.ts";
import { ACTION_COSTS } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CORESIGNAL_BASE = "https://api.coresignal.com/cdapi/v2";
const EMPLOYEE = "employee_multi_source";
// Le preview direct (/search/es_dsl/preview?page=N) est plafonné à 5 pages (100
// résultats) PAR CORESIGNAL. Pour paginer au-delà, on passe par /search/es_dsl
// (jusqu'à 1000 IDs/appel + curseur `after`, sans plafond), puis on résout les
// cartes de chaque page via preview-by-ids. Une page d'affichage = 20 (= taille
// de page du preview, donc un seul appel preview la couvre).
const DB_PAGE_SIZE = 20;
const ID_BLOCK_SIZE = 1000; // taille d'un bloc d'IDs renvoyé par /search/es_dsl
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
  /** Curseur de pagination profonde (search_after) renvoyé par /search/es_dsl. */
  nextAfter: string | null;
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
  const nextAfter = res.headers.get("x-next-page-after");
  let body: unknown = null;
  try { body = await res.json(); } catch { /* peut être vide sur erreur */ }

  return {
    ok: res.ok,
    status: res.status,
    totalResults: totalResults != null ? Number(totalResults) : null,
    creditsRemaining: creditsRemaining != null ? Number(creditsRemaining) : null,
    nextAfter: nextAfter != null && nextAfter !== "" ? nextAfter : null,
    body,
  };
}

/** Mappe les erreurs Coresignal → réponse Konekt (sans nommer le fournisseur). */
function mapCoresignalError(http: CoresignalHttp): Response {
  // Log interne du détail amont — indispensable pour diagnostiquer (le status
  // brut n'est jamais exposé à l'UI, cf. règle branding CLAUDE.md).
  console.error(
    `[coresignal-search] upstream error status=${http.status} body=${JSON.stringify(http.body ?? null)?.slice(0, 300)}`,
  );
  if (http.status === 401 || http.status === 403) {
    return json(500, { success: false, error: "Accès Base Konekt refusé — vérifiez la clé configurée", errorType: "AUTH", retryable: false });
  }
  if (http.status === 402) {
    return json(402, { success: false, error: "Quota Base Konekt épuisé", errorType: "CREDITS", retryable: false });
  }
  if (http.status === 429) {
    return json(429, { success: false, error: "Trop de requêtes, réessayez dans un instant", errorType: "RATE_LIMIT", retryable: true });
  }
  if (http.status === 400) {
    return json(400, { success: false, error: "Recherche non comprise par la Base Konekt, ajustez vos critères", errorType: "BAD_QUERY", retryable: false });
  }
  return json(502, { success: false, error: "La Base Konekt est momentanément indisponible", errorType: "UPSTREAM", retryable: true });
}

/** Débite les crédits Konekt (action non-LLM, floor utilisé car tokens=0). */
async function settle(svc: ReturnType<typeof serviceClient>, orgId: string | null, userId: string | null, action: string, description: string): Promise<boolean> {
  if (!orgId) return false;
  try {
    const result = await settleCredits(svc, {
      organizationId: orgId,
      userId: userId ?? "",
      aiAction: action,
      modelId: "claude-haiku-4-5", // factice : tokens=0 → floor de l'action
      tokensInput: 0,
      tokensOutput: 0,
      description,
    });
    if (!result?.success) {
      // Crédit fournisseur consommé mais NON débité → drift ledger. Loggé en
      // error (le pré-check de solde en amont rend ce cas rare : race concurrente).
      console.error(`[coresignal-search] settle non appliqué (org=${orgId} action=${action}):`, result);
    }
    return result?.success ?? false;
  } catch (e) {
    console.error("[coresignal-search] settleCredits a levé (crédit fournisseur non débité):", e);
    return false;
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

// Hydratation GRATUITE depuis le cache : remplace les cartes partielles par la
// fiche complète (photo, XP, formations, compétences) quand l'org a déjà
// collecté le profil (30j). Une relecture cache ne débite rien (cf. handleCollect
// : cache HIT = pas de settle). Plus l'org révèle, plus ses listes s'enrichissent.
async function hydratePreviewFromCache(
  svc: ReturnType<typeof serviceClient>,
  orgId: string | null,
  results: LinkedInProfileLite[],
): Promise<LinkedInProfileLite[]> {
  if (!orgId || results.length === 0) return results;
  try {
    const ids = results.map((r) => String(r.id)).filter(Boolean);
    if (ids.length === 0) return results;
    const { data: cachedRows } = await svc
      .from("coresignal_profile_cache")
      .select("coresignal_id, profile_data, expires_at")
      .eq("organization_id", orgId)
      .in("coresignal_id", ids);
    if (!cachedRows || cachedRows.length === 0) return results;
    const now = new Date();
    const fullById = new Map<string, LinkedInProfileLite>();
    for (const row of cachedRows as { coresignal_id: string; profile_data: LinkedInProfileLite | null; expires_at: string }[]) {
      if (row.profile_data && new Date(row.expires_at) > now) {
        fullById.set(String(row.coresignal_id), row.profile_data);
      }
    }
    if (fullById.size === 0) return results;
    let hydrated = 0;
    const out = results.map((r) => {
      const full = fullById.get(String(r.id));
      if (!full) return r;
      hydrated++;
      // La fiche complète remplace la carte partielle, en conservant l'id
      // d'origine + les signaux d'aperçu si la fiche ne les porte pas.
      return { ...full, id: r.id, seniority_level: full.seniority_level ?? r.seniority_level, department: full.department ?? r.department };
    });
    console.log(`[coresignal-search] preview cache hydration: ${hydrated}/${results.length} enriched (free)`);
    return out;
  } catch (e) {
    console.warn("[coresignal-search] preview cache hydration failed (non-blocking):", e);
    return results;
  }
}

// État de pagination profonde transporté dans un curseur opaque (JSON). Ne
// contient QUE le bloc d'IDs courant (≤1000) + le curseur `after` du bloc
// suivant → taille bornée quelle que soit la profondeur.
interface DbPageCursor {
  ids: string[];
  offset: number;
  after: string | null;
  total: number | null;
}

function isNumericId(s: unknown): s is string {
  return typeof s === "string" && s.length > 0 && Number.isFinite(Number(s));
}

// Valide/type le curseur opaque reçu du client. Retourne null si le curseur est
// altéré ou d'une autre source (ex. curseur Unipile envoyé à la Base Konekt) →
// l'appelant renvoie un 400 explicite au lieu de repartir silencieusement page 1
// (ce qui masquerait le bug ET re-facturerait une page déjà vue).
function parseCursor(raw: string): DbPageCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const c = parsed as Record<string, unknown>;
  if (!Array.isArray(c.ids) || !c.ids.every(isNumericId)) return null;
  if (typeof c.offset !== "number" || !Number.isInteger(c.offset) || c.offset < 0) return null;
  if (!(c.after === null || typeof c.after === "string")) return null;
  if (!(c.total === null || typeof c.total === "number")) return null;
  return { ids: c.ids as string[], offset: c.offset, after: c.after as string | null, total: c.total as number | null };
}

// Récupère un bloc d'IDs triés par pertinence via /search/es_dsl (jusqu'à 1000).
async function fetchIdBlock(
  apiKey: string,
  dsl: unknown,
  after: string | null,
): Promise<{ ok: true; ids: string[]; nextAfter: string | null; total: number | null } | { ok: false; http: CoresignalHttp }> {
  const qs = after ? `?after=${encodeURIComponent(after)}` : "";
  const http = await callCoresignal(apiKey, `${EMPLOYEE}/search/es_dsl${qs}`, { method: "POST", body: dsl });
  if (!http.ok) return { ok: false, http };
  const ids = Array.isArray(http.body) ? (http.body as unknown[]).map(String) : [];
  // On ne poursuit vers un bloc suivant que si celui-ci est plein — sinon c'est
  // la fin des résultats (évite un appel `after` inutile qui renverrait 0).
  const nextAfter = ids.length >= ID_BLOCK_SIZE ? http.nextAfter : null;
  return { ok: true, ids, nextAfter, total: http.totalResults };
}

// Pagination Base Konekt SANS PLAFOND : IDs profonds (relevance) via /search/es_dsl
// + cartes via preview-by-ids. Piloté par un curseur opaque (voir DbPageCursor).
async function handlePreview(apiKey: string, svc: ReturnType<typeof serviceClient>, orgId: string | null, userId: string | null, params: Record<string, unknown>): Promise<Response> {
  const filters = (params.filters ?? {}) as LinkedInFiltersLite;
  const rawCursor = typeof params.cursor === "string" && params.cursor ? params.cursor : null;

  const { query, sort } = mapFiltersToEsDsl(filters);
  const dsl = { query, sort };
  if (JSON.stringify(dsl).length > MAX_ES_DSL_CHARS) {
    return json(400, { success: false, error: "Recherche trop complexe, réduisez le nombre de critères", errorType: "QUERY_TOO_LARGE" });
  }

  // 1. Résoudre l'état de pagination depuis le curseur opaque (validé).
  let state: DbPageCursor;
  if (rawCursor) {
    const parsed = parseCursor(rawCursor);
    if (!parsed) {
      return json(400, { success: false, error: "Curseur de pagination invalide", errorType: "BAD_CURSOR", retryable: false });
    }
    state = parsed;
  } else {
    state = { ids: [], offset: 0, after: null, total: null };
  }

  // 2-6. Avancer bloc par bloc / tranche par tranche jusqu'à obtenir des cartes
  //       ou épuiser les résultats. La boucle bornée évite qu'une tranche vide
  //       (IDs tous supprimés — rare) stoppe la pagination côté front, qui
  //       s'arrête sur un lot vide. Chaque tour = au plus 1 preview (+1 bloc).
  let results: LinkedInProfileLite[] = [];
  let creditsRemaining: number | null = null;
  const MAX_SKIP = 5;
  for (let guard = 0; guard < MAX_SKIP; guard++) {
    // Charger un bloc d'IDs si le bloc courant est épuisé.
    if (state.offset >= state.ids.length) {
      if (state.ids.length === 0 && state.after === null) {
        // Tout premier appel de la recherche → 1er bloc (after=null).
        const block = await fetchIdBlock(apiKey, dsl, null);
        if (!block.ok) return mapCoresignalError(block.http);
        state = { ids: block.ids, offset: 0, after: block.nextAfter, total: block.total ?? state.total };
      } else if (state.after) {
        const block = await fetchIdBlock(apiKey, dsl, state.after);
        if (!block.ok) return mapCoresignalError(block.http);
        state = { ids: block.ids, offset: 0, after: block.nextAfter, total: block.total ?? state.total };
      } else {
        break; // plus aucun bloc → fin des résultats
      }
    }

    const slice = state.ids.slice(state.offset, state.offset + DB_PAGE_SIZE);
    if (slice.length === 0) break;
    state.offset += slice.length;

    // Cartes des IDs de la tranche via preview-by-ids (terms filter, 1 page).
    const previewBody = {
      query: { bool: { filter: [{ terms: { id: slice.map((s) => Number(s)) } }, { term: { is_deleted: 0 } }] } },
    };
    const http = await callCoresignal(apiKey, `${EMPLOYEE}/search/es_dsl/preview?page=1`, { method: "POST", body: previewBody });
    if (!http.ok) return mapCoresignalError(http);
    creditsRemaining = http.creditsRemaining;
    const rawList = Array.isArray(http.body) ? (http.body as Record<string, unknown>[]) : [];

    // Reordonner selon l'ordre pertinence de la tranche (terms ne le garantit pas).
    const cardById = new Map<string, LinkedInProfileLite>();
    for (const raw of rawList) {
      const card = coresignalPreviewToProfile(raw);
      cardById.set(String(card.id), card);
    }
    results = slice
      .map((id) => cardById.get(String(id)))
      .filter((c): c is LinkedInProfileLite => Boolean(c));

    if (results.length > 0) break; // tranche non vide → on la sert
    // sinon tranche entièrement vide (rare) → on tente la suivante
  }

  // Hydratation cache (gratuit).
  results = await hydratePreviewFromCache(svc, orgId, results);

  // Curseur suivant (borné : uniquement le bloc courant + son `after`).
  const hasMore = state.offset < state.ids.length || state.after != null;
  const nextCursor = hasMore
    ? JSON.stringify({ ids: state.ids, offset: state.offset, after: state.after, total: state.total } as DbPageCursor)
    : null;

  // Débit uniquement si on a réellement servi des cartes (une fin de résultats
  // ne coûte rien à l'utilisateur).
  if (results.length > 0) {
    await settle(svc, orgId, userId, "coresignal_preview", "Base Konekt — aperçu");
  }
  console.log(`[coresignal-search] preview served=${results.length} offset=${state.offset}/${state.ids.length} hasMore=${hasMore} total=${state.total} credits=${creditsRemaining}`);

  return json(200, { success: true, results, cursor: nextCursor, total: state.total });
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

    // Gate de rollout (utilisateurs uniquement) : la Base Konekt n'est ouverte
    // qu'aux orgs explicitement activées. Vérifié CÔTÉ SERVEUR — le front ne fait
    // qu'un pré-affichage — pour empêcher tout appel direct qui consommerait des
    // crédits fournisseur (clé partagée) hors périmètre.
    if (userId) {
      if (!orgId) {
        return json(403, { success: false, error: "Base Konekt non activée", errorType: "NOT_ENABLED" });
      }
      const { data: integ } = await svc
        .from("organization_integrations")
        .select("coresignal_enabled")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (integ?.coresignal_enabled !== true) {
        return json(403, { success: false, error: "Base Konekt non activée", errorType: "NOT_ENABLED" });
      }
    }

    // Rate limit (par user), sauf service-role — FAIL-CLOSED : une erreur du RPC
    // bloque (pour un fournisseur payant, l'indisponibilité du contrôle ne doit
    // pas ouvrir les vannes).
    if (userId) {
      const { data: allowed, error: rlError } = await svc.rpc("check_rate_limit", {
        p_user_id: userId,
        p_action: "coresignal_search",
        p_max_requests: 30,
        p_window_seconds: 60,
      });
      if (rlError) {
        console.error("[coresignal-search] rate-limit check failed:", rlError);
        return json(503, { success: false, error: "Service momentanément indisponible, réessayez", errorType: "RATE_LIMIT_UNAVAILABLE", retryable: true });
      }
      if (allowed !== true) {
        return json(429, { success: false, error: "Trop de requêtes, réessayez dans un instant", errorType: "RATE_LIMIT", retryable: true });
      }
    }

    // Pré-check solde (fail-closed) AVANT tout appel fournisseur payant : sans lui,
    // une org à 0 crédit consomme la Base Konekt sans débit ni trace (le settle
    // post-paiement étant fail-open).
    if (userId && orgId && (action === "preview" || action === "search" || action === "collect")) {
      const cost = action === "collect"
        ? (ACTION_COSTS.coresignal_collect?.floor ?? 2)
        : (ACTION_COSTS.coresignal_preview?.floor ?? 2);
      const { data: balance } = await svc
        .from("ai_credit_balances")
        .select("plan_credits, topup_credits")
        .eq("organization_id", orgId)
        .maybeSingle();
      const total = (balance?.plan_credits ?? 0) + (balance?.topup_credits ?? 0);
      if (total < cost) {
        return json(402, { success: false, error: `Crédits Konekt insuffisants (${total} disponibles, ${cost} requis)`, errorType: "INSUFFICIENT_CREDITS", retryable: false });
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
