import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { fetchOrgContactNumbers, fetchRecentPhoneCalls } from '@/lib/phoneCalls';
import { groupUnattachedCalls } from '@/lib/phoneCallGroups';

export const UNATTACHED_CALLS_KEY = 'unattached-calls';

/**
 * Appels des 300 dernières entrées de l'organisation dont le numéro ne
 * correspond à aucun candidat, regroupés par numéro. Le rapprochement compare
 * les numéros E.164 des appels à ceux de candidate_contacts, normalisés ici
 * (la colonne est du texte libre, sans E.164 en base).
 */
export function useUnattachedCalls() {
  const { organizationId } = useOrganization();
  const query = useQuery({
    queryKey: [UNATTACHED_CALLS_KEY, organizationId],
    enabled: !!organizationId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [calls, known] = await Promise.all([fetchRecentPhoneCalls(), fetchOrgContactNumbers()]);
      return { calls, known };
    },
  });

  const groups = useMemo(
    () => (query.data ? groupUnattachedCalls(query.data.calls, query.data.known) : []),
    [query.data],
  );

  return {
    groups,
    /** Appels reçus au total (rattachés ou non) : 0 = rien n'est encore remonté de l'opérateur. */
    totalCalls: query.data?.calls.length ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error instanceof Error ? query.error.message : undefined,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
  };
}
