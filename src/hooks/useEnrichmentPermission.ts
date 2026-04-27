/**
 * useEnrichmentPermission — Hook pour récupérer permission + quota mensuel
 * d'enrichment de l'user courant.
 *
 * Returns :
 *   - canEnrich : true si user a la permission can_enrich_contacts
 *   - quotaMonthly : limite mensuelle (default 100)
 *   - quotaUsed : compteur consommé pour le mois en cours
 *   - quotaRemaining : quotaMonthly - quotaUsed
 *   - quotaPercent : usage en %
 *
 * Usage dans EnrichContactButton, BulkEnrichButton :
 *   - Désactive le bouton si !canEnrich (tooltip "Demandez à votre admin")
 *   - Affiche "X/Y ce mois" dans la modale de confirmation
 *   - Refuse l'action si quotaRemaining < cost
 */

import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';

interface MembershipRow {
  can_enrich_contacts: boolean;
  enrichment_quota_monthly: number;
  user_id: string;
}

interface QuotaRow {
  emails_consumed: number;
  phones_consumed: number;
  total_credits_used: number;
}

export function useEnrichmentPermission() {
  const { organizationId } = useOrganization();

  // 1. Récupération permission + quota max via organization_members
  const { data: membership, isLoading: membershipLoading } = useQuery({
    queryKey: ['enrichment-permission', organizationId],
    queryFn: async (): Promise<MembershipRow | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !organizationId) return null;
      const { data } = await supabase
        .from('organization_members')
        .select('can_enrich_contacts, enrichment_quota_monthly, user_id')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .maybeSingle();
      return data as MembershipRow | null;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000, // 5 min — la permission change rarement
  });

  // 2. Récupération du compteur du mois en cours via enrichment_user_quotas
  const periodMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  const { data: quotaUsedRow, isLoading: quotaLoading, refetch: refetchQuota } = useQuery({
    queryKey: ['enrichment-quota', organizationId, periodMonth],
    queryFn: async (): Promise<QuotaRow | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !organizationId) return null;
      const { data } = await supabase
        .from('enrichment_user_quotas')
        .select('emails_consumed, phones_consumed, total_credits_used')
        .eq('user_id', user.id)
        .eq('organization_id', organizationId)
        .eq('period_month', periodMonth)
        .maybeSingle();
      return (data as QuotaRow) || { emails_consumed: 0, phones_consumed: 0, total_credits_used: 0 };
    },
    enabled: !!organizationId,
    staleTime: 30 * 1000, // 30s — peut bouger après chaque enrich
  });

  const canEnrich = membership?.can_enrich_contacts !== false;
  const quotaMonthly = membership?.enrichment_quota_monthly ?? 100;
  const quotaUsed = (quotaUsedRow?.emails_consumed ?? 0) + (quotaUsedRow?.phones_consumed ?? 0);
  const quotaRemaining = Math.max(0, quotaMonthly - quotaUsed);
  const quotaPercent = quotaMonthly > 0 ? Math.round((quotaUsed / quotaMonthly) * 100) : 0;
  const isQuotaExhausted = quotaRemaining <= 0;
  const isQuotaWarning = quotaPercent >= 80;

  return {
    canEnrich,
    quotaMonthly,
    quotaUsed,
    quotaRemaining,
    quotaPercent,
    isQuotaExhausted,
    isQuotaWarning,
    isLoading: membershipLoading || quotaLoading,
    refetchQuota,
    creditsUsedThisMonth: quotaUsedRow?.total_credits_used ?? 0,
  };
}
