import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { LINKEDIN_QUOTA_STATUS_QUERY_KEY } from './useLinkedInQuotaStatus';
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

/** Bornes du plafond d'actions visibles par jour, communes à tous les écrans. Max = contrainte member_quotas_max_actions_range (migration 20260513220000) et outil update_member_quota ; min 1 = plancher appliqué par enforceLinkedInAction. */
export const MAX_ACTIONS_PER_DAY_MIN = 1;
export const MAX_ACTIONS_PER_DAY_MAX = 500;
export const isValidMaxActionsPerDay = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= MAX_ACTIONS_PER_DAY_MIN && v <= MAX_ACTIONS_PER_DAY_MAX;

export function useMemberQuotas() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const { data: quotas = [], isLoading, isSuccess, isError, refetch } = useQuery({
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
      // Verrou d'écriture : sans lecture réussie, le formulaire part des
      // valeurs par défaut et l'upsert écraserait la ligne enregistrée.
      if (queryClient.getQueryState(['member-quotas', organizationId])?.status !== 'success') throw new Error('Quotas non chargés');
      const { data, error } = await supabase
        .from('member_quotas')
        .upsert({
          organization_id: organizationId!,
          user_id: userId,
          ...q,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,user_id' })
        .select('id, business_hours_start, business_hours_end, timezone, max_actions_per_day')
        .single();
      if (error) throw error;
      // Relecture de la ligne écrite : un champ envoyé dont la valeur relue
      // diffère est un échec, pas un succès (message non affiché, toast générique).
      const row = data as Record<string, unknown>;
      const notSaved = Object.entries(q).filter(([k, v]) => k in row && row[k] !== v);
      if (notSaved.length > 0) throw new Error(`Champs non enregistrés : ${notSaved.map(([k]) => k).join(', ')}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-quotas'] });
      // La carte « Plafonds du jour » lit heures et plafond par la RPC
      // get_linkedin_quota_status : l'invalider pour qu'elle suive l'enregistrement.
      queryClient.invalidateQueries({ queryKey: [LINKEDIN_QUOTA_STATUS_QUERY_KEY] });
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
    // Lecture réussie : isLoading vaut false quand la requête est désactivée
    // (organisation pas encore connue) alors que rien n'a été lu.
    isReady: isSuccess,
    isError,
    refetch,
    upsertQuota: upsertQuota.mutate,
    isSaving: upsertQuota.isPending,
    getQuotaForUser,
  };
}
