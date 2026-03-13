import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

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
  created_at: string;
  updated_at: string;
}

export const useSubscription = () => {
  const { organizationId } = useOrganization();

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

  const { data: currentPlan, isLoading: isLoadingPlan } = useQuery({
    queryKey: ['subscription-plan', subscription?.plan_id],
    queryFn: async () => {
      if (!subscription?.plan_id) return null;
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('id', subscription.plan_id)
        .single();
      if (error) return null;
      return {
        ...data,
        features: data.features as unknown as string[],
        limits: data.limits as unknown as SubscriptionPlan['limits'],
      } as SubscriptionPlan;
    },
    enabled: !!subscription?.plan_id,
    staleTime: 30 * 60 * 1000,
  });

  const isPro = subscription?.plan_id === 'pro' || subscription?.plan_id === 'enterprise';
  const isEnterprise = subscription?.plan_id === 'enterprise';
  const isFree = !subscription || subscription.plan_id === 'free';

  return {
    subscription,
    currentPlan,
    isPro,
    isEnterprise,
    isFree,
    isLoading: isLoadingSub || isLoadingPlan,
    planId: subscription?.plan_id || 'free',
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
