import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { toast } from 'sonner';

export interface MemberQuota {
  id: string;
  organization_id: string;
  user_id: string;
  max_inmails_per_day: number;
  max_messages_per_day: number;
  max_searches_per_day: number;
  max_profile_visits_per_day: number;
  // ── Conformité LinkedIn (warning #260513-007211) — cf. migration 20260513220000
  business_hours_start: number;       // 0-23, default 8
  business_hours_end: number;         // 1-24, default 19
  max_actions_per_day: number;        // Cap global actions visibles/jour, default 80
  timezone: string;                   // IANA, default 'Europe/Paris'
  created_at: string;
  updated_at: string;
}

// Alignés sur les défauts serveur (_shared/linkedin-quotas.ts et RPC
// get_linkedin_quota_status) : 80 actions visibles, 100 visites, 100 recherches, 40 InMails.
export const DEFAULT_QUOTAS = {
  max_inmails_per_day: 40,
  max_messages_per_day: 100,
  max_searches_per_day: 100,
  max_profile_visits_per_day: 100,
  business_hours_start: 8,
  business_hours_end: 19,
  max_actions_per_day: 80,
  timezone: 'Europe/Paris',
};

export function useMemberQuotas() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const { data: quotas = [], isLoading } = useQuery({
    queryKey: ['member-quotas', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_quotas')
        .select('*')
        .eq('organization_id', organizationId!);
      if (error) throw error;
      return (data || []) as MemberQuota[];
    },
    enabled: !!organizationId,
  });

  const upsertQuota = useMutation({
    mutationFn: async ({ userId, quotas: q }: {
      userId: string;
      quotas: Partial<typeof DEFAULT_QUOTAS>;
    }) => {
      const { error } = await supabase
        .from('member_quotas')
        .upsert({
          organization_id: organizationId!,
          user_id: userId,
          ...q,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,user_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-quotas'] });
      toast.success('Quotas mis à jour');
    },
    onError: () => toast.error('Erreur lors de la mise à jour des quotas'),
  });

  const getQuotaForUser = (userId: string): MemberQuota | null => {
    return quotas.find(q => q.user_id === userId) || null;
  };

  return {
    quotas,
    isLoading,
    upsertQuota: upsertQuota.mutate,
    isSaving: upsertQuota.isPending,
    getQuotaForUser,
  };
}
