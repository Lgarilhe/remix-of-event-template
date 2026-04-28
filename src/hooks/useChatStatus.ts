/**
 * useChatStatus — Hook pour snooze + archive d'une conversation Inbox.
 *
 * Utilise la table chat_categories (étendue par migration 20260428140000)
 * avec les colonnes snoozed_until + archived_at. On partage la table avec
 * useChatCategories (sentiment) plutôt que créer une nouvelle table → un
 * seul SELECT pour récupérer toutes les métadonnées d'un chat.
 *
 * UPSERT pattern : on n'écrit QUE les colonnes snoozed_until/archived_at,
 * la colonne `category` reste intacte si déjà set (Supabase ON CONFLICT
 * UPDATE n'affecte que les colonnes passées dans le INSERT).
 *
 * Filtrage côté frontend :
 *   - 'active' (default) : pas snoozée OR snooze expirée, pas archivée
 *   - 'snoozed' : snoozed_until > now()
 *   - 'archived' : archived_at IS NOT NULL
 *   - 'all' : tout
 */

import { useState, useCallback, useEffect } from 'react';
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
  const [statusMap, setStatusMap] = useState<Map<string, ChatStatusInfo>>(new Map());
  const [statusFilter, setStatusFilter] = useState<ChatStatusFilter>('active');
  const [loading, setLoading] = useState(false);
  const { organizationId } = useOrganization();
  const { isReady, user } = useAuthReady();

  const fetchStatus = useCallback(async () => {
    if (!isReady || !user) {
      setStatusMap(new Map());
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('chat_categories')
        .select('chat_id, snoozed_until, archived_at')
        .eq('created_by', user.id);

      if (error) throw error;

      const map = new Map<string, ChatStatusInfo>();
      for (const row of (data || [])) {
        // Ne garder que les rows qui ont au moins un statut défini
        const r = row as { chat_id: string; snoozed_until: string | null; archived_at: string | null };
        if (r.snoozed_until || r.archived_at) {
          map.set(r.chat_id, {
            snoozedUntil: r.snoozed_until,
            archivedAt: r.archived_at,
          });
        }
      }
      setStatusMap(map);
    } catch (error) {
      console.error('[useChatStatus] fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [isReady, user]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  /** Met une conversation en sommeil jusqu'à une date donnée */
  const snoozeChat = useCallback(async (chatId: string, accountId: string, until: Date) => {
    if (!user) return;

    try {
      const isoUntil = until.toISOString();
      const { error } = await supabase
        .from('chat_categories')
        .upsert({
          chat_id: chatId,
          account_id: accountId,
          created_by: user.id,
          organization_id: organizationId,
          snoozed_until: isoUntil,
          archived_at: null, // unarchive si snooze
          updated_at: new Date().toISOString(),
        }, { onConflict: 'chat_id,created_by' });

      if (error) throw error;

      setStatusMap(prev => {
        const next = new Map(prev);
        next.set(chatId, { snoozedUntil: isoUntil, archivedAt: null });
        return next;
      });

      const formatted = until.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      toast.success(`Conversation en sommeil jusqu'au ${formatted}`);
    } catch (e: any) {
      console.error('[useChatStatus] snooze error:', e);
      toast.error('Impossible de mettre en sommeil', { description: e?.message });
    }
  }, [user, organizationId]);

  /** Archive une conversation (masquée du filter par défaut) */
  const archiveChat = useCallback(async (chatId: string, accountId: string) => {
    if (!user) return;

    try {
      const isoNow = new Date().toISOString();
      const { error } = await supabase
        .from('chat_categories')
        .upsert({
          chat_id: chatId,
          account_id: accountId,
          created_by: user.id,
          organization_id: organizationId,
          archived_at: isoNow,
          snoozed_until: null, // un-snooze si archivée
          updated_at: isoNow,
        }, { onConflict: 'chat_id,created_by' });

      if (error) throw error;

      setStatusMap(prev => {
        const next = new Map(prev);
        next.set(chatId, { snoozedUntil: null, archivedAt: isoNow });
        return next;
      });

      toast.success('Conversation archivée');
    } catch (e: any) {
      console.error('[useChatStatus] archive error:', e);
      toast.error('Impossible d\'archiver', { description: e?.message });
    }
  }, [user, organizationId]);

  /** Restaure une conversation (annule snooze + archive) */
  const restoreChat = useCallback(async (chatId: string, accountId: string) => {
    if (!user) return;

    try {
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

      setStatusMap(prev => {
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      });

      toast.success('Conversation restaurée');
    } catch (e: any) {
      console.error('[useChatStatus] restore error:', e);
      toast.error('Impossible de restaurer', { description: e?.message });
    }
  }, [user, organizationId]);

  /** Helpers de lecture */
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

  /** Compte par statut sur une liste de chat IDs */
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
    getStatusCounts,
    refetch: fetchStatus,
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
