// Refonte mission, lot 2 : adaptateurs de la fiche candidat de la nouvelle page
// mission. Une ligne de mission_candidate_rows devient l'ATSCandidate que lisent
// les onglets existants (src/components/ats/candidate-detail/**), et le profil
// LinkedIn enregistré devient le profil enrichi de ces onglets.
//
// buildEnrichedProfile est une copie de la construction de CandidateDetailModal
// (qui reste intacte, et sert encore le /pipeline et l'ancienne page mission).
// Module pur : aucune lecture, aucune écriture.

import type { ATSCandidate } from '@/hooks/useATSData';
import type { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import type { MissionCandidateDetailRow, MissionCandidateRow } from '../types';

type Raw = Record<string, any>;

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Profil LinkedIn enregistré utilisable : un objet non vide. */
export function hasProfileData(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw as object).length > 0;
}

/** Nom affiché d'un candidat ; « Candidat sans nom » à défaut. */
export function candidateDisplayName(row: Pick<MissionCandidateRow, 'name'>, raw?: unknown): string {
  if (row.name) return row.name;
  const r = (hasProfileData(raw) ? raw : {}) as Raw;
  const fromProfile = text(r.name) ?? text(`${r.first_name ?? ''} ${r.last_name ?? ''}`);
  return fromProfile ?? 'Candidat sans nom';
}

function monthDate(d: Raw | undefined | null): string | undefined {
  if (!d || typeof d !== 'object') return undefined;
  return `${d.year || ''}${d.month ? `-${String(d.month).padStart(2, '0')}` : ''}` || undefined;
}

/**
 * Profil enrichi des onglets existants (Aperçu, Évaluations, Profil) à partir
 * du profil LinkedIn enregistré ; null sans profil. `now` : année de référence
 * pour les années d'expérience.
 */
export function buildEnrichedProfile(
  raw: unknown,
  fallback: { name: string | null; headline: string | null },
  now: Date = new Date(),
): EnrichedProfile | null {
  if (!hasProfileData(raw)) return null;
  const r = raw as Raw;
  const workExperience: Raw[] = Array.isArray(r.work_experience) ? r.work_experience : [];
  const currentJob = workExperience.find((exp) => exp && !exp.end) || workExperience[0];
  let yearsOfExperience: number | undefined;
  const startYears = workExperience.map((e) => e?.start?.year).filter((y): y is number => typeof y === 'number' && y > 0);
  if (startYears.length > 0) yearsOfExperience = now.getFullYear() - Math.min(...startYears);
  const listOfNames = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((s) => (typeof s === 'string' ? s : s?.name)).filter((s): s is string => typeof s === 'string' && s !== '')
      : [];

  return {
    name: text(r.name) || text(`${r.first_name || ''} ${r.last_name || ''}`) || fallback.name || '',
    headline: text(r.headline) || fallback.headline || undefined,
    summary: text(r.summary) ?? undefined,
    currentRole: currentJob?.role,
    currentCompany: currentJob?.company,
    location: typeof r.location === 'string' ? r.location : r.location?.name,
    skills: listOfNames(r.skills),
    experiences: workExperience.slice(0, 6).map((exp) => ({
      title: exp?.role || exp?.title || '',
      company: exp?.company || exp?.company_name || '',
      logo: exp?.company_logo || exp?.logo_url || exp?.logo || undefined,
      description: exp?.description,
      startDate: monthDate(exp?.start),
      endDate: monthDate(exp?.end),
      isCurrent: !exp?.end,
    })),
    education: (Array.isArray(r.education) ? r.education : []).slice(0, 4).map((edu: Raw) => {
      const school =
        typeof edu?.school === 'string' ? edu.school : edu?.school?.name || edu?.school_name || edu?.school_details?.name || '';
      const logo =
        edu?.school_logo ||
        edu?.logo_url ||
        edu?.logo ||
        edu?.school_details?.logo ||
        edu?.school_details?.logo_url ||
        edu?.school_details?.image ||
        (typeof edu?.school === 'object' ? edu?.school?.logo : undefined);
      return {
        school,
        logo: logo || undefined,
        degree: edu?.degree || edu?.degree_name || '',
        field: edu?.field_of_study || edu?.field || '',
        startYear: edu?.start?.year?.toString(),
        endYear: edu?.end?.year?.toString(),
      };
    }),
    yearsOfExperience,
    languages: listOfNames(r.languages),
  };
}

/**
 * Ligne sous le nom : « Poste, Entreprise », sinon le titre du profil.
 * null s'il n'y a rien.
 */
export function positionLine(
  enriched: Pick<EnrichedProfile, 'currentRole' | 'currentCompany' | 'headline'> | null,
  headline: string | null,
): string | null {
  const role = text(enriched?.currentRole);
  const company = text(enriched?.currentCompany);
  if (role && company) return `${role}, ${company}`;
  return role ?? text(enriched?.headline) ?? text(headline) ?? company;
}

export interface ScoreReasons {
  summary: string | null;
  strengths: string[];
  concerns: string[];
}

const MAX_REASONS = 4;

/**
 * Raison de la note : résumé, points forts et réserves de scoring_details
 * (score-profile-job). Aucun détail par critère : il n'existe que pour les
 * postes à critères structurés, et n'est pas enregistré sur la ligne.
 * null si rien n'est lisible.
 */
export function scoreReasons(details: unknown): ScoreReasons | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Raw;
  const list = (v: unknown) =>
    Array.isArray(v) ? v.map(text).filter((s): s is string => s !== null).slice(0, MAX_REASONS) : [];
  const out: ScoreReasons = { summary: text(d.summary), strengths: list(d.strengths), concerns: list(d.concerns) };
  return out.summary || out.strengths.length > 0 || out.concerns.length > 0 ? out : null;
}

/**
 * ATSCandidate des onglets existants pour une ligne de la mission.
 * id = ligne canonique, jobId = celui de la ligne, jobTitle = intitulé du
 * poste ou nom de la mission, stage = libellé de l'étape de la mission.
 */
export function toAtsCandidate(
  row: MissionCandidateDetailRow,
  project: { name: string; job_details?: unknown },
  stageLabel: string,
  linkedinProfileData: unknown,
  now: Date = new Date(),
): ATSCandidate {
  const jd = (project.job_details && typeof project.job_details === 'object' ? project.job_details : {}) as Raw;
  const profile = hasProfileData(linkedinProfileData) ? linkedinProfileData : null;
  return {
    id: row.id,
    candidateId: row.candidateId,
    name: candidateDisplayName(row, profile),
    email: null,
    phone: null,
    linkedin: row.linkedinUrl,
    headline: row.headline,
    expertise: [],
    stage: stageLabel,
    entity: null,
    source: 'local',
    sourceId: row.id,
    jobId: row.jobId,
    jobTitle: text(jd.title) ?? project.name,
    lastActivity: row.updatedAt ?? row.stageEnteredAt,
    createdAt: row.createdAt ?? row.stageEnteredAt ?? row.updatedAt ?? now.toISOString(),
    score: row.score,
    recommendation: row.recommendation,
    tags: row.tags,
    scoringDetails: (row.scoringDetails && typeof row.scoringDetails === 'object'
      ? row.scoringDetails
      : null) as ATSCandidate['scoringDetails'],
    linkedinProfileData: profile,
  };
}

/**
 * Voisins d'une ligne dans l'ordre affiché par Pipeline. Une ligne absente de
 * la liste n'a pas de voisin (flèches inactives).
 */
export function neighborRowIds(
  visibleRowIds: readonly string[],
  ids: readonly string[],
): { previous: string | null; next: string | null } {
  const index = visibleRowIds.findIndex((id) => ids.includes(id));
  if (index === -1) return { previous: null, next: null };
  return {
    previous: index > 0 ? visibleRowIds[index - 1] : null,
    next: index + 1 < visibleRowIds.length ? visibleRowIds[index + 1] : null,
  };
}

/**
 * Place du candidat dans la liste affichée (« 3 sur 12 »), par n'importe
 * quelle ligne de son groupe ; null s'il n'y figure pas.
 */
export function rowPosition(
  visibleRowIds: readonly string[],
  ids: readonly string[],
): { index: number; total: number } | null {
  const index = visibleRowIds.findIndex((id) => ids.includes(id));
  if (index === -1) return null;
  return { index: index + 1, total: visibleRowIds.length };
}

/** Date courte « 17/09 » ; null pour une date illisible. */
export function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

/** Jalons datés de la ligne, dans l'ordre de l'entonnoir : « Contacté le 17/09 ». */
export function milestoneTexts(
  row: Pick<MissionCandidateRow, 'contactedAt' | 'repliedAt' | 'firstInterviewAt' | 'presentedAt' | 'hiredAt'>,
): string[] {
  const items: [string | null, string][] = [
    [row.contactedAt, 'Contacté le'],
    [row.repliedAt, 'A répondu le'],
    [row.firstInterviewAt, 'Premier entretien le'],
    [row.presentedAt, 'Présenté au client le'],
    [row.hiredAt, 'Embauché le'],
  ];
  const out: string[] = [];
  for (const [iso, label] of items) {
    const d = shortDate(iso);
    if (d) out.push(`${label} ${d}`);
  }
  return out;
}

/** « depuis aujourd'hui », « depuis 1 j », « depuis 6 j » ; null sans date. */
export function sinceText(days: number | null): string | null {
  if (days === null) return null;
  return days === 0 ? "depuis aujourd'hui" : `depuis ${days.toLocaleString('fr-FR')} j`;
}
