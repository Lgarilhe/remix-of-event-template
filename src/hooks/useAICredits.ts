import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import {
  ACTION_COSTS,
  MODEL_CATALOG,
  estimateCredits,
  resolveModel,
  type CreditBalance,
  type CreditTransaction,
  type PreauthResult,
  type AIActionCost,
} from '@/types/aiCredits';

// Re-export for backward compatibility
export type { CreditBalance, CreditTransaction };
export { ACTION_COSTS as AI_CREDIT_COSTS };

/**
 * Main hook for the token-based AI credits system.
 * Provides: balance (plan + topup), pre-auth, estimation, model resolution.
 */
export const useAICredits = () => {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

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

  const planCredits = balance?.plan_credits ?? 0;
  const topupCredits = balance?.topup_credits ?? 0;
  const creditsRemaining = planCredits + topupCredits;
  const creditsTotal = balance?.credits_total ?? 0;

  const usagePercent = creditsTotal > 0
    ? Math.round(((creditsTotal - creditsRemaining) / creditsTotal) * 100)
    : 0;

  /**
   * Pre-authorize an AI action: check if enough credits are available.
   * Returns estimated cost and whether the action can proceed.
   */
  const preauthCredits = async (
    aiAction: string,
    modelId?: string
  ): Promise<PreauthResult> => {
    const { data } = await invokeEdgeFunction<PreauthResult>('ai-credits', {
      action: 'preauth',
      ai_action: aiAction,
      model: modelId,
    });
    return data ?? { has_credits: false, estimated_credits: 0, remaining: 0, model: 'claude-sonnet-4-6' };
  };

  /**
   * Estimate credits for an action with a given model (local, no API call).
   */
  const getEstimate = (actionId: string, modelId?: string): number => {
    const action = ACTION_COSTS[actionId];
    if (!action) return 1;
    const resolvedModel = modelId || resolveModel(action.routingTier, null, null, actionId);
    return estimateCredits(actionId, resolvedModel);
  };

  /**
   * Invalidate the credit balance cache (call after settlement).
   */
  const invalidateBalance = () => {
    queryClient.invalidateQueries({ queryKey: ['ai-credits', organizationId] });
  };

  return {
    balance,
    planCredits,
    topupCredits,
    creditsRemaining,
    creditsTotal,
    usagePercent,
    isLoading,
    preauthCredits,
    getEstimate,
    invalidateBalance,
    refetch,
    // Convenience flags
    isLow: creditsTotal > 0 && creditsRemaining / creditsTotal < 0.2,
    isOut: creditsRemaining <= 0,
    periodEnd: balance?.period_end ?? null,
  };
};

/**
 * Hook to fetch credit transaction history.
 */
export const useAICreditHistory = (limit = 50) => {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ['ai-credit-history', organizationId, limit],
    queryFn: async () => {
      const { data } = await invokeEdgeFunction<{ transactions: CreditTransaction[] }>('ai-credits', {
        action: 'get_history',
        limit,
      });
      return data?.transactions ?? [];
    },
    enabled: !!organizationId,
    staleTime: 2 * 60 * 1000,
  });
};

/**
 * Hook for the action cost grid (used in Settings page).
 * Returns all actions with estimated costs for each model.
 */
export const useActionCostGrid = () => {
  const models = Object.values(MODEL_CATALOG);
  const actions = Object.values(ACTION_COSTS);

  const grid = actions.map((action: AIActionCost) => ({
    ...action,
    costs: Object.fromEntries(
      models.map((model) => [model.id, estimateCredits(action.action, model.id)])
    ),
  }));

  return { grid, models, actions };
};
