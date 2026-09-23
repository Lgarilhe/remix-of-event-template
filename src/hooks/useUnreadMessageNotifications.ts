import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { isInActiveOrg, notificationOrgFilter, type Notification } from '@/hooks/useNotifications';

// Un topic realtime par instance : supabase.channel(topic) renvoie le channel
// existant si le nom est déjà pris (sidebar + dashboard montent ce hook en
// même temps) et le cleanup de l'un couperait la souscription de l'autre.
let channelSeq = 0;

/**
 * Lightweight global hook: counts unread notifications of type 'new_message'.
 * Works on any page (uses the notifications table, not the Unipile API).
 * Subscribes to realtime inserts for instant badge updates.
 * Périmètre : organisation active et notifications sans organisation.
 */
export const useUnreadMessageNotifications = () => {
  const [count, setCount] = useState(0);
  const { isReady, user } = useAuthReady();
  const { organizationId, isLoading: orgLoading } = useOrganization();

  useEffect(() => {
    if (!isReady || !user) {
      setCount(0);
      return;
    }
    // Comptage et filtre temps réel limités à l'organisation active : on l'attend.
    if (orgLoading) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let isMounted = true;

    const fetchCount = async () => {
      const { count: c } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .or(notificationOrgFilter(organizationId))
        .eq('type', 'new_message')
        .is('read_at', null);
      if (!isMounted) return;
      setCount(c ?? 0);
    };

    const setup = async () => {
      try {
        // Souscrire d'abord, compter ensuite : aucun événement ne tombe entre
        // le comptage et l'écoute. Topic neuf à chaque (re)souscription.
        const topic = `unread-msg-notifs-${++channelSeq}`;
        channel = supabase
          .channel(topic)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'notifications',
              filter: `user_id=eq.${user.id}`,
            },
            (payload) => {
              // Le canal ne filtre que sur user_id : l'organisation se vérifie ici.
              const row = payload.new as Partial<Notification>;
              if (row?.type === 'new_message' && isInActiveOrg(row, organizationId)) {
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
              const row = payload.new as Partial<Notification>;
              if (row?.type === 'new_message' && row?.read_at && isInActiveOrg(row, organizationId)) {
                setCount(prev => Math.max(0, prev - 1));
              }
            }
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              void fetchCount();
            }
          });
      } catch (error) {
        if (!isMounted) return;
        console.warn('[useUnreadMessageNotifications] Failed to load notifications:', error);
        setCount(0);
      }
    };

    void setup();

    return () => {
      isMounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [isReady, user, orgLoading, organizationId]);

  return count;
};
