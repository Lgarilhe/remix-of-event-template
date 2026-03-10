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

    // Resolve LinkedIn account
    const orgId = conv.organization_id;
    const { data: members } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", orgId)
      .limit(1);

    // Get first connected LinkedIn account for this org
    const { data: integrations } = await supabase
      .from("organization_integrations")
      .select("unipile_api_key, unipile_dsn, unipile_connected")
      .eq("organization_id", orgId)
      .single();

    // Get account ID via unipile-accounts
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

    // Build search params from plan
    const filters = searchPlan.filters;
    const stopConditions = searchPlan.stop_conditions || { target_go_profiles: 10, max_profiles_to_scan: 200 };

    await postStatus(`🔍 Recherche lancée — je scanne les profils LinkedIn...`);

    // Execute search (up to max_profiles_to_scan in batches of 25)
    const maxProfiles = Math.min(stopConditions.max_profiles_to_scan || 200, 200);
    const targetGo = stopConditions.target_go_profiles || 10;
    let allProfiles: any[] = [];
    let cursor: string | null = null;
    let round = 0;
    const maxRounds = Math.ceil(maxProfiles / 25);

    while (allProfiles.length < maxProfiles && round < maxRounds) {
      round++;
      try {
        const searchBody: any = {
          action: "search",
          account_id: accountId,
          organization_id: orgId,
          api: "recruiter",
          category: "people",
          limit: 25,
          keywords: filters.keywords || undefined,
          role: filters.role || undefined,
          seniority: filters.seniority || undefined,
          location: filters.location_keywords || undefined,
          location_within_area: filters.location_within_area || undefined,
          company_keywords: filters.company_keywords?.length
            ? filters.company_keywords.map((kw: string) => ({ keywords: kw, priority: "MUST_HAVE", scope: "CURRENT" }))
            : undefined,
          skills_keywords: filters.skills_keywords?.length
            ? filters.skills_keywords.map((s: string) => ({ id: s, priority: "CAN_HAVE" }))
            : undefined,
          school: filters.school_names?.length
            ? filters.school_names.map((s: string) => ({ id: s, priority: "CAN_HAVE" }))
            : undefined,
          open_to_work: filters.open_to_work || undefined,
        };
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
        allProfiles.push(...results);
        cursor = searchData.cursor || null;

        if (!cursor || results.length < 25) break;
      } catch (e) {
        console.error("[run-agent-search] Search round error:", e);
        break;
      }
    }

    if (allProfiles.length === 0) {
      await postStatus("😕 Aucun profil trouvé avec ces critères. Essayez d'élargir la recherche.");
      await supabase.from("agent_conversations").update({ status: "completed" }).eq("id", conversation_id);
      return new Response(JSON.stringify({ success: true, profiles_found: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await postStatus(`📊 ${allProfiles.length} profils trouvés — scoring en cours...`);

    // Filter by calculated experience if specified
    let filteredProfiles = allProfiles;
    if (filters.calculated_experience_min != null || filters.calculated_experience_max != null) {
      filteredProfiles = allProfiles.filter((p: any) => {
        // Simple year calc from first experience
        const firstExp = p.work_experience?.[p.work_experience.length - 1];
        if (!firstExp?.start_date) return true;
        const years = (Date.now() - new Date(firstExp.start_date).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (filters.calculated_experience_min && years < filters.calculated_experience_min) return false;
        if (filters.calculated_experience_max && years > filters.calculated_experience_max) return false;
        return true;
      });
    }

    // Load job data for scoring
    let jobData: any = null;
    if (conv.job_id) {
      // Fetch job from Notion via edge function
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
          jobData = (jobsData.jobs || []).find((j: any) => j.id === conv.job_id);
        }
      } catch (e) {
        console.error("[run-agent-search] Failed to load job:", e);
      }
    }

    // Score profiles (in batches of 3)
    const scoredProfiles: Array<{ profile: any; score: any }> = [];
    const goProfiles: Array<{ profile: any; score: any }> = [];
    const SCORE_BATCH_SIZE = 3;

    for (let i = 0; i < Math.min(filteredProfiles.length, maxProfiles); i += SCORE_BATCH_SIZE) {
      const batch = filteredProfiles.slice(i, i + SCORE_BATCH_SIZE);

      const scorePromises = batch.map(async (profile: any) => {
        if (!jobData) return { profile, score: null };

        try {
          const profileData = {
            id: profile.provider_id || profile.id || `agent-${Date.now()}`,
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
            providerId: profile.provider_id || "",
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
          return { profile, score: scoreData };
        } catch (e) {
          console.error(`[run-agent-search] Score error for ${profile.name}:`, e);
          return { profile, score: null };
        }
      });

      const batchResults = await Promise.allSettled(scorePromises);
      for (const result of batchResults) {
        if (result.status === "fulfilled" && result.value) {
          scoredProfiles.push(result.value);
          const rec = result.value.score?.recommendation;
          if (rec === "go" || rec === "Go") {
            goProfiles.push(result.value);
          }
        }
      }

      // Progress update every batch
      if (i + SCORE_BATCH_SIZE < filteredProfiles.length) {
        await postStatus(`⏳ ${scoredProfiles.length}/${filteredProfiles.length} profils analysés — ${goProfiles.length} Go trouvés...`);
      }

      // Stop early if we have enough Go profiles
      if (goProfiles.length >= targetGo) break;

      // Small delay between batches
      await new Promise(r => setTimeout(r, 500));
    }

    // Build summary
    const goCount = goProfiles.length;
    const totalScored = scoredProfiles.length;

    let summaryMsg = `✅ **Recherche terminée !**\n\n`;
    summaryMsg += `- 📊 **${totalScored}** profils analysés\n`;
    summaryMsg += `- ✅ **${goCount}** profils qualifiés "Go"\n\n`;

    if (goCount > 0) {
      summaryMsg += `### 🏆 Top profils\n\n`;
      // Sort by score
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
        },
      })
      .eq("id", conversation_id);

    return new Response(JSON.stringify({
      success: true,
      profiles_found: allProfiles.length,
      profiles_scored: totalScored,
      go_count: goCount,
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
