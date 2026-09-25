import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { formatSequenceError as formatErrorMessage } from '@/lib/sequenceErrorMessages';
import { sequenceActionLabel, skipReasonLabel, formatStepDelay } from '@/lib/sequenceCatalog';
import { Button } from '@/components/ui/button';
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
import { EnrollmentStatusBadge, ExecutionStatusBadge, SequenceActionIcon } from './SequenceBadges';
import { 
  Users, 
  ExternalLink, 
  MoreHorizontal, 
  StopCircle, 
  Play,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  Clock,
  Search,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/plural';

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
  /** account_disconnected | quota_reached | subscription_required | manual. NULL hors pause. */
  pause_reason?: string | null;
  executions?: StepExecution[];
}

interface SequenceEnrollmentsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sequenceId: string;
  sequenceName: string;
}

// Actions to hide from UI (internal/noise)
const HIDDEN_ACTION_TYPES = new Set(['wait_connection', 'check_connection', 'wait_reply', 'wait_for_event']);

/** « 26/09 à 10:42 » */
const formatWhen = (value: string) => format(new Date(value), "dd/MM 'à' HH:mm", { locale: fr });

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
  const [processingSequences, setProcessingSequences] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'stop' | 'bulkStop' | 'markReplied' | 'reEnroll' | 'skipStep'; id?: string; stepId?: string; name?: string } | null>(null);

  const fetchEnrollments = async (append = false) => {
    try {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setLoadError(null);
      }

      // Fetch sequence steps FIRST to get the full workflow.
      // Pour append on réutilise allSteps déjà en state.
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

        // Count total enrollments for pagination UI
        const { count } = await supabase
          .from('sequence_enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('sequence_id', sequenceId);
        setTotalCount(count || 0);
      }

      // Fetch enrollments paginés (200 par page)
      const offset = append ? enrollments.length : 0;
      const { data: enrollData, error: enrollError } = await supabase
        .from('sequence_enrollments')
        .select('*')
        .eq('sequence_id', sequenceId)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (enrollError) throw enrollError;

      setHasMore((enrollData?.length || 0) === PAGE_SIZE);

      // Fetch all step executions for these enrollments
      const enrollmentIds = enrollData?.map(e => e.id) || [];
      const { data: execData, error: execError } = await supabase
        .from('sequence_step_executions')
        .select('*')
        .in('enrollment_id', enrollmentIds)
        .order('step_order', { ascending: true });
      if (execError) throw execError;

      // Attach executions to enrollments (stepsLookup déjà résolu plus haut)
      const enriched = (enrollData || []).map(enrollment => ({
        ...enrollment,
        executions: (execData || [])
          .filter(e => e.enrollment_id === enrollment.id)
          .map(exec => ({
            ...exec,
            step: stepsLookup.find((s: any) => s.id === exec.step_id),
          })),
      }));

      setEnrollments(prev => append ? [...prev, ...enriched] : enriched);
    } catch (err) {
      console.error('Error fetching enrollments:', err);
      // Une panne ne se lit pas comme une liste vide : état d'erreur avec
      // « Réessayer » ; la suite d'une liste déjà affichée échoue par un toast.
      if (append) toast.error("La suite de la liste n'a pas pu être chargée. Réessayez.");
      else setLoadError(err instanceof Error ? err.message : String(err));
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

  const candidateName = (enrollmentId: string) =>
    enrollments.find(e => e.id === enrollmentId)?.profile_name || 'ce candidat';

  const stopEnrollment = async (enrollmentId: string) => {
    try {
      // Update enrollment status
      const { error: enrollError } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'paused', pause_reason: 'manual' })
        .eq('id', enrollmentId);

      if (enrollError) throw enrollError;

      // Cancel scheduled executions
      await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Arrêt manuel' })
        .eq('enrollment_id', enrollmentId)
        .eq('status', 'scheduled');

      setEnrollments(prev => 
        prev.map(e => e.id === enrollmentId ? { ...e, status: 'paused' } : e)
      );
      toast.success(`Séquence arrêtée pour ${candidateName(enrollmentId)}`);
    } catch (error) {
      console.error('Error stopping enrollment:', error);
      toast.error("La séquence n'a pas pu être arrêtée. Réessayez.");
    }
  };

  const resumeEnrollment = async (enrollmentId: string) => {
    try {
      const { error } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'active', pause_reason: null })
        .eq('id', enrollmentId);

      if (error) throw error;

      // Re-schedule the next cancelled step so the backend picks it up
      const enrollment = enrollments.find(e => e.id === enrollmentId);
      if (enrollment) {
        const cancelledExecs = (enrollment.executions || [])
          .filter(e => e.status === 'cancelled')
          .sort((a, b) => a.step_order - b.step_order);
        
        if (cancelledExecs.length > 0) {
          const nextExec = cancelledExecs[0];
          const scheduledAt = new Date();
          scheduledAt.setMinutes(scheduledAt.getMinutes() + 1); // Schedule 1 min from now
          
          await supabase
            .from('sequence_step_executions')
            .update({ 
              status: 'scheduled', 
              skip_reason: null,
              scheduled_at: scheduledAt.toISOString(),
            })
            .eq('id', nextExec.id);
        }
      }

      setEnrollments(prev => 
        prev.map(e => e.id === enrollmentId ? { ...e, status: 'active' } : e)
      );
      toast.success(`Séquence reprise pour ${candidateName(enrollmentId)}`);
      fetchEnrollments(); // Refresh to show updated executions
    } catch (error) {
      console.error('Error resuming enrollment:', error);
      toast.error("La séquence n'a pas pu reprendre. Réessayez.");
    }
  };

  const bulkStopActive = async () => {
    const activeEnrollments = enrollments.filter(e => e.status === 'active');
    if (activeEnrollments.length === 0) return;

    try {
      const ids = activeEnrollments.map(e => e.id);
      
      const { error: enrollError } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'paused', pause_reason: 'manual' })
        .in('id', ids);

      if (enrollError) throw enrollError;

      await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Arrêt groupé' })
        .in('enrollment_id', ids)
        .eq('status', 'scheduled');

      setEnrollments(prev => 
        prev.map(e => ids.includes(e.id) ? { ...e, status: 'paused' } : e)
      );
      toast.success(ids.length > 1 ? `${ids.length} inscriptions arrêtées` : '1 inscription arrêtée');
    } catch (error) {
      console.error('Error bulk stopping:', error);
      toast.error("Les inscriptions n'ont pas pu être arrêtées. Réessayez.");
    }
  };

  const reEnroll = async (enrollmentId: string) => {
    try {
      // Re-enrôlement : remet active + reset retry_count + reschedule la prochaine
      // étape à maintenant. Utile pour relancer un candidat qui s'était arrêté
      // (replied/paused/stopped) après contact résolu hors-canal.
      const { error: updErr } = await supabase
        .from('sequence_enrollments')
        .update({
          status: 'active',
          pause_reason: null,
          replied_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', enrollmentId);
      if (updErr) throw updErr;

      // Trouve la prochaine étape pending (cancelled ou scheduled) et la reschedule
      const { data: nextExec } = await (supabase
        .from('sequence_step_executions')
        .select('id')
        .eq('enrollment_id', enrollmentId)
        .in('status', ['cancelled', 'scheduled', 'failed', 'quota_blocked'])
        .order('step_order', { ascending: true })
        .limit(1) as any);
      if (nextExec && nextExec.length > 0) {
        await supabase
          .from('sequence_step_executions')
          .update({
            status: 'scheduled',
            scheduled_at: new Date().toISOString(),
            retry_count: 0,
            error_message: null,
            skip_reason: null,
          })
          .eq('id', nextExec[0].id);
      }

      setEnrollments(prev =>
        prev.map(e => e.id === enrollmentId ? { ...e, status: 'active', replied_at: null } : e)
      );
      toast.success(`Inscription relancée pour ${candidateName(enrollmentId)}`, {
        description: 'La prochaine étape part au prochain passage des envois, dans les 5 minutes.',
      });
    } catch (err) {
      console.error('[EnrollmentsPanel] reEnroll failed:', err);
      toast.error("La réinscription n'a pas abouti. Réessayez.");
    }
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
      const payload = data as { success?: boolean; error?: string; status?: string } | null;
      if (error || !payload?.success) {
        // Réponse 409 avec statut (le corps reste dans data) : l'étape est déjà
        // partie ou traitée.
        if (payload?.status) {
          toast.error('Cette étape est déjà partie ou traitée : il n’y a plus rien à passer.');
          await fetchEnrollments();
          return;
        }
        throw error || new Error(payload?.error || 'skip_execution');
      }

      toast.success('Étape passée', {
        description: "La séquence continue à l'étape suivante.",
      });
      await fetchEnrollments();
    } catch (err) {
      console.error('[EnrollmentsPanel] skipStep failed:', err);
      toast.error("L'étape n'a pas pu être passée. Réessayez.");
    }
  };

  const markReplied = async (enrollmentId: string) => {
    try {
      // Marque l'enrollment 'replied' + cancel les executions pending
      const { error } = await supabase
        .from('sequence_enrollments')
        .update({
          status: 'replied',
          replied_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', enrollmentId);
      if (error) throw error;

      await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Réponse marquée manuellement' })
        .eq('enrollment_id', enrollmentId)
        .eq('status', 'scheduled');

      setEnrollments(prev =>
        prev.map(e => e.id === enrollmentId ? { ...e, status: 'replied', replied_at: new Date().toISOString() } : e)
      );
      toast.success(`Réponse enregistrée pour ${candidateName(enrollmentId)}`, {
        description: 'Les étapes restantes ont été annulées.',
      });
    } catch (err) {
      console.error('[EnrollmentsPanel] markReplied failed:', err);
      toast.error("Le candidat n'a pas pu être marqué comme ayant répondu. Réessayez.");
    }
  };

  const handleConfirmedAction = async () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'stop' && confirmAction.id) {
      await stopEnrollment(confirmAction.id);
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

  const processSequencesNow = async () => {
    try {
      setProcessingSequences(true);

      // Avance les actions de CETTE séquence ; le cron les envoie au cycle
      // suivant avec ses garde-fous (heures ouvrées, quotas, santé du compte,
      // vérification de réponse). Avant, l'UI déclenchait un cycle complet
      // toutes organisations confondues, refusé à tout utilisateur sans rôle
      // plateforme, et les deux vérifications globales qui suivaient
      // (check_replies, check_wait_events) tournent de toute façon par cron.
      const { data, error } = await invokeEdgeFunction('process-sequences', {
        action: 'nudge_sequences',
        sequence_id: sequenceId,
      });

      if (error) {
        console.error('[processSequencesNow] error:', error);
        toast.error("Les étapes n'ont pas pu être avancées. Réessayez dans un instant.");
        return;
      }

      const payload = data as { success?: boolean; rescheduled?: number; error?: string } | null;
      if (!payload?.success) {
        console.error('[processSequencesNow] Unexpected response:', payload);
        toast.error("Les étapes n'ont pas pu être avancées. Réessayez dans un instant.");
        return;
      }

      // Le moteur d'envoi passe toutes les 5 minutes (migration 20260513200000).
      const count = payload.rescheduled || 0;
      toast.success(count > 0
        ? `${plural(count, 'étape avancée', 'étapes avancées')} : ${count > 1 ? 'elles partent' : 'elle part'} au prochain passage des envois, dans les 5 minutes.`
        : 'Aucune étape à avancer : tout est déjà en file ou terminé.');

      await fetchEnrollments();
    } catch (error) {
      console.error('[processSequencesNow] Exception:', error);
      toast.error("Connexion interrompue : les étapes n'ont pas été avancées. Réessayez.");
    } finally {
      setProcessingSequences(false);
    }
  };

  const activeCount = enrollments.filter(e => e.status === 'active').length;
  const pausedCount = enrollments.filter(e => e.status === 'paused').length;
  const completedCount = enrollments.filter(e => ['completed', 'replied'].includes(e.status)).length;

  // Étapes planifiées dont l'heure est passée
  const pendingExecutions = enrollments.flatMap(e => e.executions || [])
    .filter(exec => exec.status === 'scheduled' && new Date(exec.scheduled_at) < new Date());

  const query = searchQuery.toLowerCase().trim();
  const filtered = query
    ? enrollments.filter(e =>
        (e.profile_name || '').toLowerCase().includes(query) ||
        (e.profile_headline || '').toLowerCase().includes(query)
      )
    : enrollments;
                  
  const visibleSteps = allSteps.filter(s => !HIDDEN_ACTION_TYPES.has(s.action_type));

  const description = loading
    ? 'Chargement des inscriptions…'
    : loadError
      ? 'Inscriptions indisponibles'
      : totalCount === 0
        ? 'Aucun candidat inscrit'
        : plural(totalCount, 'candidat inscrit', 'candidats inscrits');

  const confirmName = confirmAction?.name || 'ce candidat';
  const confirmCopy = (() => {
    switch (confirmAction?.type) {
      case 'bulkStop':
        return {
          title: activeCount > 1 ? `Arrêter les ${activeCount} inscriptions en cours ?` : "Arrêter l'inscription en cours ?",
          description: `${activeCount > 1 ? `Les ${activeCount} candidats en cours ne recevront` : 'Le candidat en cours ne recevra'} plus de messages de cette séquence. Les étapes planifiées sont annulées ; vous pourrez reprendre chaque inscription depuis ce panneau.`,
          action: activeCount > 1 ? 'Arrêter les inscriptions' : "Arrêter l'inscription",
          cancel: 'Laisser en cours',
          destructive: true,
        };
      case 'markReplied':
        return {
          title: `Marquer ${confirmName} comme ayant répondu ?`,
          description: 'Les étapes restantes seront annulées. À utiliser quand le candidat vous a répondu en dehors de Konekt (téléphone, e-mail, rendez-vous).',
          action: 'Marquer comme ayant répondu',
          cancel: 'Annuler',
          destructive: false,
        };
      case 'reEnroll':
        return {
          title: `Réinscrire ${confirmName} ?`,
          description: "L'inscription repasse en cours : la prochaine étape non envoyée part au prochain passage des envois, dans les 5 minutes, pendant vos horaires d'envoi.",
          action: 'Réinscrire',
          cancel: 'Annuler',
          destructive: false,
        };
      case 'skipStep':
        return {
          title: 'Passer cette étape ?',
          description: `Cette étape ne sera pas envoyée à ${confirmName} : la séquence passe directement à l'étape suivante.`,
          action: "Passer l'étape",
          cancel: "Garder l'étape",
          destructive: true,
        };
      default:
        return {
          title: `Arrêter la séquence pour ${confirmName} ?`,
          description: `${confirmName} ne recevra plus de messages de cette séquence. Vous pourrez la reprendre depuis ce panneau.`,
          action: 'Arrêter la séquence',
          cancel: 'Laisser en cours',
          destructive: true,
        };
    }
  })();

  return (
    <>
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="space-y-1 border-b border-border px-6 py-5 pr-14 text-left">
          <p className="eyebrow">Inscriptions</p>
          <SheetTitle className="break-words">{sequenceName}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {loading ? (
            <EnrollmentsSkeleton />
          ) : loadError ? (
            <ErrorState
              title="Impossible de charger les inscriptions"
              description="Vérifiez votre connexion, puis réessayez."
              detail={loadError}
              onRetry={() => fetchEnrollments()}
            />
          ) : enrollments.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Aucun candidat inscrit"
              description="Inscrivez des candidats depuis la recherche ou la messagerie : leur progression dans la séquence s'affichera ici."
            />
          ) : (
            <>
              {pendingExecutions.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 sm:flex-nowrap">
                  <Clock className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {plural(pendingExecutions.length, 'étape en retard', 'étapes en retard')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {pendingExecutions.length > 1
                        ? "Leur heure est passée : elles partent au prochain passage des envois, pendant vos horaires d'envoi."
                        : "Son heure est passée : elle part au prochain passage des envois, pendant vos horaires d'envoi."}
                    </p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={processSequencesNow}
                        loading={processingSequences}
                        className="shrink-0 max-md:h-11 max-md:w-full"
                      >
                        Traiter maintenant
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Avance les prochaines étapes de cette séquence (hors invitations LinkedIn) : elles partent dans les 5 minutes.
                    </TooltipContent>
                  </Tooltip>
                </div>
              )}

              <StatGrid cols={{ base: 3 }}>
                <StatTile label="En cours" value={activeCount} />
                <StatTile label="En pause" value={pausedCount} />
                <StatTile label="Terminées" value={completedCount} />
              </StatGrid>

              {activeCount > 0 && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmAction({ type: 'bulkStop' })}
                    className="text-danger hover:text-danger max-md:h-11 max-md:w-full"
                  >
                    <StopCircle aria-hidden="true" />
                    {activeCount > 1 ? `Arrêter les ${activeCount} inscriptions en cours` : "Arrêter l'inscription en cours"}
                  </Button>
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
                    <Button variant="outline" size="sm" onClick={() => setSearchQuery('')}>
                      Effacer la recherche
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-2" aria-label="Candidats inscrits">
                  {filtered.map((enrollment) => {
                    const isExpanded = expandedEnrollments.has(enrollment.id);
                    const executions = enrollment.executions || [];
                    const shownExecutions = executions.filter(e => !HIDDEN_ACTION_TYPES.has(e.step?.action_type || ''));
                    const nextScheduled = shownExecutions
                      .filter(e => e.status === 'scheduled')
                      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0];
                    const lastExecuted = shownExecutions
                      .filter(e => (e.status === 'executed' || e.status === 'sent') && e.executed_at)
                      .sort((a, b) => new Date(b.executed_at!).getTime() - new Date(a.executed_at!).getTime())[0];
                    const name = enrollment.profile_name || 'Candidat';

                    return (
                      <li key={enrollment.id}>
                        <Collapsible
                          open={isExpanded}
                          onOpenChange={() => toggleExpanded(enrollment.id)}
                          className="rounded-xl border border-border bg-card"
                        >
                          <div className="flex items-start gap-1 p-2">
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
                                  <EnrollmentStatusBadge status={enrollment.status} pauseReason={enrollment.pause_reason} />
                                  {lastExecuted && (
                                    <span className="text-xs text-muted-foreground">
                                      Dernière étape le {formatWhen(lastExecuted.executed_at!)}
                                    </span>
                                  )}
                                  {nextScheduled && (
                                    <span className="text-xs text-muted-foreground">
                                      Prochaine : {sequenceActionLabel(nextScheduled.step?.action_type)}, le {formatWhen(nextScheduled.scheduled_at)}
                                    </span>
                                  )}
                                  {!nextScheduled && !lastExecuted && (
                                    <span className="text-xs text-muted-foreground">
                                      {shownExecutions.length === 0 ? 'Aucune étape planifiée' : 'Aucune étape envoyée'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </CollapsibleTrigger>

                            <DropdownMenu modal={false}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      className="shrink-0 max-md:h-11 max-md:w-11"
                                      aria-label={`Actions pour ${name}`}
                                    >
                                      <MoreHorizontal aria-hidden="true" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                </TooltipTrigger>
                                <TooltipContent>Actions</TooltipContent>
                              </Tooltip>
                              <DropdownMenuContent align="end">
                                {enrollment.status === 'active' ? (
                                  <DropdownMenuItem onClick={() => setConfirmAction({ type: 'stop', id: enrollment.id, name })}>
                                    <StopCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                                    Arrêter la séquence
                                  </DropdownMenuItem>
                                ) : enrollment.status === 'paused' ? (
                                  <DropdownMenuItem onClick={() => resumeEnrollment(enrollment.id)}>
                                    <Play className="mr-2 h-4 w-4" aria-hidden="true" />
                                    Reprendre la séquence
                                  </DropdownMenuItem>
                                ) : null}
                                {/* Réponse hors canal (téléphone, en personne, autre boîte mail) :
                                    évite de continuer à relancer le candidat. */}
                                {(enrollment.status === 'active' || enrollment.status === 'paused' || enrollment.status === 'completed') && (
                                  <DropdownMenuItem onClick={() => setConfirmAction({ type: 'markReplied', id: enrollment.id, name })}>
                                    <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />
                                    Marquer comme ayant répondu
                                  </DropdownMenuItem>
                                )}
                                {/* Réinscrire : après un arrêt, une réponse traitée ou une séquence terminée */}
                                {(enrollment.status === 'replied' || enrollment.status === 'completed' || enrollment.status === 'paused' || enrollment.status === 'cancelled' || enrollment.status === 'stopped') && (
                                  <DropdownMenuItem onClick={() => setConfirmAction({ type: 'reEnroll', id: enrollment.id, name })}>
                                    <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                                    Réinscrire à la séquence
                                  </DropdownMenuItem>
                                )}
                                {enrollment.profile_url && (
                                  <DropdownMenuItem asChild>
                                    <a href={enrollment.profile_url} target="_blank" rel="noopener noreferrer">
                                      <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
                                      Ouvrir le profil LinkedIn
                                    </a>
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          <CollapsibleContent>
                            <div className="border-t border-border px-4 pb-4 pt-3">
                              {visibleSteps.length === 0 ? (
                                <p className="py-2 text-center text-xs text-muted-foreground">
                                  Cette séquence n'a pas encore d'étape.
                                </p>
                              ) : (
                                <>
                                  <p className="eyebrow mb-2">Déroulé</p>
                                  <ol className="space-y-2">
                                    {visibleSteps.map((step) => {
                                      const exec = executions.find(e => e.step_id === step.id);
                                      const status = exec?.status || 'pending';
                                      const isPending = status === 'pending';
                                      const isDone = status === 'executed' || status === 'sent';
                                      const delay = formatStepDelay(step.delay_days, step.delay_hours, step.delay_minutes);
                                      const reason = exec && ['skipped', 'cancelled', 'quota_blocked'].includes(exec.status)
                                        ? skipReasonLabel(exec.skip_reason)
                                        : null;

                                      return (
                                        <li key={step.id} className="flex items-start gap-3 rounded-lg border border-border p-2.5">
                                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                                            <SequenceActionIcon type={step.action_type} />
                                          </span>
                                          <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                              <span className={cn('text-sm font-medium', isPending ? 'text-foreground-secondary' : 'text-foreground')}>
                                                {sequenceActionLabel(step.action_type)}
                                              </span>
                                              <ExecutionStatusBadge status={status} />
                                              {isPending && delay && (
                                                <span className="text-xs text-muted-foreground">Délai {delay}</span>
                                              )}
                                            </div>

                                            {exec?.status === 'scheduled' && (
                                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                                <span className="text-xs text-muted-foreground">Prévue le {formatWhen(exec.scheduled_at)}</span>
                                                <Button
                                                  variant="outline"
                                                  size="xs"
                                                  className="max-md:h-11"
                                                  onClick={() => setConfirmAction({ type: 'skipStep', stepId: exec.id, name })}
                                                >
                                                  Passer l'étape
                                                </Button>
                                              </div>
                                            )}
                                            {isDone && exec?.executed_at && (
                                              <p className="mt-1 text-xs text-muted-foreground">
                                                {status === 'sent' ? 'Envoyée' : 'Faite'} le {formatWhen(exec.executed_at)}
                                              </p>
                                            )}
                                            {reason && <p className="mt-1 text-xs text-muted-foreground">{reason}</p>}
                                            {exec?.status === 'failed' && exec.error_message && (
                                              <p className="mt-1.5 rounded-md bg-danger-muted px-2.5 py-1.5 text-xs text-danger">
                                                Échec : {formatErrorMessage(exec.error_message)}
                                              </p>
                                            )}

                                            {isDone && exec?.final_message && (
                                              <div className="mt-2 rounded-md border border-border bg-background p-2.5 text-xs">
                                                {exec.final_subject && (
                                                  <p className="mb-1 font-medium text-foreground">{exec.final_subject}</p>
                                                )}
                                                <p className="line-clamp-2 leading-relaxed text-foreground-secondary">
                                                  {exec.final_message.replace(/\\n|\n/g, ' ')}
                                                </p>
                                              </div>
                                            )}

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
                    variant="outline"
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
          <AlertDialogTitle>{confirmCopy.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirmCopy.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{confirmCopy.cancel}</AlertDialogCancel>
          <AlertDialogAction
            className={confirmCopy.destructive ? 'bg-destructive' : undefined}
            onClick={handleConfirmedAction}
          >
            {confirmCopy.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
