import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { CALLS_HUB_KEY } from '@/hooks/useCallsHub';
import {
  fetchCallInsightDetail,
  fetchCallTranscript,
  fetchInsightsForCalls,
  requestCallAnalysis,
} from '@/lib/phoneCallInsights';
import { isInsightInProgress } from '@/lib/phoneCallInsightModel';

export const CALL_INSIGHT_KEY = 'call-insight';

/** Relecture toutes les 5 secondes tant que l'analyse n'est pas terminée, pas plus de 3 minutes. */
const POLL_MS = 5000;
const POLL_WINDOW_MS = 3 * 60 * 1000;

/** L'analyse d'un appel : relue régulièrement tant qu'elle est en attente ou en cours. */
export function useCallInsightDetail(callId: string | null) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: [CALL_INSIGHT_KEY, 'detail', organizationId, callId],
    enabled: !!organizationId && !!callId,
    staleTime: 15 * 1000,
    queryFn: () => fetchCallInsightDetail(callId as string),
    refetchInterval: (query) => {
      const status = query.state.data?.insight?.status;
      if (!isInsightInProgress(status)) return false;
      return Date.now() - query.state.dataUpdatedAt < POLL_WINDOW_MS ? POLL_MS : false;
    },
  });
}

/** La transcription, lue seulement quand on la demande (elle est volumineuse). */
export function useCallTranscript(callId: string | null, enabled: boolean) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: [CALL_INSIGHT_KEY, 'transcript', organizationId, callId],
    enabled: !!organizationId && !!callId && enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchCallTranscript(callId as string),
  });
}

/** Les analyses de quelques appels (historique d'une fiche candidat). Une lecture en échec n'affiche simplement rien. */
export function useCallInsightSummaries(callIds: ReadonlyArray<string>) {
  const { organizationId } = useOrganization();
  const key = callIds.join(',');
  return useQuery({
    queryKey: [CALL_INSIGHT_KEY, 'summaries', organizationId, key],
    enabled: !!organizationId && callIds.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      try {
        return await fetchInsightsForCalls(callIds);
      } catch (error) {
        console.warn('[useCallInsightSummaries] analyses illisibles:', (error as { message?: string })?.message);
        return new Map();
      }
    },
  });
}

/** Lance (ou relance) l'analyse d'un appel, puis rafraîchit ce qui l'affiche. */
export function useAnalyzeCall(callId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options: { force?: boolean; fetchTranscript?: boolean } = {}) => requestCallAnalysis(callId as string, options),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: [CALL_INSIGHT_KEY] });
      void queryClient.invalidateQueries({ queryKey: [CALLS_HUB_KEY] });
    },
  });
}
