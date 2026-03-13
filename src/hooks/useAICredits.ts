import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

export interface CreditBalance {
  id: string;
  organization_id: string;
  credits_remaining: number;
  credits_total: number;
  period_start: string;
  period_end: string;
  updated_at: string;
}

export interface CreditTransaction {
  id: string;
  organization_id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  action: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// Credit costs (mirror of edge function)
export const AI_CREDIT_COSTS: Record<string, { cost: number; label: string }> = {
  scoring: { cost: 1, label: 'Scoring IA' },
  outreach_message: { cost: 1, label: 'Message de prospection' },
  analyze_response: { cost: 1, label: 'Analyse de réponse' },
  screen_candidate: { cost: 1, label: 'Screening candidat' },
  generate_scorecard: { cost: 2, label: 'Scorecard' },
  call_report: { cost: 2, label: 'Compte-rendu d\'appel' },
  live_coaching: { cost: 5, label: 'Coaching live' },
  agent_search: { cost: 3, label: 'Recherche agent IA' },
  profile_fraud: { cost: 1, label: 'Détection fraude' },
  nurturing_analysis: { cost: 1, label: 'Analyse nurturing' },
  filter_assistant: { cost: 1, label: 'Assistant filtres' },
  refine_search: { cost: 1, label: 'Affinage recherche' },
};

export const useAICredits = () => {
  const { organizationId } = useOrganization();

  const { data: balance, isLoading, refetch } = useQuery({
    queryKey: ['ai-credits', organizationId],
    queryFn: async () => {
      const { data } = await invokeEdgeFunction<CreditBalance>('ai-credits', {
        action: 'get_balance',
      });
      return data as CreditBalance;
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000,
  });

  const checkCredits = async (aiAction: string): Promise<boolean> => {
    const { data } = await invokeEdgeFunction<{ has_credits: boolean }>('ai-credits', {
      action: 'check_credits',
      ai_action: aiAction,
    });
    return data?.has_credits ?? false;
  };

  const deductCredits = async (aiAction: string, description?: string) => {
    const { data } = await invokeEdgeFunction<{ success: boolean; remaining?: number; error?: string }>('ai-credits', {
      action: 'deduct',
      ai_action: aiAction,
      description,
    });
    if (data?.success) {
      refetch();
    }
    return data;
  };

  const usagePercent = balance
    ? balance.credits_total > 0
      ? Math.round(((balance.credits_total - balance.credits_remaining) / balance.credits_total) * 100)
      : 0
    : 0;

  return {
    balance,
    creditsRemaining: balance?.credits_remaining ?? 0,
    creditsTotal: balance?.credits_total ?? 0,
    usagePercent,
    isLoading,
    checkCredits,
    deductCredits,
    refetch,
  };
};

export const useAICreditHistory = () => {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['ai-credit-history', organizationId],
    queryFn: async () => {
      const { data } = await invokeEdgeFunction<{ transactions: CreditTransaction[] }>('ai-credits', {
        action: 'get_history',
        limit: 50,
      });
      return data?.transactions ?? [];
    },
    enabled: !!organizationId,
    staleTime: 2 * 60 * 1000,
  });
};
