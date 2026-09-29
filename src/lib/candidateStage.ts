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

import { supabase } from '@/integrations/supabase/client';
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

/** Change l'étape d'une ligne (origine user). Ne lève pas : un refus rend ok: false. */
export async function setCandidateStage(id: string, t: StageTarget): Promise<StageOutcome> {
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
 */
export async function setCandidateStages(
  ids: string[],
  t: StageTarget,
  fromStages?: GeneralStage[],
): Promise<StageBatchOutcome> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
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

  return out;
}
