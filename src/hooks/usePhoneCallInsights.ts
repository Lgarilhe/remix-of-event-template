import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCallInsights, type CallInsight } from '@/lib/phoneCallInsights';

const EMPTY: Map<string, CallInsight> = new Map();

/**
 * Résumés, transcriptions et tâches proposées des appels d'une fiche, lus en
 * deux requêtes pour toute la liste. Clé sous ['phone-call-insights'] : une
 * action sur un appel invalide toute la famille.
 */
export function usePhoneCallInsights(callIds: readonly string[]): { byCallId: Map<string, CallInsight>; loading: boolean } {
  const key = useMemo(() => Array.from(new Set(callIds)).sort().join(','), [callIds]);
  const query = useQuery({
    queryKey: ['phone-call-insights', key],
    queryFn: () => fetchCallInsights(key.split(',')),
    enabled: key !== '',
    staleTime: 30_000,
  });
  return { byCallId: query.data ?? EMPTY, loading: query.isLoading };
}
