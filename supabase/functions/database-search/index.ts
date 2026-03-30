/**
 * Database Search Edge Function
 * Provides the same search experience as LinkedIn Recruiter but powered
 * by Apollo.io data. The client never sees "Apollo" — it's presented
 * as "Base Konekt" or "Base de données".
 *
 * Input: Same filter format as unipile-search (LinkedIn filters)
 * Output: Same LinkedInProfile format as unipile-search results
 *
 * This allows:
 * 1. Users without Recruiter license to access advanced filters
 * 2. Fallback when LinkedIn has session conflicts
 * 3. Complementary sourcing alongside LinkedIn
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

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

const APOLLO_BASE = "https://api.apollo.io";

// ─── Map LinkedIn filters to Apollo API format ─────────────────────────────

function mapFiltersToApollo(params: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    per_page: Math.min(Number(params.limit) || 25, 100),
    page: params.page ? Number(params.page) : 1,
  };

  // Keywords → full-profile search
  if (params.keywords) {
    payload.q_keywords = String(params.keywords);
  }

  // Role / Boolean title keywords → person_titles
  const roles = params.role as Array<{ keywords: string; priority: string; scope: string }> | undefined;
  if (roles?.length) {
    // Extract title keywords from role filters (split OR clauses)
    const titles: string[] = [];
    const excludeTitles: string[] = [];
    for (const r of roles) {
      const keywords = r.keywords
        .replace(/"/g, "")
        .split(/\s+OR\s+/i)
        .map((k: string) => k.trim())
        .filter(Boolean);
      if (r.priority === "DOESNT_HAVE") {
        excludeTitles.push(...keywords);
      } else {
        titles.push(...keywords);
      }
    }
    if (titles.length) payload.person_titles = titles;
    if (excludeTitles.length) payload.person_not_titles = excludeTitles;
  }

  // Job title (priority-based) → person_titles
  const jobTitles = params.job_title as Array<{ id: string; priority: string }> | undefined;
  if (jobTitles?.length) {
    const existing = (payload.person_titles as string[]) || [];
    const newTitles = jobTitles
      .filter((t) => t.priority !== "DOESNT_HAVE")
      .map((t) => t.id);
    payload.person_titles = [...existing, ...newTitles];
  }

  // Seniority → person_seniorities
  const seniority = params.seniority as string[] | undefined;
  if (seniority?.length) {
    const seniorityMap: Record<string, string> = {
      "1": "intern",
      "2": "entry",
      "3": "entry",
      "4": "senior",
      "5": "manager",
      "6": "director",
      "7": "vp",
      "8": "c_suite",
      "9": "partner",
      "10": "owner",
    };
    payload.person_seniorities = seniority
      .map((s) => seniorityMap[s] || s)
      .filter(Boolean);
  }

  // Location → person_locations
  const location = params.location;
  if (location) {
    const locs = Array.isArray(location) ? location : [location];
    const locationNames: string[] = [];
    for (const loc of locs) {
      if (typeof loc === "string") {
        locationNames.push(loc);
      } else if (typeof loc === "object" && loc !== null) {
        // Recruiter format: { id, name, priority, scope }
        const l = loc as Record<string, string>;
        if (l.name) locationNames.push(l.name);
      }
    }
    if (locationNames.length) payload.person_locations = locationNames;
  }

  // Skills → q_keywords (Apollo searches skills in full profile text)
  const skills = params.skills as Array<{ id: string; keywords?: string; name?: string; priority: string }> | undefined;
  if (skills?.length) {
    const skillKeywords = skills
      .filter((s) => s.priority !== "DOESNT_HAVE")
      .map((s) => s.keywords || s.name || s.id)
      .filter(Boolean);
    if (skillKeywords.length) {
      const existing = payload.q_keywords ? String(payload.q_keywords) + " " : "";
      payload.q_keywords = existing + skillKeywords.join(" ");
    }
  }

  // Company (include/exclude)
  const company = params.company;
  if (company) {
    if (Array.isArray(company)) {
      // Simple array of names/IDs
      if (company.length) payload.q_organization_name = company.join(" ");
    } else if (typeof company === "object") {
      const c = company as { include?: string[]; exclude?: string[] };
      if (c.include?.length) payload.q_organization_name = c.include.join(" ");
      // Apollo doesn't have a direct exclude for org name
    }
  }

  // Company keywords (Recruiter) → organization name search
  const companyKeywords = params.company_keywords as Array<{ keywords: string; priority: string; scope: string }> | undefined;
  if (companyKeywords?.length) {
    const include = companyKeywords
      .filter((c) => c.priority !== "DOESNT_HAVE")
      .map((c) => c.keywords);
    if (include.length) {
      const existing = payload.q_organization_name ? String(payload.q_organization_name) + " " : "";
      payload.q_organization_name = existing + include.join(" ");
    }
  }

  // Industry
  const industry = params.industry;
  if (industry) {
    let tags: string[] = [];
    if (Array.isArray(industry)) {
      tags = industry.map((i: unknown) => typeof i === "string" ? i : (i as Record<string, string>).name || (i as Record<string, string>).id);
    } else if (typeof industry === "object") {
      const ind = industry as { include?: string[] };
      tags = ind.include || [];
    }
    if (tags.length) payload.q_organization_keyword_tags = tags;
  }

  // School
  const school = params.school;
  if (school && Array.isArray(school) && school.length) {
    // Apollo uses q_keywords for school matching
    const schoolNames = school.map((s: unknown) => {
      if (typeof s === "string") return s;
      if (typeof s === "object" && s !== null) return (s as Record<string, string>).name || (s as Record<string, string>).id;
      return "";
    }).filter(Boolean);
    if (schoolNames.length) {
      const existing = payload.q_keywords ? String(payload.q_keywords) + " " : "";
      payload.q_keywords = existing + schoolNames.join(" ");
    }
  }

  // Years of experience → not directly in Apollo, but can filter seniority
  const yearsExp = params.years_of_experience as { min?: number; max?: number } | undefined;
  // Apollo doesn't have a direct years filter — handled post-filter

  // Function / Department
  const func = params.function as string[] | undefined;
  if (func?.length) {
    const deptMap: Record<string, string> = {
      engineering: "engineering",
      sales: "sales",
      marketing: "marketing",
      operations: "operations",
      finance: "finance",
      human_resources: "human_resources",
      product: "product_management",
      legal: "legal",
      design: "design",
      research: "data_science",
      it: "information_technology",
    };
    payload.person_departments = func.map((f) => deptMap[f.toLowerCase()] || f);
  }

  return payload;
}

// ─── Convert Apollo person to LinkedInProfile format ────────────────────────

function apolloToLinkedInProfile(p: Record<string, unknown>): Record<string, unknown> {
  const org = (p.organization || {}) as Record<string, unknown>;
  const employmentHistory = (p.employment_history || []) as Array<Record<string, unknown>>;

  // Build work experience from employment history
  const workExperience = employmentHistory.slice(0, 10).map((exp) => {
    const startDate = exp.start_date ? String(exp.start_date) : null;
    const endDate = exp.end_date ? String(exp.end_date) : null;
    const isCurrent = !endDate || exp.current === true;

    return {
      role: exp.title || "",
      position: exp.title || "",
      company: exp.organization_name || "",
      description: exp.description || "",
      location: "",
      start: startDate ? { year: parseInt(startDate.split("-")[0]) || null, month: parseInt(startDate.split("-")[1]) || null } : null,
      end: endDate ? { year: parseInt(endDate.split("-")[0]) || null, month: parseInt(endDate.split("-")[1]) || null } : null,
      current: isCurrent,
      skills: [],
    };
  });

  const currentJob = workExperience.find((w) => w.current) || workExperience[0];

  // Build education
  const education = ((p.education || []) as Array<Record<string, unknown>>).map((edu) => ({
    school: edu.school_name || edu.name || "",
    degree: edu.degree || "",
    field_of_study: edu.field_of_study || edu.major || "",
    start: edu.start_date ? { year: parseInt(String(edu.start_date).split("-")[0]) } : null,
    end: edu.end_date ? { year: parseInt(String(edu.end_date).split("-")[0]) } : null,
  }));

  // Calculate years of experience
  let yearsOfExperience: number | null = null;
  if (employmentHistory.length > 0) {
    const earliest = employmentHistory
      .filter((e) => e.start_date)
      .sort((a, b) => String(a.start_date || "").localeCompare(String(b.start_date || "")))[0];
    if (earliest?.start_date) {
      const startYear = parseInt(String(earliest.start_date).split("-")[0]);
      if (startYear > 1970) {
        yearsOfExperience = new Date().getFullYear() - startYear;
      }
    }
  }

  const firstName = String(p.first_name || "");
  const lastName = String(p.last_name || "");
  const fullName = p.name || `${firstName} ${lastName}`.trim();

  return {
    // Core identity — same as LinkedIn format
    id: p.id || crypto.randomUUID(),
    provider_id: p.id,
    public_identifier: null,
    member_urn: null,
    name: fullName,
    first_name: firstName,
    last_name: lastName,
    headline: p.headline || p.title || `${currentJob?.role || ""} @ ${currentJob?.company || ""}`,
    location: [p.city, p.state, p.country].filter(Boolean).join(", "),
    industry: String(org.industry || ""),
    summary: null, // Apollo doesn't provide About section

    // Photo — Apollo has it for most profiles
    profile_picture_url: p.photo_url || p.profile_pic_url || null,

    // URLs
    public_profile_url: p.linkedin_url || null,
    profile_url: p.linkedin_url || null,

    // Current position
    current_positions: currentJob
      ? [{
          role: currentJob.role,
          company: currentJob.company,
          position: currentJob.role,
          start: currentJob.start,
          end: null,
          current: true,
        }]
      : [],

    // Past positions
    past_positions: workExperience
      .filter((w) => !w.current)
      .slice(0, 5)
      .map((w) => ({
        role: w.role,
        company: w.company,
        position: w.role,
        start: w.start,
        end: w.end,
        current: false,
      })),

    // Full work experience (same format as Unipile)
    work_experience: workExperience,

    // Education
    education,

    // Skills — Apollo doesn't list skills separately
    skills: [],

    // Network signals — not available from Apollo
    network_distance: null,
    open_to_work: false,
    is_open_to_work: false,
    open_profile: false,
    is_open_profile: false,

    // Contact info (revealed separately, not included in search)
    emails: [],
    phone_numbers: [],

    // Enrichment metadata
    _source: "database", // Internal flag — never shown to user
    _years_of_experience: yearsOfExperience,
  };
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
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

    // Resolve Apollo API key (per-org or env)
    let apolloApiKey = Deno.env.get("APOLLO_API_KEY");
    try {
      const { resolveApolloCredentials, resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
      const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const orgId = await resolveOrgIdFromUser(user.id, serviceClient);
      if (orgId) {
        const creds = await resolveApolloCredentials(orgId, serviceClient);
        if (creds?.apiKey) apolloApiKey = creds.apiKey;
      }
    } catch (e) {
      console.warn("[database-search] Could not resolve org Apollo credentials:", e);
    }

    if (!apolloApiKey) {
      return json({ success: false, error: "Base de données non configurée" }, 500);
    }

    const body = await req.json();
    const action = body.action || "search";

    if (action === "search") {
      // Map LinkedIn-style filters to Apollo format
      const apolloPayload = mapFiltersToApollo(body);

      // Handle pagination via cursor (page number as string)
      if (body.cursor) {
        apolloPayload.page = parseInt(body.cursor) || 1;
      }

      console.log("[database-search] Apollo payload:", JSON.stringify(apolloPayload));

      const response = await fetch(`${APOLLO_BASE}/v1/mixed_people/api_search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": apolloApiKey,
        },
        body: JSON.stringify(apolloPayload),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[database-search] Apollo API error:", response.status, errText);
        return json({
          success: false,
          error: "Erreur lors de la recherche. Réessayez.",
        });
      }

      const data = await response.json();
      const rawPeople = data.people || [];

      // Convert to LinkedInProfile format — identical to what unipile-search returns
      // Convert and filter out low-quality profiles (no last name, no company, no experience)
      const allProfiles = rawPeople.map(apolloToLinkedInProfile);
      const profiles = allProfiles.filter((p: Record<string, unknown>) => {
        const lastName = String(p.last_name || '').trim();
        const headline = String(p.headline || '').trim();
        const company = ((p.current_positions as any[]) || [])[0]?.company;
        const workExp = (p.work_experience as any[]) || [];

        // Must have at least a last name
        if (!lastName || lastName.length < 2) return false;
        // Must have a headline or current position
        if (!headline && !company) return false;
        // Must have at least 1 work experience
        if (workExp.length === 0) return false;

        return true;
      });

      // Pagination
      const pagination = data.pagination || {};
      const totalEntries = pagination.total_entries || profiles.length;
      const currentPage = pagination.page || 1;
      const totalPages = pagination.total_pages || 1;
      const hasMore = currentPage < totalPages;

      return json({
        success: true,
        items: profiles,
        total: totalEntries,
        cursor: hasMore ? String(currentPage + 1) : null,
        hasMoreResults: hasMore,
      });
    }

    // Get profile details (for enrichment / profile view)
    if (action === "get_profile") {
      const profileId = body.profile_id || body.linkedin_url;
      if (!profileId) {
        return json({ success: false, error: "profile_id required" }, 400);
      }

      // Try to find by LinkedIn URL in Apollo
      const searchPayload: Record<string, unknown> = { per_page: 1 };
      if (String(profileId).includes("linkedin.com")) {
        searchPayload.person_linkedin_url = profileId;
      } else {
        searchPayload.q_keywords = profileId;
      }

      const response = await fetch(`${APOLLO_BASE}/v1/mixed_people/api_search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": apolloApiKey,
        },
        body: JSON.stringify(searchPayload),
      });

      if (!response.ok) {
        return json({ success: false, error: "Profil non trouvé" });
      }

      const data = await response.json();
      const person = data.people?.[0];
      if (!person) {
        return json({ success: false, error: "Profil non trouvé" });
      }

      return json({
        success: true,
        profile: apolloToLinkedInProfile(person),
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[database-search] Error:", err);
    return json({ error: "Erreur serveur" }, 500);
  }
});
