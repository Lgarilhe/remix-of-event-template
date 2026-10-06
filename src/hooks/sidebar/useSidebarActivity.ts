/**
 * Activité (§4.3, D25) : notifications hors messages des 30 derniers jours,
 * 30 lignes au plus. Appelé par la seule section Activité, lecture lancée
 * seulement quand elle est ouverte (`enabled` suit `open`) : fermée, aucune
 * requête ne tourne. L'état ouvert ou fermé est tenu par la section.
 */
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { notificationOrgFilter, type Notification } from '@/lib/notificationKinds';
import { queryState } from '@/lib/sidebarSection';
import { sidebarActivityKey, type SidebarQuery } from './useSidebarNotifications';

const ACTIVITY_WINDOW_MS = 30 * 86_400_000;

export function useSidebarActivity(open: boolean): SidebarQuery<Notification[]> {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { organizationId, isLoading: orgLoading } = useOrganization();

  const query = useQuery({
    queryKey: sidebarActivityKey(userId, organizationId),
    queryFn: async (): Promise<Notification[]> => {
      if (!userId) throw new Error('Utilisateur inconnu');
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, link, created_at, read_at, metadata, organization_id')
        .eq('user_id', userId)
        .or(notificationOrgFilter(organizationId))
        .neq('type', 'new_message')
        .gte('created_at', new Date(Date.now() - ACTIVITY_WINDOW_MS).toISOString())
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
    enabled: open && !!userId && !orgLoading,
    staleTime: 60_000,
    retry: 1,
  });

  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  const { state, stale } = queryState({ data: query.data, isError: query.isError, fetchStatus: query.fetchStatus });
  return { data: query.data, status: state, stale, retry };
}
