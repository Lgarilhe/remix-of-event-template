import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { toast } from 'sonner';

export interface ProcessStep {
  id: string;
  project_id: string;
  organization_id: string;
  step_order: number;
  name: string;
  description: string | null;
  objectives: string[];
  duration_minutes: number;
  interviewer_type: 'internal' | 'client' | 'panel';
  interviewer_name: string | null;
  interviewer_user_id: string | null;
  evaluation_criteria: Array<{ criterion: string; weight: number }>;
  is_eliminatory: boolean;
  template_source: 'default' | 'custom' | 'ai_generated';
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  project_id: string;
  user_id: string;
  role: 'lead' | 'sourcer' | 'account_manager' | 'reviewer' | 'freelance';
  permissions: { can_edit_brief: boolean; can_source: boolean; can_submit: boolean };
  created_at: string;
}

const DEFAULT_STEPS: Omit<ProcessStep, 'id' | 'project_id' | 'organization_id' | 'created_at' | 'updated_at'>[] = [
  { step_order: 1, name: 'Screening call', description: 'Premier échange téléphonique', objectives: ['Motivation', 'Disponibilité', 'Prétentions salariales'], duration_minutes: 30, interviewer_type: 'internal', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: true, template_source: 'default' },
  { step_order: 2, name: 'Entretien technique', description: 'Évaluation des compétences techniques', objectives: ['Compétences techniques', 'Résolution de problèmes'], duration_minutes: 60, interviewer_type: 'internal', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: false, template_source: 'default' },
  { step_order: 3, name: 'Entretien client', description: 'Rencontre avec le hiring manager', objectives: ['Culture fit', 'Adéquation avec l\'équipe'], duration_minutes: 45, interviewer_type: 'client', interviewer_name: null, interviewer_user_id: null, evaluation_criteria: [], is_eliminatory: false, template_source: 'default' },
];

export const useMissionProcess = (projectId: string | undefined) => {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  // Fetch steps
  const { data: steps = [], isLoading: loadingSteps } = useQuery({
    queryKey: ['mission-process-steps', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('mission_process_steps')
        .select('*')
        .eq('project_id', projectId)
        .order('step_order', { ascending: true });
      if (error) throw error;
      return (data || []) as ProcessStep[];
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch team
  const { data: team = [], isLoading: loadingTeam } = useQuery({
    queryKey: ['mission-team', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('mission_team')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as TeamMember[];
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });

  // Add step
  const addStepMutation = useMutation({
    mutationFn: async (input: Partial<ProcessStep> & { name: string }) => {
      if (!projectId || !organizationId) throw new Error('Missing context');
      const nextOrder = steps.length > 0 ? Math.max(...steps.map(s => s.step_order)) + 1 : 1;
      const { data, error } = await supabase
        .from('mission_process_steps')
        .insert({
          project_id: projectId,
          organization_id: organizationId,
          step_order: input.step_order ?? nextOrder,
          name: input.name,
          description: input.description || null,
          objectives: input.objectives || [],
          duration_minutes: input.duration_minutes ?? 30,
          interviewer_type: input.interviewer_type || 'internal',
          interviewer_name: input.interviewer_name || null,
          is_eliminatory: input.is_eliminatory ?? false,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ProcessStep;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mission-process-steps', projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Update step
  const updateStepMutation = useMutation({
    mutationFn: async ({ id, ...input }: Partial<ProcessStep> & { id: string }) => {
      const { error } = await supabase
        .from('mission_process_steps')
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mission-process-steps', projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Delete step
  const deleteStepMutation = useMutation({
    mutationFn: async (stepId: string) => {
      const { error } = await supabase
        .from('mission_process_steps')
        .delete()
        .eq('id', stepId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mission-process-steps', projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Reorder steps
  const reorderStepsMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      const updates = orderedIds.map((id, i) =>
        supabase.from('mission_process_steps').update({ step_order: i + 1 }).eq('id', id)
      );
      const results = await Promise.all(updates);
      const failed = results.find(r => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mission-process-steps', projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Initialize with default steps
  const initializeDefaultSteps = async () => {
    if (!projectId || !organizationId) return;
    for (const step of DEFAULT_STEPS) {
      await addStepMutation.mutateAsync({ ...step } as any);
    }
    toast.success('Process par défaut créé');
  };

  return {
    steps,
    team,
    loadingSteps,
    loadingTeam,
    addStep: addStepMutation.mutateAsync,
    updateStep: updateStepMutation.mutateAsync,
    deleteStep: deleteStepMutation.mutateAsync,
    reorderSteps: reorderStepsMutation.mutateAsync,
    initializeDefaultSteps,
    isAdding: addStepMutation.isPending,
  };
};
