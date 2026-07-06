import { useSubscription } from '@/hooks/useSubscription';
import { useOrganization } from '@/hooks/useOrganization';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Hook to check subscription limits and enforce quotas.
 * Returns helper functions to check if a specific action is allowed.
 */
export const useQuotaGate = () => {
  const { currentPlan, isFree, isPro, isLoading } = useSubscription();
  const { organizationId } = useOrganization();

  // Count active jobs (sourcing projects) for this org
  const { data: jobCount = 0 } = useQuery({
    queryKey: ['quota-job-count', organizationId],
    queryFn: async () => {
      if (!organizationId) return 0;
      const { count, error } = await supabase
        .from('sourcing_projects')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        // Les recherches autonomes (/sourcing) ne consomment pas le quota missions
        .eq('kind', 'mission')
        .is('archived_at', null);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });

  // Count org members
  const { data: memberCount = 0 } = useQuery({
    queryKey: ['quota-member-count', organizationId],
    queryFn: async () => {
      if (!organizationId) return 0;
      const { count, error } = await supabase
        .from('organization_members')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });

  const limits = currentPlan?.limits || { max_jobs: 2, max_searches: 50, max_members: 1, ai_credits: 100 };
  const hasResolvedLimits = Boolean(currentPlan?.limits);

  const canCreateJob = !hasResolvedLimits ? true : jobCount < limits.max_jobs;
  const canAddMember = !hasResolvedLimits ? true : memberCount < limits.max_members;

  return {
    isLoading,
    isFree,
    isPro,
    limits,
    jobCount,
    memberCount,
    canCreateJob,
    canAddMember,
    planName: currentPlan?.name || 'Free',
  };
};
