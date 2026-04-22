/**
 * Estimate LinkedIn Search Count
 * Runs a limit:1 search with the conversation's search plan filters
 * and returns the total result count from LinkedIn.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    // Auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { conversation_id } = await req.json();
    if (!conversation_id) {
      return new Response(JSON.stringify({ error: "conversation_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Load conversation
    const { data: conv, error: convError } = await supabase
      .from("agent_conversations")
      .select("*")
      .eq("id", conversation_id)
      .single();

    if (convError || !conv) {
      return new Response(JSON.stringify({ error: "Conversation not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify membership
    const orgId = conv.organization_id;
    if (orgId) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("id")
        .eq("user_id", user.id)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const searchPlan = conv.search_config as any;
    if (!searchPlan?.filters) {
      return new Response(JSON.stringify({ error: "No search plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve LinkedIn account
    let accountId: string | null = null;
    try {
      const accountsRes = await fetchWithTimeout(
        `${supabaseUrl}/functions/v1/unipile-accounts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
            apikey: anonKey,
          },
          body: JSON.stringify({ action: "list", organization_id: orgId }),
        },
        10000
      );
      const accountsData = await accountsRes.json();
      if (accountsData?.success && accountsData.accounts?.length > 0) {
        accountId = accountsData.accounts[0].id;
      }
    } catch (e) {
      console.error("[estimate-search-count] Failed to get accounts:", e);
    }

    if (!accountId) {
      return new Response(
        JSON.stringify({ error: "No LinkedIn account connected" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve IDs for structured filters
    const filters = searchPlan.filters;

    async function resolveIds(type: string, keywords: string[]): Promise<string[]> {
      const ids: string[] = [];
      for (const kw of keywords) {
        try {
          const res = await fetchWithTimeout(
            `${supabaseUrl}/functions/v1/unipile-search`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
                apikey: anonKey,
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
            },
            10000
          );
          const data = await res.json();
          if (data?.success && data.items?.length > 0) {
            ids.push(data.items[0].id);
          }
        } catch (e) {
          console.warn(`[estimate] Failed to resolve ${type} "${kw}":`, e);
        }
      }
      return ids;
    }

    const locationKeywords = filters.location_keywords || [];
    const companyNames = (filters.company_keywords || []).map((c: any) =>
      typeof c === "string" ? c : c.keywords || c
    );
    const skillNames = (filters.skills_filter || []).map((s: any) =>
      typeof s === "string" ? s : s.keywords || s
    );
    const industryKeywords = filters.industry_keywords || [];
    const schoolKeywords = filters.school_keywords || [];
    const functionKeywords = filters.function_keywords || [];

    const [locationIds, companyIds, skillIds, industryIds, schoolIds, functionIds] =
      await Promise.all([
        locationKeywords.length > 0 ? resolveIds("LOCATION", locationKeywords) : [],
        companyNames.length > 0 ? resolveIds("COMPANY", companyNames) : [],
        skillNames.length > 0 ? resolveIds("SKILL", skillNames) : [],
        industryKeywords.length > 0 ? resolveIds("INDUSTRY", industryKeywords) : [],
        schoolKeywords.length > 0 ? resolveIds("SCHOOL", schoolKeywords) : [],
        functionKeywords.length > 0 ? resolveIds("JOB_FUNCTION", functionKeywords) : [],
      ]);

    // Build search body (limit: 1 — we only want the count)
    const searchBody: any = {
      action: "search",
      account_id: accountId,
      organization_id: orgId,
      api: "recruiter",
      category: "people",
      limit: 1,
      keywords: filters.keywords || undefined,
    };

    if (locationIds.length > 0) {
      searchBody.location = locationIds.map((id: string) => ({
        id,
        priority: "MUST_HAVE",
        scope: "CURRENT_OR_OPEN_TO_RELOCATE",
      }));
      if (filters.location_within_area) {
        searchBody.location_within_area = filters.location_within_area;
      }
    }

    if (filters.role?.length > 0) {
      searchBody.role = filters.role.map((r: any) => ({
        keywords: r.keywords,
        priority: r.priority || "MUST_HAVE",
        scope: r.scope || "CURRENT",
      }));
    }

    if (filters.seniority?.length > 0) {
      searchBody.seniority = filters.seniority;
    }

    if (companyIds.length > 0) {
      const scope = (filters.company_keywords || []).find((c: any) => typeof c === "object" && c.scope)?.scope || "CURRENT";
      searchBody.company = companyIds.map((id: string) => ({ id, priority: "MUST_HAVE", scope }));
    }

    if (industryIds.length > 0) {
      searchBody.industry = { include: industryIds };
    }

    if (schoolIds.length > 0) {
      searchBody.school = schoolIds.map((id: string) => ({ id, priority: "MUST_HAVE" }));
    }

    if (skillIds.length > 0) {
      searchBody.skills = skillIds.map((id: string) => ({ id, priority: "MUST_HAVE" }));
    }

    if (functionIds.length > 0) {
      searchBody.function = functionIds;
    }

    if (filters.network_distance?.length > 0) {
      searchBody.network_distance = filters.network_distance;
    }

    if (filters.tenure_min != null || filters.tenure_max != null) {
      const tenureObj: any = {};
      if (filters.tenure_min != null) tenureObj.min = filters.tenure_min;
      if (filters.tenure_max != null) tenureObj.max = filters.tenure_max;
      searchBody.years_of_experience = tenureObj;
    }

    if (filters.degree) {
      searchBody.degree = filters.degree;
    }

    if (filters.company_headcount?.length > 0) {
      searchBody.company_headcount = filters.company_headcount;
    }

    if (filters.spotlights?.length > 0) {
      searchBody.spotlights = filters.spotlights;
    }

    // Execute search
    const searchRes = await fetchWithTimeout(
      `${supabaseUrl}/functions/v1/unipile-search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          apikey: anonKey,
        },
        body: JSON.stringify(searchBody),
      },
      20000
    );

    const searchData = await searchRes.json();

    if (!searchData?.success) {
      return new Response(
        JSON.stringify({ success: false, error: searchData?.error || "Search failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const total = searchData.total || 0;

    return new Response(
      JSON.stringify({ success: true, total }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[estimate-search-count] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
