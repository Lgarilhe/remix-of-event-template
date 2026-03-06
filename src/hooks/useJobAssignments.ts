import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { toast } from 'sonner';

export interface JobAssignment {
  id: string;
  organization_id: string;
  member_id: string;
  user_id: string;
  job_id: string;
  job_title: string | null;
  assigned_by: string;
  created_at: string;
}

export function useJobAssignments(jobId?: string | null) {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['job-assignments', organizationId, jobId],
    queryFn: async () => {
      let query = supabase
        .from('job_assignments')
        .select('*')
        .eq('organization_id', organizationId!);
      
      if (jobId) {
        query = query.eq('job_id', jobId);
      }

      const { data, error } = await query.order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as JobAssignment[];
    },
    enabled: !!organizationId,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ memberId, userId, jobId, jobTitle }: {
      memberId: string; userId: string; jobId: string; jobTitle?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      const { error } = await supabase.from('job_assignments').insert({
        organization_id: organizationId!,
        member_id: memberId,
        user_id: userId,
        job_id: jobId,
        job_title: jobTitle || null,
        assigned_by: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-assignments'] });
      toast.success('Recruteur assigné au poste');
    },
    onError: (err: Error) => {
      if (err.message?.includes('duplicate')) {
        toast.error('Ce recruteur est déjà assigné à ce poste');
      } else {
        toast.error('Erreur lors de l\'assignation');
      }
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase
        .from('job_assignments')
        .delete()
        .eq('id', assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['job-assignments'] });
      toast.success('Assignation retirée');
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  return {
    assignments,
    isLoading,
    assign: assignMutation.mutate,
    unassign: unassignMutation.mutate,
    isAssigning: assignMutation.isPending,
  };
}
