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
    const { data: state } = await supabase
      .from('round_robin_state')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('job_id', jobId)
      .single();

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
      return null;
    }

    // Update round-robin state
    await supabase
      .from('round_robin_state')
      .upsert({
        organization_id: organizationId,
        job_id: jobId,
        last_assigned_user_id: nextUserId,
        last_assigned_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,job_id' });

    return nextUserId;
  }, [organizationId, jobId, assignments]);

  return { assignCandidate, hasRecruiters: assignments.length > 0 };
}
