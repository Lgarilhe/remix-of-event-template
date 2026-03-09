import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { useJobAssignments } from './useJobAssignments';
import { toast } from 'sonner';

export function useRoundRobin(jobId: string) {
  const { organizationId } = useOrganization();
  const { assignments } = useJobAssignments(jobId);

  const assignCandidate = useCallback(async (candidateId: string, candidateName?: string) => {
    if (!organizationId || assignments.length === 0) {
      toast.error('Aucun recruteur assigné à ce poste');
      return null;
    }

    // Get current round-robin state
    const { data: state, error: stateError } = await supabase
      .from('round_robin_state')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('job_id', jobId)
      .single();

    // PGRST116 = no rows found, which is expected for first assignment
    if (stateError && stateError.code !== 'PGRST116') {
      console.error('Round-robin state fetch error:', stateError);
      toast.error('Erreur lors de la récupération de l\'état round-robin');
      return null;
    }

    // Find next recruiter
    const assignedUserIds = assignments.map(a => a.user_id);
    let nextIndex = 0;

    if (state?.last_assigned_user_id) {
      const lastIndex = assignedUserIds.indexOf(state.last_assigned_user_id);
      nextIndex = (lastIndex + 1) % assignedUserIds.length;
    }

    const nextUserId = assignedUserIds[nextIndex];

    // Create the assignment
    const { error: assignError } = await supabase
      .from('candidate_assignments')
      .upsert({
        organization_id: organizationId,
        assigned_to: nextUserId,
        job_id: jobId,
        candidate_id: candidateId,
        candidate_name: candidateName || null,
        assignment_method: 'round_robin',
      }, { onConflict: 'organization_id,job_id,candidate_id' });

    if (assignError) {
      console.error('Round-robin assignment error:', assignError);
      toast.error('Erreur lors de l\'assignation du candidat');
      return null;
    }

    // Update round-robin state
    const { error: stateUpdateError } = await supabase
      .from('round_robin_state')
      .upsert({
        organization_id: organizationId,
        job_id: jobId,
        last_assigned_user_id: nextUserId,
        last_assigned_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,job_id' });

    if (stateUpdateError) {
      console.error('Round-robin state update error:', stateUpdateError);
      // Non-blocking: assignment succeeded, state update is best-effort
    }

    return nextUserId;
  }, [organizationId, jobId, assignments]);

  return { assignCandidate, hasRecruiters: assignments.length > 0 };
}
