import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { differenceInDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import {
  ATS_LABEL_TO_STAGE,
  buildUndoMoves,
  isGeneralStage,
  readStageSnapshots,
  setCandidateStages,
  stageErrorMessage,
  undoCandidateStages,
  undoSummaryMessage,
  type GeneralStage,
  type UndoMove,
  type UndoOutcome,
} from '@/lib/candidateStage';
import { atsColumnOf, atsColumnTitle, invalidateStageReaders } from '@/lib/stageDisplay';
import { missionIdOfJob } from '@/hooks/useEnrollmentPreview';
import { readManualStop, type ManualStopInfo } from '@/lib/sequenceLabels';

// Types
export interface ATSCandidate {
  id: string;
  candidateId: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  headline: string | null;
  expertise: string[];
  stage: string;
  entity: string | null;
  source: 'local' | 'sequence' | 'inmail';
  sourceId: string;
  jobId: string | null;
  jobTitle: string | null;
  sequenceId?: string;
  sequenceName?: string;
  sequenceStatus?: string;
  /** Arrêt manuel de l'inscription (lot 5b) : « Arrêtée par … le … ». */
  sequenceManualStop?: ManualStopInfo | null;
  connectionStatus?: string;
  lastActivity: string | null;
  createdAt: string;
  notesCount?: number;
  hasReminder?: boolean;
  score?: number | null;
  recommendation?: string | null;
  outreachStatus?: string | null;
  tags?: string[];
  scoringDetails?: {
    match_score: number;
    matching_skills: string[];
    missing_skills: string[];
    experience_match: string;
    location_match: boolean;
    summary: string;
    recommendation: string;
    salary_analysis?: any;
  } | null;
  linkedinProfileData?: any;
  /** Photo LinkedIn enregistrée (lignes de mission) ; absente, ce sont les initiales (PersonAvatar). */
  pictureUrl?: string | null;
  /**
   * Lot 0c-4 : champs de la vue mission_candidate_rows (lignes de mission).
   * Mission du candidat (uuid, jamais « project:… »), nom de la mission.
   */
  projectId?: string | null;
  missionName?: string | null;
  /** Étape générale (lignes de mission) ; pour un candidat de séquence ou d'InMail, celle de sa colonne. */
  generalStage?: GeneralStage | null;
  processStepId?: string | null;
  /** Nom de l'étape d'entretien de la mission (ligne En entretien avec une étape) : sous-titre de la colonne ITW en cours. */
  processStepName?: string | null;
  /** Date d'entrée dans l'étape, chaîne de la base : base de l'ancienneté et de « sans mouvement ». */
  stageEnteredAt?: string | null;
  /** Lignes du candidat dans la mission (doublons compris) : un geste les écrit toutes. */
  groupIds?: string[];
  /** Jalons les plus anciens du groupe, et étape d'avant un écart (cumuls « au total »). */
  contactedAt?: string | null;
  repliedAt?: string | null;
  firstInterviewAt?: string | null;
  hiredAt?: string | null;
  rejectedFromStage?: string | null;
}

/**
 * Colonnes du /pipeline. La clé (libellé hérité, liste blanche de
 * set_candidate_stage et de l'assistant) ne change pas ; le titre affiché
 * reprend les mots de la mission (lot 0c-4, décision 3 : À trier, Retenu,
 * A répondu, Embauché, Écarté ; colonnes d'entretien inchangées).
 */
export const ATS_STAGES = [
  { key: 'Nouveau', label: atsColumnTitle('Nouveau'), color: 'bg-muted border-border' },
  { key: 'Contacté', label: atsColumnTitle('Contacté'), color: 'bg-info/10 border-info/30' },
  { key: 'Répondu', label: atsColumnTitle('Répondu'), color: 'bg-muted border-border' },
  { key: 'Pressenti', label: atsColumnTitle('Pressenti'), color: 'bg-muted border-border' },
  { key: 'Pré-qualif', label: atsColumnTitle('Pré-qualif'), color: 'bg-muted border-border' },
  { key: 'CV envoyé', label: atsColumnTitle('CV envoyé'), color: 'bg-muted border-border' },
  { key: 'ITW en cours', label: atsColumnTitle('ITW en cours'), color: 'bg-warning/10 border-warning/30' },
  { key: 'Offre', label: atsColumnTitle('Offre'), color: 'bg-muted border-border' },
  { key: 'Gagné', label: atsColumnTitle('Gagné'), color: 'bg-success/10 border-success/30' },
  { key: 'Perdu', label: atsColumnTitle('Perdu'), color: 'bg-destructive/10 border-destructive/30' },
];

/** Provenance d'un candidat, écrite en mots et jamais par sa clé (revue design E-18). */
export const ATS_SOURCE_LABELS: Record<ATSCandidate['source'], string> = {
  local: 'Mission',
  sequence: 'Séquence',
  inmail: 'InMail',
};

/**
 * Délai, en jours, au-delà duquel un candidat est « sans mouvement » dans son
 * étape (revue design E-17). Une seule table pour la carte, le tableau et
 * l'analyse du pipeline global, en attendant le module d'étapes commun (E-01).
 * Pas de délai pour À trier, Retenu, Embauché ni Écarté (plan 0c, section 6.4,
 * mêmes exemptions que le kanban de mission) : un vivier à trier n'est pas
 * « sans mouvement ».
 */
export const STAGNATION_DAYS: Record<string, number> = {
  'Contacté': 5,
  'Répondu': 3,
  'Pré-qualif': 7,
  'CV envoyé': 5,
  'ITW en cours': 10,
  'Offre': 7,
};

/**
 * Personnes distinctes d'une liste de lignes (une ligne par candidat et par
 * mission) : un candidat présent dans deux missions compte pour un. Le mot
 * « candidats » des chiffres du tableau de bord et du /pipeline a ce sens.
 */
export function countPeople(candidates: ReadonlyArray<Pick<ATSCandidate, 'candidateId' | 'id'>>): number {
  return new Set(candidates.map((c) => c.candidateId || c.id)).size;
}

const timeOf = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time;
};

/**
 * Jours passés dans l'étape (lot 0c-4) : depuis stage_entered_at, à défaut
 * depuis la dernière action, puis depuis l'ajout (candidat de séquence ou
 * d'InMail sans ligne de mission). Une date illisible passe à la suivante.
 */
export function daysInStage(
  candidate: Pick<ATSCandidate, 'stageEnteredAt' | 'lastActivity' | 'createdAt'>,
  now: Date = new Date(),
): number | null {
  const time = timeOf(candidate.stageEnteredAt) ?? timeOf(candidate.lastActivity) ?? timeOf(candidate.createdAt);
  return time === null ? null : differenceInDays(now, time);
}

/** Jours dans l'étape quand le délai de l'étape est dépassé ; null sinon (et pour une étape sans délai). */
export function stagnantDays(
  candidate: Pick<ATSCandidate, 'stage' | 'stageEnteredAt' | 'lastActivity' | 'createdAt'>,
  now: Date = new Date(),
): number | null {
  const limit = STAGNATION_DAYS[candidate.stage];
  const days = daysInStage(candidate, now);
  return limit !== undefined && days !== null && days > limit ? days : null;
}

// Cache configuration
// 🐛 TUNING Opus A4 : avant, staleTime=30min + refetchOnWindowFocus=false =
// données ATS périmées si un collègue (ou soi-même autre onglet) bouge un
// candidat. Pour un ATS temps-réel, 2min + refetchOnWindowFocus=true est plus
// raisonnable. L'user qui revient sur l'onglet après une pause voit toujours
// l'état à jour.
const STALE_TIME = 2 * 60 * 1000;
const GC_TIME = 60 * 60 * 1000;

/**
 * Lot 0c-4 : le /pipeline lit la vue mission_candidate_rows, une ligne par
 * candidat et par mission (doublons réunis, ligne canonique, jalons les plus
 * anciens du groupe). La colonne vient de l'étape générale (atsColumnOf,
 * plan 0c section 6.5), jamais de status ni d'un repli sur pipeline_stage,
 * sauf pour les quatre colonnes d'entretien.
 *
 * La photo seule est extraite côté base (`linkedin_profile_data->>…`) : jamais le profil entier.
 */
// Chaîne typée string : sinon l'analyse du select par le client typé dépasse la profondeur permise (TS2589).
const MCR_DISPLAY_COLUMNS: string = 'id, candidate_id, candidate_name, candidate_headline, linkedin_profile_url, status, pipeline_stage, general_stage, process_step_id, stage_entered_at, score, recommendation, job_id, project_id, mission_name, tags, updated_at, created_at, scoring_details, contacted_at, replied_at, first_interview_at, hired_at, rejected_from_stage, is_unopened, group_ids, picture:linkedin_profile_data->>profile_picture_url, picture_large:linkedin_profile_data->>profile_picture_url_large';

/** Ligne de la vue, telle que lue par le /pipeline. */
export interface MissionRow {
  id: string;
  candidate_id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  linkedin_profile_url: string | null;
  status: string | null;
  pipeline_stage: string | null;
  general_stage: string | null;
  process_step_id: string | null;
  stage_entered_at: string | null;
  score: number | null;
  recommendation: string | null;
  job_id: string | null;
  project_id: string | null;
  mission_name: string | null;
  tags: string[] | null;
  updated_at: string | null;
  created_at: string | null;
  scoring_details: unknown;
  contacted_at: string | null;
  replied_at: string | null;
  first_interview_at: string | null;
  hired_at: string | null;
  rejected_from_stage: string | null;
  is_unopened: boolean | null;
  group_ids: string[] | null;
  /** Adresse de la photo LinkedIn enregistrée (petite, puis grande). */
  picture?: string | null;
  picture_large?: string | null;
}

// Toutes les lignes de mission visibles (RLS de l'appelant), jamais ouverts compris.
async function fetchMissionRows(): Promise<MissionRow[]> {
  // Paginé pour passer la limite de 1 000 lignes par requête.
  const allRecords: MissionRow[] = [];
  let from = 0;
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 100; // Safety cap: 100 × 1000 = 100k rows max
  for (let page_i = 0; page_i < MAX_PAGES; page_i++) {
    const { data: page, error: pageError } = await supabase
      .from('mission_candidate_rows')
      .select(MCR_DISPLAY_COLUMNS)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    // Une lecture en échec remonte : jamais une liste vide ou partielle
    // présentée comme complète (revue design E-44).
    if (pageError) throw new Error(pageError.message || 'Lecture des candidats impossible');
    if (!page || page.length === 0) break;
    // La vue type ses colonnes en « string | null » pour PostgREST : MissionRow
    // porte les garanties de la vue (id, candidate_id jamais nuls).
    allRecords.push(...(page as unknown as MissionRow[]));
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    if (page_i === MAX_PAGES - 1) {
      console.warn(`[useATSData] fetchMissionRows hit max page cap (${MAX_PAGES}), ${allRecords.length} rows loaded`);
    }
  }
  return allRecords;
}

/**
 * Noms des étapes d'entretien des missions (id vers nom). Une lecture en échec
 * rend une table vide : les cartes n'ont alors pas de sous-titre, rien d'autre.
 */
async function fetchProcessStepNames(): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('mission_process_steps').select('id, name');
  if (error) console.warn('[useATSData] étapes d\'entretien illisibles :', error.message);
  return new Map((data ?? []).map((step) => [step.id, step.name]));
}

/** Candidat du /pipeline pour une ligne de la vue. stepNames : noms des étapes d'entretien (sous-titre de En entretien). */
export function candidateOfMissionRow(r: MissionRow, stepNames?: ReadonlyMap<string, string>): ATSCandidate {
  return {
    id: `local-${r.id}`,
    candidateId: r.candidate_id,
    name: r.candidate_name || 'Profil LinkedIn',
    email: null,
    phone: null,
    linkedin: r.linkedin_profile_url && r.linkedin_profile_url.includes('/in/') ? r.linkedin_profile_url : null,
    headline: r.candidate_headline || null,
    expertise: [],
    stage: atsColumnOf(r),
    entity: null,
    source: 'local' as const,
    sourceId: r.id,
    jobId: r.job_id || null,
    jobTitle: r.mission_name || null,
    lastActivity: r.updated_at || r.created_at,
    createdAt: r.created_at ?? '',
    score: r.score,
    recommendation: r.recommendation,
    outreachStatus: r.status,
    tags: r.tags || [],
    scoringDetails: (r.scoring_details as ATSCandidate['scoringDetails']) || null,
    linkedinProfileData: null,
    pictureUrl: r.picture || r.picture_large || null,
    projectId: r.project_id,
    missionName: r.mission_name,
    generalStage: isGeneralStage(r.general_stage) ? r.general_stage : null,
    processStepId: r.process_step_id,
    processStepName: r.general_stage === 'interviewing' && r.process_step_id ? stepNames?.get(r.process_step_id) ?? null : null,
    stageEnteredAt: r.stage_entered_at,
    groupIds: r.group_ids && r.group_ids.length > 0 ? r.group_ids : [r.id],
    contactedAt: r.contacted_at,
    repliedAt: r.replied_at,
    firstInterviewAt: r.first_interview_at,
    hiredAt: r.hired_at,
    rejectedFromStage: r.rejected_from_stage,
  };
}

/** Étape générale d'une colonne du /pipeline (candidat de séquence ou d'InMail, sans ligne). */
const generalStageOfColumn = (column: string): GeneralStage | null => ATS_LABEL_TO_STAGE[column]?.stage ?? null;

interface SequenceEnrichmentRow {
  profile_id: string;
  sequence_id: string;
  status: string;
  connection_status: string | null;
  completion_reason: string | null;
  manual_stop: unknown;
  outreach_sequences: { id: string; name: string } | null;
}

// Fetch sequence enrollments for enrichment
async function fetchSequenceEnrichment(): Promise<Map<string, { sequenceId: string; sequenceName: string; sequenceStatus: string; sequenceManualStop: ManualStopInfo | null; connectionStatus: string }>> {
  const { data: enrollments, error } = await supabase
    .from('sequence_enrollments')
    // Ligne typée à la main : l'inférence des chemins JSON dépasse la profondeur de TypeScript.
    .select<string, SequenceEnrichmentRow>('profile_id, sequence_id, status, connection_status, completion_reason:tracking_data->>completion_reason, manual_stop:tracking_data->manual_stop, outreach_sequences (id, name)')
    .order('created_at', { ascending: false });

  // Séquence seulement : la mission et son titre viennent de la ligne de mission
  // (lot 0c-4), jamais du poste de l'inscription.
  const map = new Map();
  if (!error && enrollments) {
    for (const e of enrollments) {
      if (!map.has(e.profile_id)) {
        map.set(e.profile_id, {
          sequenceId: e.sequence_id,
          sequenceName: (e as any).outreach_sequences?.name || null,
          sequenceStatus: e.status,
          sequenceManualStop: readManualStop(e.status, e.completion_reason, e.manual_stop),
          connectionStatus: e.connection_status,
        });
      }
    }
  }
  return map;
}

// Fetch standalone sequence candidates not in job_candidate_status
async function fetchSequenceOnlyCandidates(existingIds: Set<string>): Promise<ATSCandidate[]> {
  const { data: enrollments, error } = await supabase
    .from('sequence_enrollments')
    // Ligne non inférée : les chemins JSON dépassent la profondeur de TypeScript (lue champ par champ plus bas).
    .select<string, Record<string, unknown>>('id, sequence_id, profile_id, provider_id, resolved_profile_id, profile_name, profile_headline, profile_url, status, connection_status, job_id, job_title, replied_at, updated_at, created_at, completion_reason:tracking_data->>completion_reason, manual_stop:tracking_data->manual_stop, outreach_sequences (id, name)')
    .order('created_at', { ascending: false });

  if (error || !enrollments) return [];

  return enrollments
    // Même rapprochement que is_unopened dans la vue : profil, identifiant fournisseur ou profil résolu.
    .filter((e: any) => ![e.profile_id, e.provider_id, e.resolved_profile_id].some((id) => !!id && existingIds.has(id)))
    .map((enrollment: any) => {
      let stage = 'Contacté';
      if (enrollment.replied_at) stage = 'Répondu';
      else if (enrollment.status === 'paused') stage = 'Nouveau';

      return {
        id: `sequence-${enrollment.id}`,
        candidateId: enrollment.profile_id,
        name: enrollment.profile_name || 'Profil LinkedIn',
        email: null,
        phone: null,
        linkedin: enrollment.profile_url && enrollment.profile_url.includes('/in/') ? enrollment.profile_url : null,
        headline: enrollment.profile_headline || null,
        expertise: [],
        stage,
        generalStage: generalStageOfColumn(stage),
        entity: null,
        source: 'sequence' as const,
        sourceId: enrollment.id,
        jobId: enrollment.job_id || null,
        jobTitle: enrollment.job_title || null,
        projectId: missionIdOfJob(enrollment.job_id) ?? null,
        sequenceId: enrollment.sequence_id,
        sequenceName: enrollment.outreach_sequences?.name || null,
        sequenceStatus: enrollment.status,
        sequenceManualStop: readManualStop(enrollment.status, enrollment.completion_reason, enrollment.manual_stop),
        connectionStatus: enrollment.connection_status,
        lastActivity: enrollment.updated_at || enrollment.created_at,
        createdAt: enrollment.created_at,
      };
    });
}

// Fetch standalone InMail candidates not in job_candidate_status
async function fetchInMailOnlyCandidates(existingIds: Set<string>): Promise<ATSCandidate[]> {
  const { data: inmails, error } = await supabase
    .from('inmail_queue')
    .select('id, recipient_profile_id, recipient_name, recipient_headline, status, sent_at, created_at, project_id')
    .order('created_at', { ascending: false });

  if (error || !inmails) return [];

  return inmails
    .filter((inmail: any) => !existingIds.has(inmail.recipient_profile_id))
    .map((inmail: any) => {
      const stage = inmail.status === 'replied' ? 'Répondu' : inmail.status === 'sent' ? 'Contacté' : 'Nouveau';
      return {
        id: `inmail-${inmail.id}`,
        candidateId: inmail.recipient_profile_id,
        name: inmail.recipient_name || 'Profil LinkedIn',
        email: null,
        phone: null,
        linkedin: null,
        headline: inmail.recipient_headline || null,
        expertise: [],
        stage,
        generalStage: generalStageOfColumn(stage),
        entity: null,
        source: 'inmail' as const,
        sourceId: inmail.id,
        // Mission de l'InMail (lot 0b) : l'InMail se filtre par mission et son candidat
        // peut changer d'étape (une ligne À trier est créée dans cette mission).
        jobId: inmail.project_id ? `project:${inmail.project_id}` : null,
        jobTitle: null,
        projectId: inmail.project_id ?? null,
        lastActivity: inmail.sent_at || inmail.created_at,
        createdAt: inmail.created_at,
      };
    });
}

// Fetch metadata (notes & reminders)
async function fetchMetadata(candidates: ATSCandidate[]): Promise<ATSCandidate[]> {
  const [notesResult, remindersResult] = await Promise.all([
    supabase.from('candidate_notes').select('candidate_id'),
    supabase.from('candidate_reminders').select('candidate_id').is('completed_at', null),
  ]);

  const notesMap = new Map<string, number>();
  if (notesResult.data) {
    notesResult.data.forEach((note: any) => {
      const count = notesMap.get(note.candidate_id) || 0;
      notesMap.set(note.candidate_id, count + 1);
    });
  }

  const reminderSet = new Set<string>();
  if (remindersResult.data) {
    remindersResult.data.forEach((r: any) => reminderSet.add(r.candidate_id));
  }

  return candidates.map(candidate => ({
    ...candidate,
    notesCount: notesMap.get(candidate.candidateId) || 0,
    hasReminder: reminderSet.has(candidate.candidateId),
  }));
}

/**
 * Nom des missions des candidats de séquence et d'InMail (lot 0c-4) : celui des
 * lignes de la vue (mission_name), sinon sourcing_projects.name pour une mission
 * sans ligne visible. Jamais le job_title d'une inscription, qui peut différer du
 * nom de la mission et brouillerait le filtre Mission.
 */
async function fetchMissionNames(rows: readonly MissionRow[], extra: readonly ATSCandidate[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const r of rows) {
    if (r.project_id && r.mission_name) names.set(r.project_id, r.mission_name);
  }
  const missing = [...new Set(extra.map((c) => c.projectId).filter((id): id is string => !!id && !names.has(id)))];
  if (missing.length === 0) return names;
  const { data, error } = await supabase.from('sourcing_projects').select('id, name').in('id', missing);
  if (error) console.warn('[useATSData] noms de mission illisibles :', error.message);
  for (const p of data ?? []) {
    if (p.name) names.set(p.id, p.name);
  }
  return names;
}

// Main fetch : la vue des lignes de mission d'abord, séquences et InMails comblent les manques.
async function fetchAllCandidates(): Promise<ATSCandidate[]> {
  const [missionRows, sequenceEnrichment, stepNames] = await Promise.all([
    fetchMissionRows(),
    fetchSequenceEnrichment(),
    fetchProcessStepNames(),
  ]);

  // existingIds sur TOUTES les lignes de la vue, jamais ouverts compris (plan 0c,
  // E4) : un candidat inscrit dont la ligne de mission n'a jamais été ouverte ne
  // revient pas en « Contacté » sans mission par sa séquence ou son InMail.
  const existingIds = new Set(missionRows.map(r => r.candidate_id));

  // Profils jamais ouverts : hors du Pipeline (décision 2), ils restent au Sourcing.
  const enrichedLocal = missionRows
    .filter(r => !r.is_unopened)
    .map(r => {
      const c = candidateOfMissionRow(r, stepNames);
      const seqData = sequenceEnrichment.get(c.candidateId);
      return seqData ? { ...c, ...seqData } : c;
    });

  // Fetch candidates only in sequences/inmails (not in local table)
  const [seqOnly, inmailOnly] = await Promise.all([
    fetchSequenceOnlyCandidates(existingIds),
    fetchInMailOnlyCandidates(existingIds),
  ]);

  const missionNames = await fetchMissionNames(missionRows, [...seqOnly, ...inmailOnly]);
  const withMissionName = (c: ATSCandidate): ATSCandidate =>
    c.projectId && missionNames.has(c.projectId) ? { ...c, jobTitle: missionNames.get(c.projectId) ?? null } : c;

  const all = [...enrichedLocal, ...seqOnly.map(withMissionName), ...inmailOnly.map(withMissionName)];
  return fetchMetadata(all);
}

/** Surface des gestes du /pipeline (mesure d'usage : 'Stage Change' et 'Stage Undo'). */
const PIPELINE_SURFACE = 'pipeline';

/** Options d'un déplacement : surface de mesure, et toasts coupés pour un déplacement groupé. */
export interface StageMoveOptions {
  silent?: boolean;
  surface?: string;
}

/** Bilan d'un déplacement de candidats (un ou plusieurs, un seul geste). */
export interface StageMoveResult {
  /** Candidats dont au moins une ligne a changé d'étape. */
  moved: number;
  /** Candidats déjà à l'étape visée : rien n'a été écrit pour eux. */
  unchanged: number;
  /** Candidats (ATSCandidate.id) non déplacés : refus, ligne absente, appel en échec. */
  failedIds: string[];
  /** Candidats déplacés dont une ligne en double n'a pas pu être écrite. */
  partial: number;
  /** Les mêmes candidats (ATSCandidate.id), pour les laisser cochés et réessayer. */
  partialIds: string[];
  /** Éléments d'annulation, un groupe par candidat déplacé ; vide si rien n'est annulable. */
  undoGroups: UndoMove[][];
  /** Première cause d'échec, pour la phrase du toast d'un déplacement seul. */
  failure: { kind: 'target' | 'mission' | 'write'; hint: string | null } | null;
}

const EMPTY_RESULT: StageMoveResult = { moved: 0, unchanged: 0, failedIds: [], partial: 0, partialIds: [], undoGroups: [], failure: null };

export function useATSData() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  const {
    data: candidates = [],
    isLoading: loading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['ats-candidates'],
    queryFn: fetchAllCandidates,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: true, // Fix Opus A4 — voir commentaire sur STALE_TIME
  });

  /** Relit les compteurs, le kanban, le /pipeline et les listes de missions (après un geste ou une annulation). */
  const refreshStageReaders = useCallback(() => invalidateStageReaders(queryClient), [queryClient]);

  /**
   * Annule des déplacements (plan 0c, section 8.4) : undo_candidate_stages
   * remet l'état d'avant (étape, colonne, date, origine, écart) et efface les
   * jalons posés par le geste. Une ligne déplacée depuis rend moved_since et
   * reste où elle est. Un groupe d'éléments par candidat, pour le bilan ; le
   * message est celui du module d'étapes, affiché tel quel.
   */
  const undoStageMoves = useCallback(async (
    groups: readonly (readonly UndoMove[])[],
    surface: string = PIPELINE_SURFACE,
  ): Promise<UndoOutcome> => {
    const nonEmpty = groups.filter((g) => g.length > 0);
    const result = await undoCandidateStages(nonEmpty.flat(), { surface });
    await refreshStageReaders().catch((e) => console.error('[useATSData] relecture après annulation :', e));
    const message = undoSummaryMessage(result, { groups: nonEmpty.map((g) => g.map((m) => m.id)) });
    if (result.movedSince === 0 && result.refused === 0 && !result.error) toast.success(message);
    else if (result.updated + result.unchanged === 0) toast.error(message);
    else toast.warning(message);
    return result;
  }, [refreshStageReaders]);

  /**
   * Déplace des candidats vers une colonne du /pipeline, en un seul geste.
   * Lot 0b-4 : l'étape s'écrit par set_candidate_stages (origine user), jamais
   * par une écriture directe de status ou pipeline_stage. Lot 0c-4 : le geste
   * écrit toutes les lignes de chaque candidat dans la mission (group_ids), après
   * une seule lecture de leur état d'avant que l'annulation rend, et compte un
   * seul « Stage Change ». Ne lève pas ; aucun toast ici, l'appelant dit le bilan.
   */
  const moveCandidates = useCallback(async (
    candidateIds: readonly string[],
    newStage: string,
    options: Pick<StageMoveOptions, 'surface'> = {},
  ): Promise<StageMoveResult> => {
    // État courant du cache plutôt que la liste du rendu : un déplacement
    // groupé relit l'étape réelle du candidat.
    const current = queryClient.getQueryData<ATSCandidate[]>(['ats-candidates']) ?? candidates;
    const byId = new Map(current.map(c => [c.id, c]));
    const selected = [...new Set(candidateIds)].map(id => ({ id, candidate: byId.get(id) }));
    if (selected.length === 0) return EMPTY_RESULT;

    const target = ATS_LABEL_TO_STAGE[newStage];
    if (!target) {
      return { ...EMPTY_RESULT, failedIds: selected.map(s => s.id), failure: { kind: 'target', hint: null } };
    }

    // Un candidat venu d'une séquence ou d'un InMail sans mission (projet) n'a pas
    // de ligne où porter une étape, et la vue ne rendrait pas la ligne créée pour
    // un poste qui ne se résout à aucune mission : refus annoncé, rien n'est écrit.
    const failedIds: string[] = [];
    let failure: StageMoveResult['failure'] = null;
    const eligible: ATSCandidate[] = [];
    for (const { id, candidate } of selected) {
      if (!candidate) {
        failedIds.push(id);
        failure ??= { kind: 'write', hint: null };
      } else if (candidate.source !== 'local' && !candidate.projectId) {
        failedIds.push(id);
        failure ??= { kind: 'mission', hint: null };
      } else {
        eligible.push(candidate);
      }
    }
    if (eligible.length === 0) return { ...EMPTY_RESULT, failedIds, failure };

    const previous = new Map(eligible.map(c => [c.id, {
      stage: c.stage,
      lastActivity: c.lastActivity,
      generalStage: c.generalStage ?? null,
      processStepId: c.processStepId ?? null,
      processStepName: c.processStepName ?? null,
      stageEnteredAt: c.stageEnteredAt ?? null,
    }]));
    const eligibleIds = new Set(eligible.map(c => c.id));
    const nowIso = new Date().toISOString();

    // 1. Optimistic UI update
    // 🐛 BUG FIX (Opus audit) : avant, l'optimistic ne mettait à jour que `stage`,
    // pas `lastActivity`. Du coup la bordure rouge "stagnant" restait affichée
    // après qu'on a explicitement bougé le candidat. Signal visuel incohérent.
    // La date d'entrée affichée est provisoire : la base rend la vraie.
    queryClient.setQueryData<ATSCandidate[]>(['ats-candidates'], (old) =>
      old?.map(c => eligibleIds.has(c.id)
        ? { ...c, stage: newStage, lastActivity: nowIso, generalStage: target.stage, stageEnteredAt: nowIso }
        : c) ?? []
    );
    const revert = (ids: ReadonlySet<string>) =>
      queryClient.setQueryData<ATSCandidate[]>(['ats-candidates'], (old) =>
        old?.map(c => ids.has(c.id) ? { ...c, ...previous.get(c.id) } : c) ?? []
      );

    try {
      // 🐛 BUG FIX Opus A3 (source of truth ambiguous) : les candidats de source
      // sequence/inmail n'ont pas de ligne : une ligne À trier est créée dans
      // leur mission (jamais une étape écrite en direct), en un seul envoi pour
      // tout le lot, puis l'étape suit le même chemin que les autres.
      const rowIdOf = new Map<string, string>();
      const withoutRow = eligible.filter(c => c.source === 'sequence' || c.source === 'inmail');
      if (withoutRow.length > 0) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Non authentifié');
        if (!organizationId) throw new Error('Organisation introuvable');

        const { error: upsertError } = await supabase
          .from('job_candidate_status')
          .upsert(withoutRow.map(c => ({
            candidate_id: c.candidateId,
            candidate_name: c.name,
            candidate_headline: c.headline,
            linkedin_profile_url: c.linkedin,
            job_id: c.jobId as string,
            organization_id: organizationId,
            created_by: user.id,
          })), {
            onConflict: 'job_id,candidate_id,created_by',
            ignoreDuplicates: true,
          });
        // Un échec d'écriture annule l'état optimiste, comme pour la table
        // principale : plus de « Candidat déplacé » sur un déplacement perdu (E-23).
        if (upsertError) throw upsertError;

        // Relecture des lignes, créées ou déjà présentes (même clé d'unicité).
        const { data: created, error: readError } = await supabase
          .from('job_candidate_status')
          .select('id, job_id, candidate_id')
          .in('job_id', [...new Set(withoutRow.map(c => c.jobId as string))])
          .in('candidate_id', [...new Set(withoutRow.map(c => c.candidateId))])
          .eq('created_by', user.id);
        if (readError) throw readError;
        const idOfPair = new Map((created ?? []).map(r => [`${r.job_id}|${r.candidate_id}`, r.id]));
        for (const c of withoutRow) {
          const id = idOfPair.get(`${c.jobId}|${c.candidateId}`);
          if (id) rowIdOf.set(c.id, id);
        }
      }

      // 2. Toutes les lignes de chaque candidat dans la mission (doublons), et leur
      //    état d'avant, lu en une fois juste avant le geste (dates en chaînes).
      const rowsOf = new Map<string, { mainId: string | null; ids: string[] }>();
      for (const c of eligible) {
        const mainId = c.source === 'local' ? c.sourceId : rowIdOf.get(c.id) ?? null;
        const ids = c.source === 'local' && c.groupIds?.length ? c.groupIds : mainId ? [mainId] : [];
        rowsOf.set(c.id, { mainId, ids });
      }
      const allRowIds = [...new Set([...rowsOf.values()].flatMap(r => r.ids))];
      const snapshots = await readStageSnapshots(allRowIds);

      // 3. Le geste, un seul appel pour tout le lot (lots de 200 faits par le module).
      const outcome = await setCandidateStages(allRowIds, target, undefined, { surface: options.surface ?? PIPELINE_SURFACE });
      if (outcome.error) failure ??= { kind: 'write', hint: outcome.error.hint };
      const rowById = new Map(outcome.rows.map(r => [r.id, r]));

      let moved = 0;
      let unchanged = 0;
      let partial = 0;
      const partialIds: string[] = [];
      const unchangedIds = new Set<string>();
      const undoGroups: UndoMove[][] = [];
      const done = new Map<string, { generalStage: GeneralStage | null; processStepId: string | null; stageEnteredAt: string | null }>();
      const failedNow = new Set<string>();
      for (const c of eligible) {
        const { mainId, ids } = rowsOf.get(c.id) ?? { mainId: null, ids: [] };
        const main = mainId ? rowById.get(mainId) : undefined;
        if (!main || main.result === 'error') {
          failedNow.add(c.id);
          failure ??= { kind: 'write', hint: main?.hint ?? null };
          continue;
        }
        const groupRows = ids.map(id => rowById.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
        // Une ligne en double refusée ou non traitée : la vue la ferait réapparaître au refetch.
        if (ids.some(id => rowById.get(id)?.result === 'error' || !rowById.has(id))) {
          partial += 1;
          partialIds.push(c.id);
          console.error('[useATSData] ligne en double non écrite pour un candidat déplacé');
        }
        // « Déplacé » se juge sur l'état d'avant (étape, étape d'entretien, colonne), comme
        // l'annulation : un geste qui confirme l'étape déjà occupée rend « updated » (l'origine
        // passe à user) sans que rien ne bouge. Un candidat de séquence ou d'InMail change de
        // colonne dès que sa ligne est écrite : sa ligne neuve n'a pas l'étape affichée avant.
        const moves = buildUndoMoves(snapshots, groupRows, { target });
        const writtenRows = groupRows.filter(r => r.result === 'updated');
        const changed = c.source === 'local'
          ? moves.length > 0 || writtenRows.some(r => !snapshots.has(r.id))
          : writtenRows.length > 0;
        if (changed) moved += 1;
        else {
          unchanged += 1;
          unchangedIds.add(c.id);
        }
        // Pas d'« Annuler » pour un candidat sans ligne avant le geste : l'état d'avant lu serait
        // la ligne À trier tout juste créée, pas la colonne où il était affiché.
        if (c.source === 'local' && moves.length > 0) undoGroups.push(moves);
        done.set(c.id, { generalStage: main.generalStage, processStepId: main.processStepId, stageEnteredAt: main.stageEnteredAt });
      }
      const failedCandidates = [...failedIds, ...failedNow];

      // Étape et date rendues par la base (la date reste la chaîne de la base) ;
      // retour arrière pour les candidats que la base n'a pas déplacés.
      queryClient.setQueryData<ATSCandidate[]>(['ats-candidates'], (old) =>
        old?.map(c => {
          const row = done.get(c.id);
          if (row) {
            return {
              ...c,
              generalStage: row.generalStage ?? target.stage,
              processStepId: row.processStepId,
              // Le nom de la nouvelle étape d'entretien vient de la relecture qui suit.
              processStepName: row.processStepId && row.processStepId === c.processStepId ? c.processStepName ?? null : null,
              stageEnteredAt: row.stageEnteredAt ?? c.stageEnteredAt,
              // Rien n'a bougé : pas d'action « maintenant » affichée jusqu'à la prochaine relecture.
              lastActivity: unchangedIds.has(c.id) ? previous.get(c.id)?.lastActivity ?? c.lastActivity : c.lastActivity,
            };
          }
          return failedNow.has(c.id) ? { ...c, ...previous.get(c.id) } : c;
        }) ?? []
      );
      return { moved, unchanged, failedIds: failedCandidates, partial, partialIds, undoGroups, failure };
    } catch (e) {
      console.error('Error updating stage:', e);
      // Revert optimistic update : restaurer l'étape, la date et lastActivity
      revert(eligibleIds);
      return {
        ...EMPTY_RESULT,
        failedIds: [...failedIds, ...eligible.map(c => c.id)],
        failure: { kind: 'write', hint: null },
      };
    }
  }, [candidates, queryClient, organizationId]);

  /**
   * Déplacement d'un candidat (colonnes, fiche, tableau de bord) : vrai si
   * enregistré, y compris quand il était déjà à cette étape. Toast avec
   * « Annuler » si la ligne a bougé. `silent` : ni toast ni relecture.
   * `surface` : écran d'origine pour la mesure, « pipeline » par défaut.
   */
  const handleStageChange = useCallback(async (
    candidateId: string,
    newStage: string,
    options: StageMoveOptions = {},
  ): Promise<boolean> => {
    const current = queryClient.getQueryData<ATSCandidate[]>(['ats-candidates']) ?? candidates;
    const candidate = current.find(c => c.id === candidateId);
    if (!candidate) return false;
    const result = await moveCandidates([candidateId], newStage, { surface: options.surface });
    const ok = result.failedIds.length === 0;
    if (options.silent) return ok;

    const name = candidate.name;
    if (!ok) {
      const { kind, hint } = result.failure ?? { kind: 'write' as const, hint: null };
      if (kind === 'target') toast.error(stageErrorMessage());
      else if (kind === 'mission') toast.error(`${name} n'est rattaché à aucune mission. Ajoutez-le d'abord à une mission pour changer son étape.`);
      else toast.error(hint ? stageErrorMessage(hint) : `Le déplacement de ${name} n'a pas été enregistré. Réessayez.`);
      return false;
    }

    void refreshStageReaders().catch((e) => console.error('[useATSData] relecture après déplacement :', e));
    const stageLabel = ATS_STAGES.find(s => s.key === newStage)?.label ?? atsColumnTitle(newStage);
    if (result.partial > 0) {
      toast.warning(`${name} est à l'étape «\u00a0${stageLabel}\u00a0», mais une de ses lignes en double n'a pas pu être mise à jour. Réessayez.`);
    } else if (result.moved === 0) {
      toast.info(`${name} est déjà à l'étape «\u00a0${stageLabel}\u00a0».`);
    } else {
      toast.success(`${name} est maintenant à l'étape «\u00a0${stageLabel}\u00a0»`, result.undoGroups.length > 0
        ? {
            action: {
              label: 'Annuler',
              // L'état d'avant, rendu par la base (jamais un déplacement inverse).
              onClick: () => {
                undoStageMoves(result.undoGroups, options.surface).catch((e) => console.error('[useATSData] annulation impossible :', e));
              },
            },
          }
        : undefined);
    }
    return true;
  }, [candidates, queryClient, moveCandidates, refreshStageReaders, undoStageMoves]);

  // Handle tags update
  const handleTagsChange = useCallback(async (candidateId: string, tags: string[]) => {
    const candidate = candidates.find(c => c.id === candidateId);
    if (!candidate || candidate.source !== 'local') return;

    // Optimistic update
    queryClient.setQueryData<ATSCandidate[]>(['ats-candidates'], (old) =>
      old?.map(c => c.id === candidateId ? { ...c, tags } : c) ?? []
    );

    try {
      const { error: updateError } = await supabase
        .from('job_candidate_status')
        .update({ tags })
        .eq('id', candidate.sourceId);
      if (updateError) throw updateError;
    } catch (error) {
      console.error('Error updating tags:', error);
      toast.error('Erreur lors de la mise à jour des tags');
      queryClient.invalidateQueries({ queryKey: ['ats-candidates'] });
    }
  }, [candidates, queryClient]);

  const isFromCache = !loading && !isFetching && candidates.length > 0;

  return {
    candidates,
    loading,
    isFetching,
    isFromCache,
    error: error ? (error instanceof Error ? error.message : 'Lecture des candidats impossible') : null,
    refetch: () => refetch(),
    handleStageChange,
    moveCandidates,
    undoStageMoves,
    refreshStageReaders,
    handleTagsChange,
  };
}
