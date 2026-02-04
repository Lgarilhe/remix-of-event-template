import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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
}

// Emoji pour les séquences
const SEQUENCE_EMOJIS = ['🎯', '🚀', '💼', '✨', '🔥', '💡', '📈', '🎨', '⚡', '🏆', '💪', '🌟'];

export const SequencesList: React.FC<SequencesListProps> = ({
  accounts,
  selectedAccount,
  selectedProfiles = [],
  selectedJob,
  onClearSelection,
}) => {
  const [sequences, setSequences] = useState<SequenceWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingSequence, setEditingSequence] = useState<Sequence | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [enrollModalSequence, setEnrollModalSequence] = useState<SequenceWithStats | null>(null);
  const [enrollmentsPanelSequence, setEnrollmentsPanelSequence] = useState<SequenceWithStats | null>(null);

  const fetchSequences = async () => {
    try {
      const { data: seqData, error: seqError } = await supabase
        .from('outreach_sequences')
        .select('*')
        .order('created_at', { ascending: false });

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

  // Refetch when component becomes visible (tab change)
  // We use a custom event to trigger refetch when the Sequences tab is selected
  useEffect(() => {
    fetchSequences();
    
    // Listen for visibility changes (when user returns to this tab)
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

          if (ifTrueDbId || ifFalseDbId) {
            await supabase
              .from('sequence_steps')
              .update({
                if_true_goto_step: ifTrueDbId,
                if_false_goto_step: ifFalseDbId,
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
          })
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

          if (ifTrueDbId || ifFalseDbId) {
            await supabase
              .from('sequence_steps')
              .update({
                if_true_goto_step: ifTrueDbId,
                if_false_goto_step: ifFalseDbId,
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
      const { error } = await supabase
        .from('outreach_sequences')
        .update({ is_active: !isActive })
        .eq('id', sequenceId);

      if (error) throw error;
      
      setSequences(prev =>
        prev.map(s => s.id === sequenceId ? { ...s, is_active: !isActive } : s)
      );
      
      toast.success(isActive ? 'Séquence désactivée' : 'Séquence activée');
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
    setEditingSequence(null);
    setShowBuilder(true);
  };

  const filteredSequences = sequences.filter(seq =>
    seq.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getSequenceEmoji = (index: number) => {
    return SEQUENCE_EMOJIS[index % SEQUENCE_EMOJIS.length];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Séquences</h1>
        <Button 
          onClick={handleCreateNew}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4"
        >
          <Send className="w-4 h-4 mr-2" />
          Créer une séquence
        </Button>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Rechercher une séquence..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-white border-gray-200"
          />
        </div>
      </div>

      {/* Selected profiles banner */}
      {selectedProfiles.length > 0 && (
        <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            <span className="font-medium text-blue-900">{selectedProfiles.length} candidat(s) sélectionné(s)</span>
            {selectedJob && (
              <Badge variant="outline" className="bg-white">{selectedJob.title}</Badge>
            )}
          </div>
          <p className="text-sm text-blue-700">
            Cliquez sur une séquence pour y inscrire les candidats
          </p>
        </div>
      )}

      {/* Table */}
      {sequences.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white rounded-xl border border-gray-100">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <Send className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="font-semibold text-lg text-gray-900 mb-2">Aucune séquence</h3>
          <p className="text-gray-500 text-center mb-6 max-w-md">
            Créez votre première séquence d'outreach pour automatiser vos prises de contact LinkedIn.
          </p>
          <Button 
            onClick={handleCreateNew}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Créer une séquence
          </Button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[auto_auto_1fr_100px_100px_100px_80px] gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <div className="w-5" />
            <div>Statut</div>
            <div>Nom de la séquence</div>
            <div className="text-center">Prospects</div>
            <div className="text-center">Créé à</div>
            <div className="text-center">Actions</div>
            <div />
          </div>

          {/* Table body */}
          <div className="divide-y divide-gray-100">
            {filteredSequences.map((seq, index) => (
              <div
                key={seq.id}
                className={cn(
                  "grid grid-cols-[auto_auto_1fr_100px_100px_100px_80px] gap-4 px-4 py-3 items-center hover:bg-gray-50 transition-colors",
                  selectedProfiles.length > 0 && "cursor-pointer"
                )}
                onClick={() => {
                  if (selectedProfiles.length > 0 && selectedAccount) {
                    setEnrollModalSequence(seq);
                  }
                }}
              >
                {/* Checkbox placeholder */}
                <div className="w-5" />

                {/* Toggle */}
                <Switch
                  checked={seq.is_active}
                  onCheckedChange={() => handleToggleActive(seq.id, seq.is_active)}
                  onClick={(e) => e.stopPropagation()}
                  className="data-[state=checked]:bg-blue-600"
                />

                {/* Name */}
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg">{getSequenceEmoji(index)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{seq.name}</div>
                    {seq.description && (
                      <div className="text-xs text-gray-500 truncate">{seq.description}</div>
                    )}
                  </div>
                </div>

                {/* Prospects - clickable to open panel */}
                <button 
                  className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors cursor-pointer border border-blue-200"
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    setEnrollmentsPanelSequence(seq);
                  }}
                  title="Voir et gérer les candidats inscrits (arrêter/reprendre)"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span className="font-medium">{seq.enrollments.active}</span>
                  <span className="text-blue-400">/</span>
                  <span>{seq.enrollments.total}</span>
                </button>

                {/* Created */}
                <div className="text-center text-sm text-gray-500">
                  {formatDistanceToNow(new Date(seq.created_at), { addSuffix: false, locale: fr })}
                </div>

                {/* Actions */}
                <div className="flex items-center justify-center gap-1">
                  <button className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                    <Star className="w-4 h-4" />
                  </button>
                  <button className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                    <BarChart3 className="w-4 h-4" />
                  </button>
                </div>

                {/* Menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-white">
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEdit(seq); }}>
                      <Edit2 className="w-4 h-4 mr-2" />
                      Modifier
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
          </div>
        </div>
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

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent className="bg-white">
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
