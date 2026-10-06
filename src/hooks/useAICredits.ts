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
  const { organizationId, isLoading: isOrganizationLoading } = useOrganization();
  const queryClient = useQueryClient();

  const { data: balance, isLoading: isBalanceLoading, refetch } = useQuery({
    queryKey: ['ai-credits', organizationId],
    queryFn: async () => {
      const { data, error } = await invokeEdgeFunction<CreditBalance>('ai-credits', {
        action: 'get_balance',
      });
      // Sans ce rejet, une réponse d'erreur ({ success: false }) serait mise en
      // cache comme un succès : plan_credits et topup_credits absents sont lus
      // à 0, donc bandeau « plus de crédits » sur un solde intact.
      if (error) throw error;
      if (typeof data?.plan_credits !== 'number' || typeof data?.topup_credits !== 'number') {
        throw new Error('Solde de crédits illisible');
      }
      return data as CreditBalance;
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000,
  });

  /**
   * Chargement en cours, résolution de l'organisation comprise. Sur une requête
   * désactivée (organisation pas encore connue), react-query rend isPending
   * vrai et isFetching faux, donc isLoading faux : sans ce cumul, les écrans
   * passent directement à la branche « solde indisponible » pendant que
   * l'organisation se résout, puis affichent le solde une fraction de seconde
   * plus tard.
   */
  const isLoading = isOrganizationLoading || isBalanceLoading;

  /**
   * Le solde est réellement connu. Faux tant qu'il n'a pas été lu (chargement,
   * erreur, organisation non résolue) et faux aussi quand le serveur répond
   * sans période : sans ligne dans ai_credit_balances, get_balance renvoie des
   * zéros et period_start à null. Le garde serveur lit la même absence comme
   * une organisation jamais approvisionnée et laisse passer les appels : ces
   * zéros ne sont donc pas un solde vide, et aucun écran ne doit les afficher
   * ni en déduire que l'IA est coupée.
   */
  const hasBalance = !!balance && !!balance.period_start;
  const planCredits = balance?.plan_credits ?? 0;
  const topupCredits = balance?.topup_credits ?? 0;
  const creditsRemaining = planCredits + topupCredits;

  /**
   * Consommation de la période, calculée côté serveur depuis les transactions.
   * Absente sur une version déployée antérieure : sans elle, l'enveloppe du
   * mois est inconnue et tout pourcentage serait inventé.
   */
  const creditsConsumed = typeof balance?.credits_consumed_period === 'number'
    ? balance.credits_consumed_period
    : null;

  /** Enveloppe de la période : ce qui a été consommé plus ce qui reste. */
  const periodAllowance = creditsConsumed !== null
    ? creditsConsumed + creditsRemaining
    : null;

  const usagePercent = periodAllowance !== null && periodAllowance > 0
    ? Math.min(100, Math.round(((creditsConsumed as number) / periodAllowance) * 100))
    : null;

  const remainingPercent = periodAllowance !== null && periodAllowance > 0
    ? Math.round((creditsRemaining / periodAllowance) * 100)
    : null;

  const isOut = hasBalance && creditsRemaining <= 0;
  const isLow = hasBalance && !isOut && remainingPercent !== null && remainingPercent < 20;

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
    creditsConsumed,
    periodAllowance,
    /** Pourcentage consommé sur la période, ou null si l'enveloppe est inconnue. */
    usagePercent,
    /** Pourcentage restant sur la période, ou null si l'enveloppe est inconnue. */
    remainingPercent,
    isLoading,
    preauthCredits,
    getEstimate,
    invalidateBalance,
    refetch,
    // Convenience flags
    hasBalance,
    isLow,
    isOut,
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
      const { data, error } = await invokeEdgeFunction<{ transactions: CreditTransaction[] }>('ai-credits', {
        action: 'get_history',
        limit,
      });
      // Une erreur rendue comme liste vide se lit « aucune utilisation », ce qui
      // est faux : on laisse la requête échouer pour afficher l'indisponibilité.
      if (error) throw error;
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
