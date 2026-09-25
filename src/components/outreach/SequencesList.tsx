import React, { useState, useEffect, useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useIsMobile } from '@/hooks/use-mobile';
import { hasPlanFeature } from '@/lib/featureGates';
import { ENROLLMENT_STATUSES, sequenceActionMeta } from '@/lib/sequenceCatalog';
import type { Channel } from '@/lib/channels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Banner, bannerActionClass } from '@/components/ui/banner';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorState } from '@/components/layout/ErrorState';
import {
  Plus,
  Search,
  BarChart3,
  MoreHorizontal,
  Trash2,
  Pencil,
  Users,
  Copy,
  FastForward,
  Activity,
  FileText,
  Lock,
  AlertTriangle,
  Workflow,
  ScrollText,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { toast } from 'sonner';
import { SequenceBuilder, Sequence, SenderAccountConfig, StopConditions } from './SequenceBuilder';
import { SequenceEnrollmentsPanel } from './SequenceEnrollmentsPanel';
import { SequenceActivityLog } from './SequenceActivityLog';
import { SequenceDiagnostic } from './SequenceDiagnostic';
// Q5 — SequenceAnalytics contient recharts (~100KB), lazy-load pour split chunk
const SequenceAnalytics = React.lazy(() => import('./SequenceAnalytics'));
import { SequenceTemplateSelector, SaveAsTemplateModal } from './SequenceTemplateSelector';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface SequenceWithStats {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  project_id: string | null;
  steps: any[];
  stop_conditions?: StopConditions | null;
  sender_accounts?: SenderAccountConfig[] | null;
  rotation_mode?: string | null;
  multi_sender_enabled?: boolean | null;
  enrollments: {
    total: number;
    active: number;
    completed: number;
    replied: number;
  };
}

interface SequencesListProps {
  // Passés par l'onglet Outreach. La liste n'en a plus besoin depuis le
  // retrait de l'inscription par clic sur une ligne, jamais branchée (revue
  // design D-27) : l'inscription passe par la messagerie et la recherche.
  accounts?: { id: string; name: string }[];
  selectedAccount?: string | null;
  isVisible?: boolean;
  projectId?: string | null;
}

const plural = (n: number, singular: string, pluralForm = `${singular}s`) => `${n} ${n > 1 ? pluralForm : singular}`;

/** Canaux employés par une séquence, dans un ordre stable (revue design D-24). */
const CHANNEL_ORDER: Channel[] = ['linkedin', 'email', 'whatsapp', 'call'];
function sequenceChannels(steps: { action_type?: string | null }[]): Channel[] {
  const used = new Set<Channel>();
  for (const step of steps) {
    const channel = sequenceActionMeta(step.action_type)?.channel;
    if (channel) used.add(channel);
  }
  return CHANNEL_ORDER.filter(c => used.has(c));
}

/** Même grille pour l'en-tête et les lignes, à partir de 1 024 px. */
const ROW_GRID = 'lg:grid-cols-[2.75rem_minmax(0,1fr)_7.5rem_minmax(0,14rem)_9rem_2.25rem]';

export const SequencesList: React.FC<SequencesListProps> = ({
  isVisible = true,
  projectId,
}) => {
  // organization_id est exigé par la policy INSERT d'outreach_sequences
  // (WITH CHECK organization_id = get_user_org_id(auth.uid())) : sans lui, la
  // création et la duplication étaient refusées par RLS.
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const planNoticeId = useId();
  // Gating par plan (lot P0-C) : l'activation d'une séquence est refusée sur le
  // plan gratuit. Tant que l'état d'abonnement charge, on ne refuse rien (le
  // moteur d'envoi côté serveur reste la référence).
  const { effectivePlanId, isLoading: isPlanLoading } = useSubscriptionState();
  const canSendSequences = isPlanLoading || hasPlanFeature(effectivePlanId, 'sequences_send');
  const [sequences, setSequences] = useState<SequenceWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingSequence, setEditingSequence] = useState<Sequence | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toggleConfirm, setToggleConfirm] = useState<{ id: string; nextActive: boolean; activeCount: number } | null>(null);
  const [enrollmentsPanelSequence, setEnrollmentsPanelSequence] = useState<SequenceWithStats | null>(null);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [showGlobalAnalytics, setShowGlobalAnalytics] = useState(false);
  const [analyticsSequence, setAnalyticsSequence] = useState<SequenceWithStats | null>(null);
  const [forceRescheduling, setForceRescheduling] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [saveTemplateSeq, setSaveTemplateSeq] = useState<SequenceWithStats | null>(null);

  /**
   * « Avancer les envois » : avance à maintenant les étapes planifiées des
   * inscriptions en cours de l'organisation, hors invitations LinkedIn. Le
   * cron les envoie au passage suivant, avec ses garde-fous (revue design D-23).
   */
  const handleForceReschedule = async () => {
    setForceRescheduling(true);
    try {
      // `nudge_sequences` avance les actions de MON organisation et laisse le
      // cron les envoyer avec ses garde-fous. Avant, l'UI appelait
      // `force_reschedule` puis `process` avec force : deux actions qui
      // balayaient toutes les organisations et que le serveur refusait à tout
      // utilisateur sans rôle plateforme (401).
      const { data, error } = await invokeEdgeFunction('process-sequences', {
        action: 'nudge_sequences',
        organization_id: organizationId,
      });
      if (error) throw error;
      const payload = data as { success?: boolean; rescheduled?: number; error?: string } | null;
      if (!payload?.success) throw new Error(payload?.error || "Échec de l'avance des envois");
      const count = payload.rescheduled || 0;
      if (count > 0) {
        toast.success(`${plural(count, 'étape avancée', 'étapes avancées')}`, {
          description: 'Elles partent au prochain passage des envois, dans le respect des heures et des limites de vos comptes.',
        });
      } else {
        toast.info('Aucune étape planifiée à avancer');
      }
    } catch (err) {
      console.error('Force reschedule error:', err);
      toast.error("Impossible d'avancer les envois", {
        description: 'Réessayez dans un instant. Si le problème persiste, ouvrez le diagnostic des envois.',
      });
    } finally {
      setForceRescheduling(false);
    }
  };

  // Audit Opus 2026-05-07 : useCallback avec dep `projectId` pour que le
  // listener visibilitychange ne capture pas une closure périmée après un
  // changement de mission.
  const fetchSequences = React.useCallback(async () => {
    try {
      let seqQuery = supabase
        .from('outreach_sequences')
        .select('*')
        .order('created_at', { ascending: false }) as any;

      if (projectId) {
        // Affiche les séquences de la mission courante ET les séquences
        // "globales" (project_id IS NULL) qui servent de templates réutilisables.
        seqQuery = seqQuery.or(`project_id.eq.${projectId},project_id.is.null`);
      }

      const { data: seqData, error: seqError } = await seqQuery;

      if (seqError) throw seqError;

      const sequenceIds = seqData?.map(s => s.id) || [];
      const { data: stepsData, error: stepsError } = await supabase
        .from('sequence_steps')
        .select('*')
        .in('sequence_id', sequenceIds)
        .order('step_order', { ascending: true });
      // Une lecture en échec ne s'affiche pas en « 0 inscrit » : elle remonte.
      if (stepsError) throw stepsError;

      const { data: enrollData, error: enrollError } = await supabase
        .from('sequence_enrollments')
        .select('sequence_id, status')
        .in('sequence_id', sequenceIds);
      if (enrollError) throw enrollError;

      const enriched: SequenceWithStats[] = (seqData || []).map((seq) => {
        const steps = stepsData?.filter(s => s.sequence_id === seq.id) || [];
        const enrollments = enrollData?.filter(e => e.sequence_id === seq.id) || [];

        return {
          ...seq,
          steps,
          enrollments: {
            total: enrollments.length,
            active: enrollments.filter(e => e.status === 'active').length,
            completed: enrollments.filter(e => e.status === 'completed').length,
            replied: enrollments.filter(e => e.status === 'replied').length,
          },
        };
      });

      setSequences(enriched);
      setLoadError(null);
    } catch (err) {
      console.error('Error fetching sequences:', err);
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Refetch when component becomes visible (tab change or page visibility)
  useEffect(() => {
    fetchSequences();

    // Listen for visibility changes (when user returns to browser tab)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchSequences();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchSequences]);

  // Refetch when tab becomes visible within the app
  useEffect(() => {
    if (isVisible) {
      fetchSequences();
    }
  }, [isVisible, fetchSequences]);

  const handleRetry = async () => {
    setRetrying(true);
    await fetchSequences();
    setRetrying(false);
  };

  const handleSaveSequence = async (sequence: Sequence) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');
      if (!organizationId) throw new Error('Organisation introuvable : rechargez la page');

      // Payload de steps envoyé à la RPC transactionnelle `save_sequence_steps`.
      // On garde `id` = id CLIENT (= id DB pour un step existant, id généré pour
      // un nouveau) : la RPC s'en sert pour faire l'UPDATE in-place des steps
      // existants (préserve leurs exécutions planifiées) et pour remapper les
      // refs de branchement (if_true/false_goto, timeout_branch, next_step).
      const buildStepsPayload = () => sequence.steps.map(step => ({
        id: step.id,
        step_order: step.order,
        action_type: step.actionType,
        condition_type: step.conditionType,
        condition_value: step.conditionValue ?? null,
        delay_days: step.delayDays ?? 0,
        delay_hours: step.delayHours ?? 0,
        delay_minutes: step.delayMinutes ?? 0,
        preferred_hour_start: step.preferredHourStart ?? null,
        preferred_hour_end: step.preferredHourEnd ?? null,
        subject_template: step.subjectTemplate ?? null,
        message_template: step.messageTemplate ?? null,
        use_ai_personalization: step.useAiPersonalization ?? false,
        ai_tone: step.aiTone ?? null,
        timeout_days: step.timeoutDays ?? null,
        wait_for_event: step.waitForEvent ?? null,
        variant_group: step.variantGroup ?? null,
        variant_weight: step.variantWeight ?? 100,
        // '__end__' = sentinelle « Fin de séquence » du StepEditor : persistée
        // via ends_sequence (avant, elle devenait next_step_id=null = « auto »
        // et le moteur enchaînait quand même sur l'étape suivante).
        ends_sequence: step.nextStepId === '__end__',
        cc_emails: step.ccEmails ?? null,
        bcc_emails: step.bccEmails ?? null,
        include_unsubscribe: step.includeUnsubscribe ?? null,
        signature_id: step.signatureId ?? null,
        if_true_goto_step: step.ifTrueGotoStep ?? null,
        if_false_goto_step: step.ifFalseGotoStep ?? null,
        timeout_branch_step_id: step.timeoutBranchStepId ?? null,
        next_step_id: step.nextStepId === '__end__' ? null : (step.nextStepId ?? null),
      }));

      // Réglages « Expéditeurs » et « Garde-fous » : les mêmes colonnes à la
      // création et en modification (revue design D-30). Avant, la création
      // n'écrivait que le nom, la description et le statut.
      const sequenceSettings = {
        stop_conditions: sequence.stopConditions || null,
        sender_accounts: sequence.senderAccounts || null,
        rotation_mode: sequence.rotationMode || null,
        multi_sender_enabled: sequence.multiSenderEnabled || false,
      };

      let targetSequenceId: string;

      if (sequence.id) {
        // UPDATE de l'entête de séquence uniquement (les steps passent par la RPC).
        const { error: updateError } = await supabase
          .from('outreach_sequences')
          .update({
            name: sequence.name,
            description: sequence.description,
            is_active: sequence.isActive,
            ...sequenceSettings,
          } as any)
          .eq('id', sequence.id);

        if (updateError) throw updateError;
        targetSequenceId = sequence.id;
      } else {
        // CREATE de l'entête de séquence.
        const { data: newSeq, error: createError } = await supabase
          .from('outreach_sequences')
          .insert({
            name: sequence.name,
            description: sequence.description,
            is_active: sequence.isActive,
            created_by: user.id,
            organization_id: organizationId,
            project_id: projectId || null,
            ...sequenceSettings,
          } as any)
          .select()
          .single();

        if (createError) throw createError;
        targetSequenceId = newSeq.id;
      }

      // Sauvegarde transactionnelle des steps : UPDATE in-place des existants,
      // INSERT des nouveaux, DELETE des seuls steps réellement retirés. Ne
      // détruit PLUS les exécutions planifiées des enrollments actifs (bloquant B1).
      const { error: stepsError } = await supabase.rpc('save_sequence_steps' as any, {
        p_sequence_id: targetSequenceId,
        p_steps: buildStepsPayload(),
      });

      if (stepsError) throw stepsError;

      // Un seul message, qui dit ce qui a été fait (revue design D-34).
      if (sequence.id) {
        toast.success(`Modifications de « ${sequence.name} » enregistrées`);
      } else if (sequence.isActive) {
        toast.success(`Séquence « ${sequence.name} » créée et activée`);
      } else {
        toast.success(`Séquence « ${sequence.name} » enregistrée`, {
          description: 'Elle reste inactive : activez-la depuis la liste quand vous le souhaitez.',
        });
      }

      fetchSequences();
      setShowBuilder(false);
      setEditingSequence(null);
    } catch (err) {
      // Relancé pour que SequenceBuilder.handleSave garde l'éditeur ouvert et
      // annonce l'échec (les modifications étaient perdues).
      console.error('Error saving sequence:', err);
      throw err;
    }
  };

  const handleToggleActive = async (sequenceId: string, isActive: boolean) => {
    // Activer (pas désactiver) exige un plan qui autorise l'envoi de séquences.
    if (!isActive && !canSendSequences) {
      toast.error("Votre offre ne permet pas d'envoyer des séquences", {
        action: { label: 'Voir les offres', onClick: () => navigate('/pricing') },
      });
      return;
    }
    try {
      const newActive = !isActive;

      // 1. Update sequence is_active flag
      const { error } = await supabase
        .from('outreach_sequences')
        .update({ is_active: newActive })
        .eq('id', sequenceId);

      if (error) throw error;

      // 2. Pause or resume enrollments accordingly
      let changedEnrollments = 0;
      if (newActive) {
        // Reactivate paused enrollments
        const { data: pausedEnrollments, error: resumeError } = await supabase
          .from('sequence_enrollments')
          .update({ status: 'active', pause_reason: null })
          .eq('sequence_id', sequenceId)
          .eq('status', 'paused')
          .select('id, current_step_order');
        if (resumeError) throw resumeError;
        changedEnrollments = pausedEnrollments?.length ?? 0;

        // Only reschedule the NEXT pending step per enrollment (not all future steps)
        if (pausedEnrollments && pausedEnrollments.length > 0) {
          const now = new Date().toISOString();

          for (const enrollment of pausedEnrollments) {
            // Find the earliest stuck execution for this enrollment
            const { data: nextExec } = await supabase
              .from('sequence_step_executions' as any)
              .select('id')
              .eq('enrollment_id', enrollment.id)
              .in('status', ['scheduled', 'waiting_event', 'quota_blocked'])
              .order('step_order', { ascending: true })
              .limit(1);

            if (nextExec && (nextExec as any[]).length > 0) {
              await supabase
                .from('sequence_step_executions' as any)
                .update({ scheduled_at: now, status: 'scheduled' })
                .eq('id', (nextExec as any[])[0].id);
            }
          }
        }
      } else {
        // Pause active enrollments
        const { data: pausedNow, error: pauseError } = await supabase
          .from('sequence_enrollments')
          .update({ status: 'paused', pause_reason: 'manual' })
          .eq('sequence_id', sequenceId)
          .eq('status', 'active')
          .select('id');
        if (pauseError) throw pauseError;
        changedEnrollments = pausedNow?.length ?? 0;
      }

      setSequences(prev =>
        prev.map(s => s.id === sequenceId ? { ...s, is_active: newActive } : s)
      );

      if (newActive) {
        toast.success('Séquence activée', {
          description: changedEnrollments > 0
            ? `${plural(changedEnrollments, 'inscription en pause reprend', 'inscriptions en pause reprennent')}.`
            : undefined,
        });
      } else {
        toast.success('Séquence désactivée', {
          description: changedEnrollments > 0
            ? `${plural(changedEnrollments, 'inscription mise', 'inscriptions mises')} en pause.`
            : undefined,
        });
      }
    } catch (err) {
      console.error('Error toggling sequence:', err);
      toast.error(isActive ? 'Impossible de désactiver la séquence' : "Impossible d'activer la séquence", {
        description: 'Vérifiez votre connexion, puis réessayez.',
      });
    }
  };

  const handleDelete = async (sequenceId: string) => {
    const name = sequences.find(s => s.id === sequenceId)?.name;
    try {
      const { error } = await supabase
        .from('outreach_sequences')
        .delete()
        .eq('id', sequenceId);

      if (error) throw error;

      setSequences(prev => prev.filter(s => s.id !== sequenceId));
      toast.success(name ? `Séquence « ${name} » supprimée` : 'Séquence supprimée');
    } catch (err) {
      console.error('Error deleting sequence:', err);
      toast.error('Impossible de supprimer la séquence', { description: 'Réessayez dans un instant.' });
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleDuplicate = async (seq: SequenceWithStats) => {
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
      if (stepsErr) throw stepsErr;

      // 2. Crée la nouvelle séquence avec un nom suffixé "(copie)", avec les
      // mêmes expéditeurs et garde-fous que l'originale.
      const { data: newSeq, error: seqErr } = await (supabase
        .from('outreach_sequences')
        .insert({
          name: `${seq.name} (copie)`,
          description: seq.description,
          is_active: false, // toujours inactive par défaut, l'user choisit quand activer
          created_by: user.id,
          organization_id: organizationId,
          stop_conditions: seq.stop_conditions ?? null,
          sender_accounts: seq.sender_accounts ?? null,
          rotation_mode: seq.rotation_mode ?? null,
          multi_sender_enabled: seq.multi_sender_enabled ?? false,
          ...(projectId ? { project_id: projectId } : {}),
        } as any)
        .select()
        .single() as any);
      if (seqErr || !newSeq) throw seqErr || new Error('Création échouée');

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
          timeout_days: s.timeout_days ?? null,
          wait_for_event: s.wait_for_event ?? null,
          variant_group: s.variant_group ?? null,
          variant_weight: s.variant_weight ?? 100,
          if_true_goto_step: s.if_true_goto_step ?? null,
          if_false_goto_step: s.if_false_goto_step ?? null,
          timeout_branch_step_id: s.timeout_branch_step_id ?? null,
          next_step_id: s.next_step_id ?? null,
        }));
        const { error: stepsCreateErr } = await supabase.rpc('save_sequence_steps' as any, {
          p_sequence_id: newSeq.id,
          p_steps: payload,
        });
        if (stepsCreateErr) throw stepsCreateErr;
      }

      toast.success(`Séquence dupliquée : « ${newSeq.name} »`, {
        description: "La copie reste inactive tant que vous ne l'activez pas.",
      });
      // Refresh la liste
      await fetchSequences();
    } catch (err) {
      console.error('Error duplicating sequence:', err);
      toast.error('Impossible de dupliquer la séquence', { description: 'Réessayez dans un instant.' });
    }
  };

  const handleEdit = (seq: SequenceWithStats) => {
    const sequence: Sequence = {
      id: seq.id,
      name: seq.name,
      description: seq.description || undefined,
      isActive: seq.is_active,
      // Réglages relus pour que l'enregistrement ne les remplace pas par des
      // valeurs vides (revue design D-30).
      stopConditions: seq.stop_conditions ?? undefined,
      senderAccounts: seq.sender_accounts ?? undefined,
      rotationMode: seq.rotation_mode ?? undefined,
      multiSenderEnabled: seq.multi_sender_enabled ?? undefined,
      steps: seq.steps.map(s => ({
        id: s.id,
        order: s.step_order,
        actionType: s.action_type,
        conditionType: s.condition_type || 'always',
        conditionValue: s.condition_value ?? undefined,
        delayDays: s.delay_days,
        delayHours: s.delay_hours,
        delayMinutes: s.delay_minutes || 0,
        preferredHourStart: s.preferred_hour_start ?? 9,
        preferredHourEnd: s.preferred_hour_end ?? 18,
        subjectTemplate: s.subject_template,
        messageTemplate: s.message_template,
        useAiPersonalization: s.use_ai_personalization,
        aiTone: s.ai_tone,
        timeoutDays: s.timeout_days,
        waitForEvent: s.wait_for_event,
        // Recharger AUSSI les configs A/B et options email — avant, une simple
        // ré-édition + save détruisait variant_group/cc/bcc/signature
        // silencieusement (audit 2026-07, Builder H3).
        variantGroup: s.variant_group ?? undefined,
        variantWeight: s.variant_weight ?? undefined,
        ccEmails: s.cc_emails ?? undefined,
        bccEmails: s.bcc_emails ?? undefined,
        includeUnsubscribe: s.include_unsubscribe ?? undefined,
        signatureId: s.signature_id ?? undefined,
        timeoutBranchStepId: s.timeout_branch_step_id,
        ifTrueGotoStep: s.if_true_goto_step,
        ifFalseGotoStep: s.if_false_goto_step,
        nextStepId: s.ends_sequence ? '__end__' : s.next_step_id,
      })),
    };
    setEditingSequence(sequence);
    setShowBuilder(true);
  };

  const handleCreateNew = () => {
    setShowTemplateSelector(true);
  };

  const handleSelectBlank = () => {
    setShowTemplateSelector(false);
    setEditingSequence(null);
    setShowBuilder(true);
  };

  const handleSelectTemplate = (sequence: Sequence) => {
    setShowTemplateSelector(false);
    setEditingSequence(sequence);
    setShowBuilder(true);
  };

  const filteredSequences = sequences.filter(seq =>
    seq.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const advanceHelp =
    "Avance à maintenant les étapes planifiées de toutes les séquences de l'organisation, sauf les invitations LinkedIn. Elles partent au prochain passage des envois, dans le respect des heures d'envoi et des limites de vos comptes.";

  const deleteTarget = sequences.find(s => s.id === deleteConfirmId);
  const toggleTarget = sequences.find(s => s.id === toggleConfirm?.id);

  // ── Une ligne par séquence, la même sur téléphone et sur ordinateur (revue design D-24, D-26) ──
  const renderRow = (seq: SequenceWithStats) => {
    const channels = sequenceChannels(seq.steps);
    const activationBlocked = !seq.is_active && !canSendSequences;
    const createdAt = new Date(seq.created_at);
    const { total, active, replied, completed } = seq.enrollments;

    return (
      <li
        key={seq.id}
        className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-4 py-3 transition-colors duration-150 hover:bg-accent/40 lg:items-center lg:gap-x-4 ${ROW_GRID}`}
      >
        {/* Activation (revue design D-25) */}
        <div className="flex items-center gap-1">
          <label className="-m-2.5 inline-flex cursor-pointer items-center justify-center p-2.5 lg:m-0 lg:p-0">
            <Switch
              checked={seq.is_active}
              disabled={activationBlocked}
              aria-label={`Activer la séquence « ${seq.name} »`}
              aria-describedby={activationBlocked ? planNoticeId : undefined}
              onCheckedChange={(next) => {
                // Confirmation requise si on désactive ET qu'il y a des actifs
                // (peut couper l'envoi pour 50+ candidats par clic).
                if (!next && seq.enrollments.active > 0) {
                  setToggleConfirm({ id: seq.id, nextActive: false, activeCount: seq.enrollments.active });
                  return;
                }
                handleToggleActive(seq.id, seq.is_active);
              }}
            />
          </label>
          {activationBlocked && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground lg:hidden" aria-hidden="true" />}
        </div>

        {/* Nom, canaux, description */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {channels.length > 0 && (
              <span className="flex shrink-0 items-center gap-1">
                {channels.map(channel => <ChannelIcon key={channel} channel={channel} size="sm" />)}
              </span>
            )}
            <p className="min-w-0 break-words text-sm font-medium text-foreground">{seq.name}</p>
            {!seq.project_id && <Badge variant="muted">Toutes les missions</Badge>}
          </div>
          {seq.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{seq.description}</p>}
        </div>

        {/* Inscrits, statuts, date, actions : sous le nom sur téléphone, en colonnes à partir de 1 024 px */}
        <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 lg:contents">
          <div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setEnrollmentsPanelSequence(seq)}
              className="-ml-2.5 gap-1.5 text-foreground max-md:h-11"
            >
              <Users aria-hidden="true" />
              {total > 0 ? plural(total, 'inscrit') : 'Aucun inscrit'}
              <span className="sr-only"> dans « {seq.name} » : voir les inscriptions</span>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {active > 0 && <Badge variant={ENROLLMENT_STATUSES.active.tone}>{active} en cours</Badge>}
            {replied > 0 && <Badge variant={ENROLLMENT_STATUSES.replied.tone}>{replied} {replied > 1 ? 'ont répondu' : 'a répondu'}</Badge>}
            {completed > 0 && <Badge variant={ENROLLMENT_STATUSES.completed.tone}>{plural(completed, 'terminée')}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="lg:sr-only">Créée </span>
            <time dateTime={seq.created_at} title={format(createdAt, "d MMMM yyyy 'à' HH:mm", { locale: fr })}>
              {formatDistanceToNow(createdAt, { addSuffix: true, locale: fr })}
            </time>
          </p>
          <div className="ml-auto lg:ml-0 lg:justify-self-end">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11"
                      aria-label={`Actions de la séquence « ${seq.name} »`}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Actions</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleEdit(seq)} className="gap-2 max-md:min-h-11">
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Modifier
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAnalyticsSequence(seq)} className="gap-2 max-md:min-h-11">
                  <BarChart3 className="h-4 w-4" aria-hidden="true" />
                  Statistiques
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDuplicate(seq)} className="gap-2 max-md:min-h-11">
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Dupliquer
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSaveTemplateSeq(seq)} className="gap-2 max-md:min-h-11">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  Enregistrer comme modèle
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setDeleteConfirmId(seq.id)}
                  className="gap-2 text-destructive focus:text-destructive max-md:min-h-11"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Supprimer
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </li>
    );
  };

  const renderBody = () => {
    // Un seul chargement, en forme de tableau, sans phrase simulée (revue design D-22).
    if (loading) {
      return (
        <div role="status" aria-label="Chargement des séquences" className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden border-b border-border bg-muted/40 px-4 py-2.5 lg:block">
            <Skeleton className="h-3 w-40" />
          </div>
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-b-0">
              <Skeleton className="h-6 w-11 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="hidden h-7 w-24 lg:block" />
              <Skeleton className="hidden h-5 w-36 lg:block" />
            </div>
          ))}
        </div>
      );
    }

    // Une panne s'affiche comme une panne, jamais comme une liste vide.
    if (loadError && sequences.length === 0) {
      return (
        <ErrorState
          title="Impossible de charger les séquences"
          description="Vérifiez votre connexion, puis réessayez. Vos séquences ne sont pas perdues."
          detail={loadError}
          onRetry={handleRetry}
          retrying={retrying}
        />
      );
    }

    if (sequences.length === 0) {
      return (
        <EmptyState
          icon={Workflow}
          title="Aucune séquence pour cette mission"
          description="Une séquence contacte vos candidats en plusieurs étapes : invitation, message, relance. L'IA Konekt peut adapter chaque message au profil et au poste."
          action={
            <Button type="button" variant="outline" size="sm" onClick={handleCreateNew} className="max-md:h-11">
              <Plus aria-hidden="true" />
              Nouvelle séquence
            </Button>
          }
        />
      );
    }

    return (
      <>
        {loadError && (
          <Banner tone="warning" icon={AlertTriangle} role="alert" className="rounded-lg border" action={
            <Button type="button" variant="link" onClick={handleRetry} loading={retrying} className={`h-auto p-0 ${bannerActionClass}`}>
              Réessayer
            </Button>
          }>
            La liste n'a pas pu être actualisée : elle date du dernier chargement.
          </Banner>
        )}

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Rechercher une séquence"
            placeholder="Rechercher une séquence…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {filteredSequences.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={Search}
            title={`Aucune séquence ne correspond à « ${searchQuery.trim()} »`}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => setSearchQuery('')} className="max-md:h-11">
                Effacer la recherche
              </Button>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {/* En-tête de colonnes, à partir de 1 024 px ; chaque cellule se lit aussi seule */}
            <div
              aria-hidden="true"
              className={`hidden gap-4 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-medium text-muted-foreground lg:grid ${ROW_GRID}`}
            >
              <span>Active</span>
              <span>Séquence</span>
              <span>Inscrits</span>
              <span>Statuts</span>
              <span>Créée</span>
              <span />
            </div>
            <ul className="divide-y divide-border" aria-label="Séquences">
              {filteredSequences.map(renderRow)}
            </ul>
          </div>
        )}
      </>
    );
  };

  return (
    <section className="space-y-4" aria-labelledby="sequences-title">
      {/* En-tête et barre d'outils (revue design D-23) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sequences-title" className="text-base font-semibold text-foreground">Séquences</h2>
        <div className="flex items-center gap-2">
          {!isMobile && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="outline" size="sm" onClick={handleForceReschedule} loading={forceRescheduling}>
                  {!forceRescheduling && <FastForward aria-hidden="true" />}
                  Avancer les envois
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{advanceHelp}</TooltipContent>
            </Tooltip>
          )}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="icon-sm" aria-label="Plus d'actions" className="max-md:h-11 max-md:w-11">
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Plus d'actions</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-72">
              {isMobile && (
                <>
                  <DropdownMenuItem onClick={handleForceReschedule} disabled={forceRescheduling} className="items-start gap-2 max-md:min-h-11">
                    <FastForward className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="block">{forceRescheduling ? 'Envois en cours d\'avance…' : 'Avancer les envois'}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{advanceHelp}</span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onClick={() => setShowGlobalAnalytics(true)} className="gap-2 max-md:min-h-11">
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
                Statistiques
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowActivityLog(true)} className="gap-2 max-md:min-h-11">
                <ScrollText className="h-4 w-4" aria-hidden="true" />
                Journal des envois
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowDiagnostic(true)} className="gap-2 max-md:min-h-11">
                <Activity className="h-4 w-4" aria-hidden="true" />
                Diagnostic des envois
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" variant="primary" size="sm" onClick={handleCreateNew} className="max-md:h-11">
            <Plus aria-hidden="true" />
            Nouvelle séquence
          </Button>
        </div>
      </div>

      {/* Sans abonnement : on prépare, on n'active pas (revue design D-25) */}
      {!canSendSequences && (
        <Banner
          tone="info"
          icon={Lock}
          className="rounded-lg border"
          action={<Link to="/pricing" className={bannerActionClass}>Voir les offres</Link>}
        >
          <span id={planNoticeId}>Votre offre ne permet pas d'envoyer des séquences : vous pouvez les préparer, pas les activer.</span>
        </Banner>
      )}

      {renderBody()}

      {/* Template Selector */}
      <SequenceTemplateSelector
        isOpen={showTemplateSelector}
        onClose={() => setShowTemplateSelector(false)}
        onSelectBlank={handleSelectBlank}
        onSelectTemplate={handleSelectTemplate}
        existingSequences={sequences}
      />

      {/* Save as Template */}
      {saveTemplateSeq && (
        <SaveAsTemplateModal
          isOpen={!!saveTemplateSeq}
          onClose={() => setSaveTemplateSeq(null)}
          sequenceId={saveTemplateSeq.id}
          sequenceName={saveTemplateSeq.name}
          steps={saveTemplateSeq.steps}
        />
      )}

      {/* Éditeur */}
      {showBuilder && (
        <SequenceBuilder
          isOpen={showBuilder}
          onClose={() => {
            setShowBuilder(false);
            setEditingSequence(null);
          }}
          onSave={handleSaveSequence}
          initialSequence={editingSequence || undefined}
          canActivate={canSendSequences}
        />
      )}

      {/* Enrollments panel */}
      {enrollmentsPanelSequence && (
        <SequenceEnrollmentsPanel
          isOpen={!!enrollmentsPanelSequence}
          onClose={() => setEnrollmentsPanelSequence(null)}
          sequenceId={enrollmentsPanelSequence.id}
          sequenceName={enrollmentsPanelSequence.name}
        />
      )}

      {/* Activity Log */}
      <SequenceActivityLog
        isOpen={showActivityLog}
        onClose={() => setShowActivityLog(false)}
      />

      {/* Diagnostic */}
      <SequenceDiagnostic
        open={showDiagnostic}
        onOpenChange={setShowDiagnostic}
        projectId={projectId}
      />

      {/* Global Analytics — lazy chunk recharts */}
      {showGlobalAnalytics && (
        <React.Suspense fallback={null}>
          <SequenceAnalytics
            isOpen={showGlobalAnalytics}
            onClose={() => setShowGlobalAnalytics(false)}
          />
        </React.Suspense>
      )}

      {/* Per-sequence Analytics — lazy chunk recharts */}
      {analyticsSequence && (
        <React.Suspense fallback={null}>
          <SequenceAnalytics
            isOpen={!!analyticsSequence}
            onClose={() => setAnalyticsSequence(null)}
            sequenceId={analyticsSequence.id}
            sequenceName={analyticsSequence.name}
          />
        </React.Suspense>
      )}

      {/* Confirmation de suppression, avec l'impact chiffré */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget ? `Supprimer la séquence « ${deleteTarget.name} » ?` : 'Supprimer cette séquence ?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Cette action est irréversible : les candidats inscrits sont retirés et leur historique d'envoi
                  (étapes planifiées et envoyées) est supprimé.
                </p>
                {deleteTarget && deleteTarget.enrollments.total > 0 && (
                  <p className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-muted px-3 py-2 text-sm text-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                    <span>
                      {plural(deleteTarget.enrollments.total, 'candidat inscrit', 'candidats inscrits')}
                      {deleteTarget.enrollments.active > 0 && `, dont ${deleteTarget.enrollments.active} en cours d'envoi`}.
                    </span>
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Supprimer la séquence
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Désactivation d'une séquence qui a des candidats en cours */}
      <AlertDialog open={!!toggleConfirm} onOpenChange={() => setToggleConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleTarget ? `Désactiver la séquence « ${toggleTarget.name} » ?` : 'Désactiver cette séquence ?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {plural(toggleConfirm?.activeCount || 0, 'candidat en cours sera mis', 'candidats en cours seront mis')} en
                  pause. Aucun message ne partira tant que la séquence restera désactivée.
                </p>
                <p>
                  Vous pourrez la réactiver à tout moment : les inscriptions reprendront là où elles en étaient.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toggleConfirm) handleToggleActive(toggleConfirm.id, true);
                setToggleConfirm(null);
              }}
            >
              Désactiver la séquence
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
