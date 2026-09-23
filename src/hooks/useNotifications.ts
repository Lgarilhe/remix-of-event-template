import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { isActionable } from '@/lib/notificationKinds';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
  organization_id: string | null;
  metadata: Json | null;
}

/**
 * Filtre PostgREST (.or) : notifications de l'organisation active, plus celles
 * écrites sans organisation. Sans organisation active, seules ces dernières.
 */
export const notificationOrgFilter = (organizationId: string | null) =>
  organizationId
    ? `organization_id.eq.${organizationId},organization_id.is.null`
    : 'organization_id.is.null';

/** Même règle pour une ligne reçue en temps réel (le canal ne filtre que sur user_id). */
export const isInActiveOrg = (
  row: { organization_id?: string | null } | null | undefined,
  organizationId: string | null,
) => !row?.organization_id || row.organization_id === organizationId;

/**
 * Applique une liste relue sans perdre ce qui s'est passé pendant la requête :
 * les notifications reçues en temps réel, plus récentes que la réponse, et les
 * marquages lus faits entre-temps.
 */
function mergeFetched(prev: Notification[], fetched: Notification[]): Notification[] {
  if (fetched.length === 0) return fetched;
  const newest = fetched[0].created_at;
  const fetchedIds = new Set(fetched.map(n => n.id));
  const arrived = prev.filter(n => !fetchedIds.has(n.id) && n.created_at > newest);
  const readLocally = new Map(prev.filter(n => n.read_at).map(n => [n.id, n.read_at]));
  const merged = fetched.map(n => (!n.read_at && readLocally.has(n.id) ? { ...n, read_at: readLocally.get(n.id) ?? null } : n));
  return [...arrived, ...merged].slice(0, 50);
}

// Un topic realtime par instance du hook : supabase.channel(topic) renvoie le
// channel existant si le nom est déjà pris, et le cleanup d'une instance
// couperait alors la souscription de l'autre (en-tête + menu utilisateur).
let channelSeq = 0;

export const useNotifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { isReady, user } = useAuthReady();
  const { organizationId, isLoading: orgLoading } = useOrganization();
  // Chaque chargement invalide ceux encore en vol : la réponse la plus récente gagne.
  const requestSeq = useRef(0);
  // Périmètre (utilisateur + organisation) de la liste affichée.
  const loadedScope = useRef<string | null>(null);

  // Les messages LinkedIn (new_message) ont déjà leur pastille « Messages »
  // dans la sidebar : ils restent dans la liste mais sortent du compteur.
  const unreadCount = useMemo(
    () => notifications.filter(n => !n.read_at && n.type !== 'new_message').length,
    [notifications],
  );

  // Non lues qui demandent une action (classement : src/lib/notificationKinds.ts).
  const actionUnreadCount = useMemo(
    () => notifications.filter(n => !n.read_at && isActionable(n)).length,
    [notifications],
  );

  const fetchNotifications = useCallback(async () => {
    const seq = ++requestSeq.current;

    if (!isReady || orgLoading) {
      setLoading(true);
      return;
    }

    if (!user) {
      loadedScope.current = null;
      setNotifications([]);
      setError(null);
      setLoading(false);
      return;
    }

    const scope = `${user.id}:${organizationId ?? ''}`;
    try {
      const { data, error: fetchError } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .or(notificationOrgFilter(organizationId))
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;
      if (seq !== requestSeq.current) return;
      const fetched = (data || []) as Notification[];
      const sameScope = loadedScope.current === scope;
      loadedScope.current = scope;
      setNotifications(prev => (sameScope ? mergeFetched(prev, fetched) : fetched));
      setError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      // Panne : la liste précédente reste affichée, sauf si elle appartient à
      // un autre périmètre (autre organisation).
      console.warn('[useNotifications] Failed to fetch notifications:', err);
      if (loadedScope.current !== scope) setNotifications([]);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [isReady, orgLoading, user, organizationId]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  // Retour du réseau ou sur l'onglet : des événements ont pu être manqués.
  useEffect(() => {
    if (!isReady || !user) return;

    const reload = () => void fetchNotifications();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('online', reload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('online', reload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isReady, user, fetchNotifications]);

  // Realtime subscription for new notifications
  useEffect(() => {
    if (!isReady || !user) {
      setNotifications([]);
      return;
    }
    // Le filtre d'organisation des événements attend l'organisation active.
    if (orgLoading) return;

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
              if (!isInActiveOrg(newNotif, organizationId)) return;
              // Déjà présente si le rechargement l'a ramenée avant l'événement.
              setNotifications(prev => (
                prev.some(n => n.id === newNotif.id) ? prev : [newNotif, ...prev]
              ));
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
          .subscribe((status) => {
            // (Re)connexion du canal : recharger, des événements ont pu être manqués.
            if (status === 'SUBSCRIBED' && isMounted) void fetchNotifications();
          });
      } catch (error) {
        console.warn('[useNotifications] Failed to subscribe to notifications:', error);
      }
    };

    void setup();

    return () => {
      isMounted = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [isReady, user, orgLoading, organizationId, fetchNotifications]);

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
    // Les autres organisations de l'utilisateur ne sont pas touchées.
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .or(notificationOrgFilter(organizationId))
      .neq('type', 'new_message')
      .is('read_at', null);

    setNotifications(prev => prev.map(n => (
      n.type === 'new_message' ? n : { ...n, read_at: n.read_at || new Date().toISOString() }
    )));
  }, [user, organizationId]);

  return {
    notifications,
    unreadCount,
    actionUnreadCount,
    loading,
    error,
    markAsRead,
    markAllAsRead,
    refresh: fetchNotifications,
  };
};
