import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

// Un topic realtime par instance du hook : supabase.channel(topic) renvoie le
// channel existant si le nom est déjà pris, et le cleanup d'une instance
// couperait alors la souscription de l'autre (en-tête + menu utilisateur).
let channelSeq = 0;

export const useNotifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const { isReady, user } = useAuthReady();

  // Les messages LinkedIn (new_message) ont déjà leur pastille « Messages »
  // dans la sidebar : ils restent dans la liste mais sortent du compteur.
  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read_at && n.type !== 'new_message').length,
    [notifications],
  );

  const fetchNotifications = useCallback(async () => {
    if (!isReady) {
      setLoading(true);
      return;
    }

    if (!user) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    try {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      setNotifications((data || []) as Notification[]);
    } catch (error) {
      console.warn('[useNotifications] Failed to fetch notifications:', error);
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [isReady, user]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription for new notifications
  useEffect(() => {
    if (!isReady || !user) {
      setNotifications([]);
      return;
    }

    let isMounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    
    const setup = async () => {
      try {
        // Topic neuf à chaque (re)souscription : l'ancien channel termine son
        // leave pendant que le nouveau s'abonne (rafraîchissement de jeton).
        const topic = `notifications-realtime-${++channelSeq}`;
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
              if (!isMounted) return;
              const newNotif = payload.new as Notification;
              setNotifications(prev => [newNotif, ...prev]);
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
              if (!isMounted) return;
              const updated = payload.new as Notification;
              setNotifications(prev => prev.map(n => (n.id === updated.id ? { ...n, ...updated } : n)));
            }
          )
          .subscribe();
      } catch (error) {
        console.warn('[useNotifications] Failed to subscribe to notifications:', error);
      }
    };

    void setup();

    return () => {
      isMounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [isReady, user]);

  const markAsRead = useCallback(async (notificationId: string) => {
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId);

    setNotifications(prev =>
      prev.map(n => n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n)
    );
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;

    // Les messages LinkedIn restent gérés par la messagerie (pastille « Messages »).
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .neq('type', 'new_message')
      .is('read_at', null);

    setNotifications(prev => prev.map(n => (
      n.type === 'new_message' ? n : { ...n, read_at: n.read_at || new Date().toISOString() }
    )));
  }, [user]);

  return { notifications, unreadCount, loading, markAsRead, markAllAsRead, refresh: fetchNotifications };
};
