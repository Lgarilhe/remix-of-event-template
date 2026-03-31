import React, { useState, useEffect } from 'react';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, 
  Search,
  Star,
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
import { SequenceAnalytics } from './SequenceAnalytics';
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
  const [sequences, setSequences] = useState<SequenceWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingSequence, setEditingSequence] = useState<Sequence | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [enrollModalSequence, setEnrollModalSequence] = useState<SequenceWithStats | null>(null);
  const [enrollmentsPanelSequence, setEnrollmentsPanelSequence] = useState<SequenceWithStats | null>(null);
  const [showActivityLog, setShowActivityLog] = useState(false);
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

  const fetchSequences = async () => {
    try {
      let seqQuery = supabase
        .from('outreach_sequences')
        .select('*')
        .order('created_at', { ascending: false }) as any;

      if (projectId) {
        seqQuery = seqQuery.eq('project_id', projectId);
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
  };

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
  }, []);

  // Refetch when tab becomes visible within the app
  useEffect(() => {
    if (isVisible) {
      fetchSequences();
    }
  }, [isVisible, projectId]);

  const handleSaveSequence = async (sequence: Sequence) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      // Map old client-side IDs to database IDs after insert
      const clientIdToDbId: Record<string, string> = {};

      if (sequence.id) {
        // UPDATE existing sequence
        const { error: updateError } = await supabase
          .from('outreach_sequences')
          .update({
            name: sequence.name,
            description: sequence.description,
            is_active: sequence.isActive,
          })
          .eq('id', sequence.id);

        if (updateError) throw updateError;

        // Delete old steps
        await supabase
          .from('sequence_steps')
          .delete()
          .eq('sequence_id', sequence.id);

        // Step 1: Insert steps WITHOUT branch references
        const stepsToInsert = sequence.steps.map(step => ({
          sequence_id: sequence.id,
          step_order: step.order,
          action_type: step.actionType,
          condition_type: step.conditionType,
          delay_days: step.delayDays,
          delay_hours: step.delayHours,
          delay_minutes: step.delayMinutes || 0,
          preferred_hour_start: step.preferredHourStart,
          preferred_hour_end: step.preferredHourEnd,
          subject_template: step.subjectTemplate,
          message_template: step.messageTemplate,
          use_ai_personalization: step.useAiPersonalization,
          ai_tone: step.aiTone,
          timeout_days: step.timeoutDays,
          wait_for_event: step.waitForEvent,
          timeout_branch_step_id: null,
          if_true_goto_step: null,
          if_false_goto_step: null,
        }));

        const { data: insertedSteps, error: stepsError } = await supabase
          .from('sequence_steps')
          .insert(stepsToInsert)
          .select();

        if (stepsError) throw stepsError;

        // Build mapping from client ID to DB ID
        sequence.steps.forEach((step, index) => {
          if (insertedSteps && insertedSteps[index]) {
            clientIdToDbId[step.id] = insertedSteps[index].id;
          }
        });

        // Step 2: Update steps WITH branch references (now that all IDs exist)
        for (const step of sequence.steps) {
          const dbId = clientIdToDbId[step.id];
          if (!dbId) continue;

          const ifTrueDbId = step.ifTrueGotoStep ? clientIdToDbId[step.ifTrueGotoStep] : null;
          const ifFalseDbId = step.ifFalseGotoStep ? clientIdToDbId[step.ifFalseGotoStep] : null;
          const timeoutBranchDbId = step.timeoutBranchStepId ? clientIdToDbId[step.timeoutBranchStepId] : null;
          const nextStepDbId = step.nextStepId ? clientIdToDbId[step.nextStepId] : null;

          if (ifTrueDbId || ifFalseDbId || timeoutBranchDbId || nextStepDbId) {
            await supabase
              .from('sequence_steps')
              .update({
                if_true_goto_step: ifTrueDbId,
                if_false_goto_step: ifFalseDbId,
                timeout_branch_step_id: timeoutBranchDbId,
                next_step_id: nextStepDbId,
              })
              .eq('id', dbId);
          }
        }

        toast.success('Séquence mise à jour');
      } else {
        // CREATE new sequence
        const { data: newSeq, error: createError } = await supabase
          .from('outreach_sequences')
          .insert({
            name: sequence.name,
            description: sequence.description,
            is_active: sequence.isActive,
            created_by: user.id,
            project_id: projectId || null,
          } as any)
          .select()
          .single();

        if (createError) throw createError;

        // Step 1: Insert steps WITHOUT branch references
        const stepsToInsert = sequence.steps.map(step => ({
          sequence_id: newSeq.id,
          step_order: step.order,
          action_type: step.actionType,
          condition_type: step.conditionType,
          delay_days: step.delayDays,
          delay_hours: step.delayHours,
          delay_minutes: step.delayMinutes || 0,
          preferred_hour_start: step.preferredHourStart,
          preferred_hour_end: step.preferredHourEnd,
          subject_template: step.subjectTemplate,
          message_template: step.messageTemplate,
          use_ai_personalization: step.useAiPersonalization,
          ai_tone: step.aiTone,
          timeout_days: step.timeoutDays,
          wait_for_event: step.waitForEvent,
          timeout_branch_step_id: null,
          if_true_goto_step: null,
          if_false_goto_step: null,
        }));

        const { data: insertedSteps, error: stepsError } = await supabase
          .from('sequence_steps')
          .insert(stepsToInsert)
          .select();

        if (stepsError) throw stepsError;

        // Build mapping from client ID to DB ID
        sequence.steps.forEach((step, index) => {
          if (insertedSteps && insertedSteps[index]) {
            clientIdToDbId[step.id] = insertedSteps[index].id;
          }
        });

        // Step 2: Update steps WITH branch references (now that all IDs exist)
        for (const step of sequence.steps) {
          const dbId = clientIdToDbId[step.id];
          if (!dbId) continue;

          const ifTrueDbId = step.ifTrueGotoStep ? clientIdToDbId[step.ifTrueGotoStep] : null;
          const ifFalseDbId = step.ifFalseGotoStep ? clientIdToDbId[step.ifFalseGotoStep] : null;
          const timeoutBranchDbId = step.timeoutBranchStepId ? clientIdToDbId[step.timeoutBranchStepId] : null;
          const nextStepDbId = step.nextStepId ? clientIdToDbId[step.nextStepId] : null;

          if (ifTrueDbId || ifFalseDbId || timeoutBranchDbId || nextStepDbId) {
            await supabase
              .from('sequence_steps')
              .update({
                if_true_goto_step: ifTrueDbId,
                if_false_goto_step: ifFalseDbId,
                timeout_branch_step_id: timeoutBranchDbId,
                next_step_id: nextStepDbId,
              })
              .eq('id', dbId);
          }
        }

        toast.success('Séquence créée');
      }

      fetchSequences();
      setShowBuilder(false);
      setEditingSequence(null);
    } catch (err) {
      console.error('Error saving sequence:', err);
      toast.error('Erreur lors de la sauvegarde');
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
        timeoutBranchStepId: s.timeout_branch_step_id,
        ifTrueGotoStep: s.if_true_goto_step,
        ifFalseGotoStep: s.if_false_goto_step,
        nextStepId: s.next_step_id,
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
        <h1 className="text-lg sm:text-xl font-bold text-foreground uppercase tracking-tight">Séquences</h1>
        <div className="flex items-center gap-0 overflow-x-auto no-scrollbar">
          <button 
            onClick={() => setShowGlobalAnalytics(true)}
            className="relative overflow-hidden flex items-center gap-1.5 h-[34px] px-3 sm:px-4 text-xs sm:text-xs font-medium uppercase tracking-wider border border-foreground bg-background text-foreground group shrink-0"
          >
            <BarChart3 className="w-3.5 h-3.5 relative z-10" />
            <span className="hidden sm:inline relative z-10">Analytics</span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          </button>
          <button 
            onClick={handleForceReschedule}
            disabled={forceRescheduling || !selectedAccount}
            className="relative overflow-hidden flex items-center gap-1.5 h-[34px] px-3 sm:px-4 text-xs sm:text-xs font-medium uppercase tracking-wider border border-foreground border-l-0 bg-brutal-accent text-foreground group shrink-0 disabled:opacity-50"
            title="Envoyer toutes les actions du jour maintenant"
          >
            <Zap className={cn("w-3.5 h-3.5 relative z-10", forceRescheduling && "animate-pulse")} />
            <span className="hidden sm:inline relative z-10">{forceRescheduling ? 'En cours...' : 'Envoyer tout'}</span>
          </button>
          <button 
            onClick={() => setShowActivityLog(true)}
            className="relative overflow-hidden flex items-center gap-1.5 h-[34px] px-3 sm:px-4 text-xs sm:text-xs font-medium uppercase tracking-wider border border-foreground border-l-0 bg-background text-foreground group shrink-0"
          >
            <Activity className="w-3.5 h-3.5 relative z-10" />
            <span className="hidden sm:inline relative z-10">Journal</span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          </button>
          <button 
            onClick={handleCreateNew}
            className="relative overflow-hidden flex items-center gap-1.5 h-[34px] px-3 sm:px-4 text-xs sm:text-xs font-medium uppercase tracking-wider border border-foreground border-l-0 bg-foreground text-background group shrink-0"
          >
            <Send className="w-3.5 h-3.5 relative z-10" />
            <span className="hidden sm:inline relative z-10">Créer une séquence</span>
            <span className="sm:hidden relative z-10">Créer</span>
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
            className="pl-9 bg-background border-foreground rounded-none"
          />
        </div>
      </div>

      {/* Selected profiles banner */}
      {selectedProfiles.length > 0 && (
        <div className="p-3 bg-brutal-accent/20 border border-foreground flex items-center justify-between">
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
        <div className="flex flex-col items-center justify-center py-16 bg-background border border-foreground">
          <div className="text-4xl mb-4">🔗</div>
          <h3 className="font-bold text-lg text-foreground mb-2 uppercase tracking-wide">Séquences automatisées</h3>
          <p className="text-muted-foreground text-center mb-6 max-w-md text-sm">
            Les séquences envoient automatiquement des messages personnalisés à vos candidats en plusieurs étapes.
            L'IA adapte chaque message au profil du candidat et au poste.
          </p>
          <button 
            onClick={handleCreateNew}
            className="relative overflow-hidden h-[34px] px-6 bg-foreground text-background border border-foreground text-xs font-medium uppercase tracking-wider group"
          >
            <span className="relative z-10 flex items-center gap-2">Créer ma première séquence</span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          </button>
        </div>
      ) : (
        <div className="bg-background border border-foreground overflow-hidden">
          {/* Table header - hidden on mobile */}
          <div className="hidden sm:grid grid-cols-[auto_auto_1fr_100px_80px_100px_100px_80px] gap-4 px-4 py-3 bg-muted border-b border-foreground text-xs font-medium text-muted-foreground uppercase tracking-wide">
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
                  "hidden sm:grid grid-cols-[auto_auto_1fr_100px_80px_100px_100px_80px] gap-4 px-4 py-3 items-center hover:bg-brutal-accent/10 transition-colors",
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
                  onCheckedChange={() => handleToggleActive(seq.id, seq.is_active)}
                  onClick={(e) => e.stopPropagation()}
                  className="data-[state=checked]:bg-foreground"
                />
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg">{getSequenceEmoji(index)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground truncate">{seq.name}</div>
                    {seq.description && (
                      <div className="text-xs text-muted-foreground truncate">{seq.description}</div>
                    )}
                  </div>
                </div>
                <button 
                  className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-sm bg-muted text-foreground hover:bg-brutal-accent/20 transition-colors cursor-pointer border border-foreground"
                  onClick={(e) => { e.stopPropagation(); setEnrollmentsPanelSequence(seq); }}
                  title="Voir et gérer les candidats inscrits"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span className="font-medium">{seq.enrollments.active}</span>
                  <span className="text-muted-foreground">/</span>
                  <span>{seq.enrollments.total}</span>
                </button>
                {/* Mini conversion funnel */}
                {seq.enrollments.total > 0 && (
                  <div className="flex items-center gap-0.5 h-2.5 w-[80px]" title={`${seq.enrollments.active} actifs • ${seq.enrollments.completed} terminés • ${seq.enrollments.replied} répondus`}>
                    {seq.steps.map((_, i) => {
                      const total = seq.enrollments.total || 1;
                      // Simple decay: each step retains ~70% of the previous
                      const pct = Math.max(10, Math.round(100 * Math.pow(0.7, i)));
                      return (
                        <div
                          key={i}
                          className="flex-1 h-full bg-foreground/15"
                        >
                          <div
                            className="h-full bg-foreground/60"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="text-center text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(seq.created_at), { addSuffix: false, locale: fr })}
                </div>
                <div className="flex items-center justify-center gap-1">
                  <button className="p-1.5 hover:bg-brutal-accent/20 text-muted-foreground hover:text-foreground transition-colors">
                    <Star className="w-4 h-4" />
                  </button>
                  <button 
                    className="p-1.5 hover:bg-brutal-accent/20 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={(e) => { e.stopPropagation(); setAnalyticsSequence(seq); }}
                    title="Voir les analytics"
                  >
                    <BarChart3 className="w-4 h-4" />
                  </button>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className="p-1.5 hover:bg-brutal-accent/20 text-muted-foreground hover:text-foreground transition-colors">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-background border-foreground">
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEdit(seq); }}>
                      <Edit2 className="w-4 h-4 mr-2" />
                      Modifier
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSaveTemplateSeq(seq); }}>
                      <FileText className="w-4 h-4 mr-2" />
                      Sauvegarder comme template
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      className="text-red-600"
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
                  "sm:hidden p-3 space-y-2.5 hover:bg-brutal-accent/10 transition-colors",
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
                      <div className="font-medium text-sm text-foreground truncate">{seq.name}</div>
                      {seq.description && (
                        <div className="text-xs text-muted-foreground truncate">{seq.description}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Switch
                      checked={seq.is_active}
                      onCheckedChange={() => handleToggleActive(seq.id, seq.is_active)}
                      onClick={(e) => e.stopPropagation()}
                      className="data-[state=checked]:bg-foreground scale-90"
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <button className="p-1 hover:bg-brutal-accent/20 text-muted-foreground">
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-background border-foreground">
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
                          className="text-red-600"
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(seq.id); }}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    className="inline-flex items-center gap-1.5 px-2 py-1 text-xs bg-muted text-foreground hover:bg-brutal-accent/20 border border-foreground"
                    onClick={(e) => { e.stopPropagation(); setEnrollmentsPanelSequence(seq); }}
                  >
                    <Users className="w-3 h-3" />
                    <span className="font-medium">{seq.enrollments.active}/{seq.enrollments.total}</span>
                  </button>
                  <span className="text-xs text-muted-foreground">
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

      {/* Global Analytics */}
      <SequenceAnalytics
        isOpen={showGlobalAnalytics}
        onClose={() => setShowGlobalAnalytics(false)}
      />

      {/* Per-sequence Analytics */}
      {analyticsSequence && (
        <SequenceAnalytics
          isOpen={!!analyticsSequence}
          onClose={() => setAnalyticsSequence(null)}
          sequenceId={analyticsSequence.id}
          sequenceName={analyticsSequence.name}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent className="bg-background border-foreground rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Tous les candidats inscrits seront retirés de la séquence.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
