/**
 * Database Search Edge Function — refactor PDL only (Phase 2 / 2026-04-27)
 *
 * Avant (legacy, retiré) : Apollo.io en backend → mapFiltersToApollo + bulk_match enrichment.
 *   Problèmes : nom masqué sans crédit reveal, pas de skills/education/languages,
 *   coût opaque, format Apollo plat.
 *
 * Maintenant : People Data Labs (PDL) Person Search en backend.
 *   - mapFiltersToPdl : LinkedInFiltersState → SQL PDL
 *   - searchPdl : 1 seul appel API qui retourne tout (skills, education, languages, certifs, emails, phones)
 *   - Cache pdl_profile_cache (TTL 30j) pour ne pas re-payer les doublons
 *   - pdlToLinkedInProfile : mappe le format PDL natif vers LinkedInProfile (format pivot Konekt)
 *
 * IMPORTANT (branding règle CLAUDE.md) : aucun message d'erreur user-facing
 * ne doit mentionner "PDL", "People Data Labs" ou "Apollo". On dit "Base Konekt"
 * ou "source de données".
 *
 * Input : Same filter format as unipile-search (LinkedInFiltersState)
 * Output : Same LinkedInProfile format as unipile-search results
 *
 * Actions supportées :
 *   - search       (default) : recherche paginée avec scroll_token
 *   - insights     : sample 100 profils + agrégation locations/companies/titles/seniority
 *   - get_profile  : enrichit 1 profil par linkedin_url
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { resolvePDLCredentials, resolveOrgIdFromUser } from "../_shared/resolve-org-credentials.ts";
import {
  mapFiltersToPdl,
  buildPdlSqlQuery,
  searchPdl,
  pdlToLinkedInProfile,
  lookupPdlCache,
  writePdlCache,
  normalizeLinkedInUrl,
  sha256Hex,
  type LinkedInFiltersLite,
  type LinkedInProfileLite,
} from "../_shared/pdl-mapping.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PDL_BASE = "https://api.peopledatalabs.com/v5";

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ─── Quality filter ─────────────────────────────────────────────────────────

function isQualityProfile(p: LinkedInProfileLite): boolean {
  const lastName = String(p.last_name || '').trim();
  const headline = String(p.headline || '').trim();
  const name = String(p.name || '').trim();

  // Must have a real name (not just a first name initial)
  if (!lastName || lastName.length < 2) {
    if (!name || name.split(' ').length < 2) return false;
  }
  // Must have a headline / title
  if (!headline) return false;

  return true;
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    // ── Service client + org resolution ──
    const serviceClient = createClient(
      supabaseUrl,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    const orgId = await resolveOrgIdFromUser(user.id, serviceClient);
    if (!orgId) {
      return json({ success: false, error: "Organisation non trouvée" }, 403);
    }

    // ── Resolve credentials (per-org > env fallback) ──
    const creds = await resolvePDLCredentials(orgId, serviceClient);
    if (!creds?.apiKey) {
      console.error("[database-search] No PDL credentials available for org", orgId);
      return json({
        success: false,
        error: "Source de données non configurée. Contactez l'administrateur.",
      }, 500);
    }
    const apiKey = creds.apiKey;

    // ── Rate limit (PDL is paid per-request) ──
    try {
      const { data: rlAllowed } = await serviceClient.rpc("check_rate_limit", {
        p_user_id: user.id,
        p_action: "database_search",
        p_max_requests: 30,
        p_window_seconds: 60,
      });
      if (rlAllowed === false) {
        return json({
          success: false,
          error: "Trop de recherches. Patientez 1 minute.",
        }, 429);
      }
    } catch {
      // RPC indisponible : on laisse passer (ne pas bloquer en cas de bug rate-limit)
    }

    const body = await req.json();
    const action = body.action || "search";

    // ════════════════════════════════════════════════════════════════════════
    // ACTION : search
    // ════════════════════════════════════════════════════════════════════════
    if (action === "search") {
      const filters: LinkedInFiltersLite = body as LinkedInFiltersLite;
      const pageSize = Math.min(Number(body.limit) || 25, 100);

      // Map filters → PDL body → SQL
      const pdlBody = mapFiltersToPdl(filters, { size: pageSize });
      const sqlQuery = buildPdlSqlQuery(pdlBody);

      if (!sqlQuery) {
        return json({
          success: false,
          error: "Au moins un critère de recherche est requis.",
        }, 400);
      }

      console.log("[database-search] PDL SQL:", sqlQuery.slice(0, 300));

      // Pagination via scroll_token (passé en cursor par le frontend)
      const scrollToken = body.cursor && typeof body.cursor === "string" ? body.cursor : undefined;

      // Appel API PDL
      const result = await searchPdl(apiKey, sqlQuery, {
        size: pageSize,
        scrollToken,
        timeoutMs: 25000,
      });

      if (result.status >= 400) {
        console.error("[database-search] PDL API error:", result.status, result.error);
        return json({
          success: false,
          error: "Erreur lors de la recherche. Réessayez.",
        });
      }

      console.log(`[database-search] PDL returned ${result.data.length} raw / ${result.total} total | scroll=${result.scroll_token ? "yes" : "no"}`);

      // Map raw PDL → LinkedInProfile
      const allProfiles: LinkedInProfileLite[] = result.data.map(pdlToLinkedInProfile);

      // Quality filter
      const profiles = allProfiles.filter(isQualityProfile);
      console.log(`[database-search] Quality filter: ${profiles.length}/${allProfiles.length}`);

      // Cache write (async, non-blocking — on retourne avant de wait l'écriture)
      const queryHash = sha256Hex(sqlQuery);
      const cacheEntries = profiles
        .filter(p => p.profile_url || p._provider === "pdl")
        .map(p => ({
          pdl_id: String(p.id),
          linkedin_url: p.profile_url || null,
          profile_data: p,
          source_query_hash: queryHash,
          credits_consumed: 1,
        }));

      // Fire and forget — pas critique si échec
      writePdlCache(serviceClient, orgId, cacheEntries).catch(e =>
        console.warn("[database-search] cache write failed (non-blocking):", e)
      );

      // Pagination metadata
      const hasMore = !!result.scroll_token;

      return json({
        success: true,
        items: profiles,
        total: result.total,
        cursor: result.scroll_token || null,
        hasMoreResults: hasMore,
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION : insights
    // ════════════════════════════════════════════════════════════════════════
    if (action === "insights") {
      const filters: LinkedInFiltersLite = body as LinkedInFiltersLite;
      const pdlBody = mapFiltersToPdl(filters, { size: 100 });
      const sqlQuery = buildPdlSqlQuery(pdlBody);

      if (!sqlQuery) {
        return json({ success: false, error: "Filtres requis pour analyse" }, 400);
      }

      const result = await searchPdl(apiKey, sqlQuery, { size: 100, timeoutMs: 20000 });

      if (result.status >= 400) {
        return json({ success: false, error: "Erreur lors de l'analyse du marché" });
      }

      const rawPeople = result.data;
      const totalEntries = result.total;

      // Aggregations
      const locationCounts: Record<string, number> = {};
      const companyCounts: Record<string, number> = {};
      const titleCounts: Record<string, number> = {};
      const seniorityDistribution: Record<string, number> = {};

      for (const p of rawPeople) {
        // Location
        const locality = p.location_locality || "";
        const country = p.location_country || "";
        const loc = country ? (locality ? `${locality}, ${country}` : country) : locality || "Inconnu";
        locationCounts[loc] = (locationCounts[loc] || 0) + 1;

        // Company
        const company = p.job_company_name || "Inconnu";
        if (company !== "Inconnu") companyCounts[company] = (companyCounts[company] || 0) + 1;

        // Title
        const title = p.job_title || "";
        if (title) titleCounts[title] = (titleCounts[title] || 0) + 1;

        // Seniority — prend le premier level
        const seniority = (Array.isArray(p.job_title_levels) ? p.job_title_levels[0] : p.job_title_levels) || "unknown";
        seniorityDistribution[seniority] = (seniorityDistribution[seniority] || 0) + 1;
      }

      const sortDesc = (obj: Record<string, number>, limit = 10) =>
        Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }));

      return json({
        success: true,
        insights: {
          totalAvailable: totalEntries,
          sampleSize: rawPeople.length,
          topLocations: sortDesc(locationCounts),
          topCompanies: sortDesc(companyCounts, 15),
          topTitles: sortDesc(titleCounts),
          seniorityDistribution: sortDesc(seniorityDistribution),
        },
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // ACTION : get_profile (enrichit 1 profil par linkedin_url)
    // ════════════════════════════════════════════════════════════════════════
    if (action === "get_profile") {
      const profileId = body.profile_id || body.linkedin_url;
      if (!profileId) {
        return json({ success: false, error: "profile_id required" }, 400);
      }

      const linkedinUrl = String(profileId).includes("linkedin.com")
        ? normalizeLinkedInUrl(String(profileId))
        : null;

      // 1. Cache lookup
      if (linkedinUrl) {
        const cached = await lookupPdlCache(serviceClient, orgId, [linkedinUrl]);
        const cachedProfile = cached.get(linkedinUrl);
        if (cachedProfile) {
          console.log(`[database-search] cache hit get_profile ${linkedinUrl}`);
          return json({ success: true, profile: cachedProfile, _cached: true });
        }
      }

      // 2. Appel PDL Person Enrich (1 crédit / hit)
      const enrichBody: Record<string, unknown> = linkedinUrl
        ? { profile: [linkedinUrl] }
        : { name: profileId };

      const enrichResp = await fetchWithTimeout(`${PDL_BASE}/person/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
        body: JSON.stringify(enrichBody),
      }, 15000);

      const enrichText = await enrichResp.text();

      if (!enrichResp.ok) {
        if (enrichResp.status === 404) {
          return json({ success: false, error: "Profil non trouvé" });
        }
        console.error("[database-search] PDL enrich error:", enrichResp.status, enrichText.slice(0, 200));
        return json({ success: false, error: "Erreur d'enrichissement" });
      }

      let enrichData: any;
      try { enrichData = JSON.parse(enrichText); } catch {
        return json({ success: false, error: "Réponse invalide" });
      }

      const person = enrichData.data;
      if (!person) {
        return json({ success: false, error: "Profil non trouvé" });
      }

      const profile = pdlToLinkedInProfile(person);

      // Cache write (1 entry)
      writePdlCache(serviceClient, orgId, [{
        pdl_id: String(profile.id),
        linkedin_url: profile.profile_url || null,
        profile_data: profile,
        credits_consumed: 1,
      }]).catch(e => console.warn("[database-search] cache write enrich failed:", e));

      return json({ success: true, profile });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[database-search] Error:", err);
    return json({ error: "Erreur serveur" }, 500);
  }
});
