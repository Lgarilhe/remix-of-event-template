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
 * les notifications reçues en temps réel depuis son départ (`arrived`) et les
 * marquages lus encore en cours d'écriture (`pendingReads`). Un marquage déjà
 * terminé, réussi ou non, laisse la base faire foi.
 */
function mergeFetched(
  prev: Notification[],
  fetched: Notification[],
  arrived: ReadonlySet<string>,
  pendingReads: ReadonlySet<string>,
): Notification[] {
  const fetchedIds = new Set(fetched.map(n => n.id));
  const kept = prev.filter(n => arrived.has(n.id) && !fetchedIds.has(n.id));
  const merged = fetched.map((n) => {
    if (n.read_at || !pendingReads.has(n.id)) return n;
    const local = prev.find(p => p.id === n.id);
    return local?.read_at ? { ...n, read_at: local.read_at } : n;
  });
  return [...kept, ...merged].slice(0, 50);
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
  // Identifiant seulement : l'objet user change à chaque relecture de session
  // (retour sur l'onglet) sans que l'utilisateur change.
  const userId = user?.id ?? null;
  const { organizationId, isLoading: orgLoading } = useOrganization();
  // Chaque chargement invalide ceux encore en vol : la réponse la plus récente gagne.
  const requestSeq = useRef(0);
  // Périmètre (utilisateur + organisation) de la liste affichée.
  const loadedScope = useRef<string | null>(null);
  // Reçues en temps réel depuis le départ du dernier chargement.
  const arrivedIds = useRef<Set<string>>(new Set());
  // Marquages lus dont l'écriture n'a pas encore répondu.
  const pendingReads = useRef<Set<string>>(new Set());
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;

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

    if (!userId) {
      loadedScope.current = null;
      setNotifications([]);
      setError(null);
      setLoading(false);
      return;
    }

    const scope = `${userId}:${organizationId ?? ''}`;
    arrivedIds.current = new Set();
    try {
      const { data, error: fetchError } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .or(notificationOrgFilter(organizationId))
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;
      if (seq !== requestSeq.current) return;
      const fetched = (data || []) as Notification[];
      const sameScope = loadedScope.current === scope;
      loadedScope.current = scope;
      const arrived = arrivedIds.current;
      setNotifications(prev => (sameScope ? mergeFetched(prev, fetched, arrived, pendingReads.current) : fetched));
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
  }, [isReady, orgLoading, userId, organizationId]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  // Retour du réseau ou sur l'onglet : des événements ont pu être manqués.
  useEffect(() => {
    if (!isReady || !userId) return;

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
  }, [isReady, userId, fetchNotifications]);

  // Realtime subscription for new notifications
  useEffect(() => {
    if (!isReady || !userId) {
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
              filter: `user_id=eq.${userId}`,
            },
            (payload) => {
              if (!isMounted) return;
              const newNotif = payload.new as Notification;
              if (!isInActiveOrg(newNotif, organizationId)) return;
              arrivedIds.current.add(newNotif.id);
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
              filter: `user_id=eq.${userId}`,
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
  }, [isReady, userId, orgLoading, organizationId, fetchNotifications]);

  // Marquage local immédiat ; si l'écriture échoue, la notification redevient
  // non lue plutôt que de rester lue à tort jusqu'au rechargement complet.
  const applyRead = useCallback(async (ids: string[], write: () => PromiseLike<{ error: unknown }>) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const now = new Date().toISOString();
    ids.forEach(id => pendingReads.current.add(id));
    setNotifications(prev => prev.map(n => (idSet.has(n.id) && !n.read_at ? { ...n, read_at: now } : n)));
    try {
      const { error: writeError } = await write();
      if (writeError) throw writeError;
    } catch (err) {
      console.warn('[useNotifications] Failed to mark notifications read:', err);
      setNotifications(prev => prev.map(n => (idSet.has(n.id) && n.read_at === now ? { ...n, read_at: null } : n)));
    } finally {
      ids.forEach(id => pendingReads.current.delete(id));
    }
  }, []);

  const markAsRead = useCallback(async (notificationId: string) => {
    await applyRead([notificationId], () => supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId));
  }, [applyRead]);

  const markAllAsRead = useCallback(async () => {
    if (!userId) return;

    // Les messages LinkedIn restent gérés par la messagerie (pastille « Messages »).
    // Les autres organisations de l'utilisateur ne sont pas touchées.
    const ids = notificationsRef.current
      .filter(n => !n.read_at && n.type !== 'new_message')
      .map(n => n.id);
    await applyRead(ids, () => supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .or(notificationOrgFilter(organizationId))
      .neq('type', 'new_message')
      .is('read_at', null));
  }, [userId, organizationId, applyRead]);

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
