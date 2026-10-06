// Actions de la liste des séquences (SequencesList) et du suivi des inscrits
// (SequenceEnrollmentsPanel), sorties des composants au lot 5c-1 pour que les
// pages Séquences les réutilisent. Corps inchangés : les dépendances (client,
// toast, mises à jour d'état, rappels) sont passées en paramètres, sous les noms
// que les tests leur donnent déjà (tests/ux/seq-audit-f2*.test.mjs).

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { toast as sonnerToast } from 'sonner';
import type { supabase as supabaseClient } from '@/integrations/supabase/client';
import type { invokeEdgeFunction as invokeEdgeFunctionFn } from '@/lib/invokeEdgeFunction';
import type { useUndoableEnrollmentAction } from '@/hooks/useUndoableEnrollmentAction';
import type { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { DONE_EXECUTION_STATUSES, PENDING_EXECUTION_STATUSES, SEQUENCE_LEVEL_PAUSE_REASONS } from '@/lib/sequenceLabels';
import {
  PAUSE_UNDO_FAILED_MESSAGE,
  PAUSE_UNDONE_MESSAGE,
  pauseToastTitle,
  sequencePauseToastTitle,
  sequenceWriteRefusal,
  summarizeUndoPause,
  type ResumeResponse,
} from '@/lib/sequenceErrorMessages';
import { rowToSequenceStep } from '@/components/outreach/sequence/sequenceGraph';
import type { Sequence, StopConditions, SenderAccountConfig } from '@/types/sequence';

type SupabaseClient = typeof supabaseClient;
type Toast = typeof sonnerToast;
type InvokeEdgeFunction = typeof invokeEdgeFunctionFn;
type UndoableEnrollmentActions = ReturnType<typeof useUndoableEnrollmentAction>;

// ── Liste des séquences ──────────────────────────────────────────────────

export interface SequenceWithStats {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  project_id: string | null;
  organization_id: string | null;
  /** Auteur : seul lui modifie la séquence quand il est collaborateur (contrat §8). */
  created_by: string | null;
  // Réglages d'en-tête lus par le moteur : à recharger à l'édition et à
  // recopier à la duplication, sinon ils sont effacés au premier enregistrement.
  stop_conditions: Partial<StopConditions> | null;
  sender_accounts: SenderAccountConfig[] | null;
  rotation_mode: string | null;
  multi_sender_enabled: boolean | null;
  steps: any[];
  enrollments: {
    total: number;
    active: number;
    completed: number;
    replied: number;
    paused: number;
    /** Candidats en pause par raison (sequence_enrollments.pause_reason). */
    pausedByReason: Record<string, number>;
  };
}

// Conditions d'arrêt affichées par défaut dans l'éditeur : ce qui est montré
// est ce qui est enregistré quand la séquence n'en a pas encore.
export const DEFAULT_STOP_CONDITIONS: StopConditions = {
  on_reply: true,
  on_click: false,
  on_unsubscribe: true,
  on_meeting_booked: false,
};

// Une étape d'attente sans événement est franchie tout de suite par le moteur :
// « Attendre réponse » clôt l'inscription comme répondue, « Attendre connexion »
// déclare le candidat connecté. L'éditeur visuel et l'assistant n'en posaient
// pas : on le déduit du type d'étape.
export const implicitWaitEvent = (actionType: string, waitForEvent: string | null | undefined): string | null => {
  if (waitForEvent) return waitForEvent;
  if (actionType === 'wait_reply') return 'reply_received';
  if (actionType === 'wait_connection') return 'connection_accepted';
  return null;
};

// « 1 candidat », « 3 candidats ».
export const candidats = (n: number) => `${n} candidat${n > 1 ? 's' : ''}`;

// Valeurs que l'éditeur affiche par défaut quand la colonne est vide : elles
// sont désormais chargées dans l'état, sinon l'écran montrait « 70 » ou « 3 »
// et l'enregistrement refusait un champ vide.
const DEFAULT_SCORE_THRESHOLD = '70';
const DEFAULT_WAIT_TIMEOUT_DAYS = 3;
const TIMEOUT_REQUIRED_ACTIONS = ['wait_connection', 'wait_reply', 'wait_profile_visit'];

// Réponse des actions serveur de reprise (process-sequences).
interface ResumeCounts {
  resumed?: number;
  nothing_to_resume?: number;
  account_unlinked?: number;
  not_paused?: number;
  error?: number;
}
interface SequenceResumeResponse {
  success?: boolean;
  results?: Array<{ enrollment_id: string; outcome: keyof ResumeCounts; message?: string }>;
  counts?: ResumeCounts;
  /** Candidats non traités faute de temps côté serveur (reprise par séquence). */
  remaining?: number;
  /**
   * Reprise par séquence d'un collaborateur (contrat §8) : candidats en pause
   * laissés de côté parce qu'inscrits par d'autres membres. 0 sinon.
   */
  other_members?: number;
  message?: string;
  error?: string;
}

// Reprise par séquence : le serveur s'arrête avant la limite de temps d'un appel
// et compte le reste dans `remaining`. On le rappelle tant qu'il en reste et
// qu'il progresse.
const MAX_RESUME_ROUNDS = 10;

// DETAIL du refus STEP_HAS_HISTORY : « Étape(s) concernée(s) : 0, 2 », en
// step_order (base 0, trié comme du texte). L'éditeur numérote à partir de 1.
// Après une suppression, l'éditeur a renuméroté les étapes : chaque étape est
// alors nommée par son type (labelsByOrder, lu en base avant l'enregistrement)
// et son numéro d'avant les modifications.
export const blockedStepsNotice = (details: string | null | undefined, labelsByOrder?: Map<number, string>): string => {
  const orders = [...new Set((details?.match(/\d+/g) ?? []).map(Number))].sort((a, b) => a - b);
  if (orders.length === 0) return '';
  const names = orders.map(order => {
    const label = labelsByOrder?.get(order);
    return label ? `« ${label} » (étape ${order + 1} avant vos modifications)` : String(order + 1);
  });
  return names.length > 1 ? ` Étapes concernées : ${names.join(', ')}.` : ` Étape concernée : ${names[0]}.`;
};

// Erreur de la base traduite pour l'éditeur, qui affiche err.message : jamais
// le texte brut de PostgreSQL (« row-level security », « not accessible »).
export const sequenceSaveError = (error: { message?: string; code?: string; hint?: string } | null): Error => {
  console.error('Sequence save error:', error);
  const refusal = sequenceWriteRefusal(error);
  if (refusal) return new Error(refusal);
  const text = error?.message ?? '';
  if (/not found or not accessible/i.test(text)) {
    return new Error('Cette séquence n’existe plus ou vous n’y avez plus accès. Actualisez la liste des séquences.');
  }
  if (error?.code === '42501' || /row-level security/i.test(text)) {
    return new Error('Vous n’avez pas les droits nécessaires pour enregistrer cette séquence.');
  }
  return new Error('La séquence n’a pas pu être enregistrée. Vérifiez votre connexion puis réessayez.');
};

// Sans droit d'envoi (plan gratuit) ou abonnement pas encore lu (décision 32),
// une nouvelle séquence est créée désactivée.
export const shouldCreateInactiveForPlan = (
  sequence: Pick<Sequence, 'id' | 'isActive'>,
  canSendSequences: boolean,
  planStateUnknown: boolean,
): boolean => !sequence.id && sequence.isActive && (!canSendSequences || planStateUnknown);

// D3 : désactiver met en pause TOUS les candidats en cours. Un collaborateur
// ne peut mettre en pause que les inscriptions qu'il a créées (RLS) : la
// désactivation ne lui est pas proposée.
export const COLLABORATOR_DEACTIVATION_HINT = 'La mise en pause de la séquence s’applique à tous ses candidats : réservée aux membres qui gèrent toutes les inscriptions. Mettez vos candidats en pause depuis la liste des inscrits.';

// Décision 32 : aucune activation tant que l'état d'abonnement n'est pas lu.
export const PLAN_STATE_LOADING_MESSAGE = 'Vérification de votre abonnement en cours : réessayez dans un instant.';
const PLAN_STATE_UNREADABLE_MESSAGE = 'Votre abonnement n’a pas pu être vérifié : la séquence n’a pas été activée. Réessayez dans un instant.';

/** Étapes connues de l'éditeur à l'ouverture d'une séquence existante. */
export type EditorBaseStepIds = { sequenceId: string; stepIds: Set<string> } | null;

/** Réactivation avec des candidats à reprendre : confirmation préalable. */
export type ActivateConfirm = { id: string; resumable: number; otherPaused: number; otherMembers: number } | null;

export interface SequenceListActionDeps {
  supabase: SupabaseClient;
  invokeEdgeFunction: InvokeEdgeFunction;
  toast: Toast;
  navigate: NavigateFunction;
  organizationId: string | null;
  projectId?: string | null;
  userId: string | null;
  isCollaborator: boolean;
  sequences: SequenceWithStats[];
  setSequences: Dispatch<SetStateAction<SequenceWithStats[]>>;
  fetchSequences: () => Promise<void>;
  togglingId: string | null;
  setTogglingId: Dispatch<SetStateAction<string | null>>;
  canManage: (seq: SequenceWithStats) => boolean;
  canEdit: (seq: SequenceWithStats) => boolean;
  readOnlyHint: (seq: SequenceWithStats) => string;
  deactivationLocked: (seq: SequenceWithStats) => boolean;
  enrollmentsPanelAction: (sequenceId: string) => { action?: { label: string; onClick: () => void } };
  offerUndo: UndoableEnrollmentActions['offerUndo'];
  resumeIds: UndoableEnrollmentActions['resumeIds'];
  showSummary: UndoableEnrollmentActions['showSummary'];
  planRef: MutableRefObject<{ unknown: boolean; loadError: boolean; canSend: boolean }>;
  refetchPlan: ReturnType<typeof useSubscriptionState>['refetch'];
  planStateUnknown: boolean;
  isPlanLoadError: boolean;
  canSendSequences: boolean;
  missionSequenceIds: string[];
  setNudging: Dispatch<SetStateAction<boolean>>;
  setNudgeConfirmOpen: Dispatch<SetStateAction<boolean>>;
  setActivateConfirm: Dispatch<SetStateAction<ActivateConfirm>>;
  setDeleteConfirmId: Dispatch<SetStateAction<string | null>>;
  duplicatingRef: MutableRefObject<boolean>;
  setDuplicatingId: Dispatch<SetStateAction<string | null>>;
  editorBaseStepIdsRef: MutableRefObject<EditorBaseStepIds>;
  setEditingActiveCount: Dispatch<SetStateAction<number | undefined>>;
  setEditingSequence: Dispatch<SetStateAction<Sequence | null>>;
  setShowBuilder: Dispatch<SetStateAction<boolean>>;
  /** Nom de la copie ; défaut « X (copie) ». Page d'une séquence (lot 5c-2) : « Copie de X ». */
  copyName?: (name: string) => string;
  /** Copie créée, étapes comprises (page d'une séquence : ouverture de la copie). */
  onDuplicated?: (copy: { id: string; name: string }) => void;
}

export function createSequenceListActions(deps: SequenceListActionDeps) {
  const {
    supabase, invokeEdgeFunction, toast, navigate,
    organizationId, projectId, userId, isCollaborator,
    sequences, setSequences, fetchSequences, togglingId, setTogglingId,
    canManage, canEdit, readOnlyHint, deactivationLocked, enrollmentsPanelAction,
    offerUndo, resumeIds, showSummary,
    planRef, refetchPlan, planStateUnknown, isPlanLoadError, canSendSequences,
    missionSequenceIds, setNudging, setNudgeConfirmOpen,
    setActivateConfirm, setDeleteConfirmId, duplicatingRef, setDuplicatingId,
    editorBaseStepIdsRef, setEditingActiveCount, setEditingSequence, setShowBuilder,
    copyName = (name: string) => `${name} (copie)`, onDuplicated,
  } = deps;

  const handleNudgeToday = async () => {
    setNudgeConfirmOpen(false);
    if (missionSequenceIds.length === 0) return;
    setNudging(true);
    try {
      // Le serveur n'avance que les actions prévues plus tard AUJOURD'HUI (fuseau
      // de chaque inscription), hors invitations et étapes d'attente, et
      // seulement pour ces séquences. Les relances des jours suivants gardent
      // leur date ; le moteur les envoie ensuite avec ses garde-fous.
      const { data, error } = await invokeEdgeFunction('process-sequences', {
        action: 'nudge_sequences',
        organization_id: organizationId,
        sequence_ids: missionSequenceIds,
      });
      const payload = data as { success?: boolean; advanced?: number; message?: string; error?: string } | null;
      if (error || !payload?.success) {
        throw new Error(payload?.message || error?.message || payload?.error || 'Réessayez dans un instant.');
      }
      const count = payload.advanced ?? 0;
      if (count > 0) {
        toast.success(`${count} action${count > 1 ? 's' : ''} avancée${count > 1 ? 's' : ''}`, {
          description: 'Elles partiront progressivement pendant vos heures d’envoi.',
        });
      } else {
        toast.info('Rien à avancer pour aujourd’hui.');
      }
    } catch (err) {
      console.error('Nudge sequences error:', err);
      toast.error('Les actions du jour n’ont pas pu être avancées', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setNudging(false);
    }
  };

  // Désactivation : les inscriptions d'abord, l'interrupteur ensuite. Le moteur
  // ne lit que le statut des inscriptions, jamais outreach_sequences.is_active :
  // un interrupteur « désactivé » sur des inscriptions encore actives laissait
  // partir les messages. Les étapes prévues gardent leur date (le moteur ignore
  // celles d'une inscription en pause) et les attentes restent telles quelles.
  //
  // Lot 5b : sans fenêtre. L'écriture des inscriptions rend leurs identifiants,
  // les seuls que « Annuler » reprend (jamais par séquence et raisons : une
  // pause qu'elle n'a pas posée, auto_paused par exemple, reste).
  const deactivateSequence = async (sequenceId: string) => {
    setTogglingId(sequenceId);
    const pauseFailed = 'La séquence n’a pas pu être mise en pause. Aucun envoi n’a été arrêté. Réessayez.';
    let pausedCount = 0;
    let pausedIds: string[] = [];
    try {
      const { data: paused, count, error: pauseError } = await supabase
        .from('sequence_enrollments')
        // Raison propre à la désactivation : la réactivation ne reprend
        // qu'elle, jamais une pause manuelle, de compte ou d'abonnement.
        .update({ status: 'paused', pause_reason: 'sequence_inactive' }, { count: 'exact' })
        .eq('sequence_id', sequenceId)
        .eq('status', 'active')
        .select('id');
      if (pauseError) {
        toast.error(pauseFailed);
        return;
      }
      pausedCount = count ?? paused?.length ?? 0;
      pausedIds = (paused ?? []).map(row => row.id);
      // D3 : recompte systématique. La RLS peut ne laisser mettre en pause
      // qu'une partie des candidats (collaborateur : ses seules inscriptions),
      // et d'autres ont pu être inscrits entre-temps. Tant qu'il en reste en
      // cours, la séquence n'est pas affichée désactivée.
      const { count: stillActive, error: countError } = await supabase
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('sequence_id', sequenceId)
        .eq('status', 'active');
      const pausedPart = pausedCount > 0
        ? `${candidats(pausedCount)} ${pausedCount > 1 ? 'sont' : 'est'} bien en pause. `
        : 'Aucun candidat n’a été mis en pause. ';
      if (countError) {
        toast.error('La séquence reste active', {
          description: `${pausedPart}Les candidats encore en cours n’ont pas pu être recomptés. Réessayez.`,
        });
        return;
      }
      const remainingActive = stillActive ?? 0;
      if (remainingActive > 0) {
        toast.error('La séquence reste active', {
          description: `${pausedPart}${candidats(remainingActive)} ${remainingActive > 1 ? 'restent' : 'reste'} en cours et ${remainingActive > 1 ? 'recevront' : 'recevra'} encore des messages : vous n’avez pas les droits sur ${remainingActive > 1 ? 'leurs inscriptions' : 'son inscription'}, ou ${remainingActive > 1 ? 'ils viennent' : 'il vient'} d’être ${remainingActive > 1 ? 'inscrits' : 'inscrit'}. Réessayez, ou demandez à un administrateur de mettre la séquence en pause.`,
          // Les candidats déjà mis en pause se reprennent depuis la liste des inscrits.
          ...(pausedCount > 0 ? enrollmentsPanelAction(sequenceId) : {}),
        });
        return;
      }

      const { data: updated, error: seqError } = await supabase
        .from('outreach_sequences')
        .update({ is_active: false })
        .eq('id', sequenceId)
        .select('id');
      if (seqError || !updated || updated.length === 0) {
        if (pausedCount > 0) {
          toast.error('La séquence n’a pas pu être mise en pause', {
            description: `${candidats(pausedCount)} ${pausedCount > 1 ? 'sont' : 'est'} bien en pause et ne ${pausedCount > 1 ? 'recevront' : 'recevra'} plus de messages. Réessayez de mettre la séquence en pause.`,
          });
        } else if (seqError) {
          toast.error('La séquence n’a pas pu être mise en pause. Réessayez.');
        } else {
          toast.error('Mise en pause impossible', { description: 'Vous n’avez pas les droits sur cette séquence.' });
        }
        return;
      }

      setSequences(prev => prev.map(s => s.id === sequenceId ? { ...s, is_active: false } : s));
      // Résultat réel, « Annuler » pendant que le toast est affiché.
      const shared = sequences.some(s => s.id === sequenceId && !s.project_id);
      const undoIds = pausedIds;
      offerUndo({
        title: sequencePauseToastTitle(pausedCount),
        description: shared && pausedCount > 0
          ? 'Cette séquence est partagée entre vos missions : ses candidats des autres missions sont aussi en pause.'
          : null,
        onUndo: () => undoSequencePause(sequenceId, undoIds),
      });
    } catch (err) {
      console.error('Error deactivating sequence:', err);
      toast.error(pausedCount > 0 ? 'La séquence n’a pas pu être mise en pause. Réessayez.' : pauseFailed);
    } finally {
      setTogglingId(null);
      fetchSequences();
    }
  };

  // « Annuler » d'une mise en pause de séquence (lot 5b) : l'interrupteur
  // d'abord, avec les contrôles d'offre de « Réactiver » (décision 32) et une
  // preuve d'écriture, puis la reprise serveur (resume_enrollments) des seules
  // inscriptions que la pause a touchées.
  const undoSequencePause = async (sequenceId: string, enrollmentIds: string[]) => {
    const plan = planRef.current;
    if (plan.unknown) {
      if (plan.loadError) {
        void refetchPlan();
        toast.error(PLAN_STATE_UNREADABLE_MESSAGE);
      } else {
        toast.info(PLAN_STATE_LOADING_MESSAGE);
      }
      return;
    }
    if (!plan.canSend) {
      toast.error("L'envoi de séquences nécessite un abonnement", {
        action: { label: 'Voir les plans', onClick: () => navigate('/pricing') },
      });
      return;
    }
    setTogglingId(sequenceId);
    try {
      const { data: updated, error: seqError } = await supabase
        .from('outreach_sequences')
        .update({ is_active: true })
        .eq('id', sequenceId)
        .select('id');
      if (seqError || !updated || updated.length === 0) {
        toast.error(PAUSE_UNDO_FAILED_MESSAGE, {
          description: seqError ? 'La séquence n’a pas pu être réactivée. Réessayez.' : 'Vous n’avez pas les droits sur cette séquence.',
        });
        return;
      }
      setSequences(prev => prev.map(s => s.id === sequenceId ? { ...s, is_active: true } : s));
      if (enrollmentIds.length === 0) {
        toast.success(PAUSE_UNDONE_MESSAGE);
        return;
      }
      const loadingId = toast.loading('Annulation de la pause…');
      const result = await resumeIds(enrollmentIds);
      showSummary(summarizeUndoPause({ ...result, total: enrollmentIds.length }), loadingId);
    } catch (err) {
      console.error('Error undoing sequence pause:', err);
      toast.error(PAUSE_UNDO_FAILED_MESSAGE, { description: 'Réessayez dans un instant.' });
    } finally {
      setTogglingId(null);
      fetchSequences();
    }
  };

  // Réactivation : l'interrupteur d'abord (avec preuve d'écriture), puis la
  // reprise côté serveur des seuls candidats mis en pause par la séquence.
  // `otherMembers` : pauses de séquence de candidats inscrits par d'autres membres,
  // que le serveur ne reprend pas pour un collaborateur (D3), comptées au clic.
  const activateSequence = async (sequenceId: string, resumable: number, otherPaused: number, otherMembers = 0) => {
    setTogglingId(sequenceId);
    try {
      const { data: updated, error: seqError } = await supabase
        .from('outreach_sequences')
        .update({ is_active: true })
        .eq('id', sequenceId)
        .select('id');
      if (seqError) {
        toast.error('La séquence n’a pas pu être réactivée. Réessayez.');
        return;
      }
      if (!updated || updated.length === 0) {
        toast.error('Réactivation impossible', { description: 'Vous n’avez pas les droits sur cette séquence.' });
        return;
      }
      setSequences(prev => prev.map(s => s.id === sequenceId ? { ...s, is_active: true } : s));

      // Raisons variées (pause manuelle, compte, limite, candidat injoignable) :
      // toutes ne se reprennent pas depuis le panneau, qui dit quoi faire pour chacun.
      const stayPaused = otherPaused > 0
        ? `${candidats(otherPaused)} ${otherPaused > 1 ? 'restent' : 'reste'} en pause pour une autre raison (pause manuelle, compte déconnecté, limite d’envoi…) : la liste des inscrits indique comment ${otherPaused > 1 ? 'les' : 'le'} reprendre.`
        : undefined;
      // Contrat §8 : candidats d'autres membres laissés en pause (appelant collaborateur).
      const otherMembersNotice = (n: number) => (n > 0
        ? `${candidats(n)} ${n > 1 ? 'inscrits' : 'inscrit'} par d’autres membres ${n > 1 ? 'restent' : 'reste'} en pause : un administrateur ou le membre qui ${n > 1 ? 'les a inscrits peut les' : 'l’a inscrit peut le'} reprendre depuis la liste des inscrits.`
        : null);

      if (resumable === 0) {
        const othersText = otherMembersNotice(otherMembers);
        if (othersText) {
          toast.warning('Séquence réactivée', {
            description: [othersText, stayPaused].filter(Boolean).join(' '),
            ...enrollmentsPanelAction(sequenceId),
          });
        } else {
          toast.success('Séquence réactivée', stayPaused ? { description: stayPaused, ...enrollmentsPanelAction(sequenceId) } : undefined);
        }
        return;
      }

      // Le serveur ne reprend que les pauses de séquence (désactivation,
      // auto-pause du moteur), garde la date de chaque étape en attente (au plus
      // tôt dans une minute), ne transforme jamais une attente (acceptation,
      // réponse) en envoi, et refuse un compte LinkedIn qui n'est plus relié.
      // Il s'arrête avant la limite de temps d'un appel et compte le reste dans
      // `remaining` : on le rappelle tant qu'il en reste et qu'il progresse,
      // puis un seul bilan.
      // Un candidat resté en pause est relu par l'appel suivant : son dernier
      // résultat fait foi, il n'est compté qu'une fois.
      const outcomes = new Map<string, keyof ResumeCounts>();
      const countsWithoutResults: Required<ResumeCounts> = { resumed: 0, nothing_to_resume: 0, account_unlinked: 0, not_paused: 0, error: 0 };
      let remaining = 0;
      // Compte du serveur (contrat §8) quand il le donne ; sinon celui fait au clic.
      let serverOtherMembers: number | null = null;
      for (let round = 0; round < MAX_RESUME_ROUNDS; round += 1) {
        if (round > 0) {
          toast.loading(`Reprise en cours : ${candidats(remaining)} encore à reprendre…`, { id: `resume-${sequenceId}` });
        }
        const { data, error } = await invokeEdgeFunction('process-sequences', {
          action: 'resume_enrollments',
          sequence_id: sequenceId,
          pause_reasons: SEQUENCE_LEVEL_PAUSE_REASONS,
        });
        const payload = data as SequenceResumeResponse | null;
        if (error || !payload?.success || !payload.counts) {
          if (round > 0) break; // Bilan des appels réussis ; le reste est signalé plus bas.
          // L'interrupteur reste actif : les candidats encore en pause ne
          // reçoivent rien, rien n'est envoyé à l'insu de l'utilisateur.
          toast.error('La séquence est réactivée, mais les candidats en pause n’ont pas pu reprendre', {
            description: `${payload?.message || error?.message || ''} Mettez la séquence en pause puis réactivez-la pour réessayer, ou reprenez-les depuis la liste des inscrits.`.trim(),
            ...enrollmentsPanelAction(sequenceId),
          });
          return;
        }
        if (serverOtherMembers === null && typeof payload.other_members === 'number') {
          serverOtherMembers = Math.max(0, payload.other_members);
        }
        if (Array.isArray(payload.results)) {
          for (const r of payload.results) outcomes.set(r.enrollment_id, r.outcome);
        } else {
          for (const key of Object.keys(countsWithoutResults) as Array<keyof ResumeCounts>) {
            countsWithoutResults[key] += payload.counts[key] ?? 0;
          }
        }
        const previous = remaining;
        remaining = payload.remaining ?? 0;
        // Plus rien à traiter, ou aucun progrès depuis l'appel précédent.
        if (remaining === 0 || (round > 0 && remaining >= previous)) break;
      }
      toast.dismiss(`resume-${sequenceId}`);

      const tally = { ...countsWithoutResults };
      for (const outcome of outcomes.values()) {
        if (outcome in tally) tally[outcome] += 1;
      }
      const resumed = tally.resumed;
      const failed = tally.error;
      const unlinked = tally.account_unlinked;
      const nothing = tally.nothing_to_resume;
      const othersLeft = serverOtherMembers ?? otherMembers;

      // Filet, tous rôles : pauses de séquence encore en place après la reprise.
      // Celles que le bilan n'explique pas (compte non relié, erreur, reste à
      // traiter, autres membres) interdisent un succès : il n'y a pas de preuve.
      const { count: stillPaused, error: recountError } = await supabase
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('sequence_id', sequenceId)
        .eq('status', 'paused')
        .in('pause_reason', SEQUENCE_LEVEL_PAUSE_REASONS);
      if (recountError) console.error('Error recounting paused enrollments after resume:', recountError);
      const unexplained = recountError ? 0 : Math.max(0, (stillPaused ?? 0) - (unlinked + failed + remaining + othersLeft));

      const details = [
        unlinked > 0 ? `${candidats(unlinked)} ${unlinked > 1 ? 'restent' : 'reste'} en pause : compte LinkedIn qui n’est plus relié.` : null,
        nothing > 0 ? `${candidats(nothing)} ${nothing > 1 ? 'n’avaient' : 'n’avait'} plus d’étape à envoyer.` : null,
        remaining > 0 ? `${candidats(remaining)} ${remaining > 1 ? 'n’ont' : 'n’a'} pas encore été ${remaining > 1 ? 'traités' : 'traité'} : reprenez-les depuis la liste des inscrits.` : null,
        otherMembersNotice(othersLeft),
        unexplained > 0 ? `${candidats(unexplained)} ${unexplained > 1 ? 'restent' : 'reste'} en pause sans avoir été repris : la liste des inscrits indique comment ${unexplained > 1 ? 'les' : 'le'} reprendre.` : null,
        recountError ? 'Les candidats encore en pause n’ont pas pu être recomptés : vérifiez la liste des inscrits.' : null,
        stayPaused ?? null,
      ].filter((d): d is string => !!d).join(' ');
      const notAllResumed = othersLeft > 0 || unexplained > 0 || !!recountError;
      // Candidats restés en pause : la liste des inscrits permet de les reprendre.
      const panelAction = (remaining > 0 || failed > 0 || unlinked > 0 || stayPaused || notAllResumed) ? enrollmentsPanelAction(sequenceId) : {};

      if (remaining > 0 && failed === 0) {
        toast.warning(`Séquence réactivée : ${candidats(resumed)} repris pour l’instant`, { description: details, ...panelAction });
      } else if (failed > 0) {
        toast.warning(`Séquence réactivée : ${candidats(resumed)} repris, ${failed} en erreur`, {
          description: `${details} Reprenez les candidats en erreur depuis la liste des inscrits.`.trim(),
          ...panelAction,
        });
      } else if (notAllResumed) {
        toast.warning(`Séquence réactivée : ${candidats(resumed)} repris`, { description: details, ...panelAction });
      } else {
        toast.success(`Séquence réactivée. ${candidats(resumed)} repris.`, details ? { description: details, ...panelAction } : undefined);
      }
    } catch (err) {
      console.error('Error activating sequence:', err);
      toast.dismiss(`resume-${sequenceId}`);
      toast.error('La réactivation a échoué. Réessayez.');
    } finally {
      setTogglingId(null);
      fetchSequences();
    }
  };

  // Clic sur un interrupteur : mise en pause immédiate de la séquence (lot 5b,
  // « Annuler » dans le toast), ou confirmation avant de réactiver une
  // séquence qui a des candidats à reprendre.
  const requestToggle = async (seq: SequenceWithStats) => {
    if (togglingId) return;
    // Défense : l'interrupteur n'est rendu que si canEdit.
    if (!canEdit(seq)) {
      toast.error('Modification impossible', { description: readOnlyHint(seq) });
      return;
    }
    if (deactivationLocked(seq)) {
      toast.error('Mise en pause réservée', { description: COLLABORATOR_DEACTIVATION_HINT });
      return;
    }
    if (seq.is_active) {
      // Sans fenêtre : deactivateSequence met les inscriptions en pause, les
      // recompte et n'écrit l'interrupteur qu'avec la preuve qu'il n'en reste
      // aucune en cours.
      await deactivateSequence(seq.id);
      return;
    }
    // Activer (pas désactiver) exige un plan qui autorise l'envoi de séquences,
    // donc un état d'abonnement lu (décision 32).
    if (planStateUnknown) {
      if (isPlanLoadError) {
        void refetchPlan();
        toast.error(PLAN_STATE_UNREADABLE_MESSAGE);
      } else {
        toast.info(PLAN_STATE_LOADING_MESSAGE);
      }
      return;
    }
    if (!canSendSequences) {
      toast.error("L'envoi de séquences nécessite un abonnement", {
        action: { label: 'Voir les plans', onClick: () => navigate('/pricing') },
      });
      return;
    }
    setTogglingId(seq.id);
    let resumable = 0;
    let otherPaused = 0;
    let otherMembers = 0;
    try {
      const pausedCount = (withReason: boolean, createdBy: string | null = null) => {
        let q = supabase
          .from('sequence_enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('sequence_id', seq.id)
          .eq('status', 'paused');
        if (withReason) q = q.in('pause_reason', SEQUENCE_LEVEL_PAUSE_REASONS);
        if (createdBy) q = q.eq('created_by', createdBy);
        return q;
      };
      // D3 : pour un collaborateur, le serveur ne reprend que les candidats qu'il
      // a inscrits. Ceux des autres membres (visibles sur sa séquence) restent
      // en pause : comptés à part pour ne pas les annoncer comme repris.
      const ownerFilter = isCollaborator ? userId : null;
      const [resumableRes, pausedRes, ownRes] = await Promise.all([
        pausedCount(true),
        pausedCount(false),
        ownerFilter ? pausedCount(true, ownerFilter) : Promise.resolve(null),
      ]);
      if (resumableRes.error || pausedRes.error || ownRes?.error) throw resumableRes.error || pausedRes.error || ownRes?.error;
      const sequencePaused = resumableRes.count ?? 0;
      resumable = ownRes ? Math.min(sequencePaused, ownRes.count ?? 0) : sequencePaused;
      otherMembers = sequencePaused - resumable;
      otherPaused = Math.max(0, (pausedRes.count ?? 0) - sequencePaused);
    } catch (err) {
      console.error('Error counting paused enrollments:', err);
      toast.error('La séquence n’a pas pu être réactivée. Réessayez.');
      setTogglingId(null);
      return;
    }
    setTogglingId(null);
    if (resumable > 0) {
      setActivateConfirm({ id: seq.id, resumable, otherPaused, otherMembers });
      return;
    }
    await activateSequence(seq.id, 0, otherPaused, otherMembers);
  };

  // Rend true si la séquence a bien été supprimée (page d'une séquence : retour à la liste).
  const handleDelete = async (sequenceId: string): Promise<boolean> => {
    try {
      // .select('id') : un refus d'accès supprime 0 ligne sans erreur.
      const { data: deleted, error } = await supabase
        .from('outreach_sequences')
        .delete()
        .eq('id', sequenceId)
        .select('id');

      if (error) throw error;
      if (!deleted || deleted.length === 0) {
        toast.error('Suppression impossible', { description: 'Vous n’avez pas les droits sur cette séquence.' });
        return false;
      }

      setSequences(prev => prev.filter(s => s.id !== sequenceId));
      toast.success('Séquence supprimée');
      // Les chiffres de la mission (inscrits retirés avec la séquence) suivent.
      void fetchSequences();
      return true;
    } catch (err) {
      console.error('Error deleting sequence:', err);
      toast.error('Impossible de supprimer la séquence', { description: 'Réessayez dans un instant.' });
      return false;
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleDuplicate = async (seq: SequenceWithStats) => {
    // Séquence d'une autre organisation : ses étapes sont illisibles (RLS) et
    // ses expéditeurs ne sont pas les miens, la copie ne pourrait rien envoyer.
    // Double clic : une seule copie.
    if (!canManage(seq) || duplicatingRef.current) return;
    duplicatingRef.current = true;
    setDuplicatingId(seq.id);
    // En-tête créé : supprimé si la copie des étapes échoue (sinon une
    // séquence vide restait et un nouvel essai en créait une seconde).
    let createdCopyId: string | null = null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');
      if (!organizationId) throw new Error('Organisation introuvable : rechargez la page');

      // 1. Charge les steps réelles depuis la DB
      const { data: steps, error: stepsErr } = await (supabase
        .from('sequence_steps')
        .select('*')
        .eq('sequence_id', seq.id)
        .order('step_order', { ascending: true }) as any);
      if (stepsErr) throw sequenceSaveError(stepsErr);

      // 2. Crée la nouvelle séquence, nommée « X (copie) » (ou par copyName)
      const { data: newSeq, error: seqErr } = await (supabase
        .from('outreach_sequences')
        .insert({
          name: copyName(seq.name),
          description: seq.description,
          is_active: false, // toujours inactive par défaut, l'user choisit quand activer
          created_by: user.id,
          organization_id: organizationId,
          // Depuis une mission : la copie lui appartient. Depuis l'écran
          // Séquences de l'organisation (lot 5c-2) : la mission de l'originale.
          ...(projectId ? { project_id: projectId } : seq.project_id ? { project_id: seq.project_id } : {}),
          // Garde-fous et expéditeurs : la copie doit s'arrêter et tourner
          // entre comptes comme l'originale.
          stop_conditions: seq.stop_conditions ?? null,
          sender_accounts: seq.sender_accounts ?? null,
          rotation_mode: seq.rotation_mode ?? null,
          multi_sender_enabled: seq.multi_sender_enabled ?? false,
        } as any)
        .select()
        .single() as any);
      if (seqErr || !newSeq) throw sequenceSaveError(seqErr);
      createdCopyId = newSeq.id;

      // 3. Re-crée les steps via la RPC transactionnelle. On passe les ANCIENS
      // ids comme ids « client » : n'appartenant pas à la nouvelle séquence,
      // la RPC insère des copies et REMAPPE les refs de branchement
      // (next_step_id, if_true/false_goto, timeout_branch) vers les nouveaux
      // ids. L'ancien insert brut copiait ces refs telles quelles → la copie
      // exécutait les steps de la séquence SOURCE (audit 2026-07, Builder H1).
      if (steps && steps.length > 0) {
        const payload = (steps as any[]).map((s: any) => ({
          id: s.id,
          step_order: s.step_order,
          action_type: s.action_type,
          condition_type: s.condition_type,
          condition_value: s.condition_value ?? null,
          delay_days: s.delay_days ?? 0,
          delay_hours: s.delay_hours ?? 0,
          delay_minutes: s.delay_minutes ?? 0,
          preferred_hour_start: s.preferred_hour_start ?? null,
          preferred_hour_end: s.preferred_hour_end ?? null,
          subject_template: s.subject_template ?? null,
          message_template: s.message_template ?? null,
          use_ai_personalization: s.use_ai_personalization ?? false,
          ai_tone: s.ai_tone ?? null,
          // Même délai par défaut qu'à l'ouverture dans l'éditeur : une attente
          // sans délai attendait sans fin dans la copie (le moteur ne l'applique
          // qu'aux attentes sans événement).
          timeout_days: s.timeout_days ?? (TIMEOUT_REQUIRED_ACTIONS.includes(s.action_type) ? DEFAULT_WAIT_TIMEOUT_DAYS : null),
          wait_for_event: implicitWaitEvent(s.action_type, s.wait_for_event),
          variant_group: s.variant_group ?? null,
          variant_weight: s.variant_weight ?? 100,
          // Mêmes clés que buildStepsPayload : sans elles, la RPC remettait la
          // fin de séquence à false et les options e-mail (dont le lien de
          // désinscription) à NULL dans la copie.
          ends_sequence: s.ends_sequence ?? false,
          cc_emails: s.cc_emails ?? null,
          bcc_emails: s.bcc_emails ?? null,
          include_unsubscribe: s.include_unsubscribe ?? null,
          signature_id: s.signature_id ?? null,
          if_true_goto_step: s.if_true_goto_step ?? null,
          if_false_goto_step: s.if_false_goto_step ?? null,
          timeout_branch_step_id: s.timeout_branch_step_id ?? null,
          next_step_id: s.next_step_id ?? null,
        }));
        const { error: stepsCreateErr } = await supabase.rpc('save_sequence_steps', {
          p_sequence_id: newSeq.id,
          p_steps: payload,
        });
        if (stepsCreateErr) throw sequenceSaveError(stepsCreateErr);
      }
      createdCopyId = null;

      toast.success(`Séquence dupliquée : "${newSeq.name}"`, {
        description: 'La copie reste inactive tant que vous ne l’activez pas.',
      });
      onDuplicated?.({ id: newSeq.id, name: newSeq.name });
      // Refresh la liste
      await fetchSequences();
    } catch (err) {
      console.error('Error duplicating sequence:', err);
      if (createdCopyId) {
        const { error: cleanupError } = await supabase
          .from('outreach_sequences')
          .delete()
          .eq('id', createdCopyId);
        if (cleanupError) console.error('Error removing empty copy after failed steps copy:', cleanupError);
      }
      toast.error('Impossible de dupliquer la séquence', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      duplicatingRef.current = false;
      setDuplicatingId(null);
    }
  };

  const handleEdit = async (seq: SequenceWithStats) => {
    // Contrat §8 : l'éditeur ne s'ouvre pas sur une séquence non modifiable. Un
    // collaborateur y réécrivait les messages d'un collègue, puis tout était
    // refusé à l'enregistrement (SEQUENCE_NOT_OWNER), sans brouillon gardé.
    if (!canEdit(seq)) {
      toast.error('Modification impossible', { description: readOnlyHint(seq) });
      return;
    }
    // Étapes relues en base à l'ouverture : la liste peut dater de l'arrivée
    // sur la page (étape ajoutée depuis par un collègue), ou ne pas avoir pu
    // les charger. Sans elles, l'éditeur ne s'ouvre pas : un enregistrement
    // depuis un éditeur vide effaçait les étapes réelles et leurs envois prévus.
    const [{ data: freshSteps, error: stepsError }, { count: activeNow, error: activeError }] = await Promise.all([
      supabase
        .from('sequence_steps')
        .select('*')
        .eq('sequence_id', seq.id)
        .order('step_order', { ascending: true }),
      // Candidats en cours, pour que l'éditeur annonce l'effet des modifications.
      supabase
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('sequence_id', seq.id)
        .eq('status', 'active'),
    ]);
    if (activeError) console.error('Error counting active enrollments for edit:', activeError);
    setEditingActiveCount(activeError ? undefined : (activeNow ?? 0));
    if (stepsError) {
      console.error('Error loading sequence steps for edit:', stepsError);
      toast.error('Impossible de charger le détail de cette séquence', {
        description: 'Vérifiez votre connexion puis réessayez.',
      });
      return;
    }
    // Même forme que les étapes de la liste (colonnes récentes absentes des types générés).
    const steps: SequenceWithStats['steps'] = freshSteps || [];
    editorBaseStepIdsRef.current = { sequenceId: seq.id, stepIds: new Set(steps.map(s => s.id)) };

    const sequence: Sequence = {
      id: seq.id,
      name: seq.name,
      description: seq.description || undefined,
      isActive: seq.is_active,
      // Recharger les réglages d'en-tête : sans eux, l'éditeur affichait les
      // valeurs par défaut et l'enregistrement effaçait ceux de la séquence.
      stopConditions: { ...DEFAULT_STOP_CONDITIONS, ...(seq.stop_conditions ?? {}) },
      senderAccounts: seq.sender_accounts ?? [],
      rotationMode: seq.rotation_mode ?? 'round_robin',
      multiSenderEnabled: !!seq.multi_sender_enabled,
      // Même lecture que le choix de modèle (rowToSequenceStep) : variantes,
      // options e-mail, renvois, « Fin de séquence » et « Si timeout » déduit de
      // l'étape de repli. S'y ajoutent les valeurs que l'éditeur affiche par
      // défaut quand la colonne est vide (seuil de score, délai d'attente).
      steps: steps.map(s => ({
        ...rowToSequenceStep(s),
        conditionValue: s.condition_value?.trim()
          ? s.condition_value
          : (s.condition_type === 'if_score_above' ? DEFAULT_SCORE_THRESHOLD : undefined),
        timeoutDays: s.timeout_days
          ?? (TIMEOUT_REQUIRED_ACTIONS.includes(s.action_type) ? DEFAULT_WAIT_TIMEOUT_DAYS : undefined),
      })),
    };
    setEditingSequence(sequence);
    setShowBuilder(true);
  };

  return {
    handleNudgeToday,
    deactivateSequence,
    undoSequencePause,
    activateSequence,
    requestToggle,
    handleDelete,
    handleDuplicate,
    handleEdit,
  };
}

// ── Suivi des inscrits ───────────────────────────────────────────────────

export interface StepExecution {
  id: string;
  step_id: string;
  step_order: number;
  status: string;
  scheduled_at: string;
  executed_at: string | null;
  final_subject: string | null;
  final_message: string | null;
  error_message: string | null;
  skip_reason: string | null;
  step?: {
    action_type: string;
    message_template: string | null;
    subject_template: string | null;
  };
}

export interface Enrollment {
  id: string;
  profile_id: string;
  profile_name: string | null;
  profile_headline: string | null;
  profile_url: string | null;
  status: string;
  current_step_order: number;
  created_at: string;
  replied_at: string | null;
  connection_status: string | null;
  /** Raison de pause (liste dans src/lib/sequenceLabels.ts). NULL hors pause. */
  pause_reason?: string | null;
  /** Suivi du moteur ; `pause_reason` y précise parfois une pause (texte en français). */
  tracking_data?: unknown;
  /** Membre qui a inscrit le candidat : un collaborateur n'agit que sur les siens (D3). */
  created_by?: string | null;
  executions?: StepExecution[];
}

export const isDoneStatus = (status: string) => (DONE_EXECUTION_STATUSES as readonly string[]).includes(status);
const isPendingStatus = (status: string) => (PENDING_EXECUTION_STATUSES as readonly string[]).includes(status);

/**
 * Pauses reprises par « Reprendre tous les candidats en pause » : pauses une
 * par une (dont celles héritées de l'ancienne désactivation, D6) et pauses de
 * séquence restées en place alors que la séquence est de nouveau active. Les
 * autres raisons (compte, abonnement, limite, échec d'envoi, candidat
 * injoignable) ont leur propre action.
 */
export const BULK_RESUME_PAUSE_REASONS: string[] = ['manual', ...SEQUENCE_LEVEL_PAUSE_REASONS];
/** Candidats par appel de reprise groupée (le serveur en traite 100 au plus, en 35 s). */
const BULK_RESUME_CHUNK = 25;

/** Motif des étapes annulées par un effacement RGPD (moteur, recordGdprErasure). */
const GDPR_ERASURE_SKIP_PREFIX = 'Effacement des données demandé';

/**
 * D5 : effacement RGPD, définitif. Marqueur durable tracking_data.gdpr_erased_at,
 * ou une étape annulée par l'effacement. Ni « Reprendre » ni « Relancer ».
 */
export const isGdprErased = (enrollment: Pick<Enrollment, 'tracking_data' | 'executions'>): boolean => {
  const tracking = enrollment.tracking_data;
  if (tracking && typeof tracking === 'object' && !Array.isArray(tracking)
    && (tracking as Record<string, unknown>).gdpr_erased_at) {
    return true;
  }
  return (enrollment.executions || []).some(e => !!e.skip_reason?.startsWith(GDPR_ERASURE_SKIP_PREFIX));
};

/** Échec dont l'issue est inconnue (le message a pu partir) : la reprise repart après lui. */
const UNCERTAIN_FAILURE_PREFIXES = ['Interrompu pendant l’envoi', "Interrompu pendant l'envoi", 'Envoi incertain'];

/**
 * Pause « échec d'envoi » dont la reprise rejoue l'étape en échec : sans étape
 * en attente, le serveur planifie l'étape qui suit la dernière étape faite, et
 * un échec n'en est pas une. « Reprendre à l'étape suivante » était donc faux.
 */
export const resumeRetriesFailedStep = (enrollment: Pick<Enrollment, 'status' | 'pause_reason' | 'executions'>): boolean => {
  if (enrollment.status !== 'paused' || enrollment.pause_reason !== 'send_failed') return false;
  const executions = enrollment.executions || [];
  if (executions.some(e => isPendingStatus(e.status) || e.status === 'sending')) return false;
  // Échec incertain : compté comme fait par le serveur (jamais rejoué).
  const isUncertain = (e: Pick<StepExecution, 'status' | 'error_message'>) => e.status === 'failed'
    && UNCERTAIN_FAILURE_PREFIXES.some(prefix => (e.error_message || '').startsWith(prefix));
  const lastDoneOrder = Math.max(-1, ...executions.filter(e => isDoneStatus(e.status) || isUncertain(e)).map(e => e.step_order));
  return executions.some(e => e.status === 'failed' && !isUncertain(e) && e.step_order > lastDoneOrder);
};

/** Lignes par page de l'API (1 000 au plus par requête). */
export const EXECUTION_PAGE_SIZE = 1000;

export interface EnrollmentActionDeps {
  supabase: SupabaseClient;
  invokeEdgeFunction: InvokeEdgeFunction;
  toast: Toast;
  sequenceId: string;
  nameOf: (enrollmentId: string) => string;
  fetchEnrollments: (append?: boolean) => Promise<void>;
  fetchStatusCounts: () => Promise<void>;
  setEnrollments: Dispatch<SetStateAction<Enrollment[]>>;
  offerUndoPause: UndoableEnrollmentActions['offerUndoPause'];
  setBulkResuming: Dispatch<SetStateAction<boolean>>;
}

export function createEnrollmentActions(deps: EnrollmentActionDeps) {
  const {
    supabase, invokeEdgeFunction, toast, sequenceId, nameOf,
    fetchEnrollments, fetchStatusCounts, setEnrollments, offerUndoPause, setBulkResuming,
  } = deps;

  // Mise en pause d'un candidat, sans fenêtre (lot 5b) : on ne touche qu'à
  // l'inscription. Les étapes prévues gardent leur date, le moteur les ignore
  // tant que l'inscription n'est pas reprise, et « Reprendre » les retrouve
  // telles quelles. « Annuler » du toast la reprend par le serveur
  // (resume_enrollments), jamais par une écriture du navigateur.
  const stopEnrollment = async (enrollmentId: string) => {
    const name = nameOf(enrollmentId);
    try {
      const { data, error: enrollError } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'paused', pause_reason: 'manual' })
        .eq('id', enrollmentId)
        .eq('status', 'active')
        .select('id');

      if (enrollError) throw enrollError;
      if (!data || data.length === 0) {
        toast.error(`La séquence n’a pas pu être mise en pause pour ${name}`, {
          description: 'Son statut a peut-être changé entre-temps : la liste a été actualisée.',
        });
        await fetchEnrollments();
        return;
      }

      setEnrollments(prev =>
        prev.map(e => e.id === enrollmentId ? { ...e, status: 'paused', pause_reason: 'manual' } : e)
      );
      void fetchStatusCounts();
      offerUndoPause({
        title: pauseToastTitle(name),
        enrollmentIds: data.map(row => row.id),
        candidateName: name,
        onSettled: () => fetchEnrollments(),
      });
    } catch (error) {
      console.error('Error pausing enrollment:', error);
      toast.error(`La séquence n’a pas pu être mise en pause pour ${name}. Réessayez.`);
    }
  };

  // « Mettre en pause » de la barre groupée (page d'une séquence, lot 5c-2) :
  // les candidats choisis qui sont en cours, même écriture que la pause d'un
  // candidat, sans fenêtre ; « Annuler » reprend ceux que l'écriture a touchés.
  const pauseEnrollments = async (enrollmentIds: string[]) => {
    const ids = [...new Set(enrollmentIds)];
    if (ids.length === 0) return;
    try {
      const { data, error: enrollError } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'paused', pause_reason: 'manual' })
        .in('id', ids)
        .eq('status', 'active')
        .select('id');
      if (enrollError) throw enrollError;
      const pausedIds = (data ?? []).map(row => row.id);
      if (pausedIds.length === 0) {
        toast.info('Aucun des candidats choisis n’était en cours.');
        await fetchEnrollments();
        return;
      }
      setEnrollments(prev =>
        prev.map(e => pausedIds.includes(e.id) ? { ...e, status: 'paused', pause_reason: 'manual' } : e)
      );
      void fetchStatusCounts();
      const single = pausedIds.length === 1 ? nameOf(pausedIds[0]) : null;
      const skipped = ids.length - pausedIds.length;
      offerUndoPause({
        title: single ? pauseToastTitle(single) : `Séquence mise en pause pour ${candidats(pausedIds.length)}.`,
        description: skipped > 0 ? `${candidats(skipped)} ${skipped > 1 ? 'n’étaient' : 'n’était'} pas en cours.` : null,
        enrollmentIds: pausedIds,
        candidateName: single,
        onSettled: () => fetchEnrollments(),
      });
    } catch (error) {
      console.error('Error pausing enrollments:', error);
      toast.error('La mise en pause a échoué. Réessayez.');
    }
  };

  // Mise en pause de TOUS les candidats en cours de la séquence, filtrée en
  // base (pas sur les 200 lignes chargées). Les étapes gardent leur date.
  // Sans fenêtre (lot 5b) : l'écriture rend les inscriptions touchées, les
  // seules que « Annuler » reprend.
  const bulkStopActive = async () => {
    try {
      const { data, count, error: enrollError } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'paused', pause_reason: 'manual' }, { count: 'exact' })
        .eq('sequence_id', sequenceId)
        .eq('status', 'active')
        .select('id');

      if (enrollError) throw enrollError;
      const paused = count ?? data?.length ?? 0;
      const pausedText = `${paused} candidat${paused > 1 ? 's' : ''} mis en pause`;
      // D3 : recompte systématique. La RLS peut n'en laisser mettre en pause
      // qu'une partie (collaborateur : ses seules inscriptions), et d'autres
      // ont pu être inscrits entre-temps : jamais de succès s'il en reste.
      const { count: stillActive, error: countError } = await supabase
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('sequence_id', sequenceId)
        .eq('status', 'active');
      const remaining = stillActive ?? 0;
      const pausedIds = (data ?? []).map(row => row.id);
      // Pause partielle : « Annuler » reste offert pour les inscriptions
      // réellement mises en pause (rendues par l'écriture), et elles seules.
      const offerPartialUndo = (title: string, description: string) => offerUndoPause({
        title, description, tone: 'warning', enrollmentIds: pausedIds, onSettled: () => fetchEnrollments(),
      });
      if (countError) {
        console.error('Error recounting active enrollments:', countError);
        const description = 'Impossible de vérifier s’il reste des candidats en cours : actualisez la liste.';
        if (paused > 0 && pausedIds.length > 0) offerPartialUndo(pausedText, description);
        else toast.warning(paused > 0 ? pausedText : 'Aucun candidat n’a été mis en pause', { description });
      } else if (remaining > 0) {
        const title = paused > 0 ? `${pausedText}, ${remaining} encore en cours` : 'Aucun candidat n’a été mis en pause';
        const description = `${remaining} candidat${remaining > 1 ? 's' : ''} en cours ${remaining > 1 ? 'recevront' : 'recevra'} encore des messages : vous n’avez pas les droits sur ${remaining > 1 ? 'leurs inscriptions' : 'son inscription'}, ou ${remaining > 1 ? 'ils viennent' : 'il vient'} d’être ${remaining > 1 ? 'inscrits' : 'inscrit'}. Réessayez, ou demandez à un administrateur.`;
        if (paused > 0 && pausedIds.length > 0) offerPartialUndo(title, description);
        else toast.error(title, { description });
      } else if (paused === 0) {
        toast.info('Aucun candidat n’était en cours.');
      } else {
        offerUndoPause({
          title: pausedText,
          enrollmentIds: pausedIds,
          onSettled: () => fetchEnrollments(),
        });
      }
    } catch (error) {
      console.error('Error bulk pausing:', error);
      toast.error('La mise en pause groupée a échoué. Réessayez.');
    }
    await fetchEnrollments();
  };

  // D6 : « Reprendre tous les candidats en pause » (pauses une par une, dont
  // celles de l'ancienne désactivation, et pauses de séquence restées alors que
  // la séquence est active). Candidats lus en base (toute la séquence, pas la
  // page chargée), puis reprise serveur par lots d'identifiants : le serveur
  // refuse une séquence désactivée, un compte non relié ou un effacement RGPD,
  // candidat par candidat.
  const bulkResumePaused = async () => {
    setBulkResuming(true);
    const toastId = `bulk-resume-${sequenceId}`;
    const counts = { resumed: 0, nothing_to_resume: 0, account_unlinked: 0, not_paused: 0, error: 0 };
    let targets: string[] = [];
    let unprocessed = 0;
    let callError: string | null = null;
    let firstErrorMessage: string | null = null;
    try {
      for (let from = 0; ; from += EXECUTION_PAGE_SIZE) {
        const { data, error } = await supabase
          .from('sequence_enrollments')
          .select('id')
          .eq('sequence_id', sequenceId)
          .eq('status', 'paused')
          .in('pause_reason', BULK_RESUME_PAUSE_REASONS)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + EXECUTION_PAGE_SIZE - 1);
        if (error) throw error;
        targets.push(...(data || []).map(e => e.id));
        if (!data || data.length < EXECUTION_PAGE_SIZE) break;
      }
      targets = [...new Set(targets)];
      if (targets.length === 0) {
        toast.info('Aucun candidat à reprendre.');
      } else {
        for (let i = 0; i < targets.length; i += BULK_RESUME_CHUNK) {
          if (targets.length > BULK_RESUME_CHUNK) {
            toast.loading(`Reprise en cours : ${i} sur ${targets.length}…`, { id: toastId });
          }
          const { data, error } = await invokeEdgeFunction('process-sequences', {
            action: 'resume_enrollments',
            enrollment_ids: targets.slice(i, i + BULK_RESUME_CHUNK),
          });
          const payload = data as ResumeResponse | null;
          if (error || !payload?.success) {
            callError = payload?.message || error?.message || 'Réessayez dans un instant.';
            unprocessed = targets.length - i;
            break;
          }
          for (const key of Object.keys(counts) as Array<keyof typeof counts>) {
            counts[key] += Number(payload.counts?.[key] ?? 0) || 0;
          }
          firstErrorMessage ??= payload.results?.find(r => r.outcome === 'error' && r.message)?.message ?? null;
        }
        toast.dismiss(toastId);
        const n = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;
        const others = [
          counts.account_unlinked > 0 ? `${n(counts.account_unlinked, 'reste', 'restent')} en pause : compte LinkedIn qui n’est plus relié` : null,
          counts.nothing_to_resume > 0 ? `${n(counts.nothing_to_resume, 'n’avait', 'n’avaient')} plus d’étape à envoyer` : null,
          counts.not_paused > 0 ? `${n(counts.not_paused, 'n’était', 'n’étaient')} plus en pause` : null,
          counts.error > 0 ? `${n(counts.error, 'en erreur', 'en erreur')}${firstErrorMessage ? ` (${firstErrorMessage.replace(/\.$/, '')})` : ''}` : null,
          unprocessed > 0 ? `${n(unprocessed, 'non traité', 'non traités')} : ${callError}` : null,
        ].filter((d): d is string => !!d).join(' ; ');
        const title = `${n(counts.resumed, 'candidat repris', 'candidats repris')}`;
        if (!others && counts.resumed > 0) {
          toast.success(title, { description: 'Une étape déjà programmée garde sa date ; sinon, la suivante suit son délai habituel, pendant vos heures d’envoi.' });
        } else if (counts.resumed > 0) {
          toast.warning(title, { description: `${others}.` });
        } else {
          toast.error('Aucun candidat n’a repris', others ? { description: `${others}.` } : undefined);
        }
      }
    } catch (error) {
      console.error('Error bulk resuming:', error);
      toast.dismiss(toastId);
      toast.error('La reprise groupée a échoué. Réessayez.');
    } finally {
      setBulkResuming(false);
    }
    await fetchEnrollments();
  };

  const skipStep = async (executionId: string) => {
    try {
      // Une seule opération serveur : elle marque l'étape sautée, avance la
      // position de l'enrollment et planifie la suivante. Avant, le front
      // écrivait 'skipped' puis déclenchait un cycle : rien n'avançait et le
      // janitor re-planifiait l'étape sautée une heure plus tard — l'InMail
      // écarté partait quand même.
      const { data, error } = await invokeEdgeFunction('process-sequences', {
        action: 'skip_execution',
        execution_id: executionId,
      });
      const payload = data as { success?: boolean; error?: string; message?: string } | null;
      if (error || !payload?.success) {
        throw new Error(payload?.message || error?.message || 'Réessayez dans un instant.');
      }

      toast.success('Étape sautée', {
        description: 'La séquence passe à l\'étape suivante.',
      });
    } catch (err) {
      console.error('[EnrollmentsPanel] skipStep failed:', err);
      toast.error('L\'étape n\'a pas pu être sautée', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
    // Liste relue dans tous les cas : sur un refus (étape déjà partie ou en
    // cours d'envoi), l'écran montre l'état réel.
    await fetchEnrollments();
  };

  const markReplied = async (enrollmentId: string) => {
    const name = nameOf(enrollmentId);
    try {
      // Clôture côté serveur, comme une réponse détectée : statut, annulation
      // de TOUTES les étapes en attente (attentes et envois bloqués compris),
      // réponse comptée une seule fois. Avant, deux écritures du navigateur
      // sans preuve : un refus d'accès affichait quand même un succès.
      const { data, error } = await invokeEdgeFunction('process-sequences', {
        action: 'mark_replied',
        enrollment_id: enrollmentId,
      });
      const payload = data as { success?: boolean; changed?: boolean; message?: string; warning?: string; stopped_siblings?: number } | null;
      if (error || !payload?.success) {
        throw new Error(payload?.message || error?.message || 'Réessayez dans un instant.');
      }
      // Contrat §8 : les autres inscriptions du candidat sont arrêtées comme
      // pour une réponse détectée ; le bilan le dit.
      const siblings = typeof payload.stopped_siblings === 'number' ? payload.stopped_siblings : 0;
      const siblingsNotice = siblings > 0
        ? ` ${siblings > 1 ? `Ses ${siblings} autres séquences en cours ou en pause ont été arrêtées.` : 'Son autre séquence en cours ou en pause a été arrêtée.'}`
        : '';
      if (payload.changed && payload.warning) {
        toast.warning(`Réponse enregistrée pour ${name}`, { description: `${payload.warning}${siblingsNotice}` });
      } else if (payload.changed) {
        toast.success(`Réponse enregistrée pour ${name}`, {
          description: `Les étapes restantes ont été annulées.${siblingsNotice}`,
        });
      } else {
        toast.info(`Rien n’a changé : la séquence de ${name} était déjà close.`);
      }
    } catch (err) {
      console.error('[EnrollmentsPanel] markReplied failed:', err);
      toast.error(`La réponse n’a pas pu être enregistrée pour ${name}`, {
        description: err instanceof Error ? err.message : undefined,
      });
    }
    await fetchEnrollments();
  };

  return { stopEnrollment, pauseEnrollments, bulkStopActive, bulkResumePaused, skipStep, markReplied };
}
