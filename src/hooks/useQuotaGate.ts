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
  const { state, isLoading, isLoadingError, isFree, seatLimit, seatCount, seatsRemaining } = useSubscriptionState();
  const { organizationId } = useOrganization();

  // Missions actives de l'organisation (libellé de la grille tarifaire).
  // `sourcing_projects` n'a pas de colonne de date d'archivage : le filtre porte sur le
  // statut, comme le rangement de /missions (terminées et archivées exclues).
  // Une erreur est levée, jamais comptée 0 : tant que le compte est inconnu,
  // rien n'est refusé (jobCountLoaded).
  const jobCountQuery = useQuery({
    queryKey: ['quota-job-count', organizationId],
    queryFn: async () => {
      if (!organizationId) return 0;
      const { count, error } = await supabase
        .from('sourcing_projects')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        // Les recherches autonomes (/sourcing) ne consomment pas le quota missions
        .eq('kind', 'mission')
        .not('status', 'in', '(completed,archived)');
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });

  // Une invitation en attente réserve un siège (même règle que send-team-invitation).
  // Seules les invitations encore valides comptent : rien ne fait sortir une
  // invitation périmée du statut « pending ».
  const pendingInvitationsQuery = useQuery({
    queryKey: ['quota-pending-invitations', organizationId],
    queryFn: async () => {
      if (!organizationId) return 0;
      const { count, error } = await supabase
        .from('organization_invitations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString());
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });

  const jobCountLoaded = jobCountQuery.data !== undefined;
  const jobCount = jobCountQuery.data ?? 0;
  const pendingInvitationsLoaded = pendingInvitationsQuery.data !== undefined;
  // Inconnu : 0, comportement de canInviteMember inchangé.
  const pendingInvitations = pendingInvitationsQuery.data ?? 0;

  const limits = state?.limits ?? {};
  const maxJobs = typeof limits.max_jobs === 'number' ? limits.max_jobs : null;

  // Tant que l'état ou le compte ne sont pas connus, on ne refuse rien.
  const canCreateJob = maxJobs === null || !jobCountLoaded ? true : maxJobs === -1 || jobCount < maxJobs;
  // Vrai quand la réponse de canCreateJob est définitive (ni supposée ni en
  // attente). Une lecture en échec compte comme une réponse (on ne refuse
  // rien) : sinon un lien ?create= attendrait sans fin. Un compte en cours de
  // relecture (périmé au montage, ou invalidé après une création) n'est pas
  // définitif : ?create= attend le chiffre relu.
  const subscriptionSettled = state !== null || isLoadingError || (!!organizationId && !isLoading);
  const jobQuotaKnown =
    subscriptionSettled &&
    (maxJobs === null || maxJobs === -1 || (jobCountLoaded && !jobCountQuery.isFetching) || jobCountQuery.isError);
  const seatsRemainingAfterInvitations = Math.max(0, seatsRemaining - pendingInvitations);
  const canInviteMember = isLoading ? true : seatsRemainingAfterInvitations > 0;

  return {
    isLoading,
    isFree,
    limits,
    jobCount,
    jobCountLoaded,
    maxJobs,
    canCreateJob,
    jobQuotaKnown,
    seatLimit,
    seatCount,
    seatsRemaining: seatsRemainingAfterInvitations,
    pendingInvitations,
    pendingInvitationsLoaded,
    canInviteMember,
    seatLimitMessage: SEAT_LIMIT_MESSAGE,
    planName: state?.plan_name || 'Gratuit',
  };
};
