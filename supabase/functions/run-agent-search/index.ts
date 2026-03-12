import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Build a dedup key from profile data (same logic as match_scores candidate_id)
function buildCandidateKey(profile: any): string {
  const name = (profile.name || "").trim().toLowerCase();
  const headline = (profile.headline || "").trim().toLowerCase();
  const company = (profile.current_company || profile.work_experience?.[0]?.company || "").trim().toLowerCase();
  return `${name}|${headline}|${company}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Auth
    const authHeader = req.headers.get("authorization");
    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader?.replace("Bearer ", "") || ""
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { conversation_id } = await req.json();
    if (!conversation_id) {
      return new Response(JSON.stringify({ error: "conversation_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load conversation
    const { data: conv, error: convError } = await supabase
      .from("agent_conversations")
      .select("*")
      .eq("id", conversation_id)
      .single();

    if (convError || !conv) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const searchPlan = conv.search_config as any;
    if (!searchPlan?.filters) {
      return new Response(JSON.stringify({ error: "No search plan configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update status to running
    await supabase.from("agent_conversations")
      .update({ status: "running" })
      .eq("id", conversation_id);

    // Helper: post status message
    async function postStatus(content: string, metadata: Record<string, unknown> = {}) {
      await supabase.from("agent_messages").insert({
        conversation_id,
        role: "assistant",
        content,
        metadata,
      });
    }

    const orgId = conv.organization_id;
    const jobId = conv.job_id;

    // ── 1. Load existing data for deduplication & cache ──

    // 1a. Load already-treated candidates for this job (from job_candidate_status)
    const alreadyTreatedSet = new Set<string>();
    const alreadyTreatedProviderIds = new Set<string>();
    if (jobId) {
      const { data: treated } = await supabase
        .from("job_candidate_status")
        .select("candidate_id, candidate_name, candidate_headline")
        .eq("job_id", jobId)
        .eq("organization_id", orgId);
      
      if (treated) {
        for (const t of treated) {
          alreadyTreatedSet.add(t.candidate_id); // provider_id stored as candidate_id
          // Also build name-based key for fallback matching
          if (t.candidate_name) {
            const key = `${(t.candidate_name || "").trim().toLowerCase()}|${(t.candidate_headline || "").trim().toLowerCase()}`;
            alreadyTreatedSet.add(key);
          }
        }
      }
    }

    // 1b. Load cached scores from match_scores for this job
    const cachedScores = new Map<string, any>();
    if (jobId) {
      const { data: scores } = await supabase
        .from("match_scores")
        .select("candidate_id, score, scoring_result")
        .eq("job_id", jobId);
      
      if (scores) {
        for (const s of scores) {
          cachedScores.set(s.candidate_id, {
            score: s.score,
            ...(s.scoring_result as any),
          });
        }
      }
    }

    const dedupCount = alreadyTreatedSet.size;
    const cacheCount = cachedScores.size;
    console.log(`[run-agent-search] Dedup pool: ${dedupCount} treated, ${cacheCount} cached scores`);

    // ── 2. Resolve LinkedIn account ──

    let accountId: string | null = null;
    try {
      const accountsRes = await fetchWithTimeout(`${supabaseUrl}/functions/v1/unipile-accounts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
          "apikey": anonKey,
        },
        body: JSON.stringify({ action: "list", organization_id: orgId }),
      });
      const accountsData = await accountsRes.json();
      if (accountsData?.success && accountsData.accounts?.length > 0) {
        accountId = accountsData.accounts[0].id;
      }
    } catch (e) {
      console.error("[run-agent-search] Failed to get accounts:", e);
    }

    if (!accountId) {
      await postStatus("❌ Aucun compte LinkedIn connecté. Connectez un compte dans les paramètres pour lancer la recherche.");
      await supabase.from("agent_conversations").update({ status: "completed" }).eq("id", conversation_id);
      return new Response(JSON.stringify({ success: false, error: "No LinkedIn account" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 3. Resolve IDs for structured filters ──

    const filters = searchPlan.filters;
    const stopConditions = searchPlan.stop_conditions || { target_go_profiles: 10, max_profiles_to_scan: 200 };
    const maxProfiles = Math.min(stopConditions.max_profiles_to_scan || 200, 200);
    const targetGo = stopConditions.target_go_profiles || 10;

    // Helper: resolve keyword → LinkedIn ID via get_parameters
    async function resolveIds(type: string, keywords: string[]): Promise<string[]> {
      const ids: string[] = [];
      for (const kw of keywords) {
        try {
          const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/unipile-search`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceKey}`,
              "apikey": anonKey,
            },
            body: JSON.stringify({
              action: "get_parameters",
              account_id: accountId,
              organization_id: orgId,
              type,
              keywords: kw,
              service: "RECRUITER",
              limit: 3,
            }),
          }, 15000);
          const data = await res.json();
          if (data?.success && data.items?.length > 0) {
            ids.push(data.items[0].id);
            console.log(`[run-agent-search] ${type} "${kw}" → ID ${data.items[0].id} (${data.items[0].title})`);
          } else {
            console.warn(`[run-agent-search] No ${type} ID found for "${kw}"`);
          }
        } catch (e) {
          console.error(`[run-agent-search] Failed to resolve ${type} "${kw}":`, e);
        }
      }
      return ids;
    }

    // Resolve all ID-based filters in parallel
    await postStatus(`📍 Résolution des filtres...`);

    const locationKeywords = filters.location_keywords || [];
    const industryKeywords = filters.industry_keywords || [];
    const schoolKeywords = filters.school_keywords || [];
    const functionKeywords = filters.function_keywords || [];
    const groupKeywords = filters.group_keywords || [];

    const [locationIds, industryIds, schoolIds, functionIds, groupIds] = await Promise.all([
      locationKeywords.length > 0 ? resolveIds("LOCATION", locationKeywords) : Promise.resolve([]),
      industryKeywords.length > 0 ? resolveIds("INDUSTRY", industryKeywords) : Promise.resolve([]),
      schoolKeywords.length > 0 ? resolveIds("SCHOOL", schoolKeywords) : Promise.resolve([]),
      functionKeywords.length > 0 ? resolveIds("JOB_FUNCTION", functionKeywords) : Promise.resolve([]),
      groupKeywords.length > 0 ? resolveIds("GROUPS", groupKeywords) : Promise.resolve([]),
    ]);

    // Build location with priority/scope structure
    const resolvedLocationIds = locationIds.map(id => ({
      id,
      priority: "MUST_HAVE",
      scope: "CURRENT_OR_OPEN_TO_RELOCATE",
    }));
    const resolvedIndustryIds = industryIds;
    const resolvedSchoolIds = schoolIds;
    const resolvedFunctionIds = functionIds;
    const resolvedGroupIds = groupIds;

    const resolvedCount = resolvedLocationIds.length + resolvedIndustryIds.length + resolvedSchoolIds.length + resolvedFunctionIds.length + resolvedGroupIds.length;

    // ── 4. Search LinkedIn (sequential with delays) ──

    await postStatus(`🔍 Recherche lancée — je scanne les profils LinkedIn...${dedupCount > 0 ? `\n📋 ${dedupCount} profils déjà traités seront ignorés.` : ""}${resolvedCount > 0 ? `\n📍 ${resolvedCount} filtre(s) résolu(s).` : ""}`);

    let allProfiles: any[] = [];
    let cursor: string | null = null;
    let round = 0;
    const maxRounds = Math.ceil(maxProfiles / 25);
    let skippedDedup = 0;

    while (allProfiles.length < maxProfiles && round < maxRounds) {
      round++;
      try {
        // Keywords = technologies/skills ONLY (no location, no titles)
        const searchKeywords = filters.keywords || undefined;
        
        console.log(`[run-agent-search] Round ${round} keywords: ${searchKeywords?.slice(0, 200)}`);
        
        // Build search body with ALL structured filters
        const searchBody: any = {
          action: "search",
          account_id: accountId,
          organization_id: orgId,
          api: "recruiter",
          category: "people",
          limit: 25,
          keywords: searchKeywords,
        };

        // Location (resolved IDs)
        if (resolvedLocationIds.length > 0) {
          searchBody.location = resolvedLocationIds;
          if (filters.location_within_area) {
            searchBody.location_within_area = filters.location_within_area;
          }
        }

        // Role / Job titles (keywords-based, Recruiter API supports this natively)
        if (filters.role && Array.isArray(filters.role) && filters.role.length > 0) {
          searchBody.role = filters.role.map((r: any) => ({
            keywords: r.keywords,
            priority: r.priority || "MUST_HAVE",
            scope: r.scope || "CURRENT",
          }));
        }

        // Seniority
        if (filters.seniority && Array.isArray(filters.seniority) && filters.seniority.length > 0) {
          searchBody.seniority = filters.seniority;
        }

        // Company keywords (Recruiter supports keywords-based company filter)
        if (filters.company_keywords && Array.isArray(filters.company_keywords) && filters.company_keywords.length > 0) {
          searchBody.company_keywords = filters.company_keywords.map((c: any) => {
            if (typeof c === "string") {
              return { keywords: c, priority: "MUST_HAVE", scope: "CURRENT" };
            }
            return { keywords: c.keywords || c, priority: c.priority || "MUST_HAVE", scope: c.scope || "CURRENT" };
          });
        }

        // Past company keywords
        if (filters.past_company_keywords && Array.isArray(filters.past_company_keywords) && filters.past_company_keywords.length > 0) {
          searchBody.past_company = filters.past_company_keywords.map((c: any) => {
            if (typeof c === "string") {
              return { keywords: c, priority: "MUST_HAVE" };
            }
            return { keywords: c.keywords || c, priority: c.priority || "MUST_HAVE" };
          });
        }

        // Industry (resolve IDs like location)
        if (resolvedIndustryIds.length > 0) {
          searchBody.industry = { include: resolvedIndustryIds };
        }

        // School (resolve IDs like location)
        if (resolvedSchoolIds.length > 0) {
          searchBody.school = resolvedSchoolIds.map((id: string) => ({
            id,
            priority: "MUST_HAVE",
          }));
        }

        // Skills (keywords-based, Recruiter supports this)
        if (filters.skills_filter && Array.isArray(filters.skills_filter) && filters.skills_filter.length > 0) {
          searchBody.skills = filters.skills_filter.map((s: any) => {
            if (typeof s === "string") {
              return { keywords: s, priority: "MUST_HAVE" };
            }
            return { keywords: s.keywords || s, priority: s.priority || "MUST_HAVE" };
          });
        }

        // Function/Department (resolve IDs)
        if (resolvedFunctionIds.length > 0) {
          searchBody.function = resolvedFunctionIds;
        }

        // Network distance (1st, 2nd, 3rd+ degree)
        if (filters.network_distance && Array.isArray(filters.network_distance) && filters.network_distance.length > 0) {
          searchBody.network_distance = filters.network_distance;
        }

        // Profile language (ISO 639-1 codes)
        if (filters.profile_language && Array.isArray(filters.profile_language) && filters.profile_language.length > 0) {
          searchBody.profile_language = filters.profile_language;
        }

        // Tenure / Years of experience (Recruiter: { min, max })
        if (filters.tenure_min != null || filters.tenure_max != null) {
          const tenureObj: any = {};
          if (filters.tenure_min != null) tenureObj.min = filters.tenure_min;
          if (filters.tenure_max != null) tenureObj.max = filters.tenure_max;
          searchBody.years_of_experience = tenureObj;
        }

        // Degree filter ({ include: [...], exclude: [...] })
        if (filters.degree) {
          searchBody.degree = filters.degree;
        }

        // Company headcount (array of { min, max })
        if (filters.company_headcount && Array.isArray(filters.company_headcount) && filters.company_headcount.length > 0) {
          searchBody.company_headcount = filters.company_headcount;
        }

        // Spotlights (OPEN_TO_WORK, ACTIVE_TALENT, etc.)
        if (filters.spotlights && Array.isArray(filters.spotlights) && filters.spotlights.length > 0) {
          searchBody.spotlights = filters.spotlights;
        }

        // Open to work (spotlight shorthand)
        if (filters.open_to_work === true) {
          searchBody.open_to_work = true;
        }

        // Groups (LinkedIn group IDs - resolved)
        if (resolvedGroupIds.length > 0) {
          searchBody.groups = resolvedGroupIds;
        }

        // Recruiting activity
        if (filters.recruiting_activity && Array.isArray(filters.recruiting_activity) && filters.recruiting_activity.length > 0) {
          searchBody.recruiting_activity = filters.recruiting_activity;
        }

        if (cursor) searchBody.cursor = cursor;

        const searchRes = await fetchWithTimeout(`${supabaseUrl}/functions/v1/unipile-search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "apikey": anonKey,
          },
          body: JSON.stringify(searchBody),
        }, 30000);

        const searchData = await searchRes.json();
        if (!searchData?.success) {
          console.error("[run-agent-search] Search failed:", searchData);
          break;
        }

        const results = searchData.results || [];

        // Deduplicate: skip profiles already treated for this job
        for (const profile of results) {
          const providerId = profile.provider_id || "";
          const nameKey = `${(profile.name || "").trim().toLowerCase()}|${(profile.headline || "").trim().toLowerCase()}`;

          if (alreadyTreatedSet.has(providerId) || alreadyTreatedSet.has(nameKey)) {
            skippedDedup++;
            continue;
          }

          // Mark as seen to avoid duplicates within this search too
          if (providerId) alreadyTreatedSet.add(providerId);
          alreadyTreatedSet.add(nameKey);

          allProfiles.push(profile);
        }

        cursor = searchData.cursor || null;
        if (!cursor || results.length < 25) break;

        // Sequential safety: 2s delay between search pages to avoid LinkedIn rate limits
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        console.error("[run-agent-search] Search round error:", e);
        break;
      }
    }

    if (allProfiles.length === 0) {
      const msg = skippedDedup > 0
        ? `😕 Aucun nouveau profil trouvé (${skippedDedup} déjà traités). Essayez d'élargir la recherche.`
        : "😕 Aucun profil trouvé avec ces critères. Essayez d'élargir la recherche.";
      await postStatus(msg);
      await supabase.from("agent_conversations").update({ status: "completed" }).eq("id", conversation_id);
      return new Response(JSON.stringify({ success: true, profiles_found: 0, skipped_dedup: skippedDedup }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await postStatus(`📊 ${allProfiles.length} nouveaux profils trouvés${skippedDedup > 0 ? ` (${skippedDedup} déjà traités ignorés)` : ""} — scoring en cours...`);

    // ── 5. Filter by calculated experience ──

    let filteredProfiles = allProfiles;
    if (filters.calculated_experience_min != null || filters.calculated_experience_max != null) {
      filteredProfiles = allProfiles.filter((p: any) => {
        const firstExp = p.work_experience?.[p.work_experience.length - 1];
        if (!firstExp?.start_date) return true;
        const years = (Date.now() - new Date(firstExp.start_date).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (filters.calculated_experience_min && years < filters.calculated_experience_min) return false;
        if (filters.calculated_experience_max && years > filters.calculated_experience_max) return false;
        return true;
      });
    }

    // ── 6. Load job data for scoring ──

    let jobData: any = null;
    if (jobId) {
      try {
        const jobRes = await fetchWithTimeout(`${supabaseUrl}/functions/v1/fetch-notion-jobs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "apikey": anonKey,
          },
          body: JSON.stringify({ organization_id: orgId }),
        }, 20000);
        const jobsData = await jobRes.json();
        if (jobsData?.success) {
          jobData = (jobsData.jobs || []).find((j: any) => j.id === jobId);
        }
      } catch (e) {
        console.error("[run-agent-search] Failed to load job:", e);
      }
    }

    // ── 7. Score profiles (sequential with cache lookup) ──

    const scoredProfiles: Array<{ profile: any; score: any; fromCache: boolean }> = [];
    const goProfiles: Array<{ profile: any; score: any }> = [];
    let cacheHits = 0;

    for (let i = 0; i < Math.min(filteredProfiles.length, maxProfiles); i++) {
      const profile = filteredProfiles[i];
      const candidateKey = buildCandidateKey(profile);
      const providerId = profile.provider_id || "";

      // Check score cache first (by candidate_id key or provider_id)
      const cachedByKey = cachedScores.get(candidateKey);
      const cachedById = providerId ? cachedScores.get(providerId) : null;
      const cached = cachedByKey || cachedById;

      if (cached) {
        cacheHits++;
        scoredProfiles.push({ profile, score: cached, fromCache: true });
        const rec = cached.recommendation;
        if (rec === "go" || rec === "Go") {
          goProfiles.push({ profile, score: cached });
        }
        continue;
      }

      // No cache → call scoring API (sequentially to respect quotas)
      if (!jobData) {
        scoredProfiles.push({ profile, score: null, fromCache: false });
        continue;
      }

      try {
        const profileData = {
          id: providerId || `agent-${Date.now()}`,
          name: profile.name || "Unknown",
          headline: profile.headline || "",
          currentRole: profile.current_role || profile.work_experience?.[0]?.role || "",
          currentCompany: profile.current_company || profile.work_experience?.[0]?.company || "",
          location: profile.location || "",
          skills: profile.skills || [],
          summary: profile.about || "",
          workExperience: (profile.work_experience || []).map((w: any) => ({
            role: w.role || w.title || "",
            company: w.company || "",
            duration: w.duration || "",
            durationMonths: w.durationMonths,
            description: w.description || "",
            skills: w.skills || [],
          })),
          education: (profile.education || []).map((e: any) => e.school || e.name || ""),
          profileUrl: profile.profile_url || "",
          providerId: providerId,
          networkDistance: profile.network_distance,
        };

        const scoreRes = await fetchWithTimeout(`${supabaseUrl}/functions/v1/score-profile-job`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "apikey": anonKey,
          },
          body: JSON.stringify({
            profile: profileData,
            job: jobData,
            organization_id: orgId,
          }),
        }, 55000);

        const scoreData = await scoreRes.json();
        scoredProfiles.push({ profile, score: scoreData, fromCache: false });
        const rec = scoreData?.recommendation;
        if (rec === "go" || rec === "Go") {
          goProfiles.push({ profile, score: scoreData });
        }
      } catch (e) {
        console.error(`[run-agent-search] Score error for ${profile.name}:`, e);
        scoredProfiles.push({ profile, score: null, fromCache: false });
      }

      // Progress update every 5 profiles
      if ((i + 1) % 5 === 0 && i + 1 < filteredProfiles.length) {
        await postStatus(`⏳ ${scoredProfiles.length}/${filteredProfiles.length} profils analysés — ${goProfiles.length} Go trouvés${cacheHits > 0 ? ` (${cacheHits} scores en cache)` : ""}...`);
      }

      // Stop early if we have enough Go profiles
      if (goProfiles.length >= targetGo) break;

      // Sequential safety: 1.5s between scoring calls to pace LinkedIn-related API usage
      await new Promise(r => setTimeout(r, 1500));
    }

    // ── 8. Build summary ──

    const goCount = goProfiles.length;
    const totalScored = scoredProfiles.length;

    let summaryMsg = `✅ **Recherche terminée !**\n\n`;
    summaryMsg += `- 📊 **${totalScored}** profils analysés\n`;
    summaryMsg += `- ✅ **${goCount}** profils qualifiés "Go"\n`;
    if (cacheHits > 0) summaryMsg += `- ⚡ **${cacheHits}** scores récupérés du cache\n`;
    if (skippedDedup > 0) summaryMsg += `- 🔄 **${skippedDedup}** profils déjà traités ignorés\n`;
    summaryMsg += `\n`;

    if (goCount > 0) {
      summaryMsg += `### 🏆 Top profils\n\n`;
      const sorted = goProfiles
        .filter(p => p.score?.score != null)
        .sort((a, b) => (b.score.score || 0) - (a.score.score || 0));

      for (const { profile, score } of sorted.slice(0, 10)) {
        const name = profile.name || "Inconnu";
        const headline = profile.headline || "";
        const sc = score.score || 0;
        const rec = score.recommendation || "go";
        const summary = score.summary || "";
        summaryMsg += `**${name}** — ${sc}/100 ${rec === "go" ? "✅" : "⚠️"}\n`;
        summaryMsg += `> ${headline}\n`;
        if (summary) summaryMsg += `> ${summary.slice(0, 120)}…\n`;
        summaryMsg += `\n`;
      }
    } else {
      summaryMsg += `Aucun profil n'a passé les critères. Tu veux que j'élargisse la recherche ?`;
    }

    // Post results
    await postStatus(summaryMsg, {
      search_results: {
        total_found: allProfiles.length,
        total_scored: totalScored,
        go_count: goCount,
        skipped_dedup: skippedDedup,
        cache_hits: cacheHits,
        go_profiles: goProfiles.map(p => ({
          name: p.profile.name,
          headline: p.profile.headline,
          score: p.score?.score,
          recommendation: p.score?.recommendation,
          summary: p.score?.summary,
          provider_id: p.profile.provider_id,
          profile_url: p.profile.profile_url,
        })),
      },
    });

    // Update conversation
    await supabase.from("agent_conversations")
      .update({
        status: "completed",
        results_summary: {
          total_found: allProfiles.length,
          total_scored: totalScored,
          go_count: goCount,
          skipped_dedup: skippedDedup,
          cache_hits: cacheHits,
        },
      })
      .eq("id", conversation_id);

    return new Response(JSON.stringify({
      success: true,
      profiles_found: allProfiles.length,
      profiles_scored: totalScored,
      go_count: goCount,
      skipped_dedup: skippedDedup,
      cache_hits: cacheHits,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[run-agent-search] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
