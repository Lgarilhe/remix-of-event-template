import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';

export interface SubscriptionPlan {
  id: string;
  name: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  features: string[];
  limits: {
    max_jobs: number;
    max_searches: number;
    max_members: number;
    ai_credits: number;
    contacts_included?: number;
  };
  stripe_price_id_monthly: string | null;
  stripe_price_id_yearly: string | null;
  sort_order: number;
}

export interface OrganizationSubscription {
  id: string;
  organization_id: string;
  plan_id: string;
  status: string;
  billing_cycle: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  /** Sièges facturés (quantité de l'abonnement), 1 par défaut. */
  seats: number;
  /** Fin de l'essai gratuit (status = trialing), null hors essai. */
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export const useSubscription = () => {
  const { organizationId } = useOrganization();
  // Plan effectif calculé côté serveur (essai expiré ou abonnement résilié →
  // free). useSubscriptionState est la référence ; la ligne brute ci-dessous
  // reste exposée telle quelle.
  const { state: subscriptionState } = useSubscriptionState();

  const { data: subscription, isLoading: isLoadingSub } = useQuery({
    queryKey: ['org-subscription', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      const { data, error } = await supabase
        .from('organization_subscriptions')
        .select('*')
        .eq('organization_id', organizationId)
        .single();
      if (error) return null;
      return data as OrganizationSubscription;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const effectivePlanId = subscriptionState?.effective_plan_id ?? subscription?.plan_id ?? null;

  const { data: currentPlan, isLoading: isLoadingPlan } = useQuery({
    queryKey: ['subscription-plan', effectivePlanId],
    queryFn: async () => {
      if (!effectivePlanId) return null;
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('id', effectivePlanId)
        .single();
      if (error) return null;
      return {
        ...data,
        features: data.features as unknown as string[],
        limits: data.limits as unknown as SubscriptionPlan['limits'],
      } as SubscriptionPlan;
    },
    enabled: !!effectivePlanId,
    staleTime: 30 * 60 * 1000,
  });

  const isPro = subscription?.plan_id === 'pro' || subscription?.plan_id === 'enterprise';
  const isEnterprise = subscription?.plan_id === 'enterprise';
  const isFree = !effectivePlanId || effectivePlanId === 'free';

  return {
    subscription,
    currentPlan,
    isPro,
    isEnterprise,
    isFree,
    isLoading: isLoadingSub || isLoadingPlan,
    planId: effectivePlanId || 'free',
    isActive: subscription?.status === 'active' || subscription?.status === 'trialing',
  };
};

export const useSubscriptionPlans = () => {
  return useQuery({
    queryKey: ['subscription-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data || []).map(p => ({
        ...p,
        features: p.features as unknown as string[],
        limits: p.limits as unknown as SubscriptionPlan['limits'],
      })) as SubscriptionPlan[];
    },
    staleTime: 30 * 60 * 1000,
  });
};
