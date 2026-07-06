import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ReconnectAlert {
  account_id: string;
  failure_count: number;
  last_failure_at: string;
}

// Bannière « compte à reconnecter » : remonte les comptes LinkedIn de l'org
// ayant ≥ 2 conflits de session (multiple_sessions) sur les 12 dernières
// heures, via la RPC get_linkedin_reconnect_alerts (SECURITY DEFINER — la
// table search_failure_log elle-même reste service-role-only).
export const useReconnectAlerts = () => {
  return useQuery({
    queryKey: ['linkedin-reconnect-alerts'],
    queryFn: async (): Promise<ReconnectAlert[]> => {
      const { data, error } = await supabase.rpc('get_linkedin_reconnect_alerts');
      // Best-effort : la bannière ne doit jamais casser l'écran de recherche.
      if (error) return [];
      return (data as ReconnectAlert[]) ?? [];
    },
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
};
