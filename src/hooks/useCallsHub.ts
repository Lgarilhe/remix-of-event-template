import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import {
  fetchCandidateNames,
  fetchOrgContactMap,
  fetchPhoneCallsSince,
  type AttachedCandidate,
  type PhoneCall,
} from '@/lib/phoneCalls';

export const CALLS_HUB_KEY = 'calls-hub';

/**
 * Les appels des `days` derniers jours, avec le candidat auquel chaque numéro
 * est rattaché (numéro E.164 → candidat). Un jour de marge : les jours se
 * comptent à Paris, la borne est posée en UTC.
 */
export function useCallsHub(days: number) {
  const { organizationId } = useOrganization();
  const query = useQuery({
    queryKey: [CALLS_HUB_KEY, organizationId, days],
    enabled: !!organizationId,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const since = new Date(Date.now() - (days + 1) * 24 * 3600 * 1000).toISOString();
      const [calls, contactMap] = await Promise.all([fetchPhoneCallsSince(since), fetchOrgContactMap()]);
      const numbers = new Set(calls.map((c) => c.numberE164).filter((n): n is string => !!n));
      const candidateIds = [...numbers].map((n) => contactMap.get(n)).filter((id): id is string => !!id);
      const names = await fetchCandidateNames(candidateIds);
      const attached = new Map<string, AttachedCandidate>();
      for (const number of numbers) {
        const candidateId = contactMap.get(number);
        if (!candidateId) continue;
        const known = names.get(candidateId);
        attached.set(number, { candidateId, name: known?.name ?? null, avatarUrl: known?.avatarUrl ?? null });
      }
      return { calls, attached };
    },
  });

  const calls: PhoneCall[] = useMemo(() => query.data?.calls ?? [], [query.data]);
  const attached = useMemo(() => query.data?.attached ?? new Map<string, AttachedCandidate>(), [query.data]);

  return {
    calls,
    attached,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error instanceof Error ? query.error.message : undefined,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
  };
}
