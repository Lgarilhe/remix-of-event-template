/**
 * useEnrichmentPermission — Hook pour récupérer permission, plafond membre et
 * forfait de contacts de l'organisation pour l'enrichissement de contact.
 *
 * Returns :
 *   - canEnrich : true si user a la permission can_enrich_contacts
 *   - quotaMonthly : plafond mensuel du membre (null = illimité, défaut depuis
 *     le lot P0-D : le forfait est par organisation)
 *   - quotaUsed : compteur consommé par le membre pour le mois en cours
 *   - quotaRemaining : quotaMonthly - quotaUsed (null si illimité)
 *   - quotaPercent : usage en % (0 si illimité)
 *   - includedMonthly / includedUsed / includedRemaining : forfait de contacts
 *     inclus par organisation et par mois (RPC get_org_contact_usage)
 *   - periodEnd : fin de la période du forfait (ISO), pour afficher la date de reset
 *
 * Usage dans EnrichContactButton, BulkEnrichButton, EnrichmentAnalytics :
 *   - Désactive le bouton si !canEnrich (tooltip "Demandez à votre admin")
 *   - Affiche "X / N contacts inclus ce mois" dans la modale de confirmation
 *   - Refuse l'action si le plafond membre est atteint
 */

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';

interface MembershipRow {
  can_enrich_contacts: boolean;
  enrichment_quota_monthly: number | null;
  user_id: string;
}

interface QuotaRow {
  emails_consumed: number;
  phones_consumed: number;
  total_credits_used: number;
}

/** Forme du jsonb renvoyé par la RPC get_org_contact_usage. */
interface OrgContactUsage {
  included_monthly: number;
  included_used: number;
  included_remaining: number;
  emails_this_month: number;
  phones_this_month: number;
  period_start: string;
  period_end: string;
}

/** "JJ/MM" de la date de reset du forfait, ou null si inconnue. */
export function formatResetDay(periodEnd: string | null): string | null {
  if (!periodEnd) return null;
  const d = new Date(periodEnd);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
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

  const { data: quotaUsedRow, isLoading: quotaLoading, refetch: refetchMemberQuota } = useQuery({
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

  // 3. Forfait de contacts inclus de l'organisation (RPC get_org_contact_usage)
  const { data: orgUsage, isLoading: orgUsageLoading, refetch: refetchOrgUsage } = useQuery({
    queryKey: ['org-contact-usage', organizationId],
    queryFn: async (): Promise<OrgContactUsage | null> => {
      if (!organizationId) return null;
      const { data, error } = await supabase.rpc('get_org_contact_usage', {
        p_organization_id: organizationId,
      });
      if (error) {
        console.warn('[useEnrichmentPermission] get_org_contact_usage failed:', error.message);
        return null;
      }
      return (data as unknown as OrgContactUsage | null) ?? null;
    },
    enabled: !!organizationId,
    staleTime: 30 * 1000, // 30s — bouge après chaque enrichissement terminé
  });

  const refetchQuota = useCallback(
    () => Promise.all([refetchMemberQuota(), refetchOrgUsage()]),
    [refetchMemberQuota, refetchOrgUsage],
  );

  const canEnrich = membership?.can_enrich_contacts !== false;
  // Plafond membre : NULL = illimité (le forfait est par organisation)
  const quotaMonthly: number | null = membership?.enrichment_quota_monthly ?? null;
  const quotaUsed = (quotaUsedRow?.emails_consumed ?? 0) + (quotaUsedRow?.phones_consumed ?? 0);
  const quotaRemaining: number | null = quotaMonthly === null ? null : Math.max(0, quotaMonthly - quotaUsed);
  const quotaPercent = quotaMonthly !== null && quotaMonthly > 0 ? Math.round((quotaUsed / quotaMonthly) * 100) : 0;
  const isQuotaExhausted = quotaMonthly !== null && quotaRemaining !== null && quotaRemaining <= 0;
  const isQuotaWarning = quotaMonthly !== null && quotaPercent >= 80;

  const includedMonthly = Number(orgUsage?.included_monthly ?? 0);
  const includedUsed = Number(orgUsage?.included_used ?? 0);
  const includedRemaining = Number(orgUsage?.included_remaining ?? 0);
  const periodEnd: string | null = orgUsage?.period_end ?? null;

  return {
    canEnrich,
    quotaMonthly,
    quotaUsed,
    quotaRemaining,
    quotaPercent,
    isQuotaExhausted,
    isQuotaWarning,
    includedMonthly,
    includedUsed,
    includedRemaining,
    periodEnd,
    isLoading: membershipLoading || quotaLoading || orgUsageLoading,
    refetchQuota,
    creditsUsedThisMonth: quotaUsedRow?.total_credits_used ?? 0,
  };
}
