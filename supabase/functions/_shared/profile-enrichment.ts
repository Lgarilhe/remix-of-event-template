// ============================================================================
// Profile enrichment — shared worker logic (decoupled queue, Phase 2)
// ============================================================================
// Conformité LinkedIn warning #260513-007211 : l'enrichissement de profil
// (GET /users/{id} = une VUE DE PROFIL) ne doit JAMAIS partir en burst. Cette
// logique est appelée UNIQUEMENT par le cron process-enrichment-queue, qui la
// throttle (1 profil à la fois, espacé, heures ouvrées). Le scoring ne fetch
// plus aucun profil en direct — il met en file (profile_enrichment_queue).
//
// Le parsing ci-dessous est porté depuis score-profile-job/maybeEnrichProfile :
// il produit le MÊME shape `enriched_data` que celui lu par readEnrichmentCache,
// donc le scoring hydrate sans changement.
// ============================================================================

import { enforceLinkedInAction, recordUsageSignal, parseUsagePct } from "./linkedin-quotas.ts";

// deno-lint-ignore no-explicit-any
type AnyClient = any;

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function canonicalizeLinkedinUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
    if (m) return `https://www.linkedin.com/in/${m[1].toLowerCase()}`;
    return url.replace(/\/+$/, "").split("?")[0].toLowerCase();
  } catch {
    return null;
  }
}

const ENRICH_SECTIONS = [
  "experience", "about", "skills", "education",
  "recommendations", "projects", "certifications",
  "languages", "volunteer_experience",
];

export interface EnrichResult {
  ok: boolean;
  reason?: string;
  /** quota gate scope when blocked (provider_pause, profile_view, ...) */
  scope?: string;
  sectionsFilled: string[];
  usagePct: number | null;
}

export interface EnrichDeps {
  supabase: AnyClient;
  apiKey: string;
  /** DSN WITHOUT protocol, or with — normalized internally. */
  dsn: string;
  accountId: string;
  organizationId: string | null;
  userId: string | null;
  providerId?: string | null;
  profileUrl?: string | null;
  profileName?: string;
}

const formatDuration = (m: number) => {
  const y = Math.floor(m / 12);
  const mo = m % 12;
  if (y === 0) return `${mo} mois`;
  if (mo === 0) return `${y} an${y > 1 ? "s" : ""}`;
  return `${y} an${y > 1 ? "s" : ""} ${mo} mois`;
};

/**
 * Parse a Unipile profile response into the `enriched_data` shape persisted in
 * candidate_enrichment_cache (consumed by score-profile-job/readEnrichmentCache).
 */
// deno-lint-ignore no-explicit-any
function parseUnipileProfile(data: any): { enrichedData: Record<string, unknown>; sectionsFilled: string[] } {
  const sectionsFilled: string[] = [];

  // ── Experience ──
  const enrichedExp = (data.work_experience || data.positions || data.experiences || []).slice(0, 5);
  // deno-lint-ignore no-explicit-any
  const workExperience = enrichedExp.map((exp: any) => {
    const role = exp.role || exp.position || exp.title || "";
    const company = exp.company || exp.company_name || "";
    const description = exp.description || "";
    // deno-lint-ignore no-explicit-any
    const skills = (exp.skills || []).map((s: any) => (typeof s === "string" ? s : s.name));
    let durationMonths = 0;
    const startYear = exp.start?.year || (typeof exp.start === "string" ? parseInt(exp.start.split("-")[0]) : null);
    const endYear = exp.end?.year || (typeof exp.end === "string" ? parseInt(exp.end.split("-")[0]) : null) || new Date().getFullYear();
    if (startYear) {
      const startMonth = exp.start?.month || 1;
      const endMonth = exp.end?.month || new Date().getMonth() + 1;
      durationMonths = (endYear - startYear) * 12 + (endMonth - startMonth);
    }
    return {
      role,
      company,
      duration: durationMonths > 0 ? formatDuration(durationMonths) : undefined,
      durationMonths,
      description: description.slice(0, 500) || undefined,
      skills: skills.slice(0, 8),
    };
  });
  if (workExperience.length > 0) sectionsFilled.push("experience");

  // ── Summary / about ──
  let summary: string | undefined;
  if (data.about || data.summary) {
    summary = (data.about || data.summary).slice(0, 700);
    sectionsFilled.push("about");
  }

  // ── Skills (+ endorsements) ──
  let skills: string[] | undefined;
  // deno-lint-ignore no-explicit-any
  let skillsWithEndorsements: any[] | undefined;
  if (Array.isArray(data.skills) && data.skills.length > 0) {
    // deno-lint-ignore no-explicit-any
    skills = (data.skills as any[]).map((s: any) => (typeof s === "string" ? s : s.name)).slice(0, 15);
    // deno-lint-ignore no-explicit-any
    skillsWithEndorsements = (data.skills as any[]).slice(0, 15).map((s: any) => ({
      name: typeof s === "string" ? s : s.name,
      endorsements: typeof s === "object" ? (s.endorsement_count || s.endorsements) : undefined,
    })).filter((s: { name?: string }) => s.name);
    sectionsFilled.push("skills");
  }

  // ── Education ──
  // deno-lint-ignore no-explicit-any
  let education: any[] | undefined;
  if (Array.isArray(data.education) && data.education.length > 0) {
    education = data.education;
    sectionsFilled.push("education");
  }

  // ── Recommendations (received) ──
  const recosReceived = data.recommendations?.received || data.recommendations || [];
  // deno-lint-ignore no-explicit-any
  let recommendations: any[] | undefined;
  if (Array.isArray(recosReceived) && recosReceived.length > 0) {
    // deno-lint-ignore no-explicit-any
    recommendations = recosReceived.slice(0, 4).map((r: any) => ({
      text: (r.text || r.caption || "").slice(0, 250),
      author: r.actor ? `${r.actor.first_name || ""} ${r.actor.last_name || ""}`.trim() : undefined,
      authorHeadline: r.actor?.headline,
    })).filter((r: { text: string }) => r.text && r.text.length > 20);
    if (recommendations && recommendations.length > 0) sectionsFilled.push("recommendations");
  }

  // ── Projects ──
  // deno-lint-ignore no-explicit-any
  let projects: any[] | undefined;
  if (Array.isArray(data.projects) && data.projects.length > 0) {
    // deno-lint-ignore no-explicit-any
    projects = data.projects.slice(0, 5).map((p: any) => ({
      name: p.name || "",
      description: p.description?.slice(0, 120),
      skills: Array.isArray(p.skills)
        // deno-lint-ignore no-explicit-any
        ? p.skills.slice(0, 5).map((s: any) => typeof s === "string" ? s : s.name).filter(Boolean)
        : undefined,
    })).filter((p: { name?: string }) => p.name);
    if (projects && projects.length > 0) sectionsFilled.push("projects");
  }

  // ── Certifications ──
  // deno-lint-ignore no-explicit-any
  let certifications: any[] | undefined;
  if (Array.isArray(data.certifications) && data.certifications.length > 0) {
    // deno-lint-ignore no-explicit-any
    certifications = data.certifications.slice(0, 8).map((c: any) => ({
      name: c.name || "",
      organization: c.organization || c.authority || c.issuer,
    })).filter((c: { name?: string }) => c.name);
    if (certifications && certifications.length > 0) sectionsFilled.push("certifications");
  }

  // ── Volunteering ──
  const volSrc = data.volunteer_experience || data.volunteering_experience || data.volunteering;
  // deno-lint-ignore no-explicit-any
  let volunteering: any[] | undefined;
  if (Array.isArray(volSrc) && volSrc.length > 0) {
    // deno-lint-ignore no-explicit-any
    volunteering = volSrc.slice(0, 3).map((v: any) => ({
      role: v.role || v.position,
      company: v.company || v.organization,
      description: v.description?.slice(0, 100),
    })).filter((v: { role?: string; company?: string }) => v.role || v.company);
    if (volunteering && volunteering.length > 0) sectionsFilled.push("volunteer_experience");
  }

  // ── Languages ──
  // deno-lint-ignore no-explicit-any
  let languages: any[] | undefined;
  if (Array.isArray(data.languages) && data.languages.length > 0) {
    // deno-lint-ignore no-explicit-any
    languages = data.languages.map((l: any) => ({
      name: l.name || l.language || "",
      proficiency: l.proficiency || l.level,
    })).filter((l: { name: string }) => l.name);
    if (languages && languages.length > 0) sectionsFilled.push("languages");
  }

  const enrichedData: Record<string, unknown> = {
    summary,
    workExperience,
    skills,
    skillsWithEndorsements,
    education,
    recommendations,
    projects,
    certifications,
    volunteering,
    languages,
  };

  return { enrichedData, sectionsFilled };
}

/**
 * THROTTLED, GATED single-profile enrichment. Called one profile at a time by
 * the queue cron. Gates through the unified ledger (profile_view), fetches ONE
 * GET /users/{id}, parses, and upserts candidate_enrichment_cache.
 *
 * Returns ok=false (with scope) when the quota gate blocks (cap reached / account
 * paused) — the caller should reschedule, NOT retry immediately.
 */
export async function enrichProfileToCache(deps: EnrichDeps): Promise<EnrichResult> {
  const baseUrl = `${deps.dsn.startsWith("http") ? deps.dsn : `https://${deps.dsn}`}/api/v1`;
  const name = deps.profileName || deps.providerId || deps.profileUrl || "unknown";

  // 1. Unified ledger gate (profile_view) — global daily cap + provider pause.
  const gate = await enforceLinkedInAction(deps.supabase, {
    accountId: deps.accountId,
    actionType: "profile_view",
    userId: deps.userId,
    organizationId: deps.organizationId,
    source: "enrichment_queue",
  });
  if (!gate.allowed) {
    return { ok: false, reason: gate.reason, scope: gate.scope, sectionsFilled: [], usagePct: null };
  }

  // 2. Resolve a profile identifier (provider_id preferred, else slug from URL).
  let resolvedId = deps.providerId || deps.profileUrl || "";
  if (resolvedId.includes("linkedin.com")) {
    resolvedId = resolvedId.replace(/\/+$/, "").split("/").pop() || resolvedId;
  }
  if (!resolvedId) {
    return { ok: false, reason: "no profile identifier", sectionsFilled: [], usagePct: null };
  }

  const sectionsParams = ENRICH_SECTIONS.map((s) => `linkedin_sections=${encodeURIComponent(s)}`).join("&");

  // 3. ONE fetch (no /posts — empreinte minimale).
  let resp: Response | null = null;
  try {
    resp = await fetchWithTimeout(
      `${baseUrl}/users/${encodeURIComponent(resolvedId)}?account_id=${deps.accountId}&${sectionsParams}&notify=false`,
      { headers: { "X-API-KEY": deps.apiKey, Accept: "application/json" } },
    );
  } catch (err) {
    return { ok: false, reason: `fetch error: ${err instanceof Error ? err.message : "unknown"}`, sectionsFilled: [], usagePct: null };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    // Provider hard-limit → pause the account so every path backs off.
    if (/too_many_requests|limit_exceeded|cannot_resend/i.test(body)) {
      await recordUsageSignal(deps.supabase, deps.accountId, 100, undefined);
    }
    return { ok: false, reason: `HTTP ${resp.status}: ${body.slice(0, 160)}`, sectionsFilled: [], usagePct: null };
  }

  // deno-lint-ignore no-explicit-any
  const data: any = await resp.json().catch(() => ({}));
  const usagePct = parseUsagePct(data);
  await recordUsageSignal(deps.supabase, deps.accountId, usagePct, undefined);

  const { enrichedData, sectionsFilled } = parseUnipileProfile(data);
  if (sectionsFilled.length === 0) {
    return { ok: false, reason: "no usable sections in response", sectionsFilled: [], usagePct };
  }

  // 4. Upsert candidate_enrichment_cache (same shape as score-profile-job).
  const linkedinUrl = canonicalizeLinkedinUrl(deps.profileUrl);
  const onConflict = linkedinUrl ? "organization_id,linkedin_url" : "organization_id,provider_id";
  try {
    await deps.supabase.from("candidate_enrichment_cache").upsert({
      organization_id: deps.organizationId,
      linkedin_url: linkedinUrl,
      provider_id: deps.providerId ?? null,
      enriched_data: enrichedData,
      sections_filled: sectionsFilled,
      last_enriched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      enriched_by: deps.userId,
    }, { onConflict });
  } catch (err) {
    return { ok: false, reason: `cache write error: ${err instanceof Error ? err.message : "unknown"}`, sectionsFilled, usagePct };
  }

  console.info(`[enrich-worker] cached ${name}: ${sectionsFilled.join(",")}`);
  return { ok: true, sectionsFilled, usagePct };
}
