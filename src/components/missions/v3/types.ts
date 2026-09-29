// Refonte mission, lots 1 et 2 : types et règles partagés de la nouvelle page
// mission (src/components/missions/v3/**). Contrat entre les pistes coquille,
// pipeline et panneaux : les noms, les formes et les règles pures d'ici ne
// changent pas sans accord des trois.
//
// Données : vue mission_candidate_rows (une ligne par candidat et par mission,
// doublons réunis ; group_ids = toutes les lignes du candidat, qu'un geste écrit
// ensemble ; is_unopened = profil jamais ouvert, hors Pipeline) et
// get_mission_stage_counts (effectifs « en ce moment » et cumuls « au total »).
// Écritures d'étape : src/lib/candidateStage.ts seulement (origine user).

import type React from 'react';
import { isGeneralStage, type GeneralStage, type StageBatchOutcome, type StageTarget } from '@/lib/candidateStage';
import { GENERAL_STAGE_LABEL, isStale, stageAgeDays } from '@/lib/stageDisplay';
import { plural } from '@/lib/plural';
import type { MissionStageCounts } from '@/hooks/useMissionStageCounts';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import type {
  CadrageSection,
  MissionPanelKind,
  MissionScreen,
  MissionV3Location,
  PipelineViewMode,
} from '@/lib/missionBeta';

export type { CadrageSection, MissionPanelKind, MissionScreen, MissionV3Location, PipelineViewMode };

// ------------------------------------------------------------------ lignes

/** Taille d'une page de la liste de Pipeline et de la section À trier. */
export const PIPELINE_PAGE_SIZE = 50;

/** Colonnes légères de mission_candidate_rows pour les listes (sans profil LinkedIn ni détail de note). */
export const MISSION_ROW_LIGHT_COLUMNS = [
  'id',
  'group_ids',
  'group_size',
  'candidate_id',
  'candidate_name',
  'candidate_headline',
  'linkedin_profile_url',
  'general_stage',
  'process_step_id',
  'stage_entered_at',
  'decision_source',
  'score',
  'recommendation',
  'skip_reason',
  'contacted_at',
  'replied_at',
  'first_interview_at',
  'presented_at',
  'hired_at',
  'rejected_at',
  'rejected_from_stage',
  'reply_summary',
  'tags',
  'job_id',
  'project_id',
  'created_by',
  'created_at',
  'updated_at',
].join(',');

/** Colonnes de la fiche : les légères, plus le profil LinkedIn et le détail de la note. */
export const MISSION_ROW_DETAIL_COLUMNS = `${MISSION_ROW_LIGHT_COLUMNS},linkedin_profile_data,scoring_details`;

export type DecisionSource = 'ai' | 'user' | 'system';

/** Une ligne de mission_candidate_rows, en camelCase. `id` : ligne canonique du groupe. */
export interface MissionCandidateRow {
  id: string;
  /** Toutes les lignes du candidat dans la mission (au moins `id`). Un geste les écrit toutes. */
  groupIds: string[];
  groupSize: number;
  candidateId: string;
  name: string | null;
  headline: string | null;
  linkedinUrl: string | null;
  stage: GeneralStage;
  processStepId: string | null;
  stageEnteredAt: string | null;
  decisionSource: DecisionSource | null;
  score: number | null;
  recommendation: string | null;
  skipReason: string | null;
  contactedAt: string | null;
  repliedAt: string | null;
  firstInterviewAt: string | null;
  presentedAt: string | null;
  hiredAt: string | null;
  rejectedAt: string | null;
  rejectedFromStage: string | null;
  replySummary: string | null;
  tags: string[];
  jobId: string | null;
  projectId: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Ligne de la fiche : colonnes de MISSION_ROW_DETAIL_COLUMNS. */
export interface MissionCandidateDetailRow extends MissionCandidateRow {
  linkedinProfileData: unknown | null;
  scoringDetails: unknown | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const DECISION_SOURCES: readonly DecisionSource[] = ['ai', 'user', 'system'];

/**
 * Ligne brute de la vue vers MissionCandidateRow. null sans identifiant ou sans
 * candidat. Étape inconnue : À trier (même repli que missionColumnOf).
 */
export function toMissionCandidateRow(raw: unknown): MissionCandidateRow | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const id = str(r.id);
  const candidateId = str(r.candidate_id);
  if (!id || !candidateId) return null;
  const group = Array.isArray(r.group_ids) ? r.group_ids.filter((g): g is string => typeof g === 'string' && g !== '') : [];
  const groupIds = group.includes(id) ? [...new Set(group)] : [id, ...new Set(group)];
  const decision = str(r.decision_source);
  return {
    id,
    groupIds,
    groupSize: Math.max(numOrNull(r.group_size) ?? groupIds.length, 1),
    candidateId,
    name: str(r.candidate_name),
    headline: str(r.candidate_headline),
    linkedinUrl: str(r.linkedin_profile_url),
    stage: isGeneralStage(r.general_stage) ? r.general_stage : 'to_sort',
    processStepId: str(r.process_step_id),
    stageEnteredAt: str(r.stage_entered_at),
    decisionSource: decision && (DECISION_SOURCES as readonly string[]).includes(decision) ? (decision as DecisionSource) : null,
    score: numOrNull(r.score),
    recommendation: str(r.recommendation),
    skipReason: str(r.skip_reason),
    contactedAt: str(r.contacted_at),
    repliedAt: str(r.replied_at),
    firstInterviewAt: str(r.first_interview_at),
    presentedAt: str(r.presented_at),
    hiredAt: str(r.hired_at),
    rejectedAt: str(r.rejected_at),
    rejectedFromStage: str(r.rejected_from_stage),
    replySummary: str(r.reply_summary),
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    jobId: str(r.job_id),
    projectId: str(r.project_id),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

/** Ligne brute de la fiche (colonnes de MISSION_ROW_DETAIL_COLUMNS). */
export function toMissionCandidateDetailRow(raw: unknown): MissionCandidateDetailRow | null {
  const row = toMissionCandidateRow(raw);
  if (!row) return null;
  const r = (raw ?? {}) as Record<string, unknown>;
  return { ...row, linkedinProfileData: r.linkedin_profile_data ?? null, scoringDetails: r.scoring_details ?? null };
}

/** Référence d'écriture d'une ligne : son groupe entier. */
export type MissionRowRef = Pick<MissionCandidateRow, 'id' | 'groupIds'>;

/** Lignes à écrire pour un geste : les groupes réunis, sans doublon, dans l'ordre. */
export function rowWriteIds(rows: readonly MissionRowRef[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const ids = row.groupIds.length > 0 ? row.groupIds : [row.id];
    for (const id of ids) {
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

export interface StageMoveSummary {
  /** Candidats dont au moins une ligne a changé d'étape. */
  changed: number;
  /** Candidats déjà à l'étape demandée. */
  unchanged: number;
  /** Candidats laissés à leur étape (étape de départ non admise, recul refusé). */
  skipped: number;
  /** Candidats refusés par la base ; hint du premier refus. */
  refused: number;
  firstHint: string | null;
  /** Échec d'appel (rien d'annoncé comme fait pour les candidats non traités). */
  callFailed: boolean;
}

/**
 * Résultat d'une ligne du groupe qui juge le candidat : celui de la ligne
 * canonique (row.id, celle qu'on voit) quand la réponse la contient ; sinon,
 * celui des autres lignes du groupe. Un doublon moins avancé qui avance seul ne
 * change pas l'étape affichée du candidat.
 */
export function candidateResults<R extends { id: string }>(row: MissionRowRef, byId: ReadonlyMap<string, R>): R[] {
  const own = byId.get(row.id);
  if (own) return [own];
  return (row.groupIds.length > 0 ? row.groupIds : [row.id]).map((id) => byId.get(id)).filter((r): r is R => !!r);
}

/**
 * Résultat par candidat d'un appel setCandidateStages sur rowWriteIds(rows),
 * jugé sur sa ligne canonique (candidateResults). Changé si elle a changé ;
 * refusé si elle est refusée ; non traité (callFailed) s'il n'a aucune ligne
 * dans la réponse.
 */
export function summarizeStageMove(rows: readonly MissionRowRef[], outcome: StageBatchOutcome): StageMoveSummary {
  const byId = new Map(outcome.rows.map((r) => [r.id, r]));
  const summary: StageMoveSummary = {
    changed: 0,
    unchanged: 0,
    skipped: 0,
    refused: 0,
    firstHint: outcome.error?.hint ?? null,
    callFailed: outcome.error !== null,
  };
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const results = candidateResults(row, byId);
    if (results.length === 0) continue;
    if (results.some((r) => r.result === 'updated')) summary.changed += 1;
    else if (results.some((r) => r.result === 'error')) {
      summary.refused += 1;
      summary.firstHint ??= results.find((r) => r.result === 'error')!.hint;
    } else if (results.every((r) => r.result === 'unchanged')) summary.unchanged += 1;
    else summary.skipped += 1;
  }
  return summary;
}

// ----------------------------------------------------------- filtre d'étape

/**
 * Filtre de la barre d'étapes (?etape=). stepId n'a de sens qu'en entretien :
 * null = tout « En entretien », 'none' = en entretien sans étape de la
 * mission, sinon l'identifiant de l'étape d'entretien.
 */
export interface StageFilter {
  stage: GeneralStage;
  stepId: string | null;
}

/** Étapes de la liste par défaut (« en cours ») : ni À trier (section repliée) ni Écarté (filtre à part). */
export const IN_PROGRESS_STAGES: readonly GeneralStage[] = ['retained', 'contacted', 'replied', 'interviewing', 'hired'];

export const NO_STEP = 'none';

/** ?etape= vers le filtre ; null pour une valeur absente ou inconnue (liste par défaut). */
export function parseStageFilter(raw: string | null | undefined): StageFilter | null {
  if (!raw) return null;
  const [stage, step, ...rest] = raw.split(':');
  if (rest.length > 0 || !isGeneralStage(stage)) return null;
  if (step === undefined) return { stage, stepId: null };
  if (stage !== 'interviewing' || step === '') return null;
  return { stage, stepId: step };
}

/** Filtre vers ?etape= : 'retained', 'interviewing', 'interviewing:none', 'interviewing:<id>'. */
export function stageFilterParam(filter: StageFilter): string {
  return filter.stage === 'interviewing' && filter.stepId ? `interviewing:${filter.stepId}` : filter.stage;
}

export function sameStageFilter(a: StageFilter | null, b: StageFilter | null): boolean {
  if (a === null || b === null) return a === b;
  return a.stage === b.stage && (a.stage !== 'interviewing' || a.stepId === b.stepId);
}

/** La ligne entre-t-elle dans le filtre (null = liste par défaut) ? */
export function rowMatchesFilter(row: Pick<MissionCandidateRow, 'stage' | 'processStepId'>, filter: StageFilter | null): boolean {
  if (filter === null) return IN_PROGRESS_STAGES.includes(row.stage);
  if (row.stage !== filter.stage) return false;
  if (filter.stage !== 'interviewing' || filter.stepId === null) return true;
  if (filter.stepId === NO_STEP) return row.processStepId === null;
  return row.processStepId === filter.stepId;
}

/** Clé stable d'un filtre pour les clés de requête et l'ordre figé : 'en-cours' par défaut. */
export function stageFilterKey(filter: StageFilter | null): string {
  return filter === null ? 'en-cours' : stageFilterParam(filter);
}

// ------------------------------------------------------ prochaine action

export interface ProvisionalNextAction {
  /** Texte de la colonne « Prochaine action » ; null : rien à afficher (Embauché, Écarté). */
  text: string | null;
  /** Jours pleins dans l'étape ; null sans date lisible. */
  days: number | null;
  /** Ligne engagée sans mouvement (isStale de stageDisplay) : mise en évidence discrète. */
  stale: boolean;
}

/**
 * Règle PROVISOIRE (lot 2, conception 13) : l'étape et « Aucune action depuis
 * N j ». La règle de la section 4.3 arrive au lot 3 et remplacera ce texte ;
 * aucune phrase ici ne suppose un signal dont la source n'existe pas.
 */
export function provisionalNextAction(
  row: Pick<MissionCandidateRow, 'stage' | 'processStepId' | 'stageEnteredAt' | 'updatedAt' | 'createdAt'>,
  now: number | Date = Date.now(),
): ProvisionalNextAction {
  const dated = { stage_entered_at: row.stageEnteredAt, updated_at: row.updatedAt, created_at: row.createdAt };
  const days = stageAgeDays(dated, now);
  const stale = isStale({ general_stage: row.stage, process_step_id: row.processStepId, ...dated }, now);
  if (row.stage === 'hired' || row.stage === 'rejected') return { text: null, days, stale: false };
  if (row.stage === 'to_sort') return { text: 'À trier', days, stale: false };
  if (days === null) return { text: 'Aucune action enregistrée', days, stale };
  if (days === 0) return { text: "Dans l'étape depuis aujourd'hui", days, stale };
  return { text: `Aucune action depuis ${days} j`, days, stale };
}

type OrderedRow = Pick<MissionCandidateRow, 'id' | 'stageEnteredAt' | 'score'> & Partial<Pick<MissionCandidateRow, 'stage'>>;

function byAge(a: OrderedRow, b: OrderedRow): number {
  const ta = a.stageEnteredAt ? Date.parse(a.stageEnteredAt) : NaN;
  const tb = b.stageEnteredAt ? Date.parse(b.stageEnteredAt) : NaN;
  const na = Number.isNaN(ta);
  const nb = Number.isNaN(tb);
  if (na !== nb) return na ? 1 : -1;
  if (!na && ta !== tb) return ta - tb;
  return 0;
}

function byScore(a: OrderedRow, b: OrderedRow): number {
  if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
  if (a.score !== null && b.score !== null && a.score !== b.score) return b.score - a.score;
  return 0;
}

const byRowId = (a: OrderedRow, b: OrderedRow): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Ordre de la liste « en cours » et des étapes, le même que celui demandé à
 * la base (useMissionCandidateRows) : les lignes qui ont une prochaine action
 * d'abord (Embauché en dernier), puis plus longtemps dans l'étape (règle
 * provisoire de l'urgence), puis la note, puis l'id.
 */
export function comparePipelineRows(a: OrderedRow, b: OrderedRow): number {
  const ha = a.stage === 'hired';
  const hb = b.stage === 'hired';
  if (ha !== hb) return ha ? 1 : -1;
  return byAge(a, b) || byScore(a, b) || byRowId(a, b);
}

/**
 * Ordre de la section À trier (maquette 4.1) : la note d'abord, les
 * meilleurs profils en tête, puis l'ancienneté, puis l'id.
 */
export function compareToSortRows(a: OrderedRow, b: OrderedRow): number {
  return byScore(a, b) || byAge(a, b) || byRowId(a, b);
}

// ------------------------------------------------------- cibles d'étape

/** Étape d'entretien de la mission, forme minimale (useMissionProcess : ProcessStep). */
export interface MissionStepRef {
  id: string;
  name: string;
  step_order: number;
}

export interface MoveOption {
  /** Valeur de filtre équivalente (stageFilterParam), unique dans la liste. */
  key: string;
  label: string;
  target: StageTarget;
}

const byOrder = (steps: readonly MissionStepRef[]) => [...steps].sort((a, b) => a.step_order - b.step_order);

/**
 * Cibles de « Déplacer vers », dans l'ordre de l'entonnoir : À trier, Retenu,
 * Contacté, A répondu, chaque étape d'entretien (ou « En entretien » sans
 * étapes), Embauché, Écarté.
 */
export function moveOptions(steps: readonly MissionStepRef[]): MoveOption[] {
  const head: GeneralStage[] = ['to_sort', 'retained', 'contacted', 'replied'];
  const out: MoveOption[] = head.map((stage) => ({ key: stage, label: GENERAL_STAGE_LABEL[stage], target: { stage } }));
  const ordered = byOrder(steps);
  if (ordered.length === 0) {
    out.push({ key: 'interviewing', label: GENERAL_STAGE_LABEL.interviewing, target: { stage: 'interviewing' } });
  } else {
    for (const step of ordered) {
      out.push({
        key: `interviewing:${step.id}`,
        label: step.name,
        target: { stage: 'interviewing', processStepId: step.id },
      });
    }
  }
  out.push({ key: 'hired', label: GENERAL_STAGE_LABEL.hired, target: { stage: 'hired' } });
  out.push({ key: 'rejected', label: GENERAL_STAGE_LABEL.rejected, target: { stage: 'rejected' } });
  return out;
}

/**
 * « Étape suivante » d'une ligne : À trier vers Retenu, Retenu vers Contacté,
 * Contacté vers A répondu, A répondu vers la première étape d'entretien (ou En
 * entretien), une étape d'entretien vers la suivante, la dernière (ou une
 * ligne en entretien sans étape d'une mission qui n'en a pas) vers Embauché.
 * En entretien sans étape sur une mission qui en a : la première étape.
 * Embauché et Écarté : null.
 */
export function nextStageOption(
  row: Pick<MissionCandidateRow, 'stage' | 'processStepId'>,
  steps: readonly MissionStepRef[],
): MoveOption | null {
  const options = moveOptions(steps);
  const find = (key: string) => options.find((o) => o.key === key) ?? null;
  const ordered = byOrder(steps);
  const firstInterview = ordered.length > 0 ? find(`interviewing:${ordered[0].id}`) : find('interviewing');
  switch (row.stage) {
    case 'to_sort':
      return find('retained');
    case 'retained':
      return find('contacted');
    case 'contacted':
      return find('replied');
    case 'replied':
      return firstInterview;
    case 'interviewing': {
      if (ordered.length === 0) return find('hired');
      const index = ordered.findIndex((step) => step.id === row.processStepId);
      if (index === -1) return firstInterview;
      return index + 1 < ordered.length ? find(`interviewing:${ordered[index + 1].id}`) : find('hired');
    }
    default:
      return null;
  }
}

/** Libellé de l'étape d'une ligne : nom de l'étape d'entretien si connue, sinon l'étape générale. */
export function rowStageLabel(
  row: Pick<MissionCandidateRow, 'stage' | 'processStepId'>,
  steps: readonly MissionStepRef[],
): string {
  if (row.stage === 'interviewing' && row.processStepId) {
    const step = steps.find((item) => item.id === row.processStepId);
    if (step) return step.name;
  }
  return GENERAL_STAGE_LABEL[row.stage];
}

// ------------------------------------------------------------------- textes

/** Lien vers le Sourcing : « 1 profil trouvé », « 12 profils trouvés » ; null à 0 ou sans chiffre. */
export function unopenedLinkText(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !(count > 0)) return null;
  return plural(count, 'profil trouvé', 'profils trouvés');
}

export const BILAN_TITLE = 'Depuis le début de la mission';

export interface BilanRate {
  key: 'retained' | 'contacted' | 'replied';
  /** Phrase du taux, nombres accordés. */
  text: string;
  /** Calcul écrit en clair. */
  detail: string;
  /** Pourcentage arrondi ; null si le dénominateur est nul ou plus petit que le numérateur. */
  percent: number | null;
}

const percentOf = (n: number, d: number): number | null => (d > 0 && n <= d ? Math.round((100 * n) / d) : null);

/**
 * Trois taux du Bilan (conception 5.4), sur les cumuls de get_mission_stage_counts :
 * retenus sur profils triés par vous, contactés sur retenus, réponses sur contactés.
 */
export function bilanRates(
  counts: Pick<MissionStageCounts, 'triagedByUser' | 'everRetained' | 'everContacted' | 'everReplied'>,
): BilanRate[] {
  const { triagedByUser, everRetained, everContacted, everReplied } = counts;
  // Les profils triés par vous comptent les lignes dont la DERNIÈRE décision
  // vient d'une personne : un envoi ou une réponse la réécrit. Plus de retenus
  // que de profils triés : le rapport serait faux, seul le cumul est donné.
  const retainedRate: BilanRate =
    everRetained > triagedByUser
      ? {
          key: 'retained',
          text: `${plural(everRetained, 'retenu')} au total`,
          detail: 'Candidats retenus au total. Une partie a été contactée depuis : le rapport aux profils triés par vous ne peut pas être calculé.',
          percent: null,
        }
      : {
          key: 'retained',
          text: `${plural(everRetained, 'retenu')} sur ${plural(triagedByUser, 'profil trié', 'profils triés')} par vous`,
          detail: 'Candidats retenus au total, sur les profils que vous avez triés vous-même.',
          percent: percentOf(everRetained, triagedByUser),
        };
  return [
    retainedRate,
    {
      key: 'contacted',
      text: `${everContacted.toLocaleString('fr-FR')} ${everContacted > 1 ? 'ont été contactés' : 'a été contacté'} sur ${plural(everRetained, 'retenu')}`,
      detail: 'Candidats contactés au total, sur les candidats retenus au total.',
      percent: percentOf(everContacted, everRetained),
    },
    {
      key: 'replied',
      text: `${everReplied.toLocaleString('fr-FR')} ${everReplied > 1 ? 'ont répondu' : 'a répondu'} sur ${plural(everContacted, 'contacté')}`,
      detail: 'Candidats qui ont répondu au total, sur les candidats contactés au total.',
      percent: percentOf(everReplied, everContacted),
    },
  ];
}

// ------------------------------------------------------ contexte et props

/**
 * Contexte de la nouvelle page (MissionV3Context.tsx), fourni par la piste
 * coquille (MissionWorkspaceV3), lu par les écrans et les panneaux.
 */
export interface MissionV3ContextValue {
  project: SourcingProject;
  location: MissionV3Location;
  /** Organisation de l'appelant = celle de la mission. */
  isOwnMission: boolean;
  isArchived: boolean;
  /** Brief et Réglages modifiables (edit_brief, mission de l'organisation). */
  canEditBrief: boolean;
  /** Étapes d'entretien modifiables (edit_process, mission de l'organisation). */
  canEditProcess: boolean;
  /** Gestes d'étape permis (fonction pipeline, mission non archivée). */
  canMoveCandidates: boolean;
  /** Raison affichée quand canMoveCandidates est faux ; null sinon. */
  moveDisabledReason: string | null;
  /** Change d'écran (entrée d'historique) ; section : Cadrage seulement. */
  goToScreen: (screen: MissionScreen, opts?: { section?: CadrageSection }) => void;
  /** Ouvre la fiche d'une ligne ; replace pour passer au voisin sans empiler l'historique. */
  openCandidate: (rowId: string, opts?: { replace?: boolean }) => void;
  /** Ouvre le panneau Prise de contact (entrée d'historique). */
  openContactPanel: () => void;
  /** Ferme le panneau : Retour si la page l'a ouvert, sinon retrait des paramètres. */
  closePanel: () => void;
  /** Ouvre (entrée d'historique) ou ferme le Bilan. */
  setBilanOpen: (open: boolean) => void;
  /** Ordre des lignes affichées par Pipeline, pour les flèches de la fiche. */
  visibleRowIds: readonly string[];
  setVisibleRowIds: (ids: readonly string[]) => void;
  /** Éteint l'interrupteur et ouvre l'ancienne page à l'endroit équivalent. */
  leaveBeta: () => void;
}

export interface MissionWorkspaceV3Props {
  projectId: string;
}

export interface CandidatePanelProps {
  /** Identifiant de ligne (mission_candidate_rows.id). */
  rowId: string;
  /** id à poser sur le titre du panneau (aria-labelledby de l'hôte). */
  titleId: string;
  onClose: () => void;
}

export interface ContactPanelProps {
  titleId: string;
  onClose: () => void;
}

/** Signature de src/hooks/useMissionStageActions.ts (piste pipeline, lu aussi par la fiche). */
export interface StageMoveRequest {
  rows: readonly MissionRowRef[];
  target: StageTarget;
  /** Étapes de départ admises (Retenir : ['to_sort', 'rejected']). */
  fromStages?: GeneralStage[];
  /** Verbe du toast de succès, accordé par le hook : « retenu », « écarté », « déplacé ». */
  verb: 'retenu' | 'écarté' | 'déplacé';
}

export interface MissionStageActions {
  /** Écrit, invalide les lectures, puis annonce ; ne lève jamais. */
  move: (request: StageMoveRequest) => Promise<StageMoveSummary>;
  isMoving: boolean;
}

/** Contenu d'un onglet de la fiche. */
export interface CandidatePanelTab {
  key: 'apercu' | 'echanges' | 'evaluations' | 'profil';
  label: 'Aperçu' | 'Échanges' | 'Évaluations' | 'Profil';
  content: React.ReactNode;
}
