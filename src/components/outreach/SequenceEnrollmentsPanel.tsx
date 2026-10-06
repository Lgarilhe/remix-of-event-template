import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useUndoableEnrollmentAction } from '@/hooks/useUndoableEnrollmentAction';
import {
  formatSequenceError as formatErrorMessage,
  formatSkipReason,
  executionStatusLabel,
  isSentExecutionStatus,
  actionTypeLabel,
  isHiddenActionType,
  isAiReviewPending,
  scheduledExecutionError,
  STOP_FAILED_MESSAGE,
  summarizeResumeResponse,
  type ResumeResponse,
} from '@/lib/sequenceErrorMessages';
import { EditScheduledMessageModal } from './activity-log/EditScheduledMessageModal';
import { ENROLLMENT_STATUSES, executionStatusMeta, formatStepDelay, type StatusTone } from '@/lib/sequenceCatalog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, StatGrid, StatTile } from '@/components/layout';
import { SequenceActionIcon } from './SequenceBadges';
import {
  Users,
  ExternalLink,
  MoreHorizontal,
  StopCircle,
  XCircle,
  Play,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  Clock,
  Search,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/plural';
import {
  MANUAL_STOP_HELP,
  RELAUNCH_AFTER_STOP_LABEL,
  SEQUENCE_LEVEL_PAUSE_REASONS,
  STOP_FOR_CANDIDATE_LABEL,
  enrollmentStatusLabel,
  hasManualStopTrace,
  manualStopLabel,
  readManualStopFromTracking,
  pausedLabel,
  pauseReasonHint,
} from '@/lib/sequenceLabels';
import {
  BULK_RESUME_PAUSE_REASONS,
  createEnrollmentActions,
  EXECUTION_PAGE_SIZE,
  isDoneStatus,
  isGdprErased,
  resumeRetriesFailedStep,
  type Enrollment,
  type StepExecution,
} from '@/lib/sequenceActions';

interface SequenceEnrollmentsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sequenceId: string;
  sequenceName: string;
}


// Apparence d'une inscription par statut : le ton de badge du catalogue
// (src/lib/sequenceCatalog.ts), la même peinture sur tous les écrans. Les
// libellés viennent de src/lib/sequenceLabels.ts (enrollmentStatusLabel,
// pausedLabel) : un statut inconnu s'affiche « Statut inconnu », jamais « En cours ».
const statusStyle: Record<string, { tone: StatusTone }> = Object.fromEntries(
  Object.entries(ENROLLMENT_STATUSES).map(([status, meta]) => [status, { tone: meta.tone }]),
);
const NEUTRAL_STATUS_STYLE: { tone: StatusTone } = { tone: 'muted' };


/** Raisons de pause qu'un « Reprendre » individuel peut lever (les autres ont leur propre action). */
const RESUMABLE_PAUSE_REASONS = new Set<string>(['manual', 'send_failed']);

/**
 * Pause « échec d'envoi » sans échec à montrer : le moteur en donne la cause
 * dans tracking_data.pause_reason (ex. relation LinkedIn du candidat inconnue
 * après « Vérifier la connexion » ; la reprise relance la vérification).
 * Une étape en échec l'emporte : c'est elle qu'il faut consulter (le texte peut
 * rester d'une pause précédente, la reprise ne l'efface pas).
 */
const sendFailedDetail = (enrollment: Enrollment): string | null => {
  if (enrollment.status !== 'paused' || enrollment.pause_reason !== 'send_failed') return null;
  if ((enrollment.executions || []).some(e => e.status === 'failed')) return null;
  const tracking = enrollment.tracking_data;
  if (!tracking || typeof tracking !== 'object' || Array.isArray(tracking)) return null;
  const text = (tracking as Record<string, unknown>).pause_reason;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
};

/** Pause posée par la séquence (désactivation, auto-pause) : levée par la réactivation. */
const isSequenceLevelPause = (reason: string | null | undefined): boolean =>
  SEQUENCE_LEVEL_PAUSE_REASONS.some(r => r === reason);
/**
 * Pause de séquence restée en place alors que la séquence est de nouveau active
 * (reprise en échec, compte non relié à la réactivation...) : l'aide « Réactivez
 * la séquence » serait fausse, le candidat se reprend un par un ou avec les autres.
 */
const SEQUENCE_ACTIVE_AGAIN_HINT = 'La séquence est de nouveau active : reprenez ce candidat.';
/**
 * D3 : un collaborateur ne reprend que les candidats qu'il a inscrits (le
 * serveur refuse les autres) : « Reprendre » lui est masqué et on dit qui peut.
 */
const OTHER_MEMBER_RESUME_HINT = 'Candidat inscrit par un autre membre : un administrateur ou ce membre peut reprendre sa séquence.';

/** « Arrêter » groupé : 200 inscriptions au plus par demande (stop_enrollments). */
const BULK_STOP_MAX = 200;

const GDPR_ERASED_NOTICE = 'Ce candidat a demandé l’effacement de ses données : il ne peut plus être relancé.';

const executionLabel = (status: string) => (status === 'pending' ? 'À venir' : executionStatusLabel(status));

/** « 26/09 à 10:42 » */
const formatWhen = (value: string) => format(new Date(value), "dd/MM 'à' HH:mm", { locale: fr });

// Exécutions chargées par lots d'inscriptions : une seule requête pour 200
// inscriptions dépassait la limite de 1 000 lignes de l'API, et les étapes
// les plus avancées disparaissaient (« À venir » sur une étape envoyée).
const EXECUTION_BATCH_SIZE = 50;

interface SequenceStep {
  id: string;
  step_order: number;
  action_type: string;
  message_template: string | null;
  subject_template: string | null;
  delay_days: number;
  delay_hours: number;
  delay_minutes?: number | null;
  timeout_days?: number | null;
  timeout_branch_step_id?: string | null;
  if_true_goto_step?: string | null;
  if_false_goto_step?: string | null;
  wait_for_event?: string | null;
}

export const SequenceEnrollmentsPanel: React.FC<SequenceEnrollmentsPanelProps> = ({
  isOpen,
  onClose,
  sequenceId,
  sequenceName,
}) => {
  const PAGE_SIZE = 200;
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedEnrollments, setExpandedEnrollments] = useState<Set<string>>(new Set());
  const [allSteps, setAllSteps] = useState<SequenceStep[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  // Lot 5b : la pause (un candidat ou tous) et l'arrêt partent sans fenêtre,
  // avec « Annuler » dans un toast ; les autres gestes gardent leur confirmation.
  const [confirmAction, setConfirmAction] = useState<{ type: 'bulkResume' | 'resume' | 'markReplied' | 'reEnroll' | 'skipStep'; id?: string; stepId?: string } | null>(null);
  // Compteurs de la séquence entière, lus en base (la liste n'en charge que
  // 200 à la fois). null tant qu'ils ne sont pas connus. `resumable` : en
  // pause pour une raison que « Reprendre tous les candidats en pause » lève.
  const [statusCounts, setStatusCounts] = useState<{ active: number; paused: number; done: number; resumable: number } | null>(null);
  // État de la séquence, relu à chaque chargement : une pause de séquence
  // (désactivation, auto-pause) ne se reprend que si elle est de nouveau active.
  // null tant qu'il n'est pas connu (aucune reprise de ce type proposée).
  const [sequenceActive, setSequenceActive] = useState<boolean | null>(null);
  const [bulkResuming, setBulkResuming] = useState(false);
  // Pause ou arrêt groupé en cours : boutons de la barre désactivés.
  const [bulkBusy, setBulkBusy] = useState<'pause' | 'stop' | null>(null);
  // D3 : un collaborateur ne met en pause ni ne reprend que ses propres
  // inscriptions (RLS, serveur) : les actions groupées ne lui sont pas proposées.
  const { isCollaborator } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  // Lot 5b : gestes immédiats avec « Annuler », et nom de l'auteur d'un arrêt.
  const { offerUndoPause, stopEnrollments } = useUndoableEnrollmentAction();
  const { members } = useTeamMembers();
  // Échec du dernier chargement complet (message technique, montré replié) :
  // affiché avec « Réessayer » au lieu de « Aucun candidat inscrit ».
  const [loadError, setLoadError] = useState<string | null>(null);
  // Lot 5a-2 : « Relire le message » d'une étape rédigée par l'IA reportée par
  // le moteur. Seule écriture : final_message (et final_subject) de cette
  // étape encore programmée, par EditScheduledMessageModal.
  const [reviewing, setReviewing] = useState<{ exec: StepExecution; profileName: string | null } | null>(null);

  const fetchStatusCounts = async () => {
    const countFor = (statuses: string[]) => supabase
      .from('sequence_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('sequence_id', sequenceId)
      .in('status', statuses);
    const [activeRes, pausedRes, doneRes, resumableRes] = await Promise.all([
      countFor(['active']),
      countFor(['paused']),
      countFor(['completed', 'replied']),
      countFor(['paused']).in('pause_reason', BULK_RESUME_PAUSE_REASONS),
    ]);
    if (activeRes.error || pausedRes.error || doneRes.error || resumableRes.error) {
      console.error('Error counting enrollments:', activeRes.error || pausedRes.error || doneRes.error || resumableRes.error);
      setStatusCounts(null);
      return;
    }
    setStatusCounts({
      active: activeRes.count ?? 0,
      paused: pausedRes.count ?? 0,
      done: doneRes.count ?? 0,
      resumable: resumableRes.count ?? 0,
    });
  };

  const fetchSequenceActive = async () => {
    const { data, error } = await supabase
      .from('outreach_sequences')
      .select('is_active')
      .eq('id', sequenceId)
      .maybeSingle();
    if (error) console.error('Error reading sequence state:', error);
    setSequenceActive(error || !data ? null : !!data.is_active);
  };

  // Exécutions des inscriptions affichées, par lots (voir EXECUTION_BATCH_SIZE)
  // et paginées dans chaque lot : aucune étape n'est perdue au-delà de
  // 1 000 lignes. Une erreur remonte au lieu d'afficher des étapes « À venir ».
  const fetchExecutionsFor = async (enrollmentIds: string[]) => {
    const batches: string[][] = [];
    for (let i = 0; i < enrollmentIds.length; i += EXECUTION_BATCH_SIZE) {
      batches.push(enrollmentIds.slice(i, i + EXECUTION_BATCH_SIZE));
    }
    const perBatch = await Promise.all(batches.map(async (batch) => {
      const rows: Tables<'sequence_step_executions'>[] = [];
      for (let from = 0; ; from += EXECUTION_PAGE_SIZE) {
        const { data, error } = await supabase
          .from('sequence_step_executions')
          .select('*')
          .in('enrollment_id', batch)
          .order('step_order', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + EXECUTION_PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < EXECUTION_PAGE_SIZE) break;
      }
      return rows;
    }));
    return perBatch.flat();
  };

  const fetchEnrollments = async (append = false) => {
    try {
      if (append) setLoadingMore(true);
      else setLoading(true);

      // Étapes de la séquence d'abord (parcours complet). En « Charger plus »,
      // on réutilise celles déjà chargées.
      let stepsLookup = allSteps;
      if (!append) {
        const { data: stepsData, error: stepsError } = await supabase
          .from('sequence_steps')
          .select('id, action_type, message_template, subject_template, step_order, delay_days, delay_hours, delay_minutes, timeout_days, timeout_branch_step_id, if_true_goto_step, if_false_goto_step, wait_for_event')
          .eq('sequence_id', sequenceId)
          .order('step_order', { ascending: true });
        if (stepsError) throw stepsError;
        stepsLookup = stepsData || [];
        setAllSteps(stepsLookup);

        // Nombre total d'inscrits (pagination), compteurs par statut et état
        // de la séquence.
        const [{ count }] = await Promise.all([
          supabase
            .from('sequence_enrollments')
            .select('id', { count: 'exact', head: true })
            .eq('sequence_id', sequenceId),
          fetchStatusCounts(),
          fetchSequenceActive(),
        ]);
        setTotalCount(count || 0);
      }

      // Inscriptions paginées (200 par page)
      const offset = append ? enrollments.length : 0;
      const { data: enrollData, error: enrollError } = await supabase
        .from('sequence_enrollments')
        .select('*')
        .eq('sequence_id', sequenceId)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (enrollError) throw enrollError;

      setHasMore((enrollData?.length || 0) === PAGE_SIZE);

      const execData = await fetchExecutionsFor(enrollData?.map(e => e.id) || []);

      // Rattache les exécutions à leur inscription (étapes résolues plus haut)
      const enriched = (enrollData || []).map(enrollment => ({
        ...enrollment,
        executions: execData
          .filter(e => e.enrollment_id === enrollment.id)
          .map(exec => ({
            ...exec,
            step: stepsLookup.find(s => s.id === exec.step_id),
          })),
      }));

      setEnrollments(prev => append ? [...prev, ...enriched] : enriched);
      setLoadError(null);
    } catch (err) {
      console.error('Error fetching enrollments:', err);
      if (!append) setLoadError(err instanceof Error ? err.message : String(err));
      toast.error('Impossible de charger les inscrits. Vérifiez votre connexion puis réessayez.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (isOpen && sequenceId) {
      fetchEnrollments();
    }
  }, [isOpen, sequenceId]);

  const toggleExpanded = (enrollmentId: string) => {
    setExpandedEnrollments(prev => {
      const next = new Set(prev);
      if (next.has(enrollmentId)) {
        next.delete(enrollmentId);
      } else {
        next.add(enrollmentId);
      }
      return next;
    });
  };

  // « Voir l'erreur » : déplie le parcours du candidat, où l'étape en échec
  // affiche son erreur.
  const showEnrollmentDetail = (enrollmentId: string) => {
    setExpandedEnrollments(prev => new Set(prev).add(enrollmentId));
  };

  const nameOf = (enrollmentId: string) =>
    enrollments.find(e => e.id === enrollmentId)?.profile_name || 'ce candidat';

  const { stopEnrollment, bulkStopActive, bulkResumePaused, skipStep, markReplied } = createEnrollmentActions({
    supabase, invokeEdgeFunction, toast, sequenceId, nameOf,
    fetchEnrollments, fetchStatusCounts, setEnrollments, offerUndoPause, setBulkResuming,
  });

  // Reprise et relance passent par le serveur : il retrouve l'étape à
  // reprendre sans jamais rejouer une action déjà envoyée, garde la date des
  // étapes en attente (au plus tôt dans une minute) et refuse un compte
  // LinkedIn qui n'est plus relié. Avant, le navigateur réarmait à l'aveugle la
  // première exécution annulée : renvoi d'un message déjà reçu, relance future
  // envoyée tout de suite, ou reprise sans effet.
  const callResumeAction = async (action: 'resume_enrollments' | 're_enroll', enrollmentId: string) => {
    const { data, error } = await invokeEdgeFunction('process-sequences', {
      action,
      enrollment_ids: [enrollmentId],
    });
    const payload = data as ResumeResponse | null;
    if (error || !payload?.success) {
      throw new Error(payload?.message || error?.message || 'Réessayez dans un instant.');
    }
    const result = payload.results?.find(r => r.enrollment_id === enrollmentId);
    if (!result) throw new Error('Le résultat n’a pas pu être lu. Actualisez la liste.');
    return { result, payload };
  };

  const resumeEnrollment = async (enrollmentId: string) => {
    const name = nameOf(enrollmentId);
    try {
      // Même bilan que la fiche candidat et la liste de la mission (message
      // selon le résultat réel : reprise, rien à reprendre, compte non relié,
      // séquence désactivée…).
      const { payload } = await callResumeAction('resume_enrollments', enrollmentId);
      const summary = summarizeResumeResponse(payload, name);
      if (summary.tone === 'success') toast.success(summary.message);
      else if (summary.tone === 'info') toast.info(summary.message);
      else toast.error(summary.message);
    } catch (error) {
      console.error('Error resuming enrollment:', error);
      toast.error(`La séquence n’a pas pu reprendre pour ${name}`, {
        description: error instanceof Error ? error.message : undefined,
      });
    }
    await fetchEnrollments();
  };

  // « Arrêter pour ce candidat » (lot 5b) : clôture serveur (stop_enrollments),
  // sans fenêtre, avec « Annuler » pendant que le toast est affiché.
  const stopForCandidate = async (enrollmentId: string) => {
    const name = enrollments.find(e => e.id === enrollmentId)?.profile_name || null;
    await stopEnrollments({
      enrollmentIds: [enrollmentId],
      candidateName: name,
      onSettled: () => fetchEnrollments(),
    });
  };

  // « Arrêter » groupé (lot 5b) : candidats en cours ou en pause de toute la
  // séquence, lus en base, 200 au plus par demande. Réservé aux membres qui
  // gèrent toutes les inscriptions (le bouton est masqué au collaborateur).
  const bulkManualStop = async () => {
    try {
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .select('id')
        .eq('sequence_id', sequenceId)
        .in('status', ['active', 'paused'])
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(BULK_STOP_MAX + 1);
      if (error) throw error;
      const ids = (data ?? []).map(row => row.id);
      if (ids.length === 0) {
        toast.info('Aucun candidat n’était en cours ni en pause.');
        await fetchEnrollments();
        return;
      }
      if (ids.length > BULK_STOP_MAX) {
        toast.info(`Arrêt groupé limité à ${BULK_STOP_MAX} candidats`, {
          description: 'Mettez plutôt la séquence en pause, ou arrêtez les candidats un par un.',
        });
        return;
      }
      await stopEnrollments({ enrollmentIds: ids, onSettled: () => fetchEnrollments() });
    } catch (error) {
      console.error('Error bulk stopping:', error);
      toast.error(STOP_FAILED_MESSAGE, {
        action: { label: 'Réessayer', onClick: () => { void runBulk('stop', bulkManualStop); } },
      });
    }
  };

  // Pause ou arrêt groupé : les boutons de la barre attendent la fin du geste.
  const runBulk = async (kind: 'pause' | 'stop', action: () => Promise<void>) => {
    setBulkBusy(kind);
    try {
      await action();
    } finally {
      setBulkBusy(null);
    }
  };

  const reEnroll = async (enrollmentId: string) => {
    const name = nameOf(enrollmentId);
    try {
      const { result } = await callResumeAction('re_enroll', enrollmentId);
      if (result.outcome === 'resumed') {
        // Pas de délai promis : le serveur réarme une étape à sa date prévue ou
        // programme la suivante selon son délai (parfois plusieurs jours).
        toast.success(`Séquence relancée pour ${name}`, {
          description: 'La prochaine action est programmée selon les délais de la séquence, pendant vos heures d’envoi.',
        });
      } else if (result.outcome === 'nothing_to_resume') {
        toast.info(`Rien à relancer : cette séquence est terminée pour ${name}`);
      } else if (result.outcome === 'account_unlinked') {
        toast.error('Ce compte LinkedIn n’est plus relié. Reliez-le avant de relancer la séquence.');
      } else {
        toast.error(`La séquence n’a pas pu être relancée pour ${name}`, { description: result.message });
      }
    } catch (err) {
      console.error('[EnrollmentsPanel] reEnroll failed:', err);
      toast.error(`La séquence n’a pas pu être relancée pour ${name}`, {
        description: err instanceof Error ? err.message : undefined,
      });
    }
    await fetchEnrollments();
  };

  // Estimation de la prochaine action visible pour le dialogue « Relancer » :
  // l'étape visible qui suit la dernière étape terminée (une étape annulée par
  // la réponse n'est pas réarmée par le serveur, qui programme la suite). Les
  // attentes intermédiaires sont masquées : c'est une estimation, sans date.
  // null si aucune étape visible ne reste.
  const nextActionLabel = (enrollment: Enrollment | undefined): string | null => {
    if (!enrollment) return null;
    const executions = enrollment.executions || [];
    const doneOrders = executions.filter(e => isDoneStatus(e.status)).map(e => e.step_order);
    const lastDone = doneOrders.length > 0 ? Math.max(...doneOrders) : -1;
    const actionType = allSteps.find(s => s.step_order > lastDone && !isHiddenActionType(s.action_type))?.action_type;
    return actionType ? actionTypeLabel(actionType) : null;
  };

  const handleConfirmedAction = async () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'resume' && confirmAction.id) {
      await resumeEnrollment(confirmAction.id);
    } else if (confirmAction.type === 'bulkResume') {
      await bulkResumePaused();
    } else if (confirmAction.type === 'markReplied' && confirmAction.id) {
      await markReplied(confirmAction.id);
    } else if (confirmAction.type === 'reEnroll' && confirmAction.id) {
      await reEnroll(confirmAction.id);
    } else if (confirmAction.type === 'skipStep' && confirmAction.stepId) {
      await skipStep(confirmAction.stepId);
    }
    setConfirmAction(null);
  };

  // Compteurs de la séquence entière quand ils sont connus, sinon ceux de la
  // page chargée.
  const activeCount = statusCounts?.active ?? enrollments.filter(e => e.status === 'active').length;
  const pausedCount = statusCounts?.paused ?? enrollments.filter(e => e.status === 'paused').length;
  const completedCount = statusCounts?.done ?? enrollments.filter(e => ['completed', 'replied'].includes(e.status)).length;

  // Actions arrivées à échéance pour des candidats en cours : le moteur les
  // prend au prochain passage (pas de bouton d'accélération ici). Celles d'un
  // candidat en pause ne partent pas tant qu'il n'est pas repris.
  const pendingExecutions = enrollments
    .filter(e => e.status === 'active')
    .flatMap(e => e.executions || [])
    .filter(exec => exec.status === 'scheduled' && new Date(exec.scheduled_at) < new Date());

  // D3 : pause, arrêt et reprise groupés pour les seuls membres qui gèrent toutes les inscriptions.
  const canBulkManage = !isCollaborator;
  const bulkResumableCount = statusCounts?.resumable ?? 0;
  // « Arrêter » groupé : candidats en cours ou en pause (compteurs de la séquence entière).
  const stoppableCount = activeCount + pausedCount;
  // Auteur d'un arrêt manuel : nom du membre, « vous » pour soi-même sans nom connu.
  const memberName = (memberId: string | null): string | null => {
    if (!memberId) return null;
    const member = members.find(m => m.userId === memberId);
    return member?.displayName || member?.email || (memberId === userId ? 'vous' : null);
  };

  const confirmEnrollment = confirmAction?.id ? enrollments.find(e => e.id === confirmAction.id) : undefined;
  const confirmName = confirmEnrollment?.profile_name || 'ce candidat';
  const confirmNextAction = confirmAction?.type === 'reEnroll' ? nextActionLabel(confirmEnrollment) : null;
  // « Relancer la séquence » après un arrêt manuel : l'étape annulée par l'arrêt est réarmée.
  const confirmManualStop = confirmEnrollment ? readManualStopFromTracking(confirmEnrollment.status, confirmEnrollment.tracking_data) : null;
  // « Reprendre » d'une pause pour échec d'envoi : c'est l'étape en échec qui repart.
  const confirmRetriesFailedStep = confirmAction?.type === 'resume' && !!confirmEnrollment && resumeRetriesFailedStep(confirmEnrollment);


  const query = searchQuery.toLowerCase().trim();
  const filtered = query
    ? enrollments.filter(e =>
        (e.profile_name || '').toLowerCase().includes(query) ||
        (e.profile_headline || '').toLowerCase().includes(query)
      )
    : enrollments;

  // Étapes affichées dans le parcours : les étapes internes (attentes, conditions) sont masquées.
  const visibleSteps = allSteps.filter(s => !isHiddenActionType(s.action_type));

  const description = loading
    ? 'Chargement des inscriptions…'
    : loadError
      ? 'Inscriptions indisponibles'
      : totalCount === 0
        ? 'Aucun candidat inscrit'
        : plural(totalCount, 'candidat inscrit', 'candidats inscrits');

  return (
    <>
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-5 pr-14 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="eyebrow">Inscriptions</p>
              <SheetTitle className="break-words">{sequenceName}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 max-md:h-11 max-md:w-11"
                  onClick={() => { void fetchEnrollments(); }}
                  disabled={loading || loadingMore}
                  aria-label="Actualiser la liste des inscrits"
                >
                  <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Actualiser</TooltipContent>
            </Tooltip>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {loading ? (
            <EnrollmentsSkeleton />
          ) : loadError && enrollments.length === 0 ? (
            <ErrorState
              title="Impossible de charger les inscriptions"
              description="Vérifiez votre connexion, puis réessayez."
              detail={loadError}
              onRetry={() => { void fetchEnrollments(); }}
            />
          ) : enrollments.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Aucun candidat inscrit"
              description="Inscrivez des candidats depuis la recherche ou la messagerie : leur progression dans la séquence s'affichera ici."
            />
          ) : (
            <>
              {/* Information : actions échues en attente du prochain passage (pas de bouton d'accélération ici) */}
              {pendingExecutions.length > 0 && (
                <div role="status" className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <p className="text-sm text-foreground">
                    {pendingExecutions.length > 1
                      ? `${pendingExecutions.length} actions en attente d’envoi. Elles partiront au prochain passage, pendant vos heures d’envoi.`
                      : '1 action en attente d’envoi. Elle partira au prochain passage, pendant vos heures d’envoi.'}
                  </p>
                </div>
              )}

              <StatGrid cols={{ base: 3 }}>
                <StatTile label="En cours" value={activeCount} />
                <StatTile label="En pause" value={pausedCount} />
                <StatTile label="Terminées" value={completedCount} />
              </StatGrid>

              {/* Actions groupées : réservées à ceux qui gèrent toutes les
                  inscriptions (D3, un collaborateur n'agit que sur les siennes). */}
              {canBulkManage && (activeCount > 0 || stoppableCount > 0 || (sequenceActive === true && bulkResumableCount > 0)) && (
                <div className="flex flex-wrap justify-end gap-2">
                  {/* Lot 5b : pause immédiate, « Annuler » dans le toast. */}
                  {canBulkManage && activeCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { void runBulk('pause', bulkStopActive); }}
                      loading={bulkBusy === 'pause'}
                      disabled={bulkBusy !== null}
                      className="text-muted-foreground hover:text-danger max-md:h-11 max-md:w-full"
                    >
                      {bulkBusy !== 'pause' && <StopCircle aria-hidden="true" />}
                      {statusCounts
                        ? `Mettre en pause tous les candidats actifs (${statusCounts.active})`
                        : 'Mettre en pause tous les candidats actifs'}
                    </Button>
                  )}
                  {/* Lot 5b : arrêt groupé (200 au plus), « Annuler » dans le toast. */}
                  {canBulkManage && stoppableCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { void runBulk('stop', bulkManualStop); }}
                      loading={bulkBusy === 'stop'}
                      disabled={bulkBusy !== null}
                      className="text-muted-foreground hover:text-danger max-md:h-11 max-md:w-full"
                    >
                      {bulkBusy !== 'stop' && <XCircle aria-hidden="true" />}
                      {`Arrêter (${stoppableCount})`}
                    </Button>
                  )}
                  {/* D6 : reprise groupée, seulement quand la séquence est active (le
                      serveur refuse la reprise d'une séquence désactivée). */}
                  {canBulkManage && sequenceActive === true && bulkResumableCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmAction({ type: 'bulkResume' })}
                      loading={bulkResuming}
                      className="max-md:h-11 max-md:w-full"
                    >
                      {!bulkResuming && <Play aria-hidden="true" />}
                      {bulkResuming ? 'Reprise en cours…' : `Reprendre tous les candidats en pause (${bulkResumableCount})`}
                    </Button>
                  )}
                </div>
              )}

              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  aria-label="Rechercher un candidat"
                  placeholder="Rechercher un candidat"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>

              {filtered.length === 0 ? (
                <EmptyState
                  variant="compact"
                  icon={Search}
                  title={`Aucun candidat ne correspond à « ${searchQuery.trim()} »`}
                  description="Cherchez par nom ou par intitulé de poste."
                  action={
                    <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')}>
                      Effacer la recherche
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-2" aria-label="Candidats inscrits">
                  {filtered.map((enrollment) => {
                    const status = statusStyle[enrollment.status] || NEUTRAL_STATUS_STYLE;
                    // Lot 5b : « Arrêtée par Guillaume Martin le 29/09 » pour un arrêt manuel.
                    const manualStop = readManualStopFromTracking(enrollment.status, enrollment.tracking_data);
                    const statusLabel = manualStop
                      ? manualStopLabel(manualStop, memberName(manualStop.by))
                      : enrollment.status === 'paused'
                        ? pausedLabel(enrollment.pause_reason)
                        : enrollmentStatusLabel(enrollment.status);
                    const isExpanded = expandedEnrollments.has(enrollment.id);
                    const executions = enrollment.executions || [];
                    const name = enrollment.profile_name || 'Candidat';
                    const pauseDetail = sendFailedDetail(enrollment);
                    // D5 : effacement RGPD, ni reprise ni relance.
                    const gdprErased = isGdprErased(enrollment);
                    // Pause de séquence restée alors que la séquence est active : se reprend ici.
                    const sequencePauseResumable = enrollment.status === 'paused'
                      && isSequenceLevelPause(enrollment.pause_reason)
                      && sequenceActive === true;
                    // D3 : même règle que le serveur (canActOnEnrollment), un
                    // collaborateur n'agit que sur les candidats qu'il a inscrits.
                    const ownRow = !isCollaborator || (!!userId && enrollment.created_by === userId);
                    const canResume = enrollment.status === 'paused' && !gdprErased && ownRow
                      && (!enrollment.pause_reason || RESUMABLE_PAUSE_REASONS.has(enrollment.pause_reason) || sequencePauseResumable);
                    // Reprise possible, mais par un administrateur ou le membre qui l'a inscrit.
                    const resumeReservedToOthers = !ownRow && enrollment.status === 'paused' && !gdprErased
                      && (!enrollment.pause_reason || RESUMABLE_PAUSE_REASONS.has(enrollment.pause_reason) || sequencePauseResumable);
                    const retriesFailedStep = resumeRetriesFailedStep(enrollment);
                    const pauseHint = gdprErased
                      ? GDPR_ERASED_NOTICE
                      : resumeReservedToOthers && !pauseDetail
                        ? OTHER_MEMBER_RESUME_HINT
                        : enrollment.status === 'paused'
                          ? (pauseDetail ?? (sequencePauseResumable ? SEQUENCE_ACTIVE_AGAIN_HINT : pauseReasonHint(enrollment.pause_reason)))
                          : null;

                    // Prochaine étape programmée et dernière étape partie (étapes internes masquées).
                    const shownExecutions = executions.filter(e => !isHiddenActionType(e.step?.action_type));
                    const nextScheduled = shownExecutions
                      .filter(e => e.status === 'scheduled')
                      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];
                    const lastExecuted = shownExecutions
                      .filter(e => isSentExecutionStatus(e.status) && e.executed_at)
                      .sort((a, b) => new Date(b.executed_at!).getTime() - new Date(a.executed_at!).getTime())[0];

                    return (
                      <li key={enrollment.id}>
                        <Collapsible
                          open={isExpanded}
                          onOpenChange={() => toggleExpanded(enrollment.id)}
                          className="rounded-xl border border-border bg-card"
                        >
                          <div className="p-2">
                            <div className="flex items-start gap-1">
                              <CollapsibleTrigger className="flex min-w-0 flex-1 items-start gap-2 rounded-lg p-1.5 text-left transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <ChevronRight
                                  className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150', isExpanded && 'rotate-90')}
                                  aria-hidden="true"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-foreground">{name}</p>
                                  {enrollment.profile_headline && (
                                    <p className="truncate text-xs text-muted-foreground">{enrollment.profile_headline}</p>
                                  )}
                                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <Badge variant={status.tone}>{statusLabel}</Badge>
                                    {lastExecuted && (
                                      <span className="text-xs text-muted-foreground">
                                        Dernière étape le {formatWhen(lastExecuted.executed_at!)}
                                      </span>
                                    )}
                                    {nextScheduled && (
                                      <span className="text-xs text-muted-foreground">
                                        Prochaine : {actionTypeLabel(nextScheduled.step?.action_type)}, le {formatWhen(nextScheduled.scheduled_at)}
                                      </span>
                                    )}
                                    {!nextScheduled && !lastExecuted && (
                                      <span className="text-xs text-muted-foreground">
                                        {shownExecutions.length === 0 ? 'Aucune étape planifiée' : 'Aucune étape envoyée'}
                                      </span>
                                    )}
                                  </div>
                                  {pauseHint && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {pauseHint}
                                    </p>
                                  )}
                                </div>
                              </CollapsibleTrigger>

                              {enrollment.profile_url && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" asChild className="shrink-0 max-md:h-11 max-md:w-11">
                                      <a
                                        href={enrollment.profile_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label={`Voir le profil LinkedIn de ${enrollment.profile_name || 'ce candidat'}`}
                                      >
                                        <ExternalLink aria-hidden="true" />
                                      </a>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Voir sur LinkedIn</TooltipContent>
                                </Tooltip>
                              )}

                              {/* Actions menu */}
                              <DropdownMenu modal={false}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        className="shrink-0 max-md:h-11 max-md:w-11"
                                        aria-label={`Actions pour ${enrollment.profile_name || 'ce candidat'}`}
                                      >
                                        <MoreHorizontal aria-hidden="true" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                  </TooltipTrigger>
                                  <TooltipContent>Actions</TooltipContent>
                                </Tooltip>
                                <DropdownMenuContent align="end">
                                  {/* D3 : sur la ligne d'un candidat inscrit par un autre membre, un
                                      collaborateur ne voit que les liens de consultation : le
                                      serveur et la base refuseraient ces actions. */}
                                  {enrollment.status === 'active' && ownRow ? (
                                    <DropdownMenuItem
                                      onClick={() => { void stopEnrollment(enrollment.id); }}
                                    >
                                      <StopCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                                      Mettre en pause pour ce candidat
                                    </DropdownMenuItem>
                                  ) : enrollment.status === 'paused' ? (
                                    <>
                                      {/* Chaque raison de pause propose l'action qui débloque :
                                          « Reprendre » seul relançait le moteur, qui remettait
                                          en pause au passage suivant. */}
                                      {enrollment.pause_reason === 'account_disconnected' && (
                                        <DropdownMenuItem asChild>
                                          <Link to="/settings/account/connections">
                                            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                                            Reconnecter le compte
                                          </Link>
                                        </DropdownMenuItem>
                                      )}
                                      {enrollment.pause_reason === 'subscription_required' && (
                                        <DropdownMenuItem asChild>
                                          <Link to="/pricing">
                                            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                                            Voir les offres
                                          </Link>
                                        </DropdownMenuItem>
                                      )}
                                      {enrollment.pause_reason === 'send_failed' && !pauseDetail && (
                                        <DropdownMenuItem onClick={() => showEnrollmentDetail(enrollment.id)}>
                                          <AlertCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                                          Voir l'erreur
                                        </DropdownMenuItem>
                                      )}
                                      {canResume && (
                                        <DropdownMenuItem
                                          onClick={() => setConfirmAction({ type: 'resume', id: enrollment.id })}
                                        >
                                          <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                                          {/* Sans étape en attente, le serveur replanifie l'étape en échec elle-même. */}
                                          {retriesFailedStep ? 'Réessayer l’étape en échec' : 'Reprendre la séquence'}
                                        </DropdownMenuItem>
                                      )}
                                    </>
                                  ) : null}
                                  {/* Lot 5b : arrêt immédiat, « Annuler » dans le toast ; le
                                      candidat reste compté comme contacté (90 jours). */}
                                  {ownRow && !gdprErased && (enrollment.status === 'active' || enrollment.status === 'paused') && (
                                    <DropdownMenuItem
                                      onClick={() => { void stopForCandidate(enrollment.id); }}
                                      aria-label={STOP_FOR_CANDIDATE_LABEL}
                                      aria-describedby={`stop-help-${enrollment.id}`}
                                      className="items-start"
                                    >
                                      <XCircle className="mr-2 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                      <span className="flex min-w-0 flex-col">
                                        <span>{STOP_FOR_CANDIDATE_LABEL}</span>
                                        <span id={`stop-help-${enrollment.id}`} className="max-w-[15rem] whitespace-normal text-xs text-muted-foreground">
                                          {MANUAL_STOP_HELP}
                                        </span>
                                      </span>
                                    </DropdownMenuItem>
                                  )}
                                  {/* Marquer comme ayant répondu (réponse hors canal :
                                      téléphone, en personne, autre boîte mail). Évite de
                                      continuer à relancer le candidat. */}
                                  {ownRow && (enrollment.status === 'active' || enrollment.status === 'paused' || enrollment.status === 'completed') && (
                                    <DropdownMenuItem
                                      onClick={() => setConfirmAction({ type: 'markReplied', id: enrollment.id })}
                                    >
                                      <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                                      Marquer comme ayant répondu
                                    </DropdownMenuItem>
                                  )}
                                  {/* Relancer : inscription close (réponse, fin, arrêt). Jamais
                                      pour un candidat en pause, qui a « Reprendre », ni après
                                      un effacement RGPD (D5). */}
                                  {ownRow && !gdprErased && (enrollment.status === 'replied' || enrollment.status === 'completed' || enrollment.status === 'cancelled' || enrollment.status === 'stopped') && (
                                    <DropdownMenuItem
                                      onClick={() => setConfirmAction({ type: 'reEnroll', id: enrollment.id })}
                                    >
                                      <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                                      {/* Après un arrêt manuel, la relance reprend l'étape annulée par l'arrêt. */}
                                      {manualStop ? RELAUNCH_AFTER_STOP_LABEL : 'Relancer depuis l’étape suivante'}
                                    </DropdownMenuItem>
                                  )}
                                  {enrollment.profile_url && (
                                    <DropdownMenuItem asChild>
                                      <a
                                        href={enrollment.profile_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                                        Voir sur LinkedIn
                                      </a>
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>

                            {/* Action qui débloque, visible sans ouvrir le menu */}
                            {enrollment.status === 'paused' && ['account_disconnected', 'subscription_required', 'send_failed'].includes(enrollment.pause_reason || '') && !pauseDetail && (
                              <div className="mt-1 pl-8">
                                {enrollment.pause_reason === 'account_disconnected' ? (
                                  <Button asChild variant="outline" size="xs" className="max-md:h-11">
                                    <Link to="/settings/account/connections">Reconnecter le compte</Link>
                                  </Button>
                                ) : enrollment.pause_reason === 'subscription_required' ? (
                                  <Button asChild variant="outline" size="xs" className="max-md:h-11">
                                    <Link to="/pricing">Voir les offres</Link>
                                  </Button>
                                ) : (
                                  <Button variant="outline" size="xs" className="max-md:h-11" onClick={() => showEnrollmentDetail(enrollment.id)}>
                                    <AlertCircle aria-hidden="true" />
                                    Voir l'erreur
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Parcours complet du candidat */}
                          <CollapsibleContent>
                            <div className="border-t border-border px-4 pb-4 pt-3">
                              {visibleSteps.length === 0 ? (
                                <p className="py-2 text-center text-xs text-muted-foreground">
                                  Cette séquence n'a pas encore d'étape.
                                </p>
                              ) : (
                                <>
                                  <p className="eyebrow mb-2">Parcours</p>
                                  <ol className="space-y-2">
                                    {visibleSteps.map((step) => {
                                      // Exécution de cette étape, si elle existe
                                      const exec = executions.find(e => e.step_id === step.id);
                                      // Statut : celui de l'exécution, ou « À venir » tant qu'elle n'est pas programmée
                                      const status = exec?.status || 'pending';
                                      const isPending = status === 'pending';
                                      const isSkipped = status === 'skipped';
                                      const isSent = isSentExecutionStatus(status);
                                      const isChannelSkip = isSkipped && exec?.skip_reason?.toLowerCase().includes('channel');
                                      const delay = formatStepDelay(step.delay_days, step.delay_hours, step.delay_minutes);

                                      return (
                                        <li
                                          key={step.id}
                                          className={cn('flex items-start gap-3 rounded-lg border border-border p-2.5', isChannelSkip && 'opacity-60')}
                                        >
                                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                                            <SequenceActionIcon type={step.action_type} />
                                          </span>
                                          <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                              <span className={cn('text-sm font-medium', isPending ? 'text-foreground-secondary' : 'text-foreground')}>
                                                {actionTypeLabel(step.action_type)}
                                              </span>
                                              <Badge variant={executionStatusMeta(status).tone}>{executionLabel(status)}</Badge>
                                              {/* Délai d'une étape pas encore programmée */}
                                              {isPending && delay && (
                                                <span className="text-xs text-muted-foreground">Délai {delay}</span>
                                              )}
                                            </div>

                                            {/* Dates et raisons, d'après l'exécution */}
                                            {exec && (
                                              <div className="mt-1 space-y-1 text-xs">
                                                {exec.status === 'scheduled' && (
                                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                                    <span className="text-muted-foreground">Prévu : {formatWhen(exec.scheduled_at)}</span>
                                                    {/* Le serveur refuse de sauter l'étape d'un candidat en
                                                        pause ou clos (enrollment_not_active) : bouton masqué. */}
                                                    {enrollment.status === 'active' && ownRow && (
                                                      <Button
                                                        variant="ghost"
                                                        size="xs"
                                                        className="text-muted-foreground max-md:h-11"
                                                        onClick={() => setConfirmAction({ type: 'skipStep', stepId: exec.id })}
                                                        title="Sauter cette étape pour ce candidat"
                                                      >
                                                        Sauter
                                                      </Button>
                                                    )}
                                                  </div>
                                                )}
                                                {exec.status === 'quota_blocked' && (
                                                  <p className="text-muted-foreground">
                                                    Nouvel essai prévu le {formatWhen(exec.scheduled_at)}
                                                  </p>
                                                )}
                                                {/* Raison d'une étape programmée ; celle d'un message IA
                                                    relu depuis le report n'est plus affichée (lot 5a-2). */}
                                                {scheduledExecutionError(exec) && (
                                                  <p className="text-warning">
                                                    {formatErrorMessage(exec.error_message)}
                                                  </p>
                                                )}
                                                {isAiReviewPending(exec) && ownRow && (
                                                  <Button
                                                    variant="outline"
                                                    size="xs"
                                                    className="max-md:h-11"
                                                    onClick={() => setReviewing({ exec, profileName: enrollment.profile_name })}
                                                  >
                                                    <Sparkles aria-hidden="true" />
                                                    Relire le message
                                                  </Button>
                                                )}
                                                {isSent && exec.executed_at && (
                                                  <p className="text-muted-foreground">Envoyée le {formatWhen(exec.executed_at)}</p>
                                                )}
                                                {(exec.status === 'skipped' || exec.status === 'cancelled') && exec.skip_reason && (
                                                  <p className={cn('text-muted-foreground', isChannelSkip && 'italic')}>
                                                    {formatSkipReason(exec.skip_reason, { manualStop: hasManualStopTrace(enrollment.tracking_data) })}
                                                  </p>
                                                )}
                                                {exec.status === 'failed' && exec.error_message && (
                                                  <p className="rounded-md bg-danger-muted px-2.5 py-1.5 text-danger">
                                                    Échec : {formatErrorMessage(exec.error_message)}
                                                  </p>
                                                )}
                                              </div>
                                            )}

                                            {/* Aperçu du message envoyé */}
                                            {isSent && exec?.final_message && (
                                              <div className="mt-2 rounded-md border border-border bg-background p-2.5 text-xs">
                                                {exec.final_subject && (
                                                  <p className="mb-1 font-medium text-foreground">{exec.final_subject}</p>
                                                )}
                                                <p className="line-clamp-2 leading-relaxed text-foreground-secondary">
                                                  {exec.final_message.replace(/\\n|\n/g, ' ')}
                                                </p>
                                              </div>
                                            )}

                                            {/* Modèle d'une étape pas encore programmée */}
                                            {isPending && step.message_template && (
                                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                                Modèle : {step.message_template.replace(/\\n|\n/g, ' ')}
                                              </p>
                                            )}
                                          </div>
                                        </li>
                                      );
                                    })}
                                  </ol>
                                </>
                              )}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </li>
                    );
                  })}
                </ul>
              )}

              {/* Pagination : 200 inscriptions par page */}
              {hasMore && (
                <div className="flex justify-center pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchEnrollments(true)}
                    loading={loadingMore}
                    className="max-md:h-11"
                  >
                    Afficher la suite ({enrollments.length} sur {totalCount})
                  </Button>
                </div>
              )}
              {!hasMore && enrollments.length >= PAGE_SIZE && (
                <p className="text-center text-xs text-muted-foreground">Les {totalCount} candidats sont affichés.</p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>

    <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirmAction?.type === 'bulkResume'
              ? `Reprendre tous les candidats en pause (${bulkResumableCount}) ?`
              : confirmAction?.type === 'markReplied'
                ? `Marquer ${confirmName} comme ayant répondu ?`
                : confirmAction?.type === 'reEnroll'
                  ? `Relancer ${confirmName} ?`
                  : confirmAction?.type === 'resume'
                    ? (confirmRetriesFailedStep
                      ? `Réessayer l’étape en échec pour ${confirmName} ?`
                      : `Reprendre la séquence pour ${confirmName} ?`)
                    : 'Sauter cette étape ?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmAction?.type === 'bulkResume'
                // Pas de délai promis : une étape en attente garde sa date, sinon
                // la suivante est programmée selon son délai (parfois plusieurs jours).
                ? 'Ces candidats, y compris ceux qui ne sont pas affichés, recevront de nouveau les messages de cette séquence. Une étape déjà programmée garde sa date (au plus tôt dans une minute) ; sinon, l’étape suivante est programmée selon son délai habituel, pendant vos heures d’envoi. Les candidats en pause pour une autre raison (compte déconnecté, abonnement, limite d’envoi, échec d’envoi, candidat injoignable) ne sont pas concernés.'
                : confirmAction?.type === 'markReplied'
                  // Contrat §8 : ses autres inscriptions sont arrêtées ; pour une
                  // séquence terminée, seulement celles commencées avant sa fin.
                  ? `${confirmName} passera en « A répondu » et ses étapes restantes seront annulées. ${confirmEnrollment?.status === 'completed'
                    ? 'Ses autres séquences encore en cours ou en pause, commencées avant la fin de celle-ci, seront aussi arrêtées.'
                    : 'Ses autres séquences encore en cours ou en pause seront aussi arrêtées.'} Utile si le candidat a répondu hors de Konekt (téléphone, en personne, etc.).`
                  : confirmAction?.type === 'reEnroll'
                    // Pas de délai promis : le serveur programme l'étape suivante
                    // selon son délai, et les attentes intermédiaires sont masquées.
                    // Après un arrêt manuel, il réarme l'étape annulée par l'arrêt.
                    ? (confirmManualStop
                      ? 'La séquence reprend là où elle a été arrêtée : l’étape prévue garde sa date (au plus tôt dans une minute), sinon l’étape suivante suit son délai habituel, pendant vos heures d’envoi.'
                      : `La séquence reprend à l’étape suivante, selon ses délais habituels${confirmNextAction ? ` (prochaine action estimée : ${confirmNextAction})` : ', s’il en reste une'}.${
                        confirmEnrollment?.status === 'replied'
                          ? ` ${confirmName} a répondu${confirmEnrollment.replied_at ? ` le ${format(new Date(confirmEnrollment.replied_at), 'd MMMM yyyy', { locale: fr })}` : ''} : vérifiez que la conversation est bien close.`
                          : ''}`)
                    : confirmAction?.type === 'resume'
                      ? (confirmRetriesFailedStep
                        ? 'L’étape en échec sera retentée après son délai habituel, pendant vos heures d’envoi. Si la cause de l’échec n’est pas réglée, elle échouera de nouveau.'
                        : 'Une étape déjà programmée garde sa date (au plus tôt dans une minute) ; sinon, l’étape suivante est programmée selon son délai habituel, pendant vos heures d’envoi.')
                      : 'Cette étape ne sera pas envoyée pour ce candidat. La séquence passera directement à l\'étape suivante.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {confirmAction?.type === 'skipStep' ? "Garder l'étape" : 'Annuler'}
          </AlertDialogCancel>
          <AlertDialogAction
            className={['markReplied', 'reEnroll', 'resume', 'bulkResume'].includes(confirmAction?.type || '') ? undefined : 'bg-destructive'}
            onClick={handleConfirmedAction}
          >
            {confirmAction?.type === 'markReplied' ? 'Marquer comme ayant répondu'
              : confirmAction?.type === 'reEnroll' ? 'Relancer'
              : confirmAction?.type === 'resume' ? (confirmRetriesFailedStep ? 'Réessayer' : 'Reprendre')
              : confirmAction?.type === 'bulkResume' ? 'Reprendre'
              : 'Sauter l\'étape'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <EditScheduledMessageModal
      isOpen={!!reviewing}
      onClose={() => setReviewing(null)}
      execution={reviewing ? {
        id: reviewing.exec.id,
        scheduled_at: reviewing.exec.scheduled_at,
        final_subject: reviewing.exec.final_subject,
        final_message: reviewing.exec.final_message,
        step: reviewing.exec.step,
        enrollment: { profile_name: reviewing.profileName },
      } : null}
      onSaved={() => fetchEnrollments()}
      aiReview
    />
    </>
  );
};

/** Squelette du panneau : tuiles, recherche, puis quatre lignes de candidat. */
const EnrollmentsSkeleton: React.FC = () => (
  <div className="space-y-4" aria-hidden="true">
    <div className="grid grid-cols-3 gap-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-20 rounded-xl" />
      ))}
    </div>
    <Skeleton className="h-9 w-full rounded-lg" />
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="space-y-2 rounded-xl border border-border p-4">
        <Skeleton className="h-4 w-2/5 rounded-sm" />
        <Skeleton className="h-3 w-3/5 rounded-sm" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>
    ))}
  </div>
);
