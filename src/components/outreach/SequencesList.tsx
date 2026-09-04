import React, { useState, useEffect } from 'react';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Search,
  BarChart3,
  MoreHorizontal,
  Trash2, 
  Edit2,
  Users,
  Sparkles,
  Send,
  Mail,
  UserPlus,
  Eye,
  MessageSquare,
  Activity,
  Zap,
  FileText,
  BookTemplate,
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
import { cn } from '@/lib/utils';
import { SequenceBuilder, Sequence, SequenceStep } from './SequenceBuilder';
import { SequenceEnrollModal } from './SequenceEnrollModal';
import { SequenceEnrollmentsPanel } from './SequenceEnrollmentsPanel';
import { SequenceActivityLog } from './SequenceActivityLog';
import { SequenceDiagnostic } from './SequenceDiagnostic';
// Q5 — SequenceAnalytics contient recharts (~100KB), lazy-load pour split chunk
const SequenceAnalytics = React.lazy(() => import('./SequenceAnalytics'));
import { SequenceTemplateSelector, SaveAsTemplateModal } from './SequenceTemplateSelector';
import { LinkedInProfile } from './types';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface SequenceWithStats {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  project_id: string | null;
  steps: any[];
  enrollments: {
    total: number;
    active: number;
    completed: number;
    replied: number;
  };
}

interface SequencesListProps {
  accounts: { id: string; name: string }[];
  selectedAccount: string | null;
  selectedProfiles?: LinkedInProfile[];
  selectedJob?: any;
  onClearSelection?: () => void;
  isVisible?: boolean;
  projectId?: string | null;
}

// Emoji pour les séquences
const SEQUENCE_EMOJIS = ['🎯', '🚀', '💼', '✨', '🔥', '💡', '📈', '🎨', '⚡', '🏆', '💪', '🌟'];

export const SequencesList: React.FC<SequencesListProps> = ({
  accounts,
  selectedAccount,
  selectedProfiles = [],
  selectedJob,
  onClearSelection,
  isVisible = true,
  projectId,
}) => {
  // organization_id est exigé par la policy INSERT d'outreach_sequences
  // (WITH CHECK organization_id = get_user_org_id(auth.uid())) : sans lui, la
  // création et la duplication étaient refusées par RLS.
  const { organizationId } = useOrganization();
  const [sequences, setSequences] = useState<SequenceWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingSequence, setEditingSequence] = useState<Sequence | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [toggleConfirm, setToggleConfirm] = useState<{ id: string; nextActive: boolean; activeCount: number } | null>(null);
  const [enrollModalSequence, setEnrollModalSequence] = useState<SequenceWithStats | null>(null);
  const [enrollmentsPanelSequence, setEnrollmentsPanelSequence] = useState<SequenceWithStats | null>(null);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [showGlobalAnalytics, setShowGlobalAnalytics] = useState(false);
  const [analyticsSequence, setAnalyticsSequence] = useState<SequenceWithStats | null>(null);
  const [forceRescheduling, setForceRescheduling] = useState(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [saveTemplateSeq, setSaveTemplateSeq] = useState<SequenceWithStats | null>(null);

  const handleForceReschedule = async () => {
    setForceRescheduling(true);
    try {
      const { data, error } = await invokeEdgeFunction('process-sequences', {
        action: 'force_reschedule',
      });
      if (error) throw error;
      const count = (data as any)?.rescheduled || 0;
      if (count > 0) {
        toast.success(`${count} action(s) avancée(s) à maintenant — elles partent dans les prochaines minutes !`);
        // Trigger process immediately after reschedule
        await invokeEdgeFunction('process-sequences', { action: 'process', force: true });
      } else {
        toast.info('Aucune action en attente à avancer pour aujourd\'hui');
      }
    } catch (err) {
      console.error('Force reschedule error:', err);
      toast.error('Erreur lors de l\'accélération');
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
      const { data: stepsData } = await supabase
        .from('sequence_steps')
        .select('*')
        .in('sequence_id', sequenceIds)
        .order('step_order', { ascending: true });

      const { data: enrollData } = await supabase
        .from('sequence_enrollments')
        .select('sequence_id, status')
        .in('sequence_id', sequenceIds);

      const enriched: SequenceWithStats[] = (seqData || []).map((seq, index) => {
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
    } catch (err) {
      console.error('Error fetching sequences:', err);
      toast.error('Erreur lors du chargement des séquences');
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

  const handleSaveSequence = async (sequence: Sequence) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');
      if (!organizationId) throw new Error('Organisation introuvable — rechargez la page');

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

      let targetSequenceId: string;

      if (sequence.id) {
        // UPDATE de l'entête de séquence uniquement (les steps passent par la RPC).
        const { error: updateError } = await supabase
          .from('outreach_sequences')
          .update({
            name: sequence.name,
            description: sequence.description,
            is_active: sequence.isActive,
            stop_conditions: sequence.stopConditions || null,
            sender_accounts: sequence.senderAccounts || null,
            rotation_mode: sequence.rotationMode || null,
            multi_sender_enabled: sequence.multiSenderEnabled || false,
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

      toast.success(sequence.id ? 'Séquence mise à jour' : 'Séquence créée');

      fetchSequences();
      setShowBuilder(false);
      setEditingSequence(null);
    } catch (err) {
      // Relancé pour que SequenceBuilder.handleSave n'affiche pas
      // « Séquence enregistrée » et ne ferme pas le builder sur un échec
      // (les modifications étaient perdues).
      console.error('Error saving sequence:', err);
      throw err;
    }
  };

  const handleToggleActive = async (sequenceId: string, isActive: boolean) => {
    try {
      const newActive = !isActive;
      
      // 1. Update sequence is_active flag
      const { error } = await supabase
        .from('outreach_sequences')
        .update({ is_active: newActive })
        .eq('id', sequenceId);

      if (error) throw error;

      // 2. Pause or resume enrollments accordingly
      if (newActive) {
        // Reactivate paused enrollments
        const { data: pausedEnrollments } = await supabase
          .from('sequence_enrollments')
          .update({ status: 'active' })
          .eq('sequence_id', sequenceId)
          .eq('status', 'paused')
          .select('id, current_step_order');

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
        await supabase
          .from('sequence_enrollments')
          .update({ status: 'paused' })
          .eq('sequence_id', sequenceId)
          .eq('status', 'active');
      }
      
      setSequences(prev =>
        prev.map(s => s.id === sequenceId ? { ...s, is_active: newActive } : s)
      );
      
      toast.success(isActive ? 'Séquence désactivée — enrollments mis en pause' : 'Séquence réactivée — enrollments relancés');
    } catch (err) {
      console.error('Error toggling sequence:', err);
      toast.error('Erreur lors de la modification');
    }
  };

  const handleDelete = async (sequenceId: string) => {
    try {
      const { error } = await supabase
        .from('outreach_sequences')
        .delete()
        .eq('id', sequenceId);

      if (error) throw error;

      setSequences(prev => prev.filter(s => s.id !== sequenceId));
      toast.success('Séquence supprimée');
    } catch (err) {
      console.error('Error deleting sequence:', err);
      toast.error('Erreur lors de la suppression');
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleDuplicate = async (seq: SequenceWithStats) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      if (!organizationId) throw new Error('Organisation introuvable — rechargez la page');

      // 1. Charge les steps réelles depuis la DB
      const { data: steps, error: stepsErr } = await (supabase
        .from('sequence_steps')
        .select('*')
        .eq('sequence_id', seq.id)
        .order('step_order', { ascending: true }) as any);
      if (stepsErr) throw stepsErr;

      // 2. Crée la nouvelle séquence avec un nom suffixé "(copie)"
      const { data: newSeq, error: seqErr } = await (supabase
        .from('outreach_sequences')
        .insert({
          name: `${seq.name} (copie)`,
          description: seq.description,
          is_active: false, // toujours inactive par défaut, l'user choisit quand activer
          created_by: user.id,
          organization_id: organizationId,
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

      toast.success(`Séquence dupliquée : "${newSeq.name}"`, {
        description: 'Inactive par défaut. Active-la quand tu es prêt.',
      });
      // Refresh la liste
      await fetchSequences();
    } catch (err) {
      console.error('Error duplicating sequence:', err);
      toast.error('Erreur lors de la duplication', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleEdit = (seq: SequenceWithStats) => {
    const sequence: Sequence = {
      id: seq.id,
      name: seq.name,
      description: seq.description || undefined,
      isActive: seq.is_active,
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

  const handleEnrollSuccess = () => {
    setEnrollModalSequence(null);
    onClearSelection?.();
    fetchSequences();
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

  const getSequenceEmoji = (index: number) => {
    return SEQUENCE_EMOJIS[index % SEQUENCE_EMOJIS.length];
  };

  if (loading) {
    return <BrutalLoader variant="sequences" rows={4} />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-lg sm:text-xl font-semibold text-foreground tracking-tight">Séquences</h1>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setShowGlobalAnalytics(true)}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted/50 transition-colors shrink-0"
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Analytics</span>
          </button>
          <button
            onClick={handleForceReschedule}
            disabled={forceRescheduling}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-border bg-accent/40 text-foreground hover:bg-accent/60 transition-colors shrink-0 disabled:opacity-50"
            title="Avance toutes les actions du jour à maintenant (sauf invitations LinkedIn — quota safety)"
          >
            <Zap className={cn("w-3.5 h-3.5", forceRescheduling && "animate-pulse")} />
            <span className="hidden sm:inline">{forceRescheduling ? 'En cours…' : 'Envoyer tout'}</span>
          </button>
          <button
            onClick={() => setShowDiagnostic(true)}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted/50 transition-colors shrink-0"
            title="Vérifier l'état du système d'envoi"
          >
            <Activity className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Diagnostic</span>
          </button>
          <button
            onClick={() => setShowActivityLog(true)}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-border bg-background text-foreground hover:bg-muted/50 transition-colors shrink-0"
            title="Voir le journal détaillé des actions envoyées"
          >
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Journal</span>
          </button>
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Créer une séquence</span>
            <span className="sm:hidden">Créer</span>
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher une séquence..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-background border-border rounded-lg"
          />
        </div>
      </div>

      {/* Selected profiles banner */}
      {selectedProfiles.length > 0 && (
        <div className="p-3 bg-accent/20 border border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-foreground" />
            <span className="font-medium text-foreground">{selectedProfiles.length} candidat(s) sélectionné(s)</span>
            {selectedJob && (
              <Badge variant="outline" className="bg-background">{selectedJob.title}</Badge>
            )}
          </div>
          <p className="text-sm text-foreground/70">
            Cliquez sur une séquence pour y inscrire les candidats
          </p>
        </div>
      )}

      {/* Table */}
      {sequences.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-card rounded-xl border border-border">
          <div className="text-4xl mb-4">🔗</div>
          <h3 className="font-semibold text-base text-foreground mb-2 tracking-tight">Séquences automatisées</h3>
          <p className="text-muted-foreground text-center mb-6 max-w-md text-sm">
            Les séquences envoient automatiquement des messages personnalisés à vos candidats en plusieurs étapes.
            L'IA adapte chaque message au profil du candidat et au poste.
          </p>
          <button
            onClick={handleCreateNew}
            className="flex items-center gap-2 h-9 px-5 bg-foreground text-background hover:bg-foreground/90 rounded-lg text-sm font-semibold transition-colors"
          >
            <Send className="w-4 h-4" />
            Créer ma première séquence
          </button>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* Table header - hidden on mobile */}
          <div className="hidden sm:grid grid-cols-[auto_auto_1fr_100px_80px_100px_100px_80px] gap-4 px-4 py-3 bg-muted/40 border-b border-border text-[11px] font-semibold text-muted-foreground">
            <div className="w-5" />
            <div>Statut</div>
            <div>Nom de la séquence</div>
            <div className="text-center">Prospects</div>
            <div className="text-center">Funnel</div>
            <div className="text-center">Créé à</div>
            <div className="text-center">Actions</div>
            <div />
          </div>

          {/* Table body */}
          <div className="divide-y divide-foreground/5">
            {filteredSequences.map((seq, index) => (
              <div
                key={seq.id}
                className={cn(
                  "hidden sm:grid grid-cols-[auto_auto_1fr_100px_80px_100px_100px_80px] gap-4 px-4 py-3 items-center hover:bg-accent/10 transition-colors",
                  selectedProfiles.length > 0 && selectedAccount && "cursor-pointer"
                )}
                onClick={() => {
                  if (selectedProfiles.length > 0 && selectedAccount) {
                    setEnrollModalSequence(seq);
                  }
                }}
              >
                <div className="w-5" />
                <Switch
                  checked={seq.is_active}
                  onCheckedChange={(next) => {
                    // Confirmation requise si on désactive ET qu'il y a des actifs
                    // (peut couper l'envoi pour 50+ candidats par clic).
                    if (!next && seq.enrollments.active > 0) {
                      setToggleConfirm({ id: seq.id, nextActive: false, activeCount: seq.enrollments.active });
                      return;
                    }
                    handleToggleActive(seq.id, seq.is_active);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="data-[state=checked]:bg-foreground"
                />
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg">{getSequenceEmoji(index)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-foreground truncate">{seq.name}</div>
                      {/* Badge "Template" si la séquence n'est pas attachée à une mission
                          (visible et utilisable depuis toutes les missions) */}
                      {!seq.project_id && (
                        <span
                          className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-info/10 text-info border border-info/30"
                          title="Séquence globale réutilisable depuis toutes les missions"
                        >
                          ✨ Template
                        </span>
                      )}
                    </div>
                    {seq.description && (
                      <div className="text-xs text-muted-foreground truncate">{seq.description}</div>
                    )}
                  </div>
                </div>
                <button
                  className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-sm bg-muted text-foreground hover:bg-accent/20 transition-colors cursor-pointer border border-border"
                  onClick={(e) => { e.stopPropagation(); setEnrollmentsPanelSequence(seq); }}
                  title={`${seq.enrollments.active} actif(s) • ${seq.enrollments.replied} répondu(s) • ${seq.enrollments.completed} terminé(s) — clic pour voir le détail`}
                >
                  <Users className="w-3.5 h-3.5" />
                  <span className="font-medium tabular-nums">{seq.enrollments.active}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="tabular-nums">{seq.enrollments.total}</span>
                </button>
                {/* Status pills : breakdown réel par état d'inscription.
                    Remplace l'ancien faux "funnel décroissance ~70%" qui ne
                    reflétait AUCUNE donnée réelle (juste de la déco).
                    Maintenant on lit vraiment seq.enrollments.{active,replied,completed}. */}
                {seq.enrollments.total > 0 ? (
                  <div className="flex items-center gap-1 flex-wrap" title="Statuts des inscriptions">
                    {seq.enrollments.active > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/30">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        {seq.enrollments.active} actif{seq.enrollments.active > 1 ? 's' : ''}
                      </span>
                    )}
                    {seq.enrollments.replied > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-info/10 text-info border border-info/30">
                        💬 {seq.enrollments.replied}
                      </span>
                    )}
                    {seq.enrollments.completed > 0 && (
                      <span
                        className="inline-flex items-center gap-1 text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-foreground/8 text-foreground/70 border border-border"
                        title={`${seq.enrollments.completed} candidat(s) ont parcouru toute la séquence sans répondre`}
                      >
                        ✓ {seq.enrollments.completed}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-[11px] text-muted-foreground/60 italic">
                    Aucune inscription
                  </span>
                )}
                <div className="text-center text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(seq.created_at), { addSuffix: false, locale: fr })}
                </div>
                <div className="flex items-center justify-center gap-1">
                  <button
                    className="p-1.5 rounded-md hover:bg-accent/20 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={(e) => { e.stopPropagation(); setAnalyticsSequence(seq); }}
                    title="Voir les analytics"
                    aria-label="Voir les analytics de la séquence"
                  >
                    <BarChart3 className="w-4 h-4" />
                  </button>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className="p-1.5 hover:bg-accent/20 text-muted-foreground hover:text-foreground transition-colors">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-background border-border">
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEdit(seq); }}>
                      <Edit2 className="w-4 h-4 mr-2" />
                      Modifier
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleDuplicate(seq); }}>
                      <Plus className="w-4 h-4 mr-2" />
                      Dupliquer
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSaveTemplateSeq(seq); }}>
                      <FileText className="w-4 h-4 mr-2" />
                      Sauvegarder comme template
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(seq.id); }}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Supprimer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}

            {/* Mobile: card layout */}
            {filteredSequences.map((seq, index) => (
              <div
                key={`mobile-${seq.id}`}
                className={cn(
                  "sm:hidden p-3 space-y-2.5 hover:bg-accent/10 transition-colors",
                  selectedProfiles.length > 0 && selectedAccount && "cursor-pointer"
                )}
                onClick={() => {
                  if (selectedProfiles.length > 0 && selectedAccount) {
                    setEnrollModalSequence(seq);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-base">{getSequenceEmoji(index)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <div className="font-medium text-sm text-foreground truncate">{seq.name}</div>
                        {!seq.project_id && (
                          <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-info/10 text-info border border-info/30">
                            ✨ Template
                          </span>
                        )}
                      </div>
                      {seq.description && (
                        <div className="text-xs text-muted-foreground truncate">{seq.description}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Switch
                      checked={seq.is_active}
                      onCheckedChange={(next) => {
                        // Même garde que le Switch desktop : confirmation si on
                        // désactive avec des candidats actifs (un tap mobile
                        // coupait l'envoi pour N candidats sans AlertDialog —
                        // audit 2026-07, Frontend M1).
                        if (!next && seq.enrollments.active > 0) {
                          setToggleConfirm({ id: seq.id, nextActive: false, activeCount: seq.enrollments.active });
                          return;
                        }
                        handleToggleActive(seq.id, seq.is_active);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="data-[state=checked]:bg-foreground scale-90"
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <button className="p-1 hover:bg-accent/20 text-muted-foreground">
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-background border-border">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEdit(seq); }}>
                          <Edit2 className="w-4 h-4 mr-2" />
                          Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setAnalyticsSequence(seq); }}>
                          <BarChart3 className="w-4 h-4 mr-2" />
                          Analytics
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          className="text-destructive"
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(seq.id); }}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-muted text-foreground hover:bg-accent/20 border border-border"
                    onClick={(e) => { e.stopPropagation(); setEnrollmentsPanelSequence(seq); }}
                  >
                    <Users className="w-3 h-3" />
                    <span className="font-medium tabular-nums">{seq.enrollments.active}/{seq.enrollments.total}</span>
                  </button>
                  {/* Breakdown statuses (mobile) — pills compacts */}
                  {seq.enrollments.replied > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-info/10 text-info border border-info/30">
                      💬 {seq.enrollments.replied}
                    </span>
                  )}
                  {seq.enrollments.completed > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-foreground/8 text-foreground/70 border border-border">
                      ✓ {seq.enrollments.completed}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(seq.created_at), { addSuffix: true, locale: fr })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* Builder modal */}
      {showBuilder && (
        <SequenceBuilder
          isOpen={showBuilder}
          onClose={() => {
            setShowBuilder(false);
            setEditingSequence(null);
          }}
          onSave={handleSaveSequence}
          initialSequence={editingSequence || undefined}
        />
      )}

      {/* Enroll modal */}
      {enrollModalSequence && selectedAccount && (
        <SequenceEnrollModal
          isOpen={!!enrollModalSequence}
          onClose={() => setEnrollModalSequence(null)}
          sequence={enrollModalSequence}
          profiles={selectedProfiles}
          accountId={selectedAccount}
          job={selectedJob}
          onSuccess={handleEnrollSuccess}
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

      {/* Delete confirmation — affiche le count d'enrollments impactés */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent className="bg-background border-border rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Cette action est <strong>irréversible</strong>. Tous les candidats inscrits seront retirés
                  et leur historique d'envoi (étapes programmées et envoyées) supprimé.
                </p>
                {(() => {
                  const seq = sequences.find(s => s.id === deleteConfirmId);
                  if (!seq) return null;
                  const total = seq.enrollments.total || 0;
                  const active = seq.enrollments.active || 0;
                  if (total === 0) return null;
                  return (
                    <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm">
                      <p className="font-semibold text-destructive">⚠ Impact :</p>
                      <p className="text-destructive/90 mt-1">
                        {total} candidat{total > 1 ? 's' : ''} inscrit{total > 1 ? 's' : ''}
                        {active > 0 && ` (dont ${active} actif${active > 1 ? 's' : ''} en cours d'envoi)`}.
                      </p>
                    </div>
                  );
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation Pause séquence avec actifs */}
      <AlertDialog open={!!toggleConfirm} onOpenChange={() => setToggleConfirm(null)}>
        <AlertDialogContent className="bg-background border-border rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Désactiver cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Les <strong>{toggleConfirm?.activeCount}</strong> candidat{(toggleConfirm?.activeCount || 0) > 1 ? 's' : ''} actuellement
                  en cours seront mis en pause. Aucun nouveau message ne partira tant que la séquence est désactivée.
                </p>
                <p className="text-xs text-muted-foreground">
                  Tu pourras la réactiver à tout moment — les enrollments reprendront là où ils en étaient.
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
              Désactiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
