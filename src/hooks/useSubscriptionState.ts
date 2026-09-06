/**
 * useSubscriptionState — état d'abonnement calculé côté serveur (RPC
 * get_subscription_state, migration 20260906181806) : plan effectif (free si
 * l'essai est expiré), jours d'essai restants, sièges facturés et membres
 * comptés, limites du plan effectif.
 *
 * C'est la seule source pour les décisions d'affichage liées au plan (gating,
 * quotas de sièges, bannières d'essai). useSubscription reste pour la ligne
 * brute et le catalogue.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

export interface SubscriptionLimits {
  max_jobs?: number;
  max_searches?: number;
  max_members?: number;
  ai_credits?: number;
  contacts_included?: number;
}

export interface SubscriptionState {
  organization_id: string;
  plan_id: string;
  effective_plan_id: string;
  plan_name: string | null;
  limits: SubscriptionLimits;
  status: string;
  billing_cycle: string | null;
  trial_ends_at: string | null;
  trial_days_left: number | null;
  seats: number;
  seat_count: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  has_stripe_subscription: boolean;
}

export const SUBSCRIPTION_STATE_QUERY_KEY = 'subscription-state';

/** Sièges autorisés pendant l'essai (aucune quantité Stripe à ce stade). */
export const TRIAL_SEAT_ALLOWANCE = 10;

export const useSubscriptionState = () => {
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: [SUBSCRIPTION_STATE_QUERY_KEY, organizationId],
    queryFn: async (): Promise<SubscriptionState | null> => {
      if (!organizationId) return null;
      const { data, error } = await supabase.rpc('get_subscription_state', {
        p_organization_id: organizationId,
      });
      if (error) throw error;
      return (data as unknown as SubscriptionState | null) ?? null;
    },
    enabled: !!organizationId,
    staleTime: 60 * 1000,
  });

  const state = query.data ?? null;
  const effectivePlanId = state?.effective_plan_id ?? 'free';
  const isTrialing = state?.status === 'trialing';
  const isFree = effectivePlanId === 'free';

  // Sièges autorisés : limite du plan gratuit, allocation d'essai, sinon quantité facturée.
  const seatLimit = isFree
    ? Math.max(1, state?.limits?.max_members ?? 1)
    : isTrialing
      ? TRIAL_SEAT_ALLOWANCE
      : Math.max(1, state?.seats ?? 1);
  const seatCount = state?.seat_count ?? 0;

  return {
    state,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    effectivePlanId,
    isTrialing,
    isFree,
    isPaid: !!state?.has_stripe_subscription && !isFree,
    trialDaysLeft: state?.trial_days_left ?? null,
    seatLimit,
    seatCount,
    seatsRemaining: Math.max(0, seatLimit - seatCount),
  };
};
