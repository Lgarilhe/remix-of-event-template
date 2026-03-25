// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function slugifyAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function humanizeLinkedInSlug(value: string) {
  const normalized = decodeURIComponent(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "Ce recruteur";

  return normalized
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeLinkedInInput(linkedinUrl: string) {
  const parsed = new URL(linkedinUrl.trim().startsWith("http") ? linkedinUrl.trim() : `https://${linkedinUrl.trim()}`);
  if (!parsed.hostname.includes("linkedin.com") || !parsed.pathname.startsWith("/in/")) {
    throw new Error("invalid_linkedin_url");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  const rawSlug = parts[1] || "";
  const decodedSlug = decodeURIComponent(rawSlug).trim().replace(/\/+$/, "");
  const asciiSlug = slugifyAscii(decodedSlug);

  const originalUrl = `https://www.linkedin.com/in/${rawSlug}`.replace(/\/+$/, "");
  const decodedUrl = decodedSlug ? `https://www.linkedin.com/in/${decodedSlug}`.replace(/\/+$/, "") : null;
  const asciiUrl = asciiSlug ? `https://www.linkedin.com/in/${asciiSlug}`.replace(/\/+$/, "") : null;

  return {
    cleanUrl: originalUrl,
    rawSlug,
    decodedSlug,
    asciiSlug,
    candidates: uniqueStrings([originalUrl, decodedUrl, asciiUrl]),
  };
}

function extractMeaningfulApolloPerson(apolloData: any) {
  const person = apolloData?.person;
  if (!person || typeof person !== "object") return null;

  const hasMeaningfulData = Boolean(
    person.name ||
    person.first_name ||
    person.last_name ||
    person.headline ||
    person.title ||
    person.bio ||
    person.organization?.name ||
    (Array.isArray(person.employment_history) && person.employment_history.length > 0) ||
    (Array.isArray(person.experience) && person.experience.length > 0) ||
    (Array.isArray(person.skills) && person.skills.length > 0)
  );

  return hasMeaningfulData ? person : null;
}

async function resolveUnipileCredentials(supabase: any, organizationId: string | null) {
  if (organizationId) {
    try {
      const { data } = await supabase
        .from("organization_integrations")
        .select("unipile_api_key, unipile_dsn, unipile_connected")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (data?.unipile_connected && data?.unipile_api_key && data?.unipile_dsn) {
        const dsn = data.unipile_dsn.startsWith("http")
          ? data.unipile_dsn.replace(/^https?:\/\//, "")
          : data.unipile_dsn;
        return { apiKey: data.unipile_api_key, dsn };
      }
    } catch (error) {
      console.warn("[scan-recruiter-linkedin] Unable to resolve org-specific Unipile credentials", error);
    }
  }

  const apiKey = Deno.env.get("UNIPILE_API_KEY");
  const rawDsn = Deno.env.get("UNIPILE_DSN");
  if (!apiKey || !rawDsn) return null;

  return {
    apiKey,
    dsn: rawDsn.startsWith("http") ? rawDsn.replace(/^https?:\/\//, "") : rawDsn,
  };
}

async function fetchLinkedInFallbackProfile(supabase: any, userId: string, expectedSlug: string) {
  const { data: mappings, error: mappingError } = await supabase
    .from("member_linkedin_accounts")
    .select("linkedin_account_id, organization_id")
    .eq("user_id", userId)
    .limit(5);

  if (mappingError) {
    console.warn("[scan-recruiter-linkedin] Unable to load LinkedIn account mappings", mappingError);
    return null;
  }

  for (const mapping of mappings || []) {
    const credentials = await resolveUnipileCredentials(supabase, mapping.organization_id);
    if (!credentials) continue;

    const profileUrl = `https://${credentials.dsn}/api/v1/users/me?account_id=${mapping.linkedin_account_id}`;
    try {
      const profileRes = await fetchWithTimeout(profileUrl, {
        headers: {
          "X-API-KEY": credentials.apiKey,
          Accept: "application/json",
        },
      }, 10000);

      if (!profileRes.ok) {
        console.warn("[scan-recruiter-linkedin] Unipile fallback failed", profileRes.status, profileRes.statusText);
        continue;
      }

      const profileData = await profileRes.json();
      const publicIdentifier = String(profileData?.public_identifier || "").trim();
      const publicProfileUrl = String(profileData?.public_profile_url || "").trim();
      const normalizedIdentifier = slugifyAscii(publicIdentifier);
      const normalizedProfileSlug = publicProfileUrl ? slugifyAscii(decodeURIComponent(publicProfileUrl.split("/").filter(Boolean).pop() || "")) : "";

      if (
        expectedSlug &&
        expectedSlug !== normalizedIdentifier &&
        expectedSlug !== normalizedProfileSlug
      ) {
        continue;
      }

      console.log("[scan-recruiter-linkedin] Using Unipile fallback profile", JSON.stringify({
        publicIdentifier,
        headline: profileData?.headline || profileData?.occupation || "",
      }));

      return profileData;
    } catch (error) {
      console.warn("[scan-recruiter-linkedin] Unipile fallback request failed", error);
    }
  }

  return null;
}

function mapUnipileProfileToApolloShape(profileData: any, cleanUrl: string) {
  const organizations = Array.isArray(profileData?.organizations) ? profileData.organizations : [];
  const organizationNames = organizations
    .map((org: any) => org?.name || org?.company_name || org?.title)
    .filter(Boolean);

  const locationText = typeof profileData?.location === "string"
    ? profileData.location
    : [profileData?.city, profileData?.state, profileData?.country].filter(Boolean).join(", ");

  return {
    name: [profileData?.first_name, profileData?.last_name].filter(Boolean).join(" ") || "Ce recruteur",
    first_name: profileData?.first_name || null,
    last_name: profileData?.last_name || null,
    headline: profileData?.headline || profileData?.occupation || "",
    title: profileData?.headline || profileData?.occupation || "",
    bio: "",
    skills: [],
    experience: organizations.map((org: any) => ({
      organization_name: org?.name || org?.company_name || null,
      company_name: org?.name || org?.company_name || null,
      title: org?.title || profileData?.headline || profileData?.occupation || null,
      location: locationText || null,
    })),
    employment_history: organizations.map((org: any) => ({
      organization_name: org?.name || org?.company_name || null,
      company_name: org?.name || org?.company_name || null,
      title: org?.title || profileData?.headline || profileData?.occupation || null,
      location: locationText || null,
    })),
    education: [],
    education_history: [],
    organization_name: organizationNames[0] || null,
    organization: {
      name: organizationNames[0] || null,
      industries: [],
      technology_names: [],
      keywords: [],
      industry: null,
      short_description: null,
      seo_description: null,
    },
    city: typeof profileData?.city === "string" ? profileData.city : null,
    state: typeof profileData?.state === "string" ? profileData.state : null,
    country: typeof profileData?.country === "string" ? profileData.country : null,
    location: locationText || null,
    photo_url: profileData?.profile_picture_url || null,
    email: profileData?.email || null,
    phone_numbers: [],
    recommendations: [],
    seniority: null,
    linkedin_url: profileData?.public_profile_url || cleanUrl,
    __source: "unipile",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Non authentifié");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Non authentifié");

    const { linkedinUrl } = await req.json();
    if (!linkedinUrl || typeof linkedinUrl !== "string") {
      throw new Error("URL LinkedIn requise");
    }

    let cleanUrl = "";
    let expectedSlug = "";
    let displaySlug = "";
    let urlCandidates: string[] = [];
    try {
      const normalized = normalizeLinkedInInput(linkedinUrl);
      cleanUrl = normalized.cleanUrl;
      expectedSlug = normalized.asciiSlug || slugifyAscii(normalized.decodedSlug || normalized.rawSlug);
      displaySlug = normalized.decodedSlug || normalized.rawSlug || normalized.asciiSlug;
      urlCandidates = normalized.candidates;
    } catch {
      throw new Error("URL LinkedIn invalide. Format attendu: linkedin.com/in/votre-profil");
    }

    const APOLLO_API_KEY = Deno.env.get("APOLLO_API_KEY");
    if (!APOLLO_API_KEY) throw new Error("Configuration Apollo manquante");

    let profile: any = null;
    let matchedUrl = cleanUrl;

    for (const candidateUrl of urlCandidates) {
      const profileRes = await fetch("https://api.apollo.io/api/v1/people/match", {
        method: "POST",
        headers: {
          "X-Api-Key": APOLLO_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Cache-Control": "no-cache",
        },
        body: JSON.stringify({
          linkedin_url: candidateUrl,
          reveal_personal_emails: false,
          reveal_phone_number: false,
        }),
      });

      if (!profileRes.ok) {
        const errorText = await profileRes.text();
        console.error("Apollo error:", profileRes.status, candidateUrl, errorText);
        continue;
      }

      const apolloData = await profileRes.json();
      const candidateProfile = extractMeaningfulApolloPerson(apolloData);
      if (candidateProfile) {
        profile = candidateProfile;
        matchedUrl = candidateUrl;
        break;
      }

      console.log("[scan-recruiter-linkedin] Apollo candidate empty", JSON.stringify({
        candidateUrl,
        keys: apolloData?.person ? Object.keys(apolloData.person) : [],
      }));
    }

    if (!profile) {
      const fallbackProfile = await fetchLinkedInFallbackProfile(supabase, user.id, expectedSlug);
      if (fallbackProfile) {
        profile = mapUnipileProfileToApolloShape(fallbackProfile, cleanUrl);
        matchedUrl = profile.linkedin_url || cleanUrl;
      }
    }

    if (!profile) {
      console.warn("[scan-recruiter-linkedin] No Apollo/Unipile profile found, using slug fallback", JSON.stringify({
        cleanUrl,
        expectedSlug,
        displaySlug,
      }));

      profile = {
        name: humanizeLinkedInSlug(displaySlug || expectedSlug),
        first_name: null,
        last_name: null,
        headline: "",
        title: "",
        bio: "",
        skills: [],
        experience: [],
        employment_history: [],
        education: [],
        education_history: [],
        organization_name: null,
        organization: {
          name: null,
          industries: [],
          technology_names: [],
          keywords: [],
          industry: null,
          short_description: null,
          seo_description: null,
        },
        city: null,
        state: null,
        country: null,
        location: null,
        photo_url: null,
        email: null,
        phone_numbers: [],
        recommendations: [],
        seniority: null,
        linkedin_url: cleanUrl,
        __source: "slug_fallback",
      };
    }

    const employmentHistory = Array.isArray(profile.employment_history)
      ? profile.employment_history
      : Array.isArray(profile.experience)
        ? profile.experience
        : [];

    const educationHistory = Array.isArray(profile.education)
      ? profile.education
      : Array.isArray(profile.education_history)
        ? profile.education_history
        : [];

    const name = profile.name || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Ce recruteur";
    const headline = profile.headline || profile.title || "";
    const about = profile.bio || profile.organization?.short_description || profile.organization?.seo_description || "";
    const skills = Array.from(new Set([
      ...(Array.isArray(profile.skills) ? profile.skills.map((s: any) => typeof s === "string" ? s : s?.name) : []),
      ...(Array.isArray(profile.organization?.keywords) ? profile.organization.keywords : []),
    ].filter(Boolean)));
    const experiences = employmentHistory.slice(0, 8).map((e: any) => {
      const parts = [e.title, e.organization_name || e.company_name, e.location].filter(Boolean);
      return parts.join(" — ");
    });

    const experienceDetails = employmentHistory.slice(0, 8).map((e: any) => {
      const orgName = e.organization_name || e.company_name || null;
      // Try Apollo's logo first
      let logoUrl = e.organization_logo_url || e.logo_url || e.organization_profile_photo || null;
      // Try website domain via Clearbit
      if (!logoUrl && e.organization_website_url) {
        try {
          const domain = new URL(e.organization_website_url.startsWith('http') ? e.organization_website_url : `https://${e.organization_website_url}`).hostname;
          logoUrl = `https://logo.clearbit.com/${domain}`;
        } catch { /* ignore */ }
      }
      // Guess domain from company name as last resort
      if (!logoUrl && orgName) {
        const guess = orgName
          .toLowerCase()
          .replace(/\s*(group|inc\.?|ltd\.?|llc|sas|sarl|sa|gmbh|co\.?|corp\.?|france|europe|international)\s*/gi, '')
          .trim()
          .replace(/[^a-z0-9]/g, '');
        if (guess.length >= 2) {
          logoUrl = `https://logo.clearbit.com/${guess}.com`;
        }
      }
      return {
        title: e.title || null,
        company: orgName,
        location: e.location || null,
        startDate: e.start_date || null,
        endDate: e.end_date || null,
        current: e.current || (!e.end_date),
        logoUrl,
      };
    });

    const education = educationHistory.slice(0, 3).map((e: any) =>
      [e.school_name || e.school, e.degree, e.field_of_study].filter(Boolean).join(" — ")
    );

    const validStartDates = employmentHistory
      .map((exp: any) => exp.start_date ? new Date(exp.start_date) : null)
      .filter((date: Date | null): date is Date => !!date && !Number.isNaN(date.getTime()));
    const earliestStart = validStartDates.length
      ? Math.min(...validStartDates.map((date) => date.getTime()))
      : null;
    const yearsExperience = earliestStart
      ? Math.max(1, Math.round((Date.now() - earliestStart) / (1000 * 60 * 60 * 24 * 365)))
      : 0;

    const seniority = profile.seniority || null;
    const currentCompany = profile.organization_name || profile.organization?.name || employmentHistory[0]?.organization_name || null;
    const currentTitle = profile.title || employmentHistory[0]?.title || null;
    const location = [profile.city, profile.state, profile.country].filter(Boolean).join(", ") || profile.location || null;
    const industry = profile.organization?.industry || null;
    const photoUrl = profile.photo_url || null;

    const companies = Array.from(new Set(
      employmentHistory.map((e: any) => e.organization_name || e.company_name).filter(Boolean)
    )).slice(0, 10) as string[];

    const industries = Array.from(new Set([
      ...(Array.isArray(profile.organization?.industries) ? profile.organization.industries : []),
      ...(industry ? [industry] : []),
    ].filter(Boolean))) as string[];

    const recommendations = Array.isArray(profile.recommendations)
      ? profile.recommendations.slice(0, 5).map((r: any) => ({
          body: typeof r === "string" ? r : (r.body || r.text || r.recommendation || ""),
          recommenderName: r.recommender_name || r.recommender?.name || r.name || null,
          recommenderTitle: r.recommender_title || r.recommender?.title || null,
        })).filter((r: any) => r.body)
      : [];

    const tags = Array.from(new Set([
      ...(seniority ? [seniority] : []),
      ...industries.slice(0, 3),
      ...(profile.organization?.technology_names?.slice(0, 5) || []),
    ].filter(Boolean))) as string[];

    const slugBase = name
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const slug = `${slugBase}-${Date.now().toString(36).slice(-4)}`;

    // Save basic profile data (no bio yet - bio generated after classification)
    await supabase
      .from("profiles")
      .update({
        linkedin_url: matchedUrl,
        recruiter_headline: headline,
        linkedin_skills: skills.slice(0, 20),
        years_experience: yearsExperience,
        public_slug: slug,
      })
      .eq("user_id", user.id);

    return new Response(
      JSON.stringify({
        headline,
        skills: skills.slice(0, 20),
        yearsExperience,
        slug,
        name,
        seniority,
        currentCompany,
        currentTitle,
        location,
        industries,
        tags,
        companies,
        photoUrl,
        education: education.slice(0, 3),
        recommendations,
        experienceDetails,
        about,
        experiences,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("scan-recruiter-linkedin error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});