// ============================================================================
// Profile enrichment — shared worker logic (decoupled queue, Phase 2)
// ============================================================================
// Conformité LinkedIn warning #260513-007211 : l'enrichissement de profil
// (une lecture de profil par le compte LinkedIn du membre) ne doit JAMAIS partir
// en burst. Cette logique est appelée UNIQUEMENT par le cron
// process-enrichment-queue, qui la throttle (1 profil à la fois, espacé, heures
// ouvrées). Le scoring ne fetch plus aucun profil en direct — il met en file
// (profile_enrichment_queue).
//
// API v2 du prestataire (client partagé _shared/unipile) : une lecture de profil
// n'enregistre PAS de visite (la visite est un appel explicite, jamais fait ici).
// Le profil lu est normalisé par toKonektProfile, puis mis en forme ci-dessous :
// on produit le MÊME shape `enriched_data` que celui lu par readEnrichmentCache
// (score-profile-job), donc le scoring hydrate sans changement.
// ============================================================================

import { enforceLinkedInAction, recordUsageSignal } from "./linkedin-quotas.ts";
import {
  assertAccountOwnedByOrg,
  assertV2AccountId,
  describeForLog,
  errorKindOf,
  getProfile,
  toKonektProfile,
  userRef,
  type KonektProfile,
  type ProfileSection,
  type UserRefInput,
} from "./unipile/index.ts";

// deno-lint-ignore no-explicit-any
type AnyClient = any;

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

/**
 * Sections demandées en UNE lecture. « À propos » n'est pas une section : le
 * texte est toujours renvoyé à la racine du profil (`bio`).
 */
export const ENRICH_SECTIONS: readonly ProfileSection[] = [
  "linkedin_experience", "linkedin_skills", "linkedin_education",
  "linkedin_recommendations", "linkedin_projects", "linkedin_certifications",
  "linkedin_languages", "linkedin_volunteer_experience",
];

export interface EnrichResult {
  ok: boolean;
  reason?: string;
  /** quota gate scope when blocked (provider_pause, profile_view, ...) */
  scope?: string;
  sectionsFilled: string[];
  /** Plus de pourcentage d'usage côté prestataire (API v2) : toujours null. */
  usagePct: number | null;
}

export interface EnrichDeps {
  supabase: AnyClient;
  /** Identifiant de compte courant (`acc_...`). */
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

/** « École - Diplôme - Domaine (année de fin) », comme ProfileData.education (profile-data.ts). */
function educationLine(e: NonNullable<KonektProfile["education"]>[number]): string {
  const year = e.end?.year ? ` (${e.end.year})` : "";
  return [e.school, e.degree, e.field_of_study].filter(Boolean).join(" - ") + year;
}

/**
 * Met un profil normalisé (toKonektProfile) dans la forme `enriched_data`
 * persistée dans candidate_enrichment_cache (consommée par
 * score-profile-job/readEnrichmentCache). Pure : aucune lecture réseau.
 */
export function buildEnrichedData(
  profile: KonektProfile,
  now: Date = new Date(),
): { enrichedData: Record<string, unknown>; sectionsFilled: string[] } {
  const sectionsFilled: string[] = [];

  // ── Experience ──
  const workExperience = (profile.work_experience ?? []).slice(0, 5).map((exp) => {
    let durationMonths = 0;
    const startYear = exp.start?.year;
    const endYear = exp.end?.year || now.getFullYear();
    if (startYear) {
      const startMonth = exp.start?.month || 1;
      const endMonth = exp.end?.month || now.getMonth() + 1;
      durationMonths = (endYear - startYear) * 12 + (endMonth - startMonth);
    }
    return {
      role: exp.role ?? "",
      company: exp.company ?? "",
      duration: durationMonths > 0 ? formatDuration(durationMonths) : undefined,
      durationMonths,
      description: (exp.description ?? "").slice(0, 500) || undefined,
      skills: (exp.skills ?? []).map((s) => s.name).slice(0, 8),
    };
  });
  if (workExperience.length > 0) sectionsFilled.push("experience");

  // ── Summary / about ──
  let summary: string | undefined;
  if (profile.summary) {
    summary = profile.summary.slice(0, 700);
    sectionsFilled.push("about");
  }

  // ── Skills (+ endorsements) ──
  let skills: string[] | undefined;
  let skillsWithEndorsements: Array<{ name: string; endorsements?: number }> | undefined;
  if (profile.skills && profile.skills.length > 0) {
    skills = profile.skills.map((s) => s.name).slice(0, 15);
    skillsWithEndorsements = profile.skills.slice(0, 15).map((s) => ({
      name: s.name,
      endorsements: s.endorsement_count ?? undefined,
    }));
    sectionsFilled.push("skills");
  }

  // ── Education (lignes de texte, la forme de ProfileData.education) ──
  let education: string[] | undefined;
  const educationLines = (profile.education ?? []).map(educationLine).filter((line) => line.trim().length > 0);
  if (educationLines.length > 0) {
    education = educationLines;
    sectionsFilled.push("education");
  }

  // ── Recommendations (received) ──
  let recommendations: Array<{ text: string; author?: string; authorHeadline?: string }> | undefined;
  const recosReceived = profile.recommendations?.received ?? [];
  if (recosReceived.length > 0) {
    recommendations = recosReceived.slice(0, 4).map((r) => ({
      text: (r.text || r.caption || "").slice(0, 250),
      author: r.actor ? `${r.actor.first_name || ""} ${r.actor.last_name || ""}`.trim() : undefined,
      authorHeadline: r.actor?.headline ?? undefined,
    })).filter((r) => r.text && r.text.length > 20);
    if (recommendations.length > 0) sectionsFilled.push("recommendations");
  }

  // ── Projects ──
  let projects: Array<{ name: string; description?: string; skills?: string[] }> | undefined;
  if (profile.projects && profile.projects.length > 0) {
    projects = profile.projects.slice(0, 5).map((p) => ({
      name: p.name ?? "",
      description: p.description?.slice(0, 120),
      skills: p.skills ? p.skills.slice(0, 5) : undefined,
    })).filter((p) => p.name);
    if (projects.length > 0) sectionsFilled.push("projects");
  }

  // ── Certifications ──
  let certifications: Array<{ name: string; organization?: string }> | undefined;
  if (profile.certifications && profile.certifications.length > 0) {
    certifications = profile.certifications.slice(0, 8).map((c) => ({
      name: c.name ?? "",
      organization: c.organization ?? undefined,
    })).filter((c) => c.name);
    if (certifications.length > 0) sectionsFilled.push("certifications");
  }

  // ── Volunteering ──
  let volunteering: Array<{ role?: string; company?: string; description?: string }> | undefined;
  if (profile.volunteering_experience && profile.volunteering_experience.length > 0) {
    volunteering = profile.volunteering_experience.slice(0, 3).map((v) => ({
      role: v.role ?? undefined,
      company: v.company ?? undefined,
      description: v.description?.slice(0, 100),
    })).filter((v) => v.role || v.company);
    if (volunteering.length > 0) sectionsFilled.push("volunteer_experience");
  }

  // ── Languages ──
  let languages: Array<{ name: string; proficiency?: string }> | undefined;
  if (profile.languages && profile.languages.length > 0) {
    languages = profile.languages.map((l) => ({
      name: l.name,
      proficiency: l.proficiency ?? undefined,
    })).filter((l) => l.name);
    if (languages.length > 0) sectionsFilled.push("languages");
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
 * Référence de lecture d'une personne : UNE seule forme (l'identifiant du
 * prestataire de préférence, sinon le pseudo), jamais un nom. Le client essaie
 * sinon chaque forme à la suite : une lecture de plus que le registre
 * `profile_view` ne compte, ce que la file d'enrichissement ne doit pas faire.
 */
export function profileReference(providerId?: string | null, profileUrl?: string | null): UserRefInput | null {
  // Un « identifiant » de file qui est en fait un pseudo est classé par userRef, comme une adresse.
  const fromId = providerId ? userRef(providerId) : null;
  const fromUrl = profileUrl ? userRef(profileUrl) : null;
  const id = fromId?.providerId ?? fromUrl?.providerId ?? null;
  const slug = fromId?.slug ?? fromUrl?.slug ?? null;
  if (id) return { providerId: id };
  return slug ? { slug } : null;
}

/**
 * THROTTLED, GATED single-profile enrichment. Called one profile at a time by
 * the queue cron. Gates through the unified ledger (profile_view), reads ONE
 * profile, parses, and upserts candidate_enrichment_cache.
 *
 * Returns ok=false (with scope) when the quota gate blocks (cap reached / account
 * paused) — the caller should reschedule, NOT retry immediately.
 */
export async function enrichProfileToCache(deps: EnrichDeps): Promise<EnrichResult> {
  const name = deps.profileName || deps.providerId || deps.profileUrl || "unknown";
  const failed = (reason: string, extra: Partial<EnrichResult> = {}): EnrichResult => ({
    ok: false, reason, sectionsFilled: [], usagePct: null, ...extra,
  });

  // 0. Le compte doit être un identifiant courant ET relié, dans l'organisation,
  //    au membre pour qui la lecture est faite (la clé du prestataire est commune
  //    à toutes les organisations : un identifiant reçu d'une requête n'est pas
  //    digne de confiance). Avant tout passage au registre des actions.
  try {
    assertV2AccountId(deps.accountId);
  } catch (err) {
    console.warn(`[enrich-worker] ${describeForLog(err)}`);
    return failed("outdated_account_id");
  }
  if (!deps.organizationId) return failed("account_not_linked");
  try {
    await assertAccountOwnedByOrg(deps.supabase, deps.organizationId, deps.accountId, {
      kinds: ["linkedin"],
      ...(deps.userId ? { userId: deps.userId } : {}),
    });
  } catch (err) {
    console.warn(`[enrich-worker] ${describeForLog(err)}`);
    return failed(errorKindOf(err) === "forbidden" ? "account_not_linked" : "ownership_check_failed");
  }

  // 1. Unified ledger gate (profile_view) — global daily cap + provider pause.
  const gate = await enforceLinkedInAction(deps.supabase, {
    accountId: deps.accountId,
    actionType: "profile_view",
    userId: deps.userId,
    organizationId: deps.organizationId,
    source: "enrichment_queue",
  });
  if (!gate.allowed) {
    return failed(gate.reason ?? "blocked", { scope: gate.scope });
  }

  // 2. Resolve a profile reference (slug and/or provider id).
  const reference = profileReference(deps.providerId, deps.profileUrl);
  if (!reference) return failed("no profile identifier");

  // 3. ONE read (no /posts — empreinte minimale), all the sections the scoring uses.
  let profile: KonektProfile;
  let throttled: string[] = [];
  try {
    const raw = await getProfile(deps.accountId, reference, { sections: ENRICH_SECTIONS });
    profile = toKonektProfile(raw);
    throttled = profile.throttled_sections ?? [];
  } catch (err) {
    const kind = errorKindOf(err);
    console.error(`[enrich-worker] profile read failed for ${name}: ${describeForLog(err)}`);
    // Provider hard-limit → pause the account so every path backs off.
    if (kind === "provider_limit") {
      await recordUsageSignal(deps.supabase, deps.accountId, 100, undefined);
    }
    return failed(`profile_read_${kind}`);
  }
  if (throttled.length > 0) {
    console.warn(`[enrich-worker] throttled sections for ${name}: ${throttled.join(",")}`);
  }

  const { enrichedData, sectionsFilled } = buildEnrichedData(profile);
  if (sectionsFilled.length === 0) {
    return failed(throttled.length > 0 ? "no usable sections in response (throttled)" : "no usable sections in response");
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
    return { ok: false, reason: `cache write error: ${err instanceof Error ? err.message : "unknown"}`, sectionsFilled, usagePct: null };
  }

  console.info(`[enrich-worker] cached ${name}: ${sectionsFilled.join(",")}`);
  return { ok: true, sectionsFilled, usagePct: null };
}
