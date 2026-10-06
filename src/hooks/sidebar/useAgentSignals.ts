/**
 * Signaux de l'assistant (§4.4, D28 à D30) : actions proposées, plans de
 * recherche proposés et conversations en cours. Partagé par À valider (onglets
 * À traiter et Assistant), le point de l'onglet Assistant et le chiffre.
 *
 * Deux lectures dans une seule queryFn. Filtres « moi » indispensables : la
 * lecture est ouverte à toute l'organisation, et le serveur refuse toute
 * décision à un autre que le proposant. Le dédoublonnage plan/action a lieu
 * dans deriveAgentSignals, et nulle part ailleurs.
 */
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { businessDaysCutoff } from '@/lib/businessDays';
import { APPROVAL_BUSINESS_DAYS, deriveAgentSignals } from '@/lib/sidebarSignals';
import { queryState, type SectionState } from '@/lib/sidebarSection';

export interface ProposedAction {
  id: string;
  conversation_id: string | null;
  tool_name: string;
  dry_run_result: unknown;
  proposed_at: string;
}

export interface AgentConversationItem {
  id: string;
  title: string | null;
  job_title: string | null;
  project_id: string | null;
  status: string;
  updated_at: string;
}

export type PlanItem = AgentConversationItem;
export type RunningItem = AgentConversationItem;

export interface AgentSignalsData {
  actions: ProposedAction[];
  plans: PlanItem[];
  running: RunningItem[];
}

export const agentSignalsQueryKey = (userId: string | null, organizationId: string | null) =>
  ['sidebar', 'agent-signals', userId, organizationId] as const;

export interface AgentSignals extends AgentSignalsData {
  status: SectionState;
  stale: boolean;
  retry: () => void;
}

const EMPTY: AgentSignalsData = { actions: [], plans: [], running: [] };

export function useAgentSignals(): AgentSignals {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: agentSignalsQueryKey(userId, organizationId),
    queryFn: async (): Promise<AgentSignalsData> => {
      if (!userId || !organizationId) throw new Error('Organisation inconnue');
      const cutoff = businessDaysCutoff(new Date(), APPROVAL_BUSINESS_DAYS).toISOString();
      const actionsQ = supabase
        .from('agent_tool_executions')
        .select('id, conversation_id, tool_name, dry_run_result, proposed_at')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .eq('status', 'proposed')
        .gte('proposed_at', cutoff)
        .order('proposed_at', { ascending: false })
        .limit(20);
      const convQ = supabase
        .from('agent_conversations')
        .select('id, title, job_title, project_id, status, updated_at')
        .eq('created_by', userId)
        .eq('organization_id', organizationId)
        .in('status', ['plan_proposed', 'running'])
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(20);
      const [actionsRes, convRes] = await Promise.all([actionsQ, convQ]);
      if (actionsRes.error) throw actionsRes.error;
      if (convRes.error) throw convRes.error;
      const actions: ProposedAction[] = actionsRes.data ?? [];
      const convs: AgentConversationItem[] = convRes.data ?? [];
      const { plans, running } = deriveAgentSignals(convs, actions, new Date());
      return { actions, plans, running };
    },
    enabled: !!userId && !!organizationId,
    staleTime: 60_000,
    retry: 1,
    refetchInterval: 2 * 60_000,
  });

  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  const { state, stale } = queryState({ data: query.data, isError: query.isError, fetchStatus: query.fetchStatus });
  const data = query.data ?? EMPTY;
  return { actions: data.actions, plans: data.plans, running: data.running, status: state, stale, retry };
}
