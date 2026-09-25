import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import {
  formatSequenceError as formatErrorMessage,
  formatSkipReason,
  executionStatusLabel,
  isSentExecutionStatus,
  actionTypeLabel,
  isHiddenActionType,
  summarizeResumeResponse,
  type ResumeResponse,
} from '@/lib/sequenceErrorMessages';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { Input } from '@/components/ui/input';
import { 
  Users, 
  ExternalLink, 
  MoreHorizontal, 
  StopCircle, 
  Play,
  CheckCircle,
  MessageCircle,
  Clock,
  XCircle,
  ChevronDown,
  ChevronRight,
  Send,
  UserPlus,
  Eye,
  Mail,
  AlertCircle,
  CheckCircle2,
  Timer,
  SkipForward,
  RefreshCw,
  Search,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DONE_EXECUTION_STATUSES,
  PENDING_EXECUTION_STATUSES,
  enrollmentStatusLabel,
  pausedLabel,
  pauseReasonHint,
} from '@/lib/sequenceLabels';

interface StepExecution {
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

interface Enrollment {
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
  executions?: StepExecution[];
}

interface SequenceEnrollmentsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sequenceId: string;
  sequenceName: string;
}

// Apparence d'une inscription par statut. Les libellés viennent de
// src/lib/sequenceLabels.ts (enrollmentStatusLabel, pausedLabel) : un statut
// inconnu s'affiche « Statut inconnu », jamais « En cours ».
const statusStyle: Record<string, { icon: React.ReactNode; className: string }> = {
  active: { icon: <Clock className="w-3 h-3" aria-hidden="true" />, className: 'bg-info text-info-foreground border border-info' },
  paused: { icon: <StopCircle className="w-3 h-3" aria-hidden="true" />, className: 'bg-warning text-warning-foreground border border-warning' },
  completed: { icon: <CheckCircle className="w-3 h-3" aria-hidden="true" />, className: 'bg-success text-success-foreground border border-success' },
  replied: { icon: <MessageCircle className="w-3 h-3" aria-hidden="true" />, className: 'bg-purple-500 text-white border border-purple-600' },
  bounced: { icon: <AlertCircle className="w-3 h-3" aria-hidden="true" />, className: 'bg-destructive/10 text-destructive border border-destructive/30' },
  stopped: { icon: <XCircle className="w-3 h-3" aria-hidden="true" />, className: 'bg-destructive/10 text-destructive border border-destructive/30' },
  cancelled: { icon: <XCircle className="w-3 h-3" aria-hidden="true" />, className: 'bg-muted text-muted-foreground border border-border' },
};
const NEUTRAL_STATUS_STYLE = { icon: <AlertCircle className="w-3 h-3" aria-hidden="true" />, className: 'bg-muted text-muted-foreground border border-border' };

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

const isDoneStatus = (status: string) => (DONE_EXECUTION_STATUSES as readonly string[]).includes(status);
const isPendingStatus = (status: string) => (PENDING_EXECUTION_STATUSES as readonly string[]).includes(status);

// Icône et couleur par type d'étape réel. Libellés et étapes internes
// (attentes, contrôles, conditions) : src/lib/sequenceErrorMessages.ts.
const actionTypeStyle: Record<string, { icon: React.ReactNode; bgColor: string }> = {
  message: { icon: <Send className="w-3.5 h-3.5" aria-hidden="true" />, bgColor: 'bg-info' },
  smart_message: { icon: <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />, bgColor: 'bg-indigo-500' },
  inmail: { icon: <Mail className="w-3.5 h-3.5" aria-hidden="true" />, bgColor: 'bg-purple-500' },
  email: { icon: <Mail className="w-3.5 h-3.5" aria-hidden="true" />, bgColor: 'bg-info' },
  whatsapp_message: { icon: <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />, bgColor: 'bg-success' },
  connection_request: { icon: <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />, bgColor: 'bg-success' },
  profile_visit: { icon: <Eye className="w-3.5 h-3.5" aria-hidden="true" />, bgColor: 'bg-muted' },
};
const DEFAULT_ACTION_STYLE = { icon: <Send className="w-3.5 h-3.5" aria-hidden="true" />, bgColor: 'bg-muted' };

// Apparence d'une étape par statut d'exécution ('pending' = pas encore programmée).
const executionStatusStyle: Record<string, { icon: React.ReactNode; className: string }> = {
  pending: { icon: <Clock className="w-3 h-3" aria-hidden="true" />, className: 'bg-muted text-muted-foreground border-border border-dashed' },
  scheduled: { icon: <Clock className="w-3 h-3" aria-hidden="true" />, className: 'bg-info/10 text-info-foreground border-info/30' },
  sending: { icon: <Send className="w-3 h-3" aria-hidden="true" />, className: 'bg-info/10 text-info-foreground border-info/30' },
  waiting_event: { icon: <Timer className="w-3 h-3" aria-hidden="true" />, className: 'bg-info/10 text-info-foreground border-info/30' },
  quota_blocked: { icon: <Timer className="w-3 h-3" aria-hidden="true" />, className: 'bg-warning/10 text-warning-foreground border-warning/30' },
  sent: { icon: <CheckCircle2 className="w-3 h-3" aria-hidden="true" />, className: 'bg-success/10 text-success-foreground border-success/30' },
  opened: { icon: <CheckCircle2 className="w-3 h-3" aria-hidden="true" />, className: 'bg-success/10 text-success-foreground border-success/30' },
  clicked: { icon: <CheckCircle2 className="w-3 h-3" aria-hidden="true" />, className: 'bg-success/10 text-success-foreground border-success/30' },
  replied: { icon: <MessageCircle className="w-3 h-3" aria-hidden="true" />, className: 'bg-success/10 text-success-foreground border-success/30' },
  bounced: { icon: <AlertCircle className="w-3 h-3" aria-hidden="true" />, className: 'bg-destructive/10 text-destructive border-destructive/30' },
  skipped: { icon: <SkipForward className="w-3 h-3" aria-hidden="true" />, className: 'bg-muted text-muted-foreground border-border' },
  failed: { icon: <AlertCircle className="w-3 h-3" aria-hidden="true" />, className: 'bg-destructive/10 text-destructive border-destructive/30' },
  cancelled: { icon: <XCircle className="w-3 h-3" aria-hidden="true" />, className: 'bg-muted text-muted-foreground border-border' },
};
const NEUTRAL_EXECUTION_STYLE = { icon: <AlertCircle className="w-3 h-3" aria-hidden="true" />, className: 'bg-muted text-muted-foreground border-border' };
const executionLabel = (status: string) => (status === 'pending' ? 'À venir' : executionStatusLabel(status));

// Exécutions chargées par lots d'inscriptions : une seule requête pour 200
// inscriptions dépassait la limite de 1 000 lignes de l'API, et les étapes
// les plus avancées disparaissaient (« À venir » sur une étape envoyée).
const EXECUTION_BATCH_SIZE = 50;
const EXECUTION_PAGE_SIZE = 1000;

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
  const [confirmAction, setConfirmAction] = useState<{ type: 'stop' | 'bulkStop' | 'resume' | 'markReplied' | 'reEnroll' | 'skipStep'; id?: string; stepId?: string } | null>(null);
  // Compteurs de la séquence entière, lus en base (la liste n'en charge que
  // 200 à la fois). null tant qu'ils ne sont pas connus.
  const [statusCounts, setStatusCounts] = useState<{ active: number; paused: number; done: number } | null>(null);
  // Échec du dernier chargement complet : affiché avec « Réessayer » au lieu
  // de « Aucun candidat inscrit ».
  const [loadError, setLoadError] = useState(false);

  const fetchStatusCounts = async () => {
    const countFor = (statuses: string[]) => supabase
      .from('sequence_enrollments')
      .select('id', { count: 'exact', head: true })
      .eq('sequence_id', sequenceId)
      .in('status', statuses);
    const [activeRes, pausedRes, doneRes] = await Promise.all([
      countFor(['active']),
      countFor(['paused']),
      countFor(['completed', 'replied']),
    ]);
    if (activeRes.error || pausedRes.error || doneRes.error) {
      console.error('Error counting enrollments:', activeRes.error || pausedRes.error || doneRes.error);
      setStatusCounts(null);
      return;
    }
    setStatusCounts({ active: activeRes.count ?? 0, paused: pausedRes.count ?? 0, done: doneRes.count ?? 0 });
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

        // Nombre total d'inscrits (pagination) et compteurs par statut.
        const [{ count }] = await Promise.all([
          supabase
            .from('sequence_enrollments')
            .select('id', { count: 'exact', head: true })
            .eq('sequence_id', sequenceId),
          fetchStatusCounts(),
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
      setLoadError(false);
    } catch (err) {
      console.error('Error fetching enrollments:', err);
      if (!append) setLoadError(true);
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

  // Mise en pause d'un candidat : on ne touche qu'à l'inscription. Les étapes
  // prévues gardent leur date, le moteur les ignore tant que l'inscription
  // n'est pas reprise, et « Reprendre » les retrouve telles quelles.
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
      toast.success(`${name} est en pause`, {
        description: 'Ses étapes prévues gardent leur date. Reprenez sa séquence quand vous le souhaitez.',
      });
    } catch (error) {
      console.error('Error pausing enrollment:', error);
      toast.error(`La séquence n’a pas pu être mise en pause pour ${name}. Réessayez.`);
    }
  };

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

  // Mise en pause de TOUS les candidats en cours de la séquence, filtrée en
  // base (pas sur les 200 lignes chargées). Les étapes gardent leur date.
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
      if (paused === 0) {
        toast.error('Aucun candidat n’a été mis en pause', {
          description: 'Plus aucun candidat n’était en cours, ou vous n’avez pas les droits sur cette séquence.',
        });
      } else {
        toast.success(`${paused} candidat${paused > 1 ? 's' : ''} mis en pause`, {
          description: 'Ils ne recevront plus de messages de cette séquence tant que vous ne les reprenez pas.',
        });
      }
    } catch (error) {
      console.error('Error bulk pausing:', error);
      toast.error('La mise en pause groupée a échoué. Réessayez.');
    }
    await fetchEnrollments();
  };

  const reEnroll = async (enrollmentId: string) => {
    const name = nameOf(enrollmentId);
    try {
      const { result } = await callResumeAction('re_enroll', enrollmentId);
      if (result.outcome === 'resumed') {
        toast.success(`Séquence relancée pour ${name}`, {
          description: 'La prochaine action partira dans les prochaines minutes, pendant vos heures d’envoi.',
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

  // Estimation de la prochaine action pour le dialogue « Relancer » : l'étape
  // annulée la plus récente encore jamais faite, sinon l'étape visible qui suit
  // la dernière étape terminée (même règle que le serveur). null si inconnue.
  const nextActionLabel = (enrollment: Enrollment | undefined): string | null => {
    if (!enrollment) return null;
    const executions = enrollment.executions || [];
    const touched = new Set(executions.filter(e => isDoneStatus(e.status) || isPendingStatus(e.status)).map(e => e.step_id));
    const rearmable = executions
      .filter(e => e.status === 'cancelled' && !touched.has(e.step_id))
      .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime())[0];
    let actionType = rearmable?.step?.action_type;
    if (!actionType) {
      const doneOrders = executions.filter(e => isDoneStatus(e.status)).map(e => e.step_order);
      const lastDone = doneOrders.length > 0 ? Math.max(...doneOrders) : -1;
      actionType = allSteps.find(s => s.step_order > lastDone && !isHiddenActionType(s.action_type))?.action_type;
    }
    if (!actionType || isHiddenActionType(actionType)) return null;
    return actionTypeLabel(actionType);
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
      const payload = data as { success?: boolean; changed?: boolean; message?: string } | null;
      if (error || !payload?.success) {
        throw new Error(payload?.message || error?.message || 'Réessayez dans un instant.');
      }
      if (payload.changed) {
        toast.success(`Réponse enregistrée pour ${name}`, {
          description: 'Les étapes restantes ont été annulées.',
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

  const handleConfirmedAction = async () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'stop' && confirmAction.id) {
      await stopEnrollment(confirmAction.id);
    } else if (confirmAction.type === 'resume' && confirmAction.id) {
      await resumeEnrollment(confirmAction.id);
    } else if (confirmAction.type === 'bulkStop') {
      await bulkStopActive();
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

  const confirmEnrollment = confirmAction?.id ? enrollments.find(e => e.id === confirmAction.id) : undefined;
  const confirmName = confirmEnrollment?.profile_name || 'ce candidat';
  const confirmNextAction = confirmAction?.type === 'reEnroll' ? nextActionLabel(confirmEnrollment) : null;

  return (
    <>
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:w-[500px] sm:max-w-[500px] bg-background rounded-lg border-l border-border">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2 pr-8">
            <SheetTitle className="flex items-center gap-2 uppercase tracking-wide min-w-0">
              <div className="h-7 w-7 bg-foreground text-background flex items-center justify-center shrink-0">
                <Users className="w-4 h-4" aria-hidden="true" />
              </div>
              <span className="truncate">{sequenceName}</span>
            </SheetTitle>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs shrink-0"
              onClick={() => { void fetchEnrollments(); }}
              disabled={loading || loadingMore}
              aria-label="Actualiser la liste des inscrits"
            >
              <RefreshCw className={cn('w-3.5 h-3.5 mr-1', loading && 'animate-spin')} aria-hidden="true" />
              Actualiser
            </Button>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Information : actions échues en attente du prochain passage */}
          {pendingExecutions.length > 0 && (
            <div className="p-3 bg-background border border-border" role="status">
              <div className="flex items-start gap-2 text-foreground">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span className="text-sm">
                  {pendingExecutions.length > 1
                    ? `${pendingExecutions.length} actions en attente d’envoi. Elles partiront au prochain passage, pendant vos heures d’envoi.`
                    : '1 action en attente d’envoi. Elle partira au prochain passage, pendant vos heures d’envoi.'}
                </span>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-0 border border-border">
            <div className="p-3 text-center border-r border-border">
              <div className="text-xl font-bold text-foreground">{activeCount}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Actifs</div>
            </div>
            <div className="p-3 text-center border-r border-border">
              <div className="text-xl font-bold text-foreground">{pausedCount}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">En pause</div>
            </div>
            <div className="p-3 text-center">
              <div className="text-xl font-bold text-foreground">{completedCount}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Terminés</div>
            </div>
          </div>

          {/* Bulk actions */}
          {activeCount > 0 && (
            <button
              onClick={() => setConfirmAction({ type: 'bulkStop' })}
              className="w-full relative overflow-hidden h-9 px-4 bg-background text-destructive border border-destructive text-xs font-medium uppercase tracking-wider group flex items-center justify-center gap-2"
            >
              <StopCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {statusCounts
                  ? `Mettre en pause tous les candidats actifs (${statusCounts.active})`
                  : 'Mettre en pause tous les candidats actifs'}
              </span>
            </button>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            <Input
              aria-label="Rechercher un candidat"
              placeholder="Rechercher un candidat…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs border-border rounded-lg"
            />
          </div>

          {/* Enrollments list */}
          <div className="h-[calc(100vh-340px)] overflow-y-auto">
            <div className="space-y-2">
              {loading ? (
                <BrutalLoader compact messages={['Chargement des inscriptions…', 'Récupération des étapes…', 'Synchronisation…']} />
              ) : loadError && enrollments.length === 0 ? (
                <div className="text-center py-8 space-y-3" role="alert">
                  <p className="text-sm text-foreground">
                    Impossible de charger les inscrits. Vérifiez votre connexion puis réessayez.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => { void fetchEnrollments(); }}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                    Réessayer
                  </Button>
                </div>
              ) : enrollments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  Aucun candidat inscrit
                </div>
              ) : (() => {
                const query = searchQuery.toLowerCase().trim();
                const filtered = query
                  ? enrollments.filter(e => 
                      (e.profile_name || '').toLowerCase().includes(query) ||
                      (e.profile_headline || '').toLowerCase().includes(query)
                    )
                  : enrollments;
                return filtered.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Aucun résultat pour « {searchQuery} »
                  </div>
                ) : filtered.map((enrollment) => {
                  const status = statusStyle[enrollment.status] || NEUTRAL_STATUS_STYLE;
                  const statusLabel = enrollment.status === 'paused'
                    ? pausedLabel(enrollment.pause_reason)
                    : enrollmentStatusLabel(enrollment.status);
                  const isExpanded = expandedEnrollments.has(enrollment.id);
                  const executions = enrollment.executions || [];
                  const pauseDetail = sendFailedDetail(enrollment);
                  const pauseHint = enrollment.status === 'paused'
                    ? (pauseDetail ?? pauseReasonHint(enrollment.pause_reason))
                    : null;
                  
                  return (
                    <Collapsible
                      key={enrollment.id}
                      open={isExpanded}
                      onOpenChange={() => toggleExpanded(enrollment.id)}
                    >
                      <div className="border border-border">
                        {/* Header - always visible */}
                        <div className="p-3 bg-background hover:bg-accent/10 group">
                          <div className="flex items-start gap-2 w-full">
                            <CollapsibleTrigger className="flex items-start gap-2 flex-1 min-w-0 text-left">
                              <div className="mt-0.5 shrink-0">
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-foreground truncate">
                                    {enrollment.profile_name || 'Candidat'}
                                  </span>
                                  {enrollment.profile_url && (
                                    <a
                                      href={enrollment.profile_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-muted-foreground hover:text-linkedin shrink-0"
                                      onClick={(e) => e.stopPropagation()}
                                      aria-label={`Voir le profil LinkedIn de ${enrollment.profile_name || 'ce candidat'}`}
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                                    </a>
                                  )}
                                </div>
                                {enrollment.profile_headline && (
                                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                                    {enrollment.profile_headline}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                  <Badge className={`text-xs rounded-full ${status.className}`}>
                                    {status.icon}
                                    <span className="ml-1">{statusLabel}</span>
                                  </Badge>
                                  {(() => {
                                    // Find next scheduled or last executed action
                                    const scheduledExecs = executions
                                      .filter(e => e.status === 'scheduled' && !isHiddenActionType(e.step?.action_type))
                                      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
                                    const executedExecs = executions
                                      .filter(e => isSentExecutionStatus(e.status) && e.executed_at && !isHiddenActionType(e.step?.action_type))
                                      .sort((a, b) => new Date(b.executed_at!).getTime() - new Date(a.executed_at!).getTime());

                                    const nextScheduled = scheduledExecs[0];
                                    const lastExecuted = executedExecs[0];

                                    return (
                                      <>
                                        {lastExecuted && (
                                          <span className="text-xs text-success-foreground">
                                            ✓ {format(new Date(lastExecuted.executed_at!), 'dd/MM à HH:mm', { locale: fr })}
                                          </span>
                                        )}
                                        {nextScheduled && (
                                          <span className="text-xs text-info-foreground font-medium">
                                            → {actionTypeLabel(nextScheduled.step?.action_type)} le {format(new Date(nextScheduled.scheduled_at), 'dd/MM à HH:mm', { locale: fr })}
                                          </span>
                                        )}
                                        {!nextScheduled && !lastExecuted && (
                                          <span className="text-xs text-muted-foreground">
                                            {executions.length} étape(s)
                                          </span>
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                                {pauseHint && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {pauseHint}
                                  </p>
                                )}
                              </div>
                            </CollapsibleTrigger>

                            {/* Actions menu */}
                            <DropdownMenu modal={false}>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 border-border rounded-lg"
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={`Actions pour ${enrollment.profile_name || 'ce candidat'}`}
                                >
                                  <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-background border-border rounded-lg">
                                {enrollment.status === 'active' ? (
                                  <DropdownMenuItem
                                    onClick={() => setConfirmAction({ type: 'stop', id: enrollment.id })}
                                    className="text-warning-foreground"
                                  >
                                    <StopCircle className="w-4 h-4 mr-2" aria-hidden="true" />
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
                                          <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                                          Reconnecter le compte
                                        </Link>
                                      </DropdownMenuItem>
                                    )}
                                    {enrollment.pause_reason === 'subscription_required' && (
                                      <DropdownMenuItem asChild>
                                        <Link to="/pricing">
                                          <ExternalLink className="w-4 h-4 mr-2" aria-hidden="true" />
                                          Voir les offres
                                        </Link>
                                      </DropdownMenuItem>
                                    )}
                                    {enrollment.pause_reason === 'send_failed' && !pauseDetail && (
                                      <DropdownMenuItem onClick={() => showEnrollmentDetail(enrollment.id)}>
                                        <AlertCircle className="w-4 h-4 mr-2" aria-hidden="true" />
                                        Voir l'erreur
                                      </DropdownMenuItem>
                                    )}
                                    {(!enrollment.pause_reason || RESUMABLE_PAUSE_REASONS.has(enrollment.pause_reason)) && (
                                      <DropdownMenuItem
                                        onClick={() => setConfirmAction({ type: 'resume', id: enrollment.id })}
                                        className="text-success-foreground"
                                      >
                                        <Play className="w-4 h-4 mr-2" aria-hidden="true" />
                                        {enrollment.pause_reason === 'send_failed' && !pauseDetail ? 'Reprendre à l’étape suivante' : 'Reprendre la séquence'}
                                      </DropdownMenuItem>
                                    )}
                                  </>
                                ) : null}
                                {/* Marquer répondu manuellement (cas réponse hors-canal :
                                    téléphone, en personne, autre boîte mail). Évite de
                                    continuer à spammer le candidat. */}
                                {(enrollment.status === 'active' || enrollment.status === 'paused' || enrollment.status === 'completed') && (
                                  <DropdownMenuItem
                                    onClick={() => setConfirmAction({ type: 'markReplied', id: enrollment.id })}
                                  >
                                    <CheckCircle2 className="w-4 h-4 mr-2 text-success" aria-hidden="true" />
                                    Marquer comme ayant répondu
                                  </DropdownMenuItem>
                                )}
                                {/* Relancer : inscription close (réponse, fin, arrêt). Jamais
                                    pour un candidat en pause, qui a « Reprendre ». */}
                                {(enrollment.status === 'replied' || enrollment.status === 'completed' || enrollment.status === 'cancelled' || enrollment.status === 'stopped') && (
                                  <DropdownMenuItem
                                    onClick={() => setConfirmAction({ type: 'reEnroll', id: enrollment.id })}
                                  >
                                    <RefreshCw className="w-4 h-4 mr-2 text-foreground" aria-hidden="true" />
                                    Relancer depuis l’étape suivante
                                  </DropdownMenuItem>
                                )}
                                {enrollment.profile_url && (
                                  <DropdownMenuItem asChild>
                                    <a
                                      href={enrollment.profile_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <ExternalLink className="w-4 h-4 mr-2" aria-hidden="true" />
                                      Voir sur LinkedIn
                                    </a>
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          {/* Action qui débloque, visible sans ouvrir le menu */}
                          {enrollment.status === 'paused' && ['account_disconnected', 'subscription_required', 'send_failed'].includes(enrollment.pause_reason || '') && !pauseDetail && (
                            <div className="mt-2 pl-6">
                              {enrollment.pause_reason === 'account_disconnected' ? (
                                <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs">
                                  <Link to="/settings/account/connections">Reconnecter le compte</Link>
                                </Button>
                              ) : enrollment.pause_reason === 'subscription_required' ? (
                                <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs">
                                  <Link to="/pricing">Voir les offres</Link>
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => showEnrollmentDetail(enrollment.id)}>
                                  <AlertCircle className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
                                  Voir l'erreur
                                </Button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Expanded content - Full workflow timeline */}
                        <CollapsibleContent>
                          <div className="border-t border-border bg-muted p-3">
                            {allSteps.length === 0 ? (
                              <p className="text-xs text-muted-foreground text-center py-2">
                                Aucune étape dans la séquence
                              </p>
                            ) : (
                              <div className="space-y-2">
                                <p className="text-xs font-medium text-foreground mb-2 uppercase tracking-wide">
                                  Parcours
                                </p>
                                {allSteps.filter(s => !isHiddenActionType(s.action_type)).map((step) => {
                                  // Exécution de cette étape, si elle existe
                                  const exec = executions.find(e => e.step_id === step.id);
                                  const actionStyle = actionTypeStyle[step.action_type] || DEFAULT_ACTION_STYLE;

                                  // Statut : celui de l'exécution, ou « À venir » tant qu'elle n'est pas programmée
                                  const status = exec?.status || 'pending';
                                  const execStatus = executionStatusStyle[status] || NEUTRAL_EXECUTION_STYLE;
                                  const isPending = status === 'pending';
                                  const isFailed = status === 'failed';
                                  const isSkipped = status === 'skipped';
                                  const isSent = isSentExecutionStatus(status);
                                  const isChannelSkip = isSkipped && exec?.skip_reason?.toLowerCase().includes('channel');

                                  return (
                                    <div 
                                      key={step.id}
                                      className={cn(
                                        "flex items-start gap-3 p-2.5 border transition-colors",
                                        isFailed && "bg-destructive/5 border-destructive/30",
                                        isChannelSkip && "bg-muted/50 border-border/5 opacity-60",
                                        isSkipped && !isChannelSkip && "bg-muted border-border",
                                        !isFailed && !isSkipped && execStatus.className
                                      )}
                                    >
                                      {/* Icône du type d'étape */}
                                      <div className={cn(
                                        "flex-shrink-0 w-7 h-7 flex items-center justify-center",
                                        isPending ? 'bg-muted text-muted-foreground' : `${actionStyle.bgColor} text-white`
                                      )}>
                                        {actionStyle.icon}
                                      </div>

                                      {/* Détail de l'étape */}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className={cn(
                                            "text-sm font-medium", 
                                            isPending ? 'text-muted-foreground' : 'text-foreground'
                                          )}>
                                            {actionTypeLabel(step.action_type)}
                                          </span>
                                          <Badge variant="outline" className={cn(
                                            "text-xs px-1.5 py-0 h-4",
                                            execStatus.className
                                          )}>
                                            {execStatus.icon}
                                            <span className="ml-0.5">{executionLabel(status)}</span>
                                          </Badge>
                                          {/* Délai d'une étape pas encore programmée */}
                                          {isPending && (step.delay_days > 0 || step.delay_hours > 0 || (step.delay_minutes ?? 0) > 0) && (
                                            <span className="text-xs text-muted-foreground">
                                              +{step.delay_days > 0 ? `${step.delay_days} j` : ''}{step.delay_hours > 0 ? ` ${step.delay_hours} h` : ''}{(step.delay_minutes ?? 0) > 0 ? ` ${step.delay_minutes} min` : ''}
                                            </span>
                                          )}
                                        </div>


                                        {/* Dates et raisons, d'après l'exécution */}
                                        {exec && (
                                          <div className="text-xs mt-1">
                                            {exec.status === 'scheduled' && (
                                              <div className="flex items-center gap-2">
                                                <span className="text-muted-foreground">
                                                  Prévu : {format(new Date(exec.scheduled_at), 'dd/MM HH:mm', { locale: fr })}
                                                </span>
                                                {/* Le serveur refuse de sauter l'étape d'un candidat en
                                                    pause ou clos (enrollment_not_active) : bouton masqué. */}
                                                {enrollment.status === 'active' && (
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setConfirmAction({ type: 'skipStep', stepId: exec.id });
                                                    }}
                                                    className="text-xs text-muted-foreground hover:text-foreground underline px-1 py-0.5"
                                                    title="Sauter cette étape pour ce candidat"
                                                  >
                                                    Sauter
                                                  </button>
                                                )}
                                              </div>
                                            )}
                                            {exec.status === 'quota_blocked' && (
                                              <span className="text-muted-foreground">
                                                Nouvel essai prévu le {format(new Date(exec.scheduled_at), 'dd/MM à HH:mm', { locale: fr })}
                                              </span>
                                            )}
                                            {exec.status === 'scheduled' && exec.error_message && (
                                              <p className="text-warning-foreground mt-1">
                                                {formatErrorMessage(exec.error_message)}
                                              </p>
                                            )}
                                            {isSent && exec.executed_at && (
                                              <span className="text-success-foreground">
                                                ✓ {format(new Date(exec.executed_at), 'dd/MM HH:mm', { locale: fr })}
                                              </span>
                                            )}
                                            {(exec.status === 'skipped' || exec.status === 'cancelled') && exec.skip_reason && (
                                              <span className={cn(
                                                "text-muted-foreground flex items-center gap-1",
                                                isChannelSkip && "italic"
                                              )}>
                                                {formatSkipReason(exec.skip_reason)}
                                              </span>
                                            )}
                                            {exec.status === 'failed' && exec.error_message && (
                                              <div className="text-destructive mt-1 p-2 bg-destructive/10 border border-destructive/20 text-xs">
                                                <strong>Erreur :</strong> {formatErrorMessage(exec.error_message)}
                                              </div>
                                            )}
                                          </div>
                                        )}

                                        {/* Aperçu du message envoyé */}
                                        {isSent && exec?.final_message && (
                                          <div className="mt-2 p-2 bg-background border border-border text-xs text-muted-foreground">
                                            {exec.final_subject && (
                                              <p className="font-medium text-foreground mb-1 pb-1 border-b text-xs">
                                                {exec.final_subject}
                                              </p>
                                            )}
                                            <p className="line-clamp-2 leading-relaxed">
                                              {exec.final_message.replace(/\\n/g, ' ').substring(0, 120)}...
                                            </p>
                                          </div>
                                        )}

                                        {/* Template preview for pending steps */}
                                        {isPending && step.message_template && (
                                          <div className="mt-1.5 text-xs text-muted-foreground/70 italic line-clamp-1">
                                            « {step.message_template.replace(/\\n/g, ' ').substring(0, 80)}... »
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                });
              })()}

              {/* Pagination — Charger plus si > PAGE_SIZE candidats */}
              {hasMore && !loading && (
                <div className="text-center py-3 border-t border-border mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchEnrollments(true)}
                    disabled={loadingMore}
                    className="text-xs"
                  >
                    {loadingMore ? 'Chargement…' : `Charger plus (${enrollments.length} / ${totalCount})`}
                  </Button>
                </div>
              )}
              {!hasMore && enrollments.length >= PAGE_SIZE && (
                <div className="text-center py-3 text-xs text-muted-foreground">
                  Tous les candidats chargés ({totalCount})
                </div>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>

    <AlertDialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirmAction?.type === 'bulkStop'
              ? (statusCounts
                ? `Mettre en pause tous les candidats actifs (${statusCounts.active}) ?`
                : 'Mettre en pause tous les candidats actifs ?')
              : confirmAction?.type === 'markReplied'
                ? `Marquer ${confirmName} comme ayant répondu ?`
                : confirmAction?.type === 'reEnroll'
                  ? `Relancer ${confirmName} ?`
                  : confirmAction?.type === 'resume'
                    ? `Reprendre la séquence pour ${confirmName} ?`
                    : confirmAction?.type === 'skipStep'
                      ? 'Sauter cette étape ?'
                      : `Mettre en pause la séquence pour ${confirmName} ?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmAction?.type === 'bulkStop'
              ? 'Tous les candidats en cours de cette séquence, y compris ceux qui ne sont pas affichés, ne recevront plus de messages tant que vous ne les reprenez pas. Leurs étapes prévues gardent leur date.'
              : confirmAction?.type === 'markReplied'
                ? `${confirmName} passera en « A répondu » et ses étapes restantes seront annulées. Utile si le candidat a répondu hors de Konekt (téléphone, en personne, etc.).`
                : confirmAction?.type === 'reEnroll'
                  ? `La prochaine action${confirmNextAction ? ` (${confirmNextAction})` : ''} partira dans les prochaines minutes.${
                    confirmEnrollment?.status === 'replied'
                      ? ` ${confirmName} a répondu${confirmEnrollment.replied_at ? ` le ${format(new Date(confirmEnrollment.replied_at), 'd MMMM yyyy', { locale: fr })}` : ''} : vérifiez que la conversation est bien close.`
                      : ''}`
                  : confirmAction?.type === 'resume'
                    ? 'Chaque étape garde sa date prévue ; celles déjà passées partiront dans les prochaines minutes, pendant vos heures d’envoi.'
                    : confirmAction?.type === 'skipStep'
                      ? 'Cette étape ne sera pas envoyée pour ce candidat. La séquence passera directement à l\'étape suivante.'
                      : `${confirmName} ne recevra plus de messages tant que vous ne reprenez pas sa séquence. Ses étapes prévues gardent leur date.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            className={['markReplied', 'reEnroll', 'resume'].includes(confirmAction?.type || '') ? '' : 'bg-destructive hover:bg-destructive/90'}
            onClick={handleConfirmedAction}
          >
            {confirmAction?.type === 'markReplied' ? 'Marquer comme ayant répondu'
              : confirmAction?.type === 'reEnroll' ? 'Relancer'
              : confirmAction?.type === 'resume' ? 'Reprendre'
              : confirmAction?.type === 'skipStep' ? 'Sauter l\'étape'
              : 'Mettre en pause'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
};
