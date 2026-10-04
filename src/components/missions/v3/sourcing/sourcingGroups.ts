// Refonte mission, lot 1-2 (écran Sourcing de la nouvelle page) : rangement
// des profils de la recherche en trois groupes (conception 5.1) : À trier,
// Retenus, Écartés, et textes de chaque ligne (note, raison, étape).
//
// Module pur : il ne lit que ce que la recherche a déjà chargé (statut et
// pipeline_stage de job_candidate_status, notes de la notation). Aucune
// écriture ici : retenir, écarter et remettre à trier passent par
// useJobCandidateStatus, qui écrit par src/lib/candidateStage.ts.

import type { GeneralStage } from '@/lib/candidateStage';
import { GENERAL_STAGE_LABEL } from '@/lib/stageDisplay';

export type SourcingGroup = 'to_sort' | 'retained' | 'rejected';

export const SOURCING_GROUPS: readonly SourcingGroup[] = ['to_sort', 'retained', 'rejected'];

export const SOURCING_GROUP_LABEL: Readonly<Record<SourcingGroup, string>> = {
  to_sort: 'À trier',
  retained: 'Retenus',
  rejected: 'Écartés',
};

/** Ce que la recherche sait d'un candidat (ligne job_candidate_status chargée). */
export interface SourcingStatusLike {
  status?: string | null;
  pipeline_stage?: string | null;
  score?: number | null;
  recommendation?: string | null;
  skip_reason?: string | null;
  scoring_details?: { summary?: unknown } | null;
}

/** Note de la notation en cours d'écran (jobScores). */
export interface SourcingScoreLike {
  match_score?: number | null;
  recommendation?: string | null;
  summary?: string | null;
  missing_skills?: readonly string[] | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAGE_BY_RANK: readonly GeneralStage[] = ['to_sort', 'retained', 'contacted', 'replied', 'interviewing', 'hired'];

/**
 * Étape d'un candidat d'après l'ancien couple (status, pipeline_stage), même
 * correspondance que candidate_stage_from_legacy (migration du lot 0a).
 */
export function legacyStageOf(status?: string | null, pipelineStage?: string | null): GeneralStage {
  const st = (status ?? '').trim().toLowerCase();
  const ps = (pipelineStage ?? '').trim().toLowerCase();
  if (st === 'dismissed' || ps === 'perdu' || ps === 'dismissed') return 'rejected';
  let stRank = 0;
  if (st === 'shortlisted') stRank = 1;
  else if (st === 'messaged' || st === 'contacted') stRank = 2;
  else if (st === 'replied' || st === 'interested' || st === 'not_interested') stRank = 3;
  else if (st === 'qualification') stRank = 4;
  let psRank = 0;
  if (ps === 'pressenti' || ps === 'shortlisted') psRank = 1;
  else if (ps === 'contacté' || ps === 'messaged') psRank = 2;
  else if (ps === 'répondu') psRank = 3;
  else if (ps === 'pré-qualif' || ps === 'itw en cours' || ps === 'offre' || ps === 'cv envoyé' || UUID_RE.test(ps)) psRank = 4;
  else if (ps === 'gagné' || ps === 'hired') psRank = 5;
  return STAGE_BY_RANK[Math.max(stRank, psRank)];
}

/** Groupe d'un candidat : sans ligne, découvert ou noté, il est À trier. */
export function sourcingGroupOf(status: SourcingStatusLike | null | undefined): SourcingGroup {
  const stage = legacyStageOf(status?.status, status?.pipeline_stage);
  if (stage === 'to_sort') return 'to_sort';
  if (stage === 'rejected') return 'rejected';
  return 'retained';
}

/**
 * Profils des trois groupes : les résultats de la recherche en cours, puis les
 * lignes de la mission déjà retenues ou écartées (hors de cette recherche),
 * sans plafond. Les lignes À trier d'anciennes recherches restent dehors (la
 * conception 5.1 écarte ce mélange), sauf celles remises à trier ici
 * (`keepToSort`). `toProfile` rend null pour une ligne sans rien d'affichable.
 */
export function sourcingProfilesOf<P extends { id: string }, S extends SourcingStatusLike>(
  results: readonly P[],
  statuses: ReadonlyMap<string, S> | undefined,
  toProfile: (status: S) => P | null,
  keepToSort: ReadonlySet<string> = new Set(),
): P[] {
  const out = [...results];
  if (!statuses || statuses.size === 0) return out;
  const seen = new Set(results.map((r) => r.id));
  for (const [id, status] of statuses) {
    if (seen.has(id)) continue;
    if (sourcingGroupOf(status) === 'to_sort' && !keepToSort.has(id)) continue;
    const profile = toProfile(status);
    if (!profile) continue;
    seen.add(id);
    out.push(profile);
  }
  return out;
}

/** Étape affichée dans Retenus (jamais la valeur brute). */
export function retainedStageOf(status: SourcingStatusLike | null | undefined): GeneralStage {
  return legacyStageOf(status?.status, status?.pipeline_stage);
}

export function retainedStageLabel(status: SourcingStatusLike | null | undefined): string {
  return GENERAL_STAGE_LABEL[retainedStageOf(status)];
}

/** Note arrondie ; null si le profil n'est pas noté (cellule vide, jamais un zéro). */
export function noteOf(score: SourcingScoreLike | null | undefined, status: SourcingStatusLike | null | undefined): number | null {
  const raw = typeof score?.match_score === 'number' ? score.match_score : typeof status?.score === 'number' ? status.score : null;
  return raw === null || Number.isNaN(raw) ? null : Math.round(raw);
}

export function recommendationOf(score: SourcingScoreLike | null | undefined, status: SourcingStatusLike | null | undefined): string | null {
  return score?.recommendation || status?.recommendation || null;
}

/**
 * Recommandation positive : mêmes valeurs que is_go_recommendation (SQL, lot 3),
 * pour que « dont N recommandés » de la carte Maintenant et la pastille
 * « Recommandé » du Sourcing comptent les mêmes profils.
 */
export function isGoRecommendation(recommendation: string | null | undefined): boolean {
  const value = (recommendation ?? '').trim().toLowerCase();
  return value === 'go' || value === 'strong_match' || value === 'good_match';
}

/** Minuscule initiale, sauf pour un sigle (« IFRS » reste « IFRS »). */
function firstLower(text: string): string {
  if (text.length === 0) return text;
  const second = text.charAt(1);
  if (second && second !== second.toLowerCase()) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function clean(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

export type ReasonTone = 'muted' | 'ai' | 'default';

/**
 * Raison affichée pour un profil À trier : « Pas encore noté », suggestion
 * d'écart de l'IA, ou résumé de la note.
 */
export function reasonOf(
  score: SourcingScoreLike | null | undefined,
  status: SourcingStatusLike | null | undefined,
  opts: { scoring?: boolean } = {},
): { text: string; tone: ReasonTone } {
  if (noteOf(score, status) === null) {
    return opts.scoring ? { text: 'Notation en cours', tone: 'muted' } : { text: 'Pas encore noté', tone: 'muted' };
  }
  const summary = clean(score?.summary) || clean(status?.scoring_details?.summary);
  if (recommendationOf(score, status) === 'skip') {
    const detail = summary || (score?.missing_skills ?? []).filter(Boolean).slice(0, 3).join(', ');
    return { text: detail ? `L'IA suggère d'écarter : ${firstLower(detail)}` : "L'IA suggère d'écarter", tone: 'ai' };
  }
  return { text: summary, tone: 'default' };
}

/** Raison affichée dans Écartés : la raison donnée par l'IA, dite comme telle. */
export function rejectedReasonOf(status: SourcingStatusLike | null | undefined): string {
  const reason = clean(status?.skip_reason);
  return reason ? `Selon l'IA : ${firstLower(reason)}` : '';
}

/** Suggestion d'écart de l'IA : profil noté « skip ». */
export function isAiSkip(score: SourcingScoreLike | null | undefined, status: SourcingStatusLike | null | undefined): boolean {
  return noteOf(score, status) !== null && recommendationOf(score, status) === 'skip';
}

/** À trier : notés d'abord par note décroissante, puis non notés dans l'ordre reçu. */
export function sortToSort<T>(rows: readonly T[], note: (row: T) => number | null): T[] {
  return rows
    .map((row, index) => ({ row, index, value: note(row) }))
    .sort((a, b) => {
      if (a.value !== null && b.value !== null) return b.value - a.value || a.index - b.index;
      if (a.value !== null) return -1;
      if (b.value !== null) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** « A », « A et B », « A, B et C », « A, B, C et 2 autres ». */
export function joinNames(names: readonly string[], max = 3): string {
  const list = names.filter((name) => name.trim().length > 0);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length <= max) return `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}`;
  const rest = list.length - max;
  return `${list.slice(0, max).join(', ')} et ${rest} ${rest > 1 ? 'autres' : 'autre'}`;
}

/** Libellé du bouton de notation (plancher de 2 crédits par profil, ACTION_COSTS.scoring). */
export function scoreButtonLabel(count: number, totalUnscored: number, floorPerProfile: number): string {
  const credits = count * floorPerProfile;
  if (count <= 1) return `Noter le profil non noté (au moins ${credits} crédits)`;
  if (count < totalUnscored) return `Noter les ${count} premiers (au moins ${credits} crédits)`;
  return `Noter les ${count} profils non notés (au moins ${credits} crédits)`;
}
