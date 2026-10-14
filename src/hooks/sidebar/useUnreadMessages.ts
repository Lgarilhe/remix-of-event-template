import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { notificationOrgFilter } from '@/lib/notificationKinds';

/** All unread message notifications, with no age window or recruitment filter. */
export function useUnreadMessages() {
  const { user } = useAuthReady();
  const { organizationId, isLoading } = useOrganization();
  const query = useQuery({
    queryKey: ['sidebar', 'unread-messages', user?.id ?? null, organizationId],
    enabled: !!user && !isLoading,
    queryFn: async () => {
      const { count, error } = await supabase.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .or(notificationOrgFilter(organizationId))
        .eq('type', 'new_message')
        .is('read_at', null);
      if (error) throw error;
      return count;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  return { count: query.data ?? null, unavailable: query.isError };
}
