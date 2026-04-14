// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  { timeoutMs = 30000, maxRetries = 3 } = {},
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetchWithTimeout(url, options, timeoutMs);

    if (res.ok || !RETRYABLE_STATUS.has(res.status)) {
      return res;
    }

    // Log retryable error with body excerpt for diagnostics
    const errBody = await res.text().catch(() => "");
    console.warn(
      `[fetchWithRetry] ${res.status} on ${url.split("/").pop()} (attempt ${attempt + 1}/${maxRetries}): ${errBody.slice(0, 200)}`,
    );

    if (attempt < maxRetries - 1) {
      const delay = res.status === 429
        ? Math.min(5000 * Math.pow(2, attempt), 30000)   // 429: longer backoff (5s, 10s, 20s)
        : 1000 * Math.pow(2, attempt);                     // 5xx: standard backoff (1s, 2s, 4s)
      await new Promise(r => setTimeout(r, delay));
    } else {
      // Final attempt failed — return a synthetic error response
      return new Response(JSON.stringify({ error: `Failed after ${maxRetries} retries (last status: ${res.status})` }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  // Should never reach here, but TypeScript needs it
  throw new Error("fetchWithRetry: unreachable");
}

// Primary dedup key: provider_id (LinkedIn URN) when available, fallback to name-based key
function buildCandidateKey(profile: any): string {
  const providerId = (profile.provider_id || "").trim();
  if (providerId) return `pid:${providerId}`;
  // Fallback: name + company (without headline which changes frequently)
  const name = (profile.name || "").trim().toLowerCase();
  const company = (profile.current_company || profile.work_experience?.[0]?.company || "").trim().toLowerCase();
  return `name:${name}|${company}`;
}

function isGoRecommendation(recommendation: unknown): boolean {
  if (typeof recommendation !== "string") return false;
  const normalized = recommendation.trim().toUpperCase();
  return normalized === "GO" || normalized === "STRONG_MATCH" || normalized === "GOOD_MATCH";
}

function diversifyResults(
  profiles: Array<{ profile: any; score: any }>,
  maxPerCompany: number = 3
): Array<{ profile: any; score: any }> {
  const companyCounts = new Map<string, number>();
  const result: typeof profiles = [];
  const overflow: typeof profiles = [];

  for (const item of profiles) {
    const company = (
      item.profile.current_company || 
      item.profile.work_experience?.[0]?.company || 
      "unknown"
    ).trim().toLowerCase();
    const count = companyCounts.get(company) || 0;
    if (count < maxPerCompany) {
      companyCounts.set(company, count + 1);
      result.push(item);
    } else {
      overflow.push(item);
    }
  }

  return [...result, ...overflow];
}

Deno.serve(async (req) => {
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
    const { data: { user }, error: authError } = await (anonClient as any).auth.getUser(
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

    // Verify user belongs to the conversation's organization
    if (conv.organization_id) {
      const { data: membership, error: membershipError } = await supabase
        .from("organization_members")
        .select("id")
        .eq("user_id", user.id)
        .eq("organization_id", conv.organization_id)
        .maybeSingle();

      if (membershipError) {
        console.error("[run-agent-search] Membership lookup failed:", membershipError);
        return new Response(JSON.stringify({ error: "Membership lookup failed" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!membership) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
    console.log(`[run-agent-search] Resolving LinkedIn account for org: ${orgId}`);
    try {
      const accountsRes = await fetchWithTimeout(`${supabaseUrl}/functions/v1/unipile-accounts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeader!,
          "apikey": anonKey,
        },
        body: JSON.stringify({ action: "list", organization_id: orgId }),
      }, 15000);
      const accountsData = await accountsRes.json();
      console.log(`[run-agent-search] unipile-accounts response: success=${accountsData?.success}, accounts=${accountsData?.accounts?.length || 0}`);
      if (accountsData?.success && accountsData.accounts?.length > 0) {
        accountId = accountsData.accounts[0].id;
        console.log(`[run-agent-search] Using account: ${accountId}`);
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

    // Common skill aliases that resolve to wrong IDs via autocomplete
    const SKILL_ALIASES: Record<string, string> = {
      'AWS': 'Amazon Web Services',
      'GCP': 'Google Cloud Platform',
      'K8s': 'Kubernetes',
      'JS': 'JavaScript',
      'TS': 'TypeScript',
      'ML': 'Machine Learning',
      'AI': 'Artificial Intelligence',
      'DL': 'Deep Learning',
      'NLP': 'Natural Language Processing',
      'CV': 'Computer Vision',
    };

    // Helper: resolve keyword → LinkedIn ID via get_parameters
    async function resolveIds(type: string, keywords: string[]): Promise<string[]> {
      const ids: string[] = [];
      for (const kw of keywords) {
        // Apply alias for common abbreviations that resolve to wrong IDs
        const resolveKw = type === 'SKILL' ? (SKILL_ALIASES[kw] || kw) : kw;
        try {
          const res = await fetchWithTimeout(`${supabaseUrl}/functions/v1/unipile-search`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": authHeader!,
              "apikey": anonKey,
            },
            body: JSON.stringify({
              action: "get_parameters",
              account_id: accountId,
              organization_id: orgId,
              type,
              keywords: resolveKw,
              service: "RECRUITER",
              limit: 3,
            }),
          }, 15000);
          const data = await res.json();
          if (data?.success && data.items?.length > 0) {
            ids.push(data.items[0].id);
            console.log(`[run-agent-search] ${type} "${kw}"${resolveKw !== kw ? ` (alias: "${resolveKw}")` : ''} → ID ${data.items[0].id} (${data.items[0].title})`);
          } else {
            console.warn(`[run-agent-search] No ${type} ID found for "${kw}"${resolveKw !== kw ? ` (tried alias: "${resolveKw}")` : ''}`);
          }
        } catch (e) {
          console.error(`[run-agent-search] Failed to resolve ${type} "${kw}":`, e);
        }
      }
      return ids;
    }

    // === SEARCH STRATEGY: APOLLO (BROAD) + AI SCORING (TIGHT) ===
    // Apollo is the primary search source (265M+ contacts, native company filters).
    // database-search accepts LinkedIn-style filters and maps them to Apollo format.
    // No LinkedIn ID resolution needed — Apollo uses text names.
    //
    // All soft criteria (skills, company type, industry, ESN exclusion, experience)
    // are evaluated by the AI scoring engine (score-profile-job) AFTER the search.

    // ── 4. Search via Apollo (sequential with delays) ──

    await postStatus(`🔍 Recherche lancée — je scanne la base de données...${dedupCount > 0 ? `\n📋 ${dedupCount} profils déjà traités seront ignorés.` : ""}`);

    let allProfiles: any[] = [];
    let cursor: string | null = null;
    let round = 0;
    const maxRounds = Math.ceil(maxProfiles / 25);
    let skippedDedup = 0;

    while (allProfiles.length < maxProfiles && round < maxRounds) {
      round++;
      try {
        console.log(`[run-agent-search] Round ${round} — BROAD search (role + location + seniority only)`);

        // === BROAD LINKEDIN SEARCH ===
        // Only 3 hard filters: role + location + seniority
        // Everything else (skills, company type, industry, ESN exclusion) is handled by scoring
        const searchBody: any = {
          action: "search",
          account_id: accountId,
          organization_id: orgId,
          api: "recruiter",
          category: "people",
          limit: 25,
        };

        // === APOLLO AS PRIMARY SOURCE ===
        // Apollo has 265M+ contacts with native company filters.
        // database-search accepts LinkedIn-style filters and maps them to Apollo format.
        // All soft criteria (skills, company type, ESN exclusion) handled by scoring AI.

        // Role / job titles
        if (filters.role && Array.isArray(filters.role) && filters.role.length > 0) {
          searchBody.role = filters.role.map((r: any) => ({ keywords: r.keywords }));
        }

        // Location (use text names for Apollo, not LinkedIn IDs)
        const locationNames = filters.location_keywords || [];
        if (locationNames.length > 0) {
          searchBody.location = locationNames.map((name: string) => ({ name }));
        }

        // Seniority
        if (filters.seniority && Array.isArray(filters.seniority) && filters.seniority.length > 0) {
          searchBody.seniority = filters.seniority;
        }

        // Core skills as keywords (simple text, not IDs)
        const skillNames: string[] = (filters.skills_filter || []).map((s: any) => typeof s === "string" ? s : (s.keywords || s));
        if (skillNames.length > 0) {
          searchBody.keywords = skillNames.slice(0, 3).join(' ');
        }

        // Company size filter (native Apollo)
        if (filters.company_headcount && Array.isArray(filters.company_headcount) && filters.company_headcount.length > 0) {
          searchBody.db_company_size_ranges = filters.company_headcount.map((h: any) => `${h.min},${h.max}`);
        }

        // Industry tags (native Apollo)
        if (filters.industry_keywords && Array.isArray(filters.industry_keywords) && filters.industry_keywords.length > 0) {
          searchBody.db_industry_tags = filters.industry_keywords;
        }

        console.log(`[run-agent-search] Apollo search body:`, JSON.stringify(searchBody).slice(0, 500));

        if (cursor) searchBody.cursor = cursor;

        const searchRes = await fetchWithRetry(`${supabaseUrl}/functions/v1/database-search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": authHeader!,
            "apikey": anonKey,
          },
          body: JSON.stringify(searchBody),
        }, { timeoutMs: 30000, maxRetries: 3 });

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

    console.log(`[run-agent-search] LinkedIn search complete: ${allProfiles.length} profiles found (${skippedDedup} dedup skipped, ${round} rounds)`);

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
        const experiences = p.work_experience || [];
        if (experiences.length === 0) return true;

        // Trouver la date de début la plus ancienne parmi toutes les expériences
        let earliestStart: number | null = null;
        for (const exp of experiences) {
          let startMs: number | null = null;
          if (exp.start?.year) {
            startMs = new Date(exp.start.year, (exp.start.month || 1) - 1).getTime();
          } else if (exp.start_date) {
            const parsed = new Date(exp.start_date).getTime();
            if (!isNaN(parsed)) startMs = parsed;
          }
          if (startMs !== null && (earliestStart === null || startMs < earliestStart)) {
            earliestStart = startMs;
          }
        }

        if (earliestStart === null) return true; // Pas de dates exploitables → on laisse passer

        const years = (Date.now() - earliestStart) / (365.25 * 24 * 3600 * 1000);
        if (filters.calculated_experience_min != null && years < filters.calculated_experience_min) return false;
        if (filters.calculated_experience_max != null && years > filters.calculated_experience_max) return false;
        return true;
      });
    }

    // ── 6. Load job data for scoring ──
    // Priority: 1) sourcing_projects (normal case), 2) job_context from search_config, 3) Notion (legacy)

    let jobData: any = null;

    // Priority 1: Load from sourcing_projects (fastest, most common case)
    const projectId = searchPlan.project_id;
    if (!jobData && projectId) {
      try {
        const { data: project } = await supabase
          .from("sourcing_projects")
          .select("job_details, name")
          .eq("id", projectId)
          .maybeSingle();

        if (project?.job_details) {
          const jd = project.job_details as Record<string, any>;
          jobData = {
            id: `project:${projectId}`,
            title: jd.title || project.name || "",
            skills: [...(jd.skills_must_have || []), ...(jd.skills_should_have || [])],
            description: jd.mission_description || "",
            location: jd.location || "",
            seniority: jd.seniority || "",
            xpMin: jd.experience_min,
            xpMax: jd.experience_max,
            mustHave: (jd.skills_must_have || []).join(", "),
            shouldHave: (jd.skills_should_have || []).join(", "),
            niceToHave: (jd.skills_nice_to_have || []).join(", "),
            bodyContent: (jd.evaluation_criteria || [])
              .map((c: any) => `${c.label}${c.deal_breaker ? " [DEAL-BREAKER]" : ""}: ${c.description || ""}`)
              .join("\n")
              .slice(0, 2000),
            transversalCriteria: {
              must: (jd.skills_must_have || []).join(", "),
              should: (jd.skills_should_have || []).join(", "),
              niceToHave: (jd.skills_nice_to_have || []).join(", "),
              context: jd.context || "",
            },
          };
          console.log(`[run-agent-search] Loaded job data from sourcing_project: "${jobData.title}"`);
        }
      } catch (e) {
        console.error("[run-agent-search] Failed to load sourcing project:", e);
      }
    }

    // Final fallback: build jobData from job_context embedded in search_config
    if (!jobData && searchPlan.job_context) {
      const jc = searchPlan.job_context as Record<string, any>;
      jobData = {
        id: projectId ? `project:${projectId}` : `agent:${conversation_id}`,
        title: jc.title || "",
        skills: [...(jc.skills_must_have || []), ...(jc.skills_should_have || [])],
        description: jc.mission_description || "",
        location: jc.location || "",
        seniority: jc.seniority || "",
        xpMin: jc.experience_min,
        xpMax: jc.experience_max,
        mustHave: (jc.skills_must_have || []).join(", "),
        shouldHave: (jc.skills_should_have || []).join(", "),
        niceToHave: (jc.skills_nice_to_have || []).join(", "),
        bodyContent: (jc.evaluation_criteria || [])
          .map((c: any) => `${c.label}${c.deal_breaker ? " [DEAL-BREAKER]" : ""}: ${c.description || ""}`)
          .join("\n")
          .slice(0, 2000),
        transversalCriteria: {
          must: (jc.skills_must_have || []).join(", "),
          should: (jc.skills_should_have || []).join(", "),
          niceToHave: (jc.skills_nice_to_have || []).join(", "),
          context: jc.context || "",
        },
      };
      console.log(`[run-agent-search] Loaded job data from search_config.job_context: "${jobData.title}"`);
    }

    // Notion job loading removed — Notion is optional and not part of the SaaS product
    // Job data comes from sourcing_projects (project_id) or search_config (job_context)

    if (!jobData) {
      console.error("[run-agent-search] ⚠️ No job data available for scoring — profiles will be unscored");
    }

    // ── 7. Score profiles (concurrent with semaphore) ──

    const GLOBAL_TIMEOUT = 140_000; // 140s safety margin (Supabase limit ~150s)
    const startTime = Date.now();
    let timedOut = false;
    const CONCURRENCY = 3;

    const scoredProfiles: Array<{ profile: any; score: any; fromCache: boolean }> = [];
    const goProfiles: Array<{ profile: any; score: any }> = [];
    let cacheHits = 0;

    // Separate cached from uncached profiles first
    const profilesToScore: Array<{ profile: any; index: number }> = [];

    for (let i = 0; i < Math.min(filteredProfiles.length, maxProfiles); i++) {
      const profile = filteredProfiles[i];
      const candidateKey = buildCandidateKey(profile);
      const providerId = profile.provider_id || "";

      const cachedByKey = cachedScores.get(candidateKey);
      const cachedById = providerId ? cachedScores.get(providerId) : null;
      const cached = cachedByKey || cachedById;

      if (cached) {
        cacheHits++;
        scoredProfiles.push({ profile, score: cached, fromCache: true });
        const rec = cached.recommendation;
        if (isGoRecommendation(rec)) {
          goProfiles.push({ profile, score: cached });
        }
      } else {
        profilesToScore.push({ profile, index: i });
      }
    }

    // Early stop if cache already has enough
    if (goProfiles.length < targetGo && jobData && profilesToScore.length > 0) {
      // Semaphore for controlled concurrency
      let activeCount = 0;
      let queueIndex = 0;

      const scoreOne = async (profile: any): Promise<{ profile: any; score: any }> => {
        const providerId = profile.provider_id || "";
        const profileData = {
          id: providerId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

        try {
          const scoreRes = await fetchWithRetry(`${supabaseUrl}/functions/v1/score-profile-job`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": authHeader!,
              "apikey": anonKey,
            },
            body: JSON.stringify({
              profile: profileData,
              job: jobData,
              organization_id: orgId,
              customScoringInstructions: [
                searchPlan.scoring_criteria?.must_have ? `MUST-HAVE: ${searchPlan.scoring_criteria.must_have}` : '',
                searchPlan.scoring_criteria?.nice_to_have ? `NICE-TO-HAVE / EXCLUSIONS: ${searchPlan.scoring_criteria.nice_to_have}` : '',
                filters.skills_keywords?.length ? `Skills à évaluer: ${filters.skills_keywords.join(', ')}` : '',
                filters.calculated_experience_min != null ? `Expérience cible: ${filters.calculated_experience_min}-${filters.calculated_experience_max || '?'} ans` : '',
              ].filter(Boolean).join('\n'),
            }),
          }, { timeoutMs: 30000, maxRetries: 2 });

          const scoreData = await scoreRes.json();
          return { profile, score: scoreData };
        } catch (err) {
          console.error(`[run-agent-search] Scoring failed for ${profile.name}:`, err);
          return { profile, score: null };
        }
      };

      // Process in batches of CONCURRENCY
      for (let batchStart = 0; batchStart < profilesToScore.length; batchStart += CONCURRENCY) {
        // Timeout check before each batch
        if (Date.now() - startTime > GLOBAL_TIMEOUT) {
          timedOut = true;
          await postStatus(`⏱️ Temps max atteint après ${scoredProfiles.length} profils analysés. Résultats partiels ci-dessous.`);
          break;
        }

        // Early stop if enough Go profiles
        if (goProfiles.length >= targetGo) break;

        const batch = profilesToScore.slice(batchStart, batchStart + CONCURRENCY);
        const results = await Promise.allSettled(batch.map(({ profile }) => scoreOne(profile)));

        for (const result of results) {
          if (result.status === "fulfilled") {
            const { profile, score } = result.value;
            scoredProfiles.push({ profile, score, fromCache: false });
            const rec = score?.recommendation;
            if (isGoRecommendation(rec)) {
              goProfiles.push({ profile, score });
            }
          } else {
            const failedProfile = batch[results.indexOf(result)]?.profile;
            console.error(`[run-agent-search] Score error for ${failedProfile?.name}:`, result.reason);
            scoredProfiles.push({ profile: failedProfile, score: null, fromCache: false });
          }
        }

        // Progress update every batch
        if (batchStart + CONCURRENCY < profilesToScore.length) {
          await postStatus(`⏳ ${scoredProfiles.length}/${filteredProfiles.length} profils analysés — ${goProfiles.length} Go trouvés${cacheHits > 0 ? ` (${cacheHits} scores en cache)` : ""}...`);
        }

        // Small delay between batches to be respectful to downstream APIs
        if (batchStart + CONCURRENCY < profilesToScore.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } else if (!jobData) {
      // No job data → push all uncached as unscored
      for (const { profile } of profilesToScore) {
        scoredProfiles.push({ profile, score: null, fromCache: false });
      }
    }

    // ── 8. Build summary ──

    const goCount = goProfiles.length;
    const totalScored = scoredProfiles.length;

    let summaryMsg = timedOut
      ? `⏱️ **Recherche partielle** (temps max atteint)\n\n`
      : `✅ **Recherche terminée !**\n\n`;
    summaryMsg += `- 📊 **${totalScored}** profils analysés${timedOut ? ` sur ${Math.min(filteredProfiles.length, maxProfiles)}` : ""}\n`;
    summaryMsg += `- ✅ **${goCount}** profils qualifiés "Go"\n`;
    if (cacheHits > 0) summaryMsg += `- ⚡ **${cacheHits}** scores récupérés du cache\n`;
    if (skippedDedup > 0) summaryMsg += `- 🔄 **${skippedDedup}** profils déjà traités ignorés\n`;
    summaryMsg += `\n`;

    if (goCount > 0) {
      summaryMsg += `### 🏆 Top profils\n\n`;
      const sorted = goProfiles
        .filter(p => p.score?.score != null)
        .sort((a, b) => (b.score.score || 0) - (a.score.score || 0));
      const diversifiedGo = diversifyResults(sorted, 3);

      for (const { profile, score } of diversifiedGo.slice(0, 10)) {
        const name = profile.name || "Inconnu";
        const headline = profile.headline || "";
        const sc = score.score || 0;
        const rec = score.recommendation || "go";
        const summary = score.summary || "";
        summaryMsg += `**${name}** — ${sc}/100 ${isGoRecommendation(rec) ? "✅" : "⚠️"}\n`;
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

    // Cleanup: ensure conversation doesn't stay stuck in "running"
    try {
      const { conversation_id } = await req.clone().json().catch(() => ({}));
      if (conversation_id) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const cleanupClient = createClient(supabaseUrl, serviceKey);
        await cleanupClient.from("agent_conversations")
          .update({ status: "error" })
          .eq("id", conversation_id)
          .eq("status", "running");
      }
    } catch (_) { /* best-effort cleanup */ }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
