import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * useLinkedInQuotaStatus : état des plafonds LinkedIn d'un compte, lu côté
 * serveur (RPC get_linkedin_quota_status, migration 20260906193347).
 *
 * Compteurs du jour et de la semaine issus de linkedin_action_log, plafonds
 * effectifs après palier de montée en charge, pause en cours, heures ouvrées.
 * Remplace les compteurs localStorage de useUnipileQuota pour l'affichage.
 */

export type LinkedInRampStage = 'week1' | 'week2' | 'week3' | 'mature';

export interface LinkedInQuotaStatus {
  account_id: string;
  account_status: string | null;
  paused_until: string | null;
  linked_at: string | null;
  ramp_factor: number;
  ramp_stage: LinkedInRampStage;
  timezone: string;
  business_hours: { start: number; end: number };
  today: {
    visible_actions: number;
    profile_views: number;
    searches: number;
    inmails: number;
  };
  week: { invitations: number };
  caps: {
    visible_actions: number;
    profile_views: number;
    searches: number;
    inmails: number;
    weekly_invitations: number;
  };
  day_resets_at: string;
}

export const LINKEDIN_QUOTA_STATUS_QUERY_KEY = 'linkedin-quota-status';

/** Libellé du palier de montée en charge (même table que linkedin_ramp_factor). */
export function rampStageLabel(stage: LinkedInRampStage | null | undefined): string {
  switch (stage) {
    case 'week1': return 'Semaine 1 : 25 % des plafonds';
    case 'week2': return 'Semaine 2 : 50 % des plafonds';
    case 'week3': return 'Semaine 3 : 75 % des plafonds';
    default: return 'Compte mature';
  }
}

export function useLinkedInQuotaStatus(accountId: string | null | undefined) {
  return useQuery({
    queryKey: [LINKEDIN_QUOTA_STATUS_QUERY_KEY, accountId],
    queryFn: async (): Promise<LinkedInQuotaStatus | null> => {
      if (!accountId) return null;
      const { data, error } = await supabase.rpc('get_linkedin_quota_status', {
        p_account_id: accountId,
      });
      if (error) throw error;
      // La RPC renvoie NULL si le compte n'est rattaché à aucun membre.
      return (data as unknown as LinkedInQuotaStatus | null) ?? null;
    },
    enabled: !!accountId,
    staleTime: 60 * 1000,
  });
}
