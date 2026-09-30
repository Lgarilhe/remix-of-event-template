// Refonte mission, lot 0b-4 : l'étape d'un candidat, écrite par une personne
// depuis le navigateur.
//
// Tout geste d'un utilisateur qui change l'étape d'une ligne job_candidate_status
// (kanban de mission, /pipeline, Sourcing, inscription, agenda) passe par ce
// module, jamais par une écriture directe de status ou pipeline_stage. Les RPC
// set_candidate_stage et set_candidate_stages (SECURITY INVOKER, la RLS de
// l'appelant s'applique) tiennent l'étape générale, l'étape d'entretien, les
// jalons et le couple de compatibilité (status, pipeline_stage).
//
// Origine toujours « user » : la base refuse toute autre origine venant d'un
// jeton de navigateur (HINT STAGE_SOURCE_FORBIDDEN), et ce module n'en envoie
// jamais d'autre. L'organisation n'est pas envoyée : la RLS la fixe.
//
// Lot 0c : le module mesure aussi le geste (option surface de setCandidateStage
// et setCandidateStages) et porte l'annulation (readStageSnapshots,
// buildUndoMoves, undoCandidateStages, undoSummaryMessage), en bas du fichier.

import { supabase } from '@/integrations/supabase/client';
import { trackEvent } from '@/lib/analytics';
import { plural } from '@/lib/plural';

export type GeneralStage =
  | 'to_sort'
  | 'retained'
  | 'contacted'
  | 'replied'
  | 'interviewing'
  | 'hired'
  | 'rejected';

export const GENERAL_STAGES: readonly GeneralStage[] = [
  'to_sort',
  'retained',
  'contacted',
  'replied',
  'interviewing',
  'hired',
  'rejected',
];

export function isGeneralStage(value: unknown): value is GeneralStage {
  return typeof value === 'string' && (GENERAL_STAGES as readonly string[]).includes(value);
}

/**
 * Cible d'un déplacement. processStepId seulement vers interviewing ;
 * legacyStage (libellé hérité du /pipeline) seulement quand l'étape générale
 * ne suffit pas, et jamais avec processStepId.
 */
export interface StageTarget {
  stage: GeneralStage;
  processStepId?: string | null;
  legacyStage?: string | null;
}

/** Résultat d'une ligne, tel que rendu par set_candidate_stage(s). */
export type StageRowResult = 'updated' | 'unchanged' | 'kept' | 'not_contacted' | 'skipped' | 'error';

/** Refus de la base : indice (HINT STAGE_*), code SQLSTATE, message technique (jamais affiché). */
export interface StageError {
  hint: string | null;
  code: string | null;
  message: string;
}

export type StageOutcome =
  | {
      ok: true;
      id: string;
      changed: boolean;
      result: StageRowResult;
      generalStage: GeneralStage | null;
      processStepId: string | null;
      /**
       * Date d'entrée dans l'étape, chaîne rendue par la base (précision à la
       * microseconde, jamais repassée par Date : l'annulation la compare telle
       * quelle). null si la base ne l'a pas rendue.
       */
      stageEnteredAt: string | null;
    }
  | ({ ok: false } & StageError);

export interface StageBatchRow {
  id: string;
  changed: boolean;
  result: StageRowResult;
  generalStage: GeneralStage | null;
  processStepId: string | null;
  /** Date d'entrée dans l'étape, chaîne de la base ; null pour une ligne skipped ou refusée. */
  stageEnteredAt: string | null;
  /** Refus par ligne (result = 'error') : indice et code de la base. */
  hint: string | null;
  code: string | null;
}

export interface StageBatchOutcome {
  /** Une ligne par identifiant traité (doublons et vides retirés). */
  rows: StageBatchRow[];
  updated: number;
  unchanged: number;
  kept: number;
  notContacted: number;
  /** Lignes hors des étapes de départ admises, laissées à leur étape. */
  skipped: number;
  /** Refus par ligne (22023, P0002) : voir rows[].hint. */
  refused: number;
  /** Échec d'un appel entier : les lignes de ce lot et des suivants ne sont pas traitées. */
  error: StageError | null;
  /** Identifiants non traités après un échec d'appel (vide sinon). */
  untreatedIds: string[];
}

/** Taille maximale d'un appel à set_candidate_stages (HINT STAGE_BATCH_TOO_LARGE au-delà). */
export const STAGE_BATCH_SIZE = 200;

// Libellés du /pipeline (ATS_STAGES, useATSData.ts) et des outils de
// l'assistant (ALLOWED_STAGES, supabase/functions/_shared/agent-tools-mutations.ts) :
// les mêmes dix libellés. Libellé hérité seulement quand l'étape générale ne
// suffit pas à le retrouver (décision 20) ; vers À trier, Retenu, Contacté ou
// Écarté, pipeline_stage reste vide et le /pipeline lit status.
export const ATS_LABEL_TO_STAGE: Readonly<Record<string, StageTarget>> = {
  'Nouveau': { stage: 'to_sort' },
  'Contacté': { stage: 'contacted' },
  'Répondu': { stage: 'replied' },
  'Pressenti': { stage: 'retained' },
  'Pré-qualif': { stage: 'interviewing', legacyStage: 'Pré-qualif' },
  'CV envoyé': { stage: 'interviewing', legacyStage: 'CV envoyé' },
  'ITW en cours': { stage: 'interviewing', legacyStage: 'ITW en cours' },
  'Offre': { stage: 'interviewing', legacyStage: 'Offre' },
  'Gagné': { stage: 'hired', legacyStage: 'Gagné' },
  'Perdu': { stage: 'rejected' },
};

// Libellés hérités admis par set_candidate_stage pour chaque étape (liste
// v_allowed de la migration 20260928201409, comparaison exacte).
export const LEGACY_LABELS_BY_STAGE: Readonly<Record<GeneralStage, readonly string[]>> = {
  to_sort: ['Nouveau', 'sourced', 'untreated'],
  retained: ['Pressenti', 'shortlisted'],
  contacted: ['Contacté', 'messaged'],
  replied: ['Répondu'],
  interviewing: ['Pré-qualif', 'ITW en cours', 'Offre', 'CV envoyé'],
  hired: ['hired', 'Gagné'],
  rejected: ['Perdu', 'dismissed'],
};

/**
 * Colonne du kanban de mission (MissionPipeline.tsx : colonnes fixes, colonnes
 * d'étapes d'entretien par identifiant, colonne Écarté) vers la cible.
 * « interviewing » (lot 0c) : colonne En entretien d'une mission sans étapes
 * d'entretien ; sur une mission qui en a, la base refuse (STAGE_STEP_REQUIRED).
 * Chemin inverse : missionColumnOf (src/lib/stageDisplay.ts).
 */
export function missionColumnToStage(key: string, stepIds: ReadonlySet<string>): StageTarget {
  if (stepIds.has(key)) return { stage: 'interviewing', processStepId: key };
  switch (key) {
    case 'sourced':
    case 'untreated':
      return { stage: 'to_sort' };
    case 'messaged':
      return { stage: 'contacted' };
    case 'Répondu':
      return { stage: 'replied' };
    case 'shortlisted':
      return { stage: 'retained' };
    case 'interviewing':
      return { stage: 'interviewing' };
    case 'hired':
      return { stage: 'hired' };
    case 'dismissed':
      return { stage: 'rejected' };
    default:
      throw new Error(`Colonne inconnue : ${key}`);
  }
}

/**
 * Cible exacte d'une ligne, pour la restaurer (annulation au /pipeline) :
 * general_stage, process_step_id (en entretien seulement), et pipeline_stage
 * seulement s'il est un libellé admis pour cette étape et qu'aucune étape
 * d'entretien n'est portée.
 */
export function exactTarget(row: {
  general_stage: string;
  process_step_id: string | null;
  pipeline_stage: string | null;
}): StageTarget {
  if (!isGeneralStage(row.general_stage)) {
    throw new Error(`Étape inconnue : ${row.general_stage}`);
  }
  const stage = row.general_stage;
  const processStepId = stage === 'interviewing' && row.process_step_id ? row.process_step_id : null;
  const legacyStage =
    !processStepId && row.pipeline_stage && LEGACY_LABELS_BY_STAGE[stage].includes(row.pipeline_stage)
      ? row.pipeline_stage
      : null;
  return { stage, processStepId, legacyStage };
}

const DEFAULT_STAGE_ERROR = "Le changement d'étape n'a pas été enregistré. Réessayez.";

const STAGE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  STAGE_STEP_REQUIRED: "Choisissez l'étape d'entretien de cette mission.",
  STAGE_STEP_NOT_IN_MISSION: "Cette étape n'appartient pas à la mission du candidat. Rechargez la page.",
  STAGE_ROW_NOT_FOUND: "Ce candidat n'est plus dans cette mission, ou vous n'y avez pas accès. Rechargez la page.",
  STAGE_DIRECT_WRITE: "Ce changement d'étape a été refusé. Rechargez la page, puis réessayez.",
};

/** Message affiché pour un refus, selon l'indice de la base. */
export function stageErrorMessage(hint?: string | null): string {
  return (hint && STAGE_ERROR_MESSAGES[hint]) || DEFAULT_STAGE_ERROR;
}

/** « 3 candidats déjà plus loin, laissés à leur étape. » ; null si aucun. */
export function skippedStageMessage(count: number): string | null {
  if (!(count > 0)) return null;
  return count > 1
    ? `${plural(count, 'candidat')} déjà plus loin, laissés à leur étape.`
    : `${plural(count, 'candidat')} déjà plus loin, laissé à son étape.`;
}

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const ROW_RESULTS: readonly StageRowResult[] = ['updated', 'unchanged', 'kept', 'not_contacted', 'skipped', 'error'];
const rowResult = (v: unknown): StageRowResult =>
  (ROW_RESULTS as readonly unknown[]).includes(v) ? (v as StageRowResult) : 'error';

function toRow(raw: Json, fallbackId: string): StageBatchRow {
  const result = rowResult(raw.result);
  return {
    id: str(raw.id) ?? fallbackId,
    changed: raw.changed === true,
    result,
    generalStage: isGeneralStage(raw.general_stage) ? raw.general_stage : null,
    processStepId: str(raw.process_step_id),
    stageEnteredAt: str(raw.stage_entered_at),
    hint: result === 'error' ? str(raw.hint) : null,
    code: result === 'error' ? str(raw.code) : null,
  };
}

function toError(error: unknown): StageError {
  const e = (error ?? {}) as { hint?: unknown; code?: unknown; message?: unknown };
  return {
    hint: str(e.hint),
    code: str(e.code),
    message: str(e.message) ?? 'Erreur inconnue',
  };
}

function targetArgs(t: StageTarget) {
  return {
    p_stage: t.stage,
    p_source: 'user' as const,
    p_process_step_id: t.processStepId ?? undefined,
    p_legacy_stage: t.legacyStage ?? undefined,
  };
}

const uniqueIds = (ids: readonly string[]): string[] => [
  ...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== '')),
];

/**
 * Option commune aux gestes d'étape. surface : l'écran d'où part le geste
 * ('mission-kanban', 'mission-table', 'pipeline', 'fiche', 'sourcing'...),
 * minuscules, chiffres et tirets, 32 caractères au plus. Sans surface, ou avec
 * une valeur hors de ce format, aucun événement de mesure n'est émis.
 */
export interface StageGestureOptions {
  surface?: string;
}

// Format court et fermé : une surface ne peut pas porter un nom, une adresse
// ou un identifiant (un UUID fait 36 caractères).
const SURFACE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * Issue d'un geste, pour la mesure : 'updated' (au moins une ligne changée,
 * aucun refus), 'partial' (au moins une ligne changée, et un refus ou un
 * appel en échec), 'unchanged' (rien à changer), 'error' (rien changé, et un
 * refus ou un appel en échec).
 */
type StageGestureResult = 'updated' | 'partial' | 'unchanged' | 'error';

function gestureResult(updated: number, failures: number): StageGestureResult {
  if (failures > 0) return updated > 0 ? 'partial' : 'error';
  return updated > 0 ? 'updated' : 'unchanged';
}

/**
 * Événement « Stage Change » : surface, étape visée, nombre de lignes changées,
 * issue. Aucun identifiant ni nom dans les propriétés.
 */
function trackStageChange(
  options: StageGestureOptions | undefined,
  to: GeneralStage,
  updated: number,
  failures: number,
): void {
  const surface = options?.surface;
  if (typeof surface !== 'string' || !SURFACE_PATTERN.test(surface)) return;
  trackEvent('Stage Change', { surface, to, count: updated, result: gestureResult(updated, failures) });
}

/**
 * Change l'étape d'une ligne (origine user). Ne lève pas : un refus rend ok: false.
 * Avec options.surface, émet un « Stage Change » (count 1 si la ligne a changé).
 */
export async function setCandidateStage(
  id: string,
  t: StageTarget,
  options?: StageGestureOptions,
): Promise<StageOutcome> {
  const outcome = await writeCandidateStage(id, t);
  const updated = outcome.ok && outcome.result === 'updated' ? 1 : 0;
  const failed = !outcome.ok || outcome.result === 'error' ? 1 : 0;
  trackStageChange(options, t.stage, updated, failed);
  return outcome;
}

async function writeCandidateStage(id: string, t: StageTarget): Promise<StageOutcome> {
  try {
    const { data, error } = await supabase.rpc('set_candidate_stage', { p_id: id, ...targetArgs(t) });
    if (error) return { ok: false, ...toError(error) };
    const row = toRow((data ?? {}) as Json, id);
    return {
      ok: true,
      id: row.id,
      changed: row.changed,
      result: row.result,
      generalStage: row.generalStage,
      processStepId: row.processStepId,
      stageEnteredAt: row.stageEnteredAt,
    };
  } catch (e) {
    return { ok: false, ...toError(e) };
  }
}

/**
 * Change l'étape de plusieurs lignes (origine user), par lots de 200.
 * fromStages : étapes de départ admises, les autres lignes rendent skipped.
 * Un échec d'appel arrête les lots suivants (les lots déjà passés restent
 * écrits) ; un refus par ligne n'arrête rien.
 * Avec options.surface, émet un seul « Stage Change » pour tout le geste
 * (count : lignes changées). Sans étapes de départ à poser, passer undefined
 * en troisième paramètre.
 */
export async function setCandidateStages(
  ids: string[],
  t: StageTarget,
  fromStages?: GeneralStage[],
  options?: StageGestureOptions,
): Promise<StageBatchOutcome> {
  const unique = uniqueIds(ids);
  const out: StageBatchOutcome = {
    rows: [],
    updated: 0,
    unchanged: 0,
    kept: 0,
    notContacted: 0,
    skipped: 0,
    refused: 0,
    error: null,
    untreatedIds: [],
  };

  for (let i = 0; i < unique.length; i += STAGE_BATCH_SIZE) {
    const chunk = unique.slice(i, i + STAGE_BATCH_SIZE);
    let data: unknown;
    try {
      const res = await supabase.rpc('set_candidate_stages', {
        p_ids: chunk,
        ...targetArgs(t),
        p_from_stages: fromStages ?? undefined,
      });
      if (res.error) {
        out.error = toError(res.error);
      } else {
        data = res.data;
      }
    } catch (e) {
      out.error = toError(e);
    }
    if (out.error) {
      out.untreatedIds = unique.slice(i);
      break;
    }

    const rows = Array.isArray(data) ? (data as Json[]) : [];
    rows.forEach((raw, k) => {
      const row = toRow(raw ?? {}, chunk[k] ?? '');
      out.rows.push(row);
      if (row.result === 'updated') out.updated += 1;
      else if (row.result === 'unchanged') out.unchanged += 1;
      else if (row.result === 'kept') out.kept += 1;
      else if (row.result === 'not_contacted') out.notContacted += 1;
      else if (row.result === 'skipped') out.skipped += 1;
      else out.refused += 1;
    });
  }

  if (unique.length > 0) {
    trackStageChange(options, t.stage, out.updated, out.refused + (out.error ? 1 : 0));
  }
  return out;
}

// ---------------------------------------------------- annulation d'un geste
//
// Plan 0c, section 8.4. Contrat exact : commentaire de undo_candidate_stages,
// migration 20260929112827_refonte_mission_lot0c_lectures.sql (SECURITY
// INVOKER, authenticated seulement, 200 lignes au plus par appel).
//
// Un écran qui offre « Annuler » enchaîne :
//   1. readStageSnapshots(ids)                  avant le geste ;
//   2. setCandidateStage(s)                     le geste ;
//   3. buildUndoMoves(snapshots, rows, options) à partir des lignes rendues ;
//   4. undoCandidateStages(moves)               au clic sur « Annuler » ;
//   5. undoSummaryMessage(result)               pour le message affiché.
// Les dates restent des chaînes de bout en bout (précision à la microseconde) :
// la base compare la date d'entrée rendue par le geste avec celle de la ligne.

/**
 * État d'une ligne job_candidate_status avant un geste, colonnes telles que la
 * base les rend. Les dates sont des chaînes, jamais passées par Date.
 */
export type StageSnapshot = {
  id: string;
  general_stage: GeneralStage;
  process_step_id: string | null;
  pipeline_stage: string | null;
  stage_entered_at: string | null;
  decision_source: string | null;
  rejected_at: string | null;
  rejected_from_stage: string | null;
  presented_at: string | null;
};

const SNAPSHOT_COLUMNS =
  'id, general_stage, process_step_id, pipeline_stage, stage_entered_at, decision_source, rejected_at, rejected_from_stage, presented_at';

// Lecture par .in('id', …) : l'adresse de la requête porte 37 caractères par
// identifiant, d'où des lots plus courts que STAGE_BATCH_SIZE (comme
// useJobCandidateStatus).
const SNAPSHOT_BATCH_SIZE = 100;

function toSnapshot(raw: Json): StageSnapshot | null {
  const id = str(raw.id);
  if (!id || !isGeneralStage(raw.general_stage)) return null;
  return {
    id,
    general_stage: raw.general_stage,
    process_step_id: str(raw.process_step_id),
    pipeline_stage: str(raw.pipeline_stage),
    stage_entered_at: str(raw.stage_entered_at),
    decision_source: str(raw.decision_source),
    rejected_at: str(raw.rejected_at),
    rejected_from_stage: str(raw.rejected_from_stage),
    presented_at: str(raw.presented_at),
  };
}

/**
 * Lit l'état d'avant des lignes (identifiants de job_candidate_status, à
 * passer tous les identifiants d'un groupe de doublons : group_ids), par lots
 * de 100. À appeler AVANT le geste. Ne lève pas : un lot illisible est
 * journalisé et ses identifiants restent absents de la Map, sans annulation
 * possible pour eux. Une ligne d'étape inconnue est ignorée de même.
 */
export async function readStageSnapshots(ids: readonly string[]): Promise<Map<string, StageSnapshot>> {
  const out = new Map<string, StageSnapshot>();
  const unique = uniqueIds(ids);
  for (let i = 0; i < unique.length; i += SNAPSHOT_BATCH_SIZE) {
    try {
      const { data, error } = await supabase
        .from('job_candidate_status')
        .select(SNAPSHOT_COLUMNS)
        .in('id', unique.slice(i, i + SNAPSHOT_BATCH_SIZE));
      if (error) throw error;
      for (const raw of data ?? []) {
        const snapshot = toSnapshot(raw);
        if (snapshot) out.set(snapshot.id, snapshot);
      }
    } catch (e) {
      console.error("[candidateStage] état d'avant illisible :", e);
    }
  }
  return out;
}

/**
 * Élément de undo_candidate_stages : une ligne déplacée par un geste.
 * after_entered_at : date d'entrée rendue par le geste. after_pipeline_stage :
 * colonne du /pipeline visée, posée seulement quand la cible porte un libellé
 * hérité (entre deux colonnes d'entretien, seul pipeline_stage change, pas la
 * date : la colonne seule décèle un déplacement depuis). before : l'état à
 * remettre ; legacy_stage vaut pipeline_stage pour En entretien sans étape de
 * mission et un libellé de la liste blanche, null sinon.
 */
export type UndoMove = {
  id: string;
  after_entered_at: string;
  after_pipeline_stage?: string;
  before: {
    general_stage: GeneralStage;
    process_step_id: string | null;
    legacy_stage: string | null;
    stage_entered_at: string | null;
    decision_source: string | null;
    rejected_at: string | null;
    rejected_from_stage: string | null;
    presented_at: string | null;
  };
};

/** Ligne rendue par un geste, telle que lue par buildUndoMoves (StageBatchRow, ou StageOutcome avec ok: true). */
export type StageGestureRow = Pick<
  StageBatchRow,
  'id' | 'result' | 'generalStage' | 'processStepId' | 'stageEnteredAt'
>;

export interface UndoMoveOptions {
  /**
   * Cible passée au geste. Sert au /pipeline : entre deux colonnes d'entretien
   * (Pré-qualif, CV envoyé, ITW en cours, Offre) l'étape générale ne change
   * pas, et la colonne visée (target.legacyStage) décide si la ligne a bougé
   * et devient after_pipeline_stage. Sans target (kanban de mission), une ligne
   * a bougé si son étape générale ou son étape d'entretien a changé.
   */
  target?: StageTarget;
}

/**
 * Construit les éléments d'annulation d'un geste. Une ligne y figure si le
 * geste l'a rendue « updated » avec une date d'entrée, que son état d'avant a
 * été lu, et que son étape, son étape d'entretien ou sa colonne d'entretien a
 * changé. Les lignes unchanged, skipped, refusées ou sans état d'avant sont
 * laissées de côté : tableau vide, rien à annuler.
 */
export function buildUndoMoves(
  snapshots: ReadonlyMap<string, StageSnapshot>,
  outcomes: readonly StageGestureRow[],
  options: UndoMoveOptions = {},
): UndoMove[] {
  const legacyTarget = options.target?.legacyStage ?? null;
  const moves: UndoMove[] = [];
  for (const row of outcomes) {
    if (row.result !== 'updated' || !row.stageEnteredAt) continue;
    const before = snapshots.get(row.id);
    if (!before) continue;

    const stageChanged = row.generalStage !== before.general_stage;
    const stepChanged = (row.processStepId ?? null) !== before.process_step_id;
    const columnChanged =
      legacyTarget !== null &&
      row.generalStage === 'interviewing' &&
      before.general_stage === 'interviewing' &&
      before.pipeline_stage !== legacyTarget;
    if (!stageChanged && !stepChanged && !columnChanged) continue;

    const legacyBefore =
      before.general_stage === 'interviewing' &&
      !before.process_step_id &&
      before.pipeline_stage !== null &&
      LEGACY_LABELS_BY_STAGE.interviewing.includes(before.pipeline_stage)
        ? before.pipeline_stage
        : null;
    const move: UndoMove = {
      id: row.id,
      after_entered_at: row.stageEnteredAt,
      before: {
        general_stage: before.general_stage,
        process_step_id: before.process_step_id,
        legacy_stage: legacyBefore,
        stage_entered_at: before.stage_entered_at,
        decision_source: before.decision_source,
        rejected_at: before.rejected_at,
        rejected_from_stage: before.rejected_from_stage,
        presented_at: before.presented_at,
      },
    };
    if (legacyTarget !== null) move.after_pipeline_stage = legacyTarget;
    moves.push(move);
  }
  return moves;
}

/**
 * Résultat d'une ligne rendu par undo_candidate_stages : 'updated' (remise à
 * l'étape d'avant), 'unchanged' (déjà à l'étape d'avant), 'moved_since'
 * (l'étape, la colonne ou l'origine a bougé depuis le geste : rien n'est
 * écrit), 'error' (refus, voir hint).
 */
export type UndoRowResult = 'updated' | 'unchanged' | 'moved_since' | 'error';

export interface UndoRow {
  id: string;
  result: UndoRowResult;
  /** Indice de la base pour un refus (STAGE_UNDO_INVALID, STAGE_ROW_NOT_FOUND, STAGE_STEP_REQUIRED...), null sinon. */
  hint: string | null;
}

export interface UndoOutcome {
  /** Une ligne par élément traité (doublons d'identifiant retirés). */
  rows: UndoRow[];
  updated: number;
  unchanged: number;
  movedSince: number;
  /** Refus par ligne : voir rows[].hint. */
  refused: number;
  /** Échec d'un appel entier : les éléments de ce lot et des suivants ne sont pas traités. */
  error: StageError | null;
  /** Identifiants non traités après un échec d'appel (vide sinon). */
  untreatedIds: string[];
}

const UNDO_RESULTS: readonly UndoRowResult[] = ['updated', 'unchanged', 'moved_since', 'error'];

function toUndoRow(raw: unknown, fallbackId: string): UndoRow {
  const r = (raw !== null && typeof raw === 'object' ? raw : {}) as Json;
  const result = (UNDO_RESULTS as readonly unknown[]).includes(r.result) ? (r.result as UndoRowResult) : 'error';
  return { id: str(r.id) ?? fallbackId, result, hint: result === 'error' ? str(r.hint) : null };
}

/**
 * Annule un geste : appelle undo_candidate_stages par lots de 200 éléments.
 * Ne lève pas : un appel en échec arrête les lots suivants (les lots déjà
 * passés restent annulés) et se lit dans error et untreatedIds. Avec
 * options.surface, émet un « Stage Undo » (surface, count : lignes remises à
 * l'étape d'avant).
 */
export async function undoCandidateStages(
  moves: readonly UndoMove[],
  options?: StageGestureOptions,
): Promise<UndoOutcome> {
  const seen = new Set<string>();
  const unique: UndoMove[] = [];
  for (const move of moves) {
    if (typeof move?.id !== 'string' || move.id === '' || seen.has(move.id)) continue;
    seen.add(move.id);
    unique.push(move);
  }
  const out: UndoOutcome = {
    rows: [],
    updated: 0,
    unchanged: 0,
    movedSince: 0,
    refused: 0,
    error: null,
    untreatedIds: [],
  };

  for (let i = 0; i < unique.length; i += STAGE_BATCH_SIZE) {
    const chunk = unique.slice(i, i + STAGE_BATCH_SIZE);
    let data: unknown;
    try {
      const res = await supabase.rpc('undo_candidate_stages', { p_moves: chunk });
      if (res.error) {
        out.error = toError(res.error);
      } else {
        data = res.data;
      }
    } catch (e) {
      out.error = toError(e);
    }
    if (out.error) {
      out.untreatedIds = unique.slice(i).map((m) => m.id);
      break;
    }

    // Une réponse par élément, dans l'ordre : un élément sans réponse est un refus.
    const rows = (data as { rows?: unknown } | null)?.rows;
    chunk.forEach((move, k) => {
      const row = toUndoRow(Array.isArray(rows) ? rows[k] : undefined, move.id);
      out.rows.push(row);
      if (row.result === 'updated') out.updated += 1;
      else if (row.result === 'unchanged') out.unchanged += 1;
      else if (row.result === 'moved_since') out.movedSince += 1;
      else out.refused += 1;
    });
  }

  const surface = options?.surface;
  if (unique.length > 0 && typeof surface === 'string' && SURFACE_PATTERN.test(surface)) {
    trackEvent('Stage Undo', { surface, count: out.updated });
  }
  return out;
}

export interface UndoSummaryOptions {
  /**
   * Identifiants de lignes regroupés par candidat (group_ids : un candidat peut
   * avoir des doublons dans la mission). Un candidat est remis si toutes ses
   * lignes le sont, « déplacé depuis » si l'une d'elles a bougé, sinon en
   * échec. Sans groupes, une ligne compte pour un candidat.
   */
  groups?: readonly (readonly string[])[];
}

/** Candidats remis, déplacés depuis le geste, non remis. */
function undoTally(result: UndoOutcome, groups?: UndoSummaryOptions['groups']) {
  const byId = new Map<string, UndoRowResult>(result.rows.map((r) => [r.id, r.result]));
  for (const id of result.untreatedIds) byId.set(id, 'error');
  const candidates = groups ?? [...byId.keys()].map((id) => [id]);
  const tally = { restored: 0, movedSince: 0, failed: 0 };
  for (const ids of candidates) {
    if (ids.length === 0) continue;
    const results = ids.map((id) => byId.get(id) ?? 'error');
    if (results.every((r) => r === 'updated' || r === 'unchanged')) tally.restored += 1;
    else if (results.includes('moved_since')) tally.movedSince += 1;
    else tally.failed += 1;
  }
  return tally;
}

/**
 * Phrase du message affiché après une annulation : combien de candidats sont
 * revenus à leur étape, combien ont changé d'étape depuis (laissés où ils
 * sont), combien n'ont pas pu être remis. Nombres accordés.
 */
export function undoSummaryMessage(result: UndoOutcome, options: UndoSummaryOptions = {}): string {
  const { restored, movedSince, failed } = undoTally(result, options.groups);
  if (restored + movedSince + failed === 0) return "Il n'y avait rien à annuler.";
  if (restored === 0 && movedSince === 0) return "L'annulation n'a pas été enregistrée. Réessayez.";

  const parts: string[] = [];
  if (restored > 0) {
    parts.push(`${plural(restored, 'candidat')} ${restored > 1 ? 'sont revenus à leur' : 'est revenu à son'} étape précédente.`);
  }
  if (movedSince > 0) {
    parts.push(
      `${plural(movedSince, 'candidat')} ${movedSince > 1 ? "ont changé d'étape depuis : ils restent" : "a changé d'étape depuis : il reste"} où ${movedSince > 1 ? 'ils sont' : 'il est'}.`,
    );
  }
  if (failed > 0) {
    parts.push(
      `${plural(failed, 'candidat')} ${failed > 1 ? "n'ont pas pu être remis à leur" : "n'a pas pu être remis à son"} étape. Réessayez.`,
    );
  }
  return parts.join(' ');
}
