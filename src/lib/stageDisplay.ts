// Refonte mission, lot 0c (socle des lectures) : l'affichage de l'étape d'un
// candidat, commun au kanban de mission, au tableau de mission et au /pipeline.
//
// Deux jeux de libellés (plan 0c, section 4.1) :
// - un effectif (combien en ce moment) porte le nom de l'étape, comme la
//   colonne du kanban : GENERAL_STAGE_LABEL ;
// - un cumul (depuis le début, colonnes ever_* de get_mission_stage_counts)
//   porte « au total » : CUMULATIVE_LABEL, cumulativeText.
//
// Les écritures restent dans src/lib/candidateStage.ts ; ce module ne fait que
// ranger, nommer et dater. Aucune fonction ne lit status ni pipeline_stage pour
// ranger une ligne, sauf atsColumnOf pour les quatre colonnes d'entretien du
// /pipeline (Pré-qualif, CV envoyé, ITW en cours, Offre).

import type { QueryClient } from '@tanstack/react-query';
import { GENERAL_STAGES, isGeneralStage, type GeneralStage } from '@/lib/candidateStage';
import { plural } from '@/lib/plural';

// ------------------------------------------------------------ libellés

/** Nom de chaque étape générale, pour un effectif et pour un titre de colonne. */
export const GENERAL_STAGE_LABEL: Readonly<Record<GeneralStage, string>> = {
  to_sort: 'À trier',
  retained: 'Retenu',
  contacted: 'Contacté',
  replied: 'A répondu',
  interviewing: 'En entretien',
  hired: 'Embauché',
  rejected: 'Écarté',
};

/** Ordre des étapes, de l'entonnoir puis Écarté (transversal). */
export const STAGE_ORDER: readonly GeneralStage[] = GENERAL_STAGES;

/** Libellé d'une étape générale ; null pour une valeur inconnue. */
export function stageLabel(stage: string | null | undefined): string | null {
  return isGeneralStage(stage) ? GENERAL_STAGE_LABEL[stage] : null;
}

/** Colonnes de cumul rendues par get_mission_stage_counts. */
export type CumulativeKey =
  | 'ever_retained'
  | 'ever_contacted'
  | 'ever_replied'
  | 'ever_interviewed'
  | 'ever_presented'
  | 'ever_hired';

const CUMULATIVE: Readonly<Record<CumulativeKey, { title: string; one: string; many: string }>> = {
  ever_retained: { title: 'Retenus au total', one: 'retenu', many: 'retenus' },
  ever_contacted: { title: 'Contactés au total', one: 'contacté', many: 'contactés' },
  ever_replied: { title: 'Ont répondu au total', one: 'a répondu', many: 'ont répondu' },
  ever_interviewed: { title: 'Entretiens au total', one: 'passé en entretien', many: 'passés en entretien' },
  ever_presented: { title: 'Présentés au total', one: 'présenté', many: 'présentés' },
  ever_hired: { title: 'Embauchés au total', one: 'embauché', many: 'embauchés' },
};

/** Titre d'un cumul (tuile, ligne de tableau) : « Contactés au total ». */
export const CUMULATIVE_LABEL: Readonly<Record<CumulativeKey, string>> = {
  ever_retained: CUMULATIVE.ever_retained.title,
  ever_contacted: CUMULATIVE.ever_contacted.title,
  ever_replied: CUMULATIVE.ever_replied.title,
  ever_interviewed: CUMULATIVE.ever_interviewed.title,
  ever_presented: CUMULATIVE.ever_presented.title,
  ever_hired: CUMULATIVE.ever_hired.title,
};

/** Cumul en phrase, nombre accordé : « 1 contacté au total », « 3 ont répondu au total ». */
export function cumulativeText(key: CumulativeKey, count: number): string {
  const c = CUMULATIVE[key];
  return `${plural(count, c.one, c.many)} au total`;
}

// ------------------------------------------------------ kanban de mission

/**
 * Clé de colonne du kanban de mission par étape générale. Mêmes clés que
 * missionColumnToStage (candidateStage.ts), qui fait le chemin inverse.
 * En entretien : l'identifiant de l'étape d'entretien de la mission, sinon
 * la clé « interviewing » (« En entretien » pour une mission sans étapes,
 * « Étape à choisir » pour une mission qui en a).
 */
export const MISSION_COLUMN_KEY: Readonly<Record<GeneralStage, string>> = {
  to_sort: 'untreated',
  retained: 'shortlisted',
  contacted: 'messaged',
  replied: 'Répondu',
  interviewing: 'interviewing',
  hired: 'hired',
  rejected: 'dismissed',
};

/** Titre de la colonne « interviewing » d'une mission qui a des étapes d'entretien. */
export const MISSION_STEP_MISSING_LABEL = 'Étape à choisir';

export interface StageRow {
  general_stage?: string | null;
  process_step_id?: string | null;
}

/**
 * Colonne du kanban de mission d'une ligne, tirée de l'étape générale et de
 * l'étape d'entretien seulement. Étape inconnue : À trier.
 */
export function missionColumnOf(row: StageRow, stepIds: ReadonlySet<string>): string {
  const stage: GeneralStage = isGeneralStage(row.general_stage) ? row.general_stage : 'to_sort';
  if (stage === 'interviewing' && row.process_step_id && stepIds.has(row.process_step_id)) {
    return row.process_step_id;
  }
  return MISSION_COLUMN_KEY[stage];
}

// ------------------------------------------------------------- /pipeline

/**
 * Colonne du /pipeline par étape générale (plan 0c, section 6.5). Clés de
 * ATS_STAGES (useATSData.ts) et de ATS_LABEL_TO_STAGE, inchangées.
 */
export const ATS_COLUMN_BY_STAGE: Readonly<Record<GeneralStage, string>> = {
  to_sort: 'Nouveau',
  retained: 'Pressenti',
  contacted: 'Contacté',
  replied: 'Répondu',
  interviewing: 'ITW en cours',
  hired: 'Gagné',
  rejected: 'Perdu',
};

/** Colonnes d'entretien du /pipeline, gardées quand pipeline_stage en porte une. */
export const ATS_INTERVIEW_COLUMNS: readonly string[] = ['Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre'];

/**
 * Colonne du /pipeline d'une ligne. En entretien : pipeline_stage s'il est
 * une colonne d'entretien, sinon « ITW en cours » (le nom de l'étape de
 * mission s'affiche en sous-titre). Étape inconnue : « Nouveau ».
 */
export function atsColumnOf(row: { general_stage?: string | null; pipeline_stage?: string | null }): string {
  if (!isGeneralStage(row.general_stage)) return ATS_COLUMN_BY_STAGE.to_sort;
  if (row.general_stage === 'interviewing' && row.pipeline_stage && ATS_INTERVIEW_COLUMNS.includes(row.pipeline_stage)) {
    return row.pipeline_stage;
  }
  return ATS_COLUMN_BY_STAGE[row.general_stage];
}

const ATS_COLUMN_TITLE: Readonly<Record<string, string>> = {
  Nouveau: GENERAL_STAGE_LABEL.to_sort,
  Pressenti: GENERAL_STAGE_LABEL.retained,
  Contacté: GENERAL_STAGE_LABEL.contacted,
  Répondu: GENERAL_STAGE_LABEL.replied,
  Gagné: GENERAL_STAGE_LABEL.hired,
  Perdu: GENERAL_STAGE_LABEL.rejected,
};

/**
 * Titre affiché d'une colonne du /pipeline (décision 3 : mêmes mots que la
 * mission). Les colonnes d'entretien gardent leur nom ; la clé ne change pas.
 */
export function atsColumnTitle(key: string): string {
  return ATS_COLUMN_TITLE[key] ?? key;
}

// ------------------------------------------------------------- ancienneté

const DAY_MS = 86_400_000;

export interface StageDatedRow {
  stage_entered_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

const timeOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Jours pleins depuis l'entrée dans l'étape (stage_entered_at, à défaut
 * updated_at puis created_at). null sans date lisible ; jamais négatif.
 */
export function stageAgeDays(row: StageDatedRow, now: number | Date = Date.now()): number | null {
  const t = timeOf(row.stage_entered_at) ?? timeOf(row.updated_at) ?? timeOf(row.created_at);
  if (t === null) return null;
  const n = typeof now === 'number' ? now : now.getTime();
  return Math.max(0, Math.floor((n - t) / DAY_MS));
}

/** Délai, en jours dans l'étape, à partir duquel une ligne est « sans mouvement ». */
export const STALE_AFTER_DAYS = 7;

/** Étapes jamais « sans mouvement » : vivier à trier, retenus, et étapes finales. */
export const STALE_EXEMPT_STAGES: ReadonlySet<GeneralStage> = new Set<GeneralStage>([
  'to_sort',
  'retained',
  'hired',
  'rejected',
]);

/** Ligne engagée (Contacté, A répondu, En entretien) depuis STALE_AFTER_DAYS jours ou plus dans son étape. */
export function isStale(row: StageRow & StageDatedRow, now: number | Date = Date.now()): boolean {
  if (!isGeneralStage(row.general_stage) || STALE_EXEMPT_STAGES.has(row.general_stage)) return false;
  const days = stageAgeDays(row, now);
  return days !== null && days >= STALE_AFTER_DAYS;
}

// ------------------------------------------------------ activité de mission

/**
 * Date d'activité d'une mission (plan 0c, section 4.4) : la plus récente de
 * updated_at et de last_stage_move_at (get_mission_stage_counts). null si
 * aucune n'est lisible. Rend la chaîne d'origine.
 */
export function missionActivityAt(
  updatedAt: string | null | undefined,
  lastStageMoveAt: string | null | undefined,
): string | null {
  const u = timeOf(updatedAt);
  const m = timeOf(lastStageMoveAt);
  if (u === null) return m === null ? null : (lastStageMoveAt as string);
  if (m === null) return updatedAt as string;
  return m > u ? (lastStageMoveAt as string) : (updatedAt as string);
}

// --------------------------------------------------------- rafraîchissement

/**
 * Lectures touchées par un changement d'étape : compteurs de mission, kanban
 * et tableau de mission, /pipeline, listes et fiche de mission (stats_*).
 */
export const STAGE_READER_KEYS: readonly (readonly string[])[] = [
  ['mission-stage-counts'],
  ['project-candidates'],
  ['ats-candidates'],
  ['sourcing-projects'],
  ['sourcing-project'],
];

/** À appeler après chaque geste d'étape et chaque annulation. */
export function invalidateStageReaders(queryClient: Pick<QueryClient, 'invalidateQueries'>): Promise<void> {
  return Promise.all(
    STAGE_READER_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })),
  ).then(() => undefined);
}
