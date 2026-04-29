/**
 * useChatStatus — Hook pour snooze + archive d'une conversation Inbox.
 *
 * Refactor 2026-04-29 : utilise React Query pour avoir un cache PARTAGÉ
 * entre toutes les instances du hook (sidebar + MessageView). Quand
 * l'user snooze depuis le header chat, la sidebar se met à jour
 * instantanément via cache invalidation.
 *
 * Source : table chat_categories (étendue par migration 20260428140000)
 * avec colonnes snoozed_until + archived_at. La colonne `category` est
 * nullable (cf 20260429100000) — une row peut servir uniquement pour
 * snooze/archive sans avoir de catégorie.
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { toast } from 'sonner';

export type ChatStatusFilter = 'active' | 'snoozed' | 'archived' | 'all';

export interface ChatStatusInfo {
  snoozedUntil: string | null;
  archivedAt: string | null;
}

/** Calcule le statut effectif d'un chat à un instant T */
export function getEffectiveStatus(info: ChatStatusInfo | undefined, now = Date.now()): 'active' | 'snoozed' | 'archived' {
  if (!info) return 'active';
  if (info.archivedAt) return 'archived';
  if (info.snoozedUntil) {
    const until = new Date(info.snoozedUntil).getTime();
    if (until > now) return 'snoozed';
  }
  return 'active';
}

export function useChatStatus() {
  const [statusFilter, setStatusFilter] = useState<ChatStatusFilter>('active');
  const { organizationId } = useOrganization();
  const { isReady, user } = useAuthReady();
  const queryClient = useQueryClient();

  const queryKey = ['chat-status', user?.id];

  const { data: statusMap = new Map<string, ChatStatusInfo>(), isLoading: loading } = useQuery({
    queryKey,
    queryFn: async (): Promise<Map<string, ChatStatusInfo>> => {
      if (!isReady || !user) return new Map();
      const { data, error } = await supabase
        .from('chat_categories')
        .select('chat_id, snoozed_until, archived_at')
        .eq('created_by', user.id);
      if (error) {
        console.error('[useChatStatus] fetch error:', error);
        return new Map();
      }
      const map = new Map<string, ChatStatusInfo>();
      for (const row of data || []) {
        const r = row as { chat_id: string; snoozed_until: string | null; archived_at: string | null };
        if (r.snoozed_until || r.archived_at) {
          map.set(r.chat_id, {
            snoozedUntil: r.snoozed_until,
            archivedAt: r.archived_at,
          });
        }
      }
      return map;
    },
    enabled: isReady && !!user,
    staleTime: 60 * 1000,
  });

  // ─── Mutation helpers (optimistic updates pour UI instantané) ──────

  const optimisticUpdate = useCallback(
    (chatId: string, info: ChatStatusInfo | null) => {
      queryClient.setQueryData<Map<string, ChatStatusInfo>>(queryKey, (prev) => {
        const next = new Map(prev || new Map());
        if (info) next.set(chatId, info);
        else next.delete(chatId);
        return next;
      });
    },
    [queryClient, queryKey]
  );

  const snoozeMutation = useMutation({
    mutationFn: async ({ chatId, accountId, until }: { chatId: string; accountId: string; until: Date }) => {
      if (!user) throw new Error('Utilisateur non authentifié');
      if (!organizationId) throw new Error('Organisation non chargée');
      const isoUntil = until.toISOString();
      const { error } = await supabase
        .from('chat_categories')
        .upsert({
          chat_id: chatId,
          account_id: accountId,
          created_by: user.id,
          organization_id: organizationId,
          snoozed_until: isoUntil,
          archived_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'chat_id,created_by' });
      if (error) throw error;
      return { chatId, isoUntil, until };
    },
    onMutate: async ({ chatId, until }) => {
      // Optimistic update : update UI immédiatement
      optimisticUpdate(chatId, { snoozedUntil: until.toISOString(), archivedAt: null });
    },
    onSuccess: ({ until }) => {
      const formatted = until.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      toast.success(`En sommeil jusqu'au ${formatted}`);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: Error, vars) => {
      // Revert optimistic update
      queryClient.invalidateQueries({ queryKey });
      toast.error('Impossible de mettre en sommeil', { description: err.message });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ chatId, accountId }: { chatId: string; accountId: string }) => {
      if (!user) throw new Error('Utilisateur non authentifié');
      if (!organizationId) throw new Error('Organisation non chargée');
      const isoNow = new Date().toISOString();
      const { error } = await supabase
        .from('chat_categories')
        .upsert({
          chat_id: chatId,
          account_id: accountId,
          created_by: user.id,
          organization_id: organizationId,
          archived_at: isoNow,
          snoozed_until: null,
          updated_at: isoNow,
        }, { onConflict: 'chat_id,created_by' });
      if (error) throw error;
      return { chatId, isoNow };
    },
    onMutate: async ({ chatId }) => {
      optimisticUpdate(chatId, { snoozedUntil: null, archivedAt: new Date().toISOString() });
    },
    onSuccess: () => {
      toast.success('Conversation archivée');
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey });
      toast.error('Impossible d\'archiver', { description: err.message });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async ({ chatId, accountId }: { chatId: string; accountId: string }) => {
      if (!user) throw new Error('Utilisateur non authentifié');
      if (!organizationId) throw new Error('Organisation non chargée');
      const { error } = await supabase
        .from('chat_categories')
        .upsert({
          chat_id: chatId,
          account_id: accountId,
          created_by: user.id,
          organization_id: organizationId,
          snoozed_until: null,
          archived_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'chat_id,created_by' });
      if (error) throw error;
      return { chatId };
    },
    onMutate: async ({ chatId }) => {
      optimisticUpdate(chatId, null);
    },
    onSuccess: () => {
      toast.success('Conversation restaurée');
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey });
      toast.error('Impossible de restaurer', { description: err.message });
    },
  });

  // ─── Public API (signature compatible avec ancienne version) ──────

  const snoozeChat = useCallback(
    (chatId: string, accountId: string, until: Date) => {
      snoozeMutation.mutate({ chatId, accountId, until });
    },
    [snoozeMutation]
  );

  const archiveChat = useCallback(
    (chatId: string, accountId: string) => {
      archiveMutation.mutate({ chatId, accountId });
    },
    [archiveMutation]
  );

  const restoreChat = useCallback(
    (chatId: string, accountId: string) => {
      restoreMutation.mutate({ chatId, accountId });
    },
    [restoreMutation]
  );

  // ─── Helpers de lecture ──

  const isSnoozed = useCallback((chatId: string): boolean => {
    return getEffectiveStatus(statusMap.get(chatId)) === 'snoozed';
  }, [statusMap]);

  const isArchived = useCallback((chatId: string): boolean => {
    return getEffectiveStatus(statusMap.get(chatId)) === 'archived';
  }, [statusMap]);

  const getSnoozedUntil = useCallback((chatId: string): Date | null => {
    const info = statusMap.get(chatId);
    if (!info?.snoozedUntil) return null;
    const d = new Date(info.snoozedUntil);
    return d.getTime() > Date.now() ? d : null;
  }, [statusMap]);

  const getArchivedAt = useCallback((chatId: string): Date | null => {
    const info = statusMap.get(chatId);
    if (!info?.archivedAt) return null;
    return new Date(info.archivedAt);
  }, [statusMap]);

  const getStatusCounts = useCallback((chatIds: string[]) => {
    const counts = { active: 0, snoozed: 0, archived: 0 };
    const now = Date.now();
    for (const id of chatIds) {
      const status = getEffectiveStatus(statusMap.get(id), now);
      counts[status]++;
    }
    return counts;
  }, [statusMap]);

  return {
    statusMap,
    statusFilter,
    setStatusFilter,
    loading,
    snoozeChat,
    archiveChat,
    restoreChat,
    isSnoozed,
    isArchived,
    getSnoozedUntil,
    getArchivedAt,
    getStatusCounts,
    refetch: () => queryClient.invalidateQueries({ queryKey }),
  };
}

/** Snooze presets pour UX rapide */
export const SNOOZE_PRESETS: Array<{ label: string; getDate: () => Date }> = [
  {
    label: 'Plus tard aujourd\'hui (3h)',
    getDate: () => new Date(Date.now() + 3 * 60 * 60 * 1000),
  },
  {
    label: 'Demain matin (9h)',
    getDate: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  {
    label: 'Cette semaine (vendredi 9h)',
    getDate: () => {
      const d = new Date();
      const dayOfWeek = d.getDay();
      const daysUntilFriday = (5 - dayOfWeek + 7) % 7 || 7;
      d.setDate(d.getDate() + daysUntilFriday);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  {
    label: 'Semaine prochaine (lundi 9h)',
    getDate: () => {
      const d = new Date();
      const dayOfWeek = d.getDay();
      const daysUntilMonday = (1 - dayOfWeek + 7) % 7 || 7;
      d.setDate(d.getDate() + daysUntilMonday);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  {
    label: 'Dans 1 mois',
    getDate: () => {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      return d;
    },
  },
];
