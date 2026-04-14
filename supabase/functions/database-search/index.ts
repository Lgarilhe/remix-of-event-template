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

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const APOLLO_BASE = "https://api.apollo.io/api";

// ─── Map LinkedIn filters to Apollo API format ─────────────────────────────

function mapFiltersToApollo(params: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    per_page: Math.min(Number(params.limit) || 25, 100),
    page: params.page ? Number(params.page) : 1,
  };

  // Keywords → convert LinkedIn Boolean query to Apollo-compatible format.
  // Apollo supports basic keyword search but NOT Boolean syntax (AND/OR/NOT/parentheses).
  // Strategy: extract positive terms, drop NOT clauses, treat OR as alternatives.
  if (params.keywords) {
    const raw = String(params.keywords);

    // 1. Remove NOT clauses entirely (NOT "junior" → skip "junior")
    const withoutNot = raw.replace(/\bNOT\s+(?:"[^"]+"|[\w]+)/gi, '');

    // 2. Extract quoted phrases as-is (they're exact terms)
    const quotedPhrases: string[] = [];
    const withoutQuotes = withoutNot.replace(/"([^"]+)"/g, (_match, phrase) => {
      quotedPhrases.push(phrase.trim());
      return '';
    });

    // 3. Strip remaining Boolean operators and parentheses
    const cleaned = withoutQuotes
      .replace(/\bAND\b/gi, ' ')
      .replace(/\bOR\b/gi, ' ')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 4. Combine: quoted phrases + individual terms (skip short ones)
    const terms = [
      ...quotedPhrases,
      ...cleaned.split(' ').filter(t => t.length >= 3),
    ].slice(0, 10);

    if (terms.length > 0) {
      payload.q_keywords = terms.join(' ');
    }
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
    if (titles.length) {
      payload.person_titles = titles;
      payload.include_similar_titles = true; // Apollo default, explicit for clarity
    }
    if (excludeTitles.length) payload.person_not_titles = excludeTitles;
  }

  // Job title (priority-based) → person_titles
  const jobTitles = params.job_title as Array<{ id: string; name?: string; priority: string }> | undefined;
  if (jobTitles?.length) {
    const existing = (payload.person_titles as string[]) || [];
    const newTitles = jobTitles
      .filter((t) => t.priority !== "DOESNT_HAVE")
      .map((t) => {
        // Use name (text) over id (numeric LinkedIn ID)
        const val = t.name || t.id;
        // Skip pure numeric IDs, split "X/Y" format titles
        if (!val || /^\d+$/.test(val)) return [];
        return val.split("/").map((s: string) => s.trim()).filter(Boolean);
      })
      .flat();
    payload.person_titles = [...existing, ...newTitles].slice(0, 10);
  }

  // If still no person_titles, try to extract from the job context
  if (!(payload.person_titles as string[])?.length) {
    // Fallback: use keywords as title search if they look like job titles
    const kw = payload.q_keywords ? String(payload.q_keywords) : "";
    if (kw && kw.length < 50) {
      payload.person_titles = [kw];
    }
  } else if (payload.q_keywords) {
    // When we have person_titles, DROP q_keywords entirely.
    // Apollo ANDs keywords with titles — combining both almost always yields 0 results.
    // The titles alone are specific enough; skills will be added back below if present.
    console.log("[database-search] Dropping q_keywords (have person_titles):", payload.q_keywords);
    delete payload.q_keywords;
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
  // Apollo needs clean location names, not LinkedIn's verbose format
  const location = params.location;
  if (location) {
    const locs = Array.isArray(location) ? location : [location];
    const locationNames: string[] = [];
    for (const loc of locs) {
      let name = "";
      if (typeof loc === "string") {
        name = loc;
      } else if (typeof loc === "object" && loc !== null) {
        const l = loc as Record<string, string>;
        name = l.name || "";
      }
      if (name) {
        // Normalize LinkedIn location format for Apollo:
        // "Ville de Paris, Île-de-France, France" → "Paris, France"
        // "Greater London, England, United Kingdom" → "London, United Kingdom"
        // "Lyon, Auvergne-Rhône-Alpes, France" → "Lyon, France"
        let cleaned = name
          .replace(/^Ville de\s+/i, "")
          .replace(/^Greater\s+/i, "")
          .replace(/^Région de\s+/i, "")
          .replace(/^Métropole de\s+/i, "")
          .replace(/^Communauté urbaine de\s+/i, "");

        // Split by comma, keep first (city) and last (country) parts
        const parts = cleaned.split(",").map(p => p.trim()).filter(Boolean);
        if (parts.length >= 3) {
          // "Paris, Île-de-France, France" → "Paris, France"
          cleaned = `${parts[0]}, ${parts[parts.length - 1]}`;
        }
        locationNames.push(cleaned);
      }
    }
    if (locationNames.length) payload.person_locations = locationNames;
  }

  // Skills → q_keywords (Apollo searches skills in full profile text)
  // Only use text-based skills, skip numeric IDs, limit to top 5
  const skills = params.skills as Array<{ id: string; keywords?: string; name?: string; priority: string }> | undefined;
  if (skills?.length) {
    const skillKeywords = skills
      .filter((s) => s.priority !== "DOESNT_HAVE")
      .map((s) => s.keywords || s.name || s.id)
      .filter((s) => s && !/^\d+$/.test(s)) // Skip numeric IDs
      .slice(0, 5); // Limit to avoid "Value too long"
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

  // Industry keywords (AI-generated text) → organization keyword tags
  const industryKeywords = params.industry_keywords as string[] | undefined;
  if (industryKeywords?.length) {
    const existing = (payload.q_organization_keyword_tags as string[]) || [];
    payload.q_organization_keyword_tags = [...existing, ...industryKeywords].slice(0, 5);
  }

  // School — only use text names, skip numeric LinkedIn IDs
  const school = params.school;
  if (school && Array.isArray(school) && school.length) {
    const schoolNames = school.map((s: unknown) => {
      if (typeof s === "string" && !/^\d+$/.test(s)) return s;
      if (typeof s === "object" && s !== null) {
        const obj = s as Record<string, string>;
        return obj.name && !/^\d+$/.test(obj.name) ? obj.name : null;
      }
      return null;
    }).filter(Boolean).slice(0, 3);
    if (schoolNames.length) {
      const existing = payload.q_keywords ? String(payload.q_keywords) + " " : "";
      payload.q_keywords = existing + schoolNames.join(" ");
    }
  }

  // SAFETY: cap q_keywords length to avoid Apollo "Value too long" error
  if (payload.q_keywords && String(payload.q_keywords).length > 500) {
    // Truncate at last complete word
    const truncated = String(payload.q_keywords).slice(0, 500);
    payload.q_keywords = truncated.slice(0, truncated.lastIndexOf(" ")).trim();
    console.warn("[database-search] q_keywords truncated to ~500 chars");
  }

  // SAFETY: cap q_organization_name length
  if (payload.q_organization_name && String(payload.q_organization_name).length > 200) {
    const truncated = String(payload.q_organization_name).slice(0, 200);
    payload.q_organization_name = truncated.slice(0, truncated.lastIndexOf(" ")).trim();
    console.warn("[database-search] q_organization_name truncated to ~200 chars");
  }

  // Years of experience → not directly in Apollo, but can filter seniority
  const yearsExp = params.years_of_experience as { min?: number; max?: number } | undefined;
  // Apollo doesn't have a direct years filter — handled post-filter

  // ─── Database-specific filters (Base Konekt exclusive) ─────────────────

  // Revenue range — Apollo expects numeric values: revenue_range[min], revenue_range[max]
  // Frontend sends strings like "1M", "500K", "100M" — must parse to numbers
  const parseRevenue = (val: unknown): number | undefined => {
    if (val === undefined || val === null || val === '') return undefined;
    const s = String(val).trim().toUpperCase();
    const match = s.match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/);
    if (!match) {
      // Try parsing as raw number
      const n = Number(s);
      return isNaN(n) ? undefined : n;
    }
    const num = parseFloat(match[1]);
    const multipliers: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
    return num * (multipliers[match[2]] || 1);
  };
  const revMin = parseRevenue(params.db_revenue_min);
  const revMax = parseRevenue(params.db_revenue_max);
  if (revMin !== undefined) payload['revenue_range[min]'] = revMin;
  if (revMax !== undefined) payload['revenue_range[max]'] = revMax;

  // Funding stage — map human-readable labels to Apollo stage codes
  const dbFundingStage = params.db_funding_stage as string | string[] | undefined;
  if (dbFundingStage) {
    const stages = Array.isArray(dbFundingStage) ? dbFundingStage : [dbFundingStage];
    const fundingStageMap: Record<string, string> = {
      "seed": "seed",
      "pre-seed": "pre_seed",
      "angel": "angel",
      "series a": "a",
      "series b": "b",
      "series c": "c",
      "series d": "d",
      "series e": "e",
      "series f": "f",
      "ipo": "ipo",
      "private_equity": "private_equity",
      "debt_financing": "debt_financing",
      "grant": "grant",
      "other": "other",
    };
    const mapped = stages.map(s => {
      const lower = s.toLowerCase().trim();
      return fundingStageMap[lower] || s;
    }).filter(Boolean);
    if (mapped.length) payload.organization_latest_funding_stage_cd = mapped;
  }

  // Company domain
  const dbCompanyDomain = params.db_company_domain as string | undefined;
  if (dbCompanyDomain) {
    // Apollo expects the _list suffix for domain search, as an ARRAY (not string)
    const domains = dbCompanyDomain.split(',').map(d => d.trim()).filter(Boolean);
    payload['q_organization_domains_list'] = domains;
  }

  // Email verified
  const dbEmailVerified = params.db_email_verified as boolean | undefined;
  if (dbEmailVerified) {
    payload.contact_email_status = ["verified"];
  }

  // Technologies
  const dbTechnologies = params.db_technologies as string[] | undefined;
  if (dbTechnologies?.length) {
    payload.currently_using_any_of_technology_uids = dbTechnologies;
  }

  // Company size (human-readable labels) → organization_num_employees_ranges
  // Only applies if company_headcount (LinkedIn codes) wasn't already set
  const dbCompanySize = params.db_company_size as string[] | undefined;
  if (dbCompanySize?.length && !payload.organization_num_employees_ranges) {
    const sizeMap: Record<string, string[]> = {
      startup: ["1,10", "11,50"],
      scaleup: ["51,200", "201,500"],
      mid: ["501,1000", "1001,5000"],
      enterprise: ["5001,10000", "10001,"],
    };
    const ranges: string[] = [];
    for (const size of dbCompanySize) {
      const mapped = sizeMap[size.toLowerCase().trim()];
      if (mapped) {
        ranges.push(...mapped);
      }
    }
    if (ranges.length) payload.organization_num_employees_ranges = ranges;
  }

  // Raw company size ranges (pass-through, e.g. ["51,200", "201,500"])
  const dbCompanySizeRanges = params.db_company_size_ranges as string[] | undefined;
  if (dbCompanySizeRanges?.length) {
    const existing = (payload.organization_num_employees_ranges as string[]) || [];
    payload.organization_num_employees_ranges = [...existing, ...dbCompanySizeRanges];
  }

  // Industry tags → q_organization_keyword_tags (direct pass-through)
  const dbIndustryTags = params.db_industry_tags as string[] | undefined;
  if (dbIndustryTags?.length) {
    const existing = (payload.q_organization_keyword_tags as string[]) || [];
    payload.q_organization_keyword_tags = [...existing, ...dbIndustryTags].slice(0, 10);
  }

  // Company actively hiring → organization_num_jobs_range
  const dbCompanyHiring = params.db_company_hiring as boolean | number | undefined;
  if (dbCompanyHiring !== undefined && dbCompanyHiring !== false) {
    // If true, require at least 1 open job; if a number, use it as minimum
    const minJobs = typeof dbCompanyHiring === "number" ? dbCompanyHiring : 1;
    if (!payload['organization_num_jobs_range[min]']) {
      payload['organization_num_jobs_range[min]'] = minJobs;
    }
  }

  // Company hired recently → organization_job_posted_at_range
  const dbCompanyHiringRecent = params.db_company_hiring_recent as number | undefined;
  if (dbCompanyHiringRecent && dbCompanyHiringRecent > 0) {
    const now = new Date();
    const minDate = new Date(now);
    minDate.setDate(minDate.getDate() - dbCompanyHiringRecent);
    // Format as YYYY-MM-DD
    const formatDate = (d: Date) => d.toISOString().split("T")[0];
    payload['organization_job_posted_at_range[min]'] = formatDate(minDate);
    payload['organization_job_posted_at_range[max]'] = formatDate(now);
  }

  // Organization job titles (open positions at employer)
  const dbOrgJobTitles = params.db_org_job_titles as string | undefined;
  if (dbOrgJobTitles) {
    const titles = dbOrgJobTitles.split(',').map((t: string) => t.trim()).filter(Boolean);
    if (titles.length) payload.q_organization_job_titles = titles;
  }

  // Organization number of jobs range
  const dbOrgNumJobsMin = params.db_org_num_jobs_min as number | string | undefined;
  const dbOrgNumJobsMax = params.db_org_num_jobs_max as number | string | undefined;
  if (dbOrgNumJobsMin !== undefined && dbOrgNumJobsMin !== '') payload['organization_num_jobs_range[min]'] = Number(dbOrgNumJobsMin);
  if (dbOrgNumJobsMax !== undefined && dbOrgNumJobsMax !== '') payload['organization_num_jobs_range[max]'] = Number(dbOrgNumJobsMax);

  // Company headcount (shared filter, Apollo-specific format)
  const headcount = params.company_headcount as string[] | undefined;
  if (headcount?.length) {
    // Map LinkedIn headcount codes to Apollo ranges
    // Map LinkedIn headcount codes to Apollo ranges (must match COMPANY_HEADCOUNT_OPTIONS labels)
    const headcountMap: Record<string, string> = {
      "A": "1,1",          // Auto-entrepreneur (1)
      "B": "2,10",         // 2-10
      "C": "11,50",        // 11-50
      "D": "51,200",       // 51-200
      "E": "201,500",      // 201-500
      "F": "501,1000",     // 501-1000
      "G": "1001,5000",    // 1001-5000
      "H": "5001,10000",   // 5001-10000
      "I": "10001,",       // 10001+ (open upper bound)
    };
    const ranges = headcount
      .map(code => headcountMap[code] || code)
      .filter(Boolean);
    if (ranges.length) payload.organization_num_employees_ranges = ranges;
  }

  // Company location (for org-level location filtering)
  const companyLocation = params.company_location as Array<{ id: string; name?: string }> | undefined;
  if (companyLocation?.length) {
    const locNames = companyLocation
      .map(l => l.name || l.id)
      .filter(l => !/^\d+$/.test(l)); // Skip numeric LinkedIn IDs
    if (locNames.length) payload.organization_locations = locNames;
  }

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

  // ─── Apollo advanced filters ──────────────────────────────────────────

  // Technologies AND mode (all must match)
  const techMustAll = params.db_tech_must_have_all as string[] | undefined;
  if (techMustAll?.length) {
    payload.currently_using_all_of_technology_uids = techMustAll;
  }

  // Technologies exclusion
  const techExclude = params.db_tech_exclude as string[] | undefined;
  if (techExclude?.length) {
    payload.currently_not_using_any_of_technology_uids = techExclude;
  }

  // Where the company is currently hiring
  const orgJobLocations = params.db_org_job_locations as string[] | undefined;
  if (orgJobLocations?.length) {
    payload.organization_job_locations = orgJobLocations;
  }

  // Latest funding date (e.g., companies that raised in the last 12 months)
  const latestFundingDateMin = params.db_latest_funding_date_min as string | undefined;
  if (latestFundingDateMin) {
    payload.latest_funding_date_range = { min: latestFundingDateMin };
  }

  // Total funding raised range
  const totalFundingMin = params.db_total_funding_min as string | undefined;
  const totalFundingMax = params.db_total_funding_max as string | undefined;
  if (totalFundingMin || totalFundingMax) {
    const range: Record<string, number> = {};
    if (totalFundingMin) range.min = Number(totalFundingMin);
    if (totalFundingMax) range.max = Number(totalFundingMax);
    payload.total_funding_range = range;
  }

  // Exclude company HQ locations
  const orgNotLocations = params.db_org_not_locations as string[] | undefined;
  if (orgNotLocations?.length) {
    payload.organization_not_locations = orgNotLocations;
  }

  // Always include similar titles for broader results
  if (payload.person_titles && !(payload as any).include_similar_titles) {
    payload.include_similar_titles = true;
  }

  // Log non-spec params (these may be silently ignored by Apollo api_search endpoint)
  const nonSpecParams = ['person_departments', 'q_organization_keyword_tags', 'q_organization_name', 'person_not_titles', 'organization_latest_funding_stage_cd'];
  const usedNonSpec = nonSpecParams.filter(p => payload[p] !== undefined);
  if (usedNonSpec.length) {
    console.warn(`[database-search] Non-spec params sent (may be ignored by api_search): ${usedNonSpec.join(', ')}`);
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
    // Source marker for client-side behaviors (detail enrichment, badges, etc.)
    source: "database",
    _source: "database",

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

    // Apollo engagement signals (from enrichment)
    is_likely_to_engage: p.is_likely_to_engage ?? null,
    intent_strength: p.intent_strength ?? null,

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

      // Apollo API call with retry on 429 (rate limit)
      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetchWithTimeout(`${APOLLO_BASE}/v1/mixed_people/api_search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "X-Api-Key": apolloApiKey,
          },
          body: JSON.stringify(apolloPayload),
        });

        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(1000 * Math.pow(2, attempt), 8000);
          console.warn(`[database-search] Apollo 429 rate limit, retrying in ${delay}ms (attempt ${attempt + 1}/3)`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        break; // Not a 429 — proceed with response
      }

      if (!response) {
        return json({ success: false, error: "Apollo API unreachable after retries" });
      }

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

      // Log pagination info from Apollo — check multiple possible locations
      const paginationInfo = data.pagination || {};
      // Apollo sometimes puts total at top-level
      const topLevelKeys = Object.keys(data).filter(k => k !== 'people');
      console.log(`[database-search] Response top-level keys (excl people):`, JSON.stringify(topLevelKeys));
      console.log(`[database-search] Search returned ${rawPeople.length} raw results | pagination:`, JSON.stringify(paginationInfo));
      // Log any top-level total-like fields
      for (const k of ['total_entries', 'total', 'total_results', 'num_fetch_result']) {
        if (data[k] !== undefined) console.log(`[database-search] data.${k} =`, data[k]);
      }
      if (rawPeople.length > 0) {
        const sample = rawPeople[0];
        console.log(`[database-search] Sample raw person:`, JSON.stringify({
          id: sample.id,
          name: sample.name,
          first_name: sample.first_name,
          last_name: sample.last_name,
          title: sample.title,
          headline: sample.headline,
          photo_url: sample.photo_url,
          city: sample.city,
          country: sample.country,
          organization_name: sample.organization_name,
          employment_history_count: (sample.employment_history || []).length,
        }));
      }

      // Step 2: Enrich in batches of 10 (Apollo limit)
      let enrichedPeople = rawPeople;
      if (rawPeople.length > 0) {
        try {
          const personIds = rawPeople.map((p: any) => p.id).filter(Boolean);
          console.log(`[database-search] Enriching ${personIds.length} profiles via bulk_match (batches of 10)...`);

          const enrichMap = new Map<string, Record<string, unknown>>();
          const BATCH_SIZE = 10;

          for (let i = 0; i < personIds.length; i += BATCH_SIZE) {
            const batch = personIds.slice(i, i + BATCH_SIZE);
            try {
              const enrichResponse = await fetchWithTimeout(`${APOLLO_BASE}/v1/people/bulk_match`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Cache-Control": "no-cache",
                  "X-Api-Key": apolloApiKey,
                },
                body: JSON.stringify({
                  details: batch.map((id: string) => ({ id })),
                  reveal_personal_emails: false,
                  reveal_phone_number: false,
                }),
              });

              if (enrichResponse.ok) {
                const enrichData = await enrichResponse.json();
                const matches = enrichData.matches || enrichData.people || [];
                for (const match of matches) {
                  if (match?.id) enrichMap.set(match.id, match);
                }
                console.log(`[database-search] Batch ${Math.floor(i / BATCH_SIZE) + 1}: enriched ${matches.length}/${batch.length}`);
              } else {
                const errText = await enrichResponse.text();
                console.warn(`[database-search] Batch enrichment failed ${enrichResponse.status}:`, errText.slice(0, 200));
              }
            } catch (batchErr) {
              console.warn(`[database-search] Batch enrichment error:`, batchErr);
            }
          }

          if (enrichMap.size > 0) {
            enrichedPeople = rawPeople.map((p: any) => {
              const enriched = enrichMap.get(p.id);
              return enriched ? { ...p, ...enriched } : p;
            });
            console.log(`[database-search] Total enriched: ${enrichMap.size}/${rawPeople.length}`);
          }
        } catch (e) {
          console.warn("[database-search] Enrichment error (non-blocking):", e);
        }
      }

      // Convert to LinkedInProfile format and filter low-quality profiles
      const allProfiles = enrichedPeople.map(apolloToLinkedInProfile);
      console.log(`[database-search] Converted ${allProfiles.length} profiles`);

      const profiles = allProfiles.filter((p: Record<string, unknown>) => {
        const firstName = String(p.first_name || '').trim();
        const lastName = String(p.last_name || '').trim();
        const headline = String(p.headline || '').trim();
        const name = String(p.name || '').trim();

        // Must have at least a first name (Apollo api_search often omits last_name)
        if (!firstName && !name) return false;
        // Must have a headline or title
        if (!headline) return false;

        return true;
      });

      console.log(`[database-search] After quality filter: ${profiles.length}/${allProfiles.length}`);

      // Pagination
      const pagination = data.pagination || {};
      const totalEntries = Number(
        pagination.total_entries ??
        pagination.total ??
        pagination.total_results ??
        pagination.total_people ??
        data.total_entries ??
        data.total ??
        data.total_results ??
        data.num_fetch_result ??
        profiles.length
      );
      const currentPage = Number(pagination.page || pagination.current_page || data.page || apolloPayload.page || 1);
      const perPage = Number(pagination.per_page || data.per_page || apolloPayload.per_page || 25);
      // Calculate total pages from total entries if not provided by Apollo
      const totalPages = Number(
        pagination.total_pages || pagination.pages || data.total_pages || Math.ceil(totalEntries / perPage) || 1
      );
      const hasMore = currentPage < totalPages && totalEntries > currentPage * perPage;

      console.log(`[database-search] Pagination: page ${currentPage}/${totalPages}, total ${totalEntries}, hasMore: ${hasMore}`);

      return json({
        success: true,
        items: profiles,
        total: totalEntries,
        cursor: hasMore ? String(currentPage + 1) : null,
        hasMoreResults: hasMore,
      });
    }

    // Market insights — quick sample without enrichment for analytics
    if (action === "insights") {
      const apolloPayload = mapFiltersToApollo({ ...body, limit: 100 });
      apolloPayload.per_page = 100; // Max sample for insights

      console.log("[database-search] Insights payload:", JSON.stringify(apolloPayload));

      const response = await fetchWithTimeout(`${APOLLO_BASE}/v1/mixed_people/api_search`, {
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
        console.error("[database-search] Insights Apollo error:", response.status, errText);
        return json({ success: false, error: "Erreur lors de l'analyse du marché" });
      }

      const data = await response.json();
      const rawPeople = data.people || [];
      const totalEntries = Number(data.total_entries ?? data.pagination?.total_entries ?? rawPeople.length);

      // Aggregate insights from raw data (no enrichment needed)
      const locationCounts: Record<string, number> = {};
      const companyCounts: Record<string, number> = {};
      const titleCounts: Record<string, number> = {};
      const seniorityDistribution: Record<string, number> = {};

      for (const p of rawPeople) {
        // Location
        const city = p.city || p.state || 'Inconnu';
        const country = p.country || '';
        const loc = country ? `${city}, ${country}` : city;
        locationCounts[loc] = (locationCounts[loc] || 0) + 1;

        // Company
        const company = p.organization_name || p.organization?.name || 'Inconnu';
        if (company !== 'Inconnu') companyCounts[company] = (companyCounts[company] || 0) + 1;

        // Title
        const title = p.title || '';
        if (title) titleCounts[title] = (titleCounts[title] || 0) + 1;

        // Seniority
        const seniority = p.seniority || 'unknown';
        seniorityDistribution[seniority] = (seniorityDistribution[seniority] || 0) + 1;
      }

      // Sort and take top entries
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

      const response = await fetchWithTimeout(`${APOLLO_BASE}/v1/mixed_people/api_search`, {
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
