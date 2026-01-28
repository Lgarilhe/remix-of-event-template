import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Plus, 
  GitBranch, 
  Play, 
  Pause, 
  Trash2, 
  Edit2,
  Users,
  Clock,
  CheckCircle,
  MessageSquare,
  Mail,
  UserPlus,
  Eye,
  MoreHorizontal,
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
import { LinkedInProfile } from './types';

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

const ACTION_ICONS = {
  inmail: Mail,
  connection_request: UserPlus,
  profile_visit: Eye,
  message: MessageSquare,
};

export const SequencesList: React.FC<SequencesListProps> = ({
  accounts,
  selectedAccount,
  selectedProfiles = [],
  selectedJob,
  onClearSelection,
}) => {
  const [sequences, setSequences] = useState<SequenceWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingSequence, setEditingSequence] = useState<Sequence | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [enrollModalSequence, setEnrollModalSequence] = useState<SequenceWithStats | null>(null);

  const fetchSequences = async () => {
    try {
      // Fetch sequences
      const { data: seqData, error: seqError } = await supabase
        .from('outreach_sequences')
        .select('*')
        .order('created_at', { ascending: false });

      if (seqError) throw seqError;

      // Fetch steps for each sequence
      const sequenceIds = seqData?.map(s => s.id) || [];
      const { data: stepsData } = await supabase
        .from('sequence_steps')
        .select('*')
        .in('sequence_id', sequenceIds)
        .order('step_order', { ascending: true });

      // Fetch enrollment stats
      const { data: enrollData } = await supabase
        .from('sequence_enrollments')
        .select('sequence_id, status')
        .in('sequence_id', sequenceIds);

      // Build enriched sequences
      const enriched: SequenceWithStats[] = (seqData || []).map(seq => {
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

  useEffect(() => {
    fetchSequences();
  }, []);

  const handleSaveSequence = async (sequence: Sequence) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      if (sequence.id) {
        // Update existing
        const { error: updateError } = await supabase
          .from('outreach_sequences')
          .update({
            name: sequence.name,
            description: sequence.description,
            is_active: sequence.isActive,
          })
          .eq('id', sequence.id);

        if (updateError) throw updateError;

        // Delete old steps and insert new ones
        await supabase
          .from('sequence_steps')
          .delete()
          .eq('sequence_id', sequence.id);

        const stepsToInsert = sequence.steps.map(step => ({
          sequence_id: sequence.id,
          step_order: step.order,
          action_type: step.actionType,
          condition_type: step.conditionType,
          delay_days: step.delayDays,
          delay_hours: step.delayHours,
          preferred_hour_start: step.preferredHourStart,
          preferred_hour_end: step.preferredHourEnd,
          subject_template: step.subjectTemplate,
          message_template: step.messageTemplate,
          use_ai_personalization: step.useAiPersonalization,
          ai_tone: step.aiTone,
        }));

        const { error: stepsError } = await supabase
          .from('sequence_steps')
          .insert(stepsToInsert);

        if (stepsError) throw stepsError;

        toast.success('Séquence mise à jour');
      } else {
        // Create new
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

        const stepsToInsert = sequence.steps.map(step => ({
          sequence_id: newSeq.id,
          step_order: step.order,
          action_type: step.actionType,
          condition_type: step.conditionType,
          delay_days: step.delayDays,
          delay_hours: step.delayHours,
          preferred_hour_start: step.preferredHourStart,
          preferred_hour_end: step.preferredHourEnd,
          subject_template: step.subjectTemplate,
          message_template: step.messageTemplate,
          use_ai_personalization: step.useAiPersonalization,
          ai_tone: step.aiTone,
        }));

        const { error: stepsError } = await supabase
          .from('sequence_steps')
          .insert(stepsToInsert);

        if (stepsError) throw stepsError;

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
        preferredHourStart: s.preferred_hour_start ?? 9,
        preferredHourEnd: s.preferred_hour_end ?? 18,
        subjectTemplate: s.subject_template,
        messageTemplate: s.message_template,
        useAiPersonalization: s.use_ai_personalization,
        aiTone: s.ai_tone,
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0077B5]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-[#0077B5]" />
            Mes séquences
          </h2>
          <p className="text-sm text-muted-foreground">
            Créez des séquences d'outreach automatisées
          </p>
        </div>
        <Button 
          onClick={() => {
            setEditingSequence(null);
            setShowBuilder(true);
          }}
          className="bg-[#0077B5] hover:bg-[#005E93]"
        >
          <Plus className="w-4 h-4 mr-2" />
          Nouvelle séquence
        </Button>
      </div>

      {/* Selected profiles banner */}
      {selectedProfiles.length > 0 && (
        <div className="p-3 bg-[#0077B5]/10 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#0077B5]" />
            <span className="font-medium">{selectedProfiles.length} candidat(s) sélectionné(s)</span>
            {selectedJob && (
              <Badge variant="outline">{selectedJob.title}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Cliquez sur une séquence pour y inscrire les candidats
          </p>
        </div>
      )}

      {/* Sequences grid */}
      {sequences.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <GitBranch className="w-12 h-12 text-muted-foreground/30 mb-4" />
            <h3 className="font-semibold text-lg mb-2">Aucune séquence</h3>
            <p className="text-muted-foreground text-center mb-4 max-w-md">
              Créez votre première séquence d'outreach pour automatiser vos prises de contact LinkedIn.
            </p>
            <Button 
              onClick={() => setShowBuilder(true)}
              className="bg-[#0077B5] hover:bg-[#005E93]"
            >
              <Plus className="w-4 h-4 mr-2" />
              Créer une séquence
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sequences.map((seq) => (
            <Card 
              key={seq.id}
              className={cn(
                "transition-all cursor-pointer hover:shadow-md",
                !seq.is_active && "opacity-60",
                selectedProfiles.length > 0 && "hover:border-[#0077B5]"
              )}
              onClick={() => {
                if (selectedProfiles.length > 0 && selectedAccount) {
                  setEnrollModalSequence(seq);
                }
              }}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base flex items-center gap-2">
                      {seq.name}
                      {!seq.is_active && (
                        <Badge variant="secondary" className="text-xs">Inactive</Badge>
                      )}
                    </CardTitle>
                    {seq.description && (
                      <CardDescription className="mt-1 line-clamp-2">
                        {seq.description}
                      </CardDescription>
                    )}
                  </div>
                  
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleEdit(seq); }}>
                        <Edit2 className="w-4 h-4 mr-2" />
                        Modifier
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleToggleActive(seq.id, seq.is_active); }}>
                        {seq.is_active ? (
                          <>
                            <Pause className="w-4 h-4 mr-2" />
                            Désactiver
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4 mr-2" />
                            Activer
                          </>
                        )}
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
              </CardHeader>
              
              <CardContent>
                {/* Steps preview */}
                <div className="flex items-center gap-1 mb-3">
                  {seq.steps.slice(0, 5).map((step, idx) => {
                    const Icon = ACTION_ICONS[step.action_type as keyof typeof ACTION_ICONS] || Mail;
                    return (
                      <React.Fragment key={step.id}>
                        {idx > 0 && <span className="text-muted-foreground/50">→</span>}
                        <div className="w-6 h-6 rounded bg-muted flex items-center justify-center">
                          <Icon className="w-3 h-3" />
                        </div>
                      </React.Fragment>
                    );
                  })}
                  {seq.steps.length > 5 && (
                    <span className="text-xs text-muted-foreground ml-1">+{seq.steps.length - 5}</span>
                  )}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {seq.enrollments.total} inscrits
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {seq.enrollments.active} actifs
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    {seq.enrollments.replied} réponses
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
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

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
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
              className="bg-destructive hover:bg-destructive/90"
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
