import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';

/**
 * Lightweight global hook: counts unread notifications of type 'new_message'.
 * Works on any page (uses the notifications table, not the Unipile API).
 * Subscribes to realtime inserts for instant badge updates.
 */
export const useUnreadMessageNotifications = () => {
  const [count, setCount] = useState(0);
  const { isReady, user } = useAuthReady();

  useEffect(() => {
    if (!isReady || !user) {
      setCount(0);
      return;
    }

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let isMounted = true;

    const setup = async () => {
      // Initial count
      const { count: c } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('type', 'new_message')
        .is('read_at', null);

      if (!isMounted) return;
      setCount(c ?? 0);

      // Realtime: increment on new inserts
      channel = supabase
        .channel('unread-msg-notifs')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if ((payload.new as any)?.type === 'new_message') {
              setCount(prev => prev + 1);
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const row = payload.new as any;
            if (row?.type === 'new_message' && row?.read_at) {
              setCount(prev => Math.max(0, prev - 1));
            }
          }
        )
        .subscribe();
    };

    setup();

    return () => {
      isMounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [isReady, user]);

  return count;
};
