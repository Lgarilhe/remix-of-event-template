import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useOrganization } from '@/hooks/useOrganization';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** Message affiché quand tous les sièges sont utilisés (même texte côté serveur, send-team-invitation). */
export const SEAT_LIMIT_MESSAGE = 'Tous vos sièges sont utilisés. Ajoutez un siège dans Abonnement.';

/**
 * Hook to check subscription limits and enforce quotas.
 * Returns helper functions to check if a specific action is allowed.
 *
 * Source unique : useSubscriptionState (plan effectif, limites, sièges).
 *   - missions : limits.max_jobs du plan effectif (-1 = illimité) ;
 *   - membres : sièges calculés par useSubscriptionState (seatLimit / seatCount /
 *     seatsRemaining : plan gratuit, allocation d'essai ou quantité facturée).
 */
export const useQuotaGate = () => {
  const { state, isLoading, isFree, seatLimit, seatCount, seatsRemaining } = useSubscriptionState();
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

  // Une invitation en attente réserve un siège (même règle que send-team-invitation).
  const { data: pendingInvitations = 0 } = useQuery({
    queryKey: ['quota-pending-invitations', organizationId],
    queryFn: async () => {
      if (!organizationId) return 0;
      const { count, error } = await supabase
        .from('organization_invitations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'pending');
      if (error) return 0;
      return count || 0;
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });

  const limits = state?.limits ?? {};
  const maxJobs = typeof limits.max_jobs === 'number' ? limits.max_jobs : null;

  // Tant que l'état n'est pas chargé, on n'affiche pas de refus (le serveur reste la référence).
  const canCreateJob = maxJobs === null ? true : maxJobs === -1 || jobCount < maxJobs;
  const seatsRemainingAfterInvitations = Math.max(0, seatsRemaining - pendingInvitations);
  const canInviteMember = isLoading ? true : seatsRemainingAfterInvitations > 0;

  return {
    isLoading,
    isFree,
    limits,
    jobCount,
    canCreateJob,
    seatLimit,
    seatCount,
    seatsRemaining: seatsRemainingAfterInvitations,
    pendingInvitations,
    canInviteMember,
    seatLimitMessage: SEAT_LIMIT_MESSAGE,
    planName: state?.plan_name || 'Gratuit',
  };
};
