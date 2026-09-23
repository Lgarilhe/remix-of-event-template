/**
 * Notifications de la barre latérale (§4.1, §4.2, D24, D26, D41) : Réponses de
 * candidats et Pour vous, une requête par section, plus le marquage lu.
 *
 * Toujours montées (chiffre d'À traiter, A4) : appelées par AppSidebar (via
 * useTodoSignal), le panneau À traiter et le tableau de bord (D40), sous les
 * mêmes clés, donc sans requête en plus. Le temps réel (useSidebarRealtime)
 * invalide ces clés ; ce hook n'ouvre aucun canal.
 *
 * Activité vit à part (useSidebarActivity) : lue seulement section ouverte.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { isActionable, notificationOrgFilter, type Notification } from '@/lib/notificationKinds';
import { businessDaysCutoff } from '@/lib/businessDays';
import { groupReplies, type GroupedReplies } from '@/lib/sidebarSignals';
import { queryState, type SectionState } from '@/lib/sidebarSection';

/** Fenêtre de lecture des réponses de candidats (D26). */
const REPLIES_WINDOW_MS = 30 * 86_400_000;

/** Réponses comptées : 3 derniers jours ouvrés (D8, D27). */
const REPLIES_BUSINESS_DAYS = 3;

const MARK_ERROR = "Le marquage n'a pas été enregistré. Réessayez.";

export interface SidebarQuery<T> {
  data: T | undefined;
  status: SectionState;
  stale: boolean;
  retry: () => void;
}

export interface ForYouData {
  /** Non lues qui demandent une action : section Pour vous et chiffre. */
  actions: Notification[];
  /** Non lues d'information : affichées en tête d'Activité (section ouverte). */
  infos: Notification[];
}

export const sidebarRepliesKey = (userId: string | null, organizationId: string | null) =>
  ['sidebar', 'replies', userId, organizationId] as const;
export const sidebarForYouKey = (userId: string | null, organizationId: string | null) =>
  ['sidebar', 'for-you', userId, organizationId] as const;
export const sidebarActivityKey = (userId: string | null, organizationId: string | null) =>
  ['sidebar', 'activity', userId, organizationId] as const;

const COMMON_OPTIONS = { staleTime: 60_000, retry: 1, refetchInterval: 5 * 60_000 } as const;

export interface SidebarNotifications {
  replies: SidebarQuery<GroupedReplies>;
  forYou: SidebarQuery<ForYouData>;
  /** Marque lues ces notifications (clic sur une ligne). Ne rejette jamais. */
  markRead: (ids: string[]) => Promise<void>;
  /** « Tout marquer comme lu » de Pour vous (hors messages et panne LinkedIn). Ne rejette jamais. */
  markAllForYouRead: () => Promise<void>;
}

export function useSidebarNotifications(): SidebarNotifications {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { organizationId, isLoading: orgLoading } = useOrganization();
  const queryClient = useQueryClient();
  // Le filtre d'organisation attend l'organisation active.
  const enabled = !!userId && !orgLoading;

  const repliesQuery = useQuery({
    queryKey: sidebarRepliesKey(userId, organizationId),
    queryFn: async (): Promise<GroupedReplies> => {
      if (!userId) throw new Error('Utilisateur inconnu');
      const since = new Date(Date.now() - REPLIES_WINDOW_MS).toISOString();
      const { data, error } = await supabase
        .from('notifications')
        .select('id, title, link, created_at, read_at, metadata')
        .eq('user_id', userId)
        .or(notificationOrgFilter(organizationId))
        .eq('type', 'new_message')
        .is('read_at', null)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return groupReplies(data ?? [], businessDaysCutoff(new Date(), REPLIES_BUSINESS_DAYS));
    },
    enabled,
    ...COMMON_OPTIONS,
  });

  const forYouQuery = useQuery({
    queryKey: sidebarForYouKey(userId, organizationId),
    queryFn: async (): Promise<ForYouData> => {
      if (!userId) throw new Error('Utilisateur inconnu');
      // La panne LinkedIn a sa propre ligne (D41) : ses notifications sortent
      // de Pour vous et du chiffre, les 50 places servent aux autres.
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, link, created_at, read_at, metadata, organization_id')
        .eq('user_id', userId)
        .or(notificationOrgFilter(organizationId))
        .not('type', 'in', '(new_message,linkedin_disconnected)')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows: Notification[] = data ?? [];
      return {
        actions: rows.filter((n) => isActionable(n)),
        infos: rows.filter((n) => !isActionable(n)),
      };
    },
    enabled,
    ...COMMON_OPTIONS,
  });

  const { refetch: refetchReplies } = repliesQuery;
  const { refetch: refetchForYou } = forYouQuery;
  const retryReplies = useCallback(() => void refetchReplies(), [refetchReplies]);
  const retryForYou = useCallback(() => void refetchForYou(), [refetchForYou]);

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: sidebarRepliesKey(userId, organizationId) });
    void queryClient.invalidateQueries({ queryKey: sidebarForYouKey(userId, organizationId) });
    void queryClient.invalidateQueries({ queryKey: sidebarActivityKey(userId, organizationId) });
  }, [queryClient, userId, organizationId]);

  /**
   * Écriture optimiste : les lignes disparaissent de Réponses et de Pour vous
   * (Activité les grise), puis la base fait foi ; en échec, retour arrière.
   */
  const applyRead = useCallback(
    async (
      update: {
        replies: (old: GroupedReplies) => GroupedReplies;
        forYou: (old: ForYouData) => ForYouData;
        activity: (old: Notification[]) => Notification[];
      },
      write: () => PromiseLike<{ data: Array<{ id: string }> | null; error: unknown }>,
      expectRows: boolean,
    ) => {
      const keys = {
        replies: sidebarRepliesKey(userId, organizationId),
        forYou: sidebarForYouKey(userId, organizationId),
        activity: sidebarActivityKey(userId, organizationId),
      };
      try {
        await Promise.all([
          queryClient.cancelQueries({ queryKey: keys.replies }),
          queryClient.cancelQueries({ queryKey: keys.forYou }),
          queryClient.cancelQueries({ queryKey: keys.activity }),
        ]);
      } catch {
        // Annulation impossible : l'écriture optimiste reste valable.
      }
      const previous = {
        replies: queryClient.getQueryData<GroupedReplies>(keys.replies),
        forYou: queryClient.getQueryData<ForYouData>(keys.forYou),
        activity: queryClient.getQueryData<Notification[]>(keys.activity),
      };
      if (previous.replies) queryClient.setQueryData<GroupedReplies>(keys.replies, update.replies(previous.replies));
      if (previous.forYou) queryClient.setQueryData<ForYouData>(keys.forYou, update.forYou(previous.forYou));
      if (previous.activity) queryClient.setQueryData<Notification[]>(keys.activity, update.activity(previous.activity));

      let failed = false;
      try {
        const { data, error } = await write();
        if (error) throw error;
        if (expectRows && (!data || data.length === 0)) throw new Error('Aucune notification mise à jour');
      } catch (err) {
        failed = true;
        console.warn('[useSidebarNotifications] marquage lu en échec :', err);
      }
      if (failed) {
        if (previous.replies) queryClient.setQueryData(keys.replies, previous.replies);
        if (previous.forYou) queryClient.setQueryData(keys.forYou, previous.forYou);
        if (previous.activity) queryClient.setQueryData(keys.activity, previous.activity);
        toast.error(MARK_ERROR);
      }
      invalidateAll();
    },
    [queryClient, userId, organizationId, invalidateAll],
  );

  const markRead = useCallback(
    async (ids: string[]) => {
      if (!userId || ids.length === 0) return;
      const idSet = new Set(ids);
      const readAt = new Date().toISOString();
      await applyRead(
        {
          replies: (old) => ({
            ...old,
            candidates: old.candidates.filter((c) => !c.ids.some((id) => idSet.has(id))),
          }),
          forYou: (old) => ({
            actions: old.actions.filter((n) => !idSet.has(n.id)),
            infos: old.infos.filter((n) => !idSet.has(n.id)),
          }),
          activity: (old) => old.map((n) => (idSet.has(n.id) && !n.read_at ? { ...n, read_at: readAt } : n)),
        },
        () =>
          supabase
            .from('notifications')
            .update({ read_at: readAt })
            .in('id', ids)
            .eq('user_id', userId)
            .select('id'),
        true,
      );
    },
    [applyRead, userId],
  );

  const markAllForYouRead = useCallback(async () => {
    if (!userId) return;
    const readAt = new Date().toISOString();
    await applyRead(
      {
        replies: (old) => old,
        forYou: () => ({ actions: [], infos: [] }),
        activity: (old) =>
          old.map((n) =>
            !n.read_at && n.type !== 'new_message' && n.type !== 'linkedin_disconnected' ? { ...n, read_at: readAt } : n,
          ),
      },
      () =>
        supabase
          .from('notifications')
          .update({ read_at: readAt })
          .eq('user_id', userId)
          .not('type', 'in', '(new_message,linkedin_disconnected)')
          .is('read_at', null)
          .or(notificationOrgFilter(organizationId))
          .select('id'),
      false,
    );
  }, [applyRead, userId, organizationId]);

  const repliesState = queryState({
    data: repliesQuery.data,
    isError: repliesQuery.isError,
    fetchStatus: repliesQuery.fetchStatus,
  });
  const forYouState = queryState({
    data: forYouQuery.data,
    isError: forYouQuery.isError,
    fetchStatus: forYouQuery.fetchStatus,
  });

  return {
    replies: { data: repliesQuery.data, status: repliesState.state, stale: repliesState.stale, retry: retryReplies },
    forYou: { data: forYouQuery.data, status: forYouState.state, stale: forYouState.stale, retry: retryForYou },
    markRead,
    markAllForYouRead,
  };
}
