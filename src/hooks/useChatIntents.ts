/**
 * useChatIntents — Charge les intents IA cachés pour les chats de la sidebar
 * + détecte le cache stale et déclenche une re-analyse en background.
 *
 * Source : table `message_analysis_cache` (alimentée par auto-analyze-message,
 * lui-même déclenché par le webhook Unipile à chaque nouveau message OU par
 * notre prefetch frontend).
 *
 * Détection stale : si `chat.last_message.timestamp > cache.updated_at`,
 * c'est qu'un nouveau message est arrivé après l'analyse → on re-analyze
 * en background (silencieux, max 3 en parallèle).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from './useAuthReady';
import type { Chat } from './useMessagesInbox';

export type ChatIntent =
  | 'interested'
  | 'not_interested'
  | 'needs_info'
  | 'wants_call'
  | 'timing_issue'
  | 'already_placed'
  | 'neutral';

export interface IntentInfo {
  intent: ChatIntent;
  confidence: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  engagement: 'high' | 'medium' | 'low';
  summary?: string;
  /** Timestamp de la dernière analyse (utile pour détecter staleness) */
  analyzedAt?: string;
  /** True si le cache est plus vieux que le dernier message */
  isStale?: boolean;
}

export interface ChatIntentMetadata {
  emoji: string;
  label: string;
  color: string;
}

export const INTENT_META: Record<ChatIntent, ChatIntentMetadata> = {
  interested: {
    emoji: '🟢',
    label: 'Intéressé',
    color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  not_interested: {
    emoji: '🔴',
    label: 'Décline',
    color: 'bg-red-500/10 text-red-700 dark:text-red-400',
  },
  needs_info: {
    emoji: '💬',
    label: 'Demande info',
    color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  },
  wants_call: {
    emoji: '📞',
    label: 'Veut appel',
    color: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  },
  timing_issue: {
    emoji: '⏰',
    label: 'Timing pas bon',
    color: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  already_placed: {
    emoji: '🚫',
    label: 'Déjà placé',
    color: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  },
  neutral: {
    emoji: '⚪',
    label: 'Neutre',
    color: 'bg-muted/40 text-muted-foreground',
  },
};

export function useChatIntents(chats: Chat[], accountId: string | null) {
  const { isReady, user } = useAuthReady();
  const queryClient = useQueryClient();
  const chatIds = chats.map(c => c.id);
  const enabled = isReady && !!user && !!accountId && chatIds.length > 0;

  const query = useQuery({
    queryKey: ['chat-intents', accountId, chatIds.sort().join(',')],
    queryFn: async (): Promise<Map<string, IntentInfo>> => {
      if (!accountId || chatIds.length === 0) return new Map();

      const { data, error } = await supabase
        .from('message_analysis_cache')
        .select('chat_id, analysis, updated_at')
        .eq('account_id', accountId)
        .in('chat_id', chatIds);

      if (error) {
        console.error('[useChatIntents] fetch error:', error);
        return new Map();
      }

      const map = new Map<string, IntentInfo>();

      // Index chats by id pour comparer last_message.timestamp avec cache.updated_at
      const chatById = new Map(chats.map(c => [c.id, c]));

      for (const row of data || []) {
        const a = row.analysis as Record<string, unknown> | null;
        if (!a || typeof a !== 'object') continue;

        const intent = a.intent as ChatIntent | undefined;
        if (!intent || !(intent in INTENT_META)) continue;

        // Détecte si le cache est stale (dernier message plus récent que l'analyse)
        const chat = chatById.get(row.chat_id);
        const lastMsgTs = chat?.last_message?.timestamp;
        const cacheTs = row.updated_at;
        let isStale = false;
        if (lastMsgTs && cacheTs) {
          try {
            isStale = new Date(lastMsgTs).getTime() > new Date(cacheTs).getTime();
          } catch { /* ignore */ }
        }

        map.set(row.chat_id, {
          intent,
          confidence: typeof a.intentConfidence === 'number' ? a.intentConfidence : 0,
          sentiment: (a.sentiment as IntentInfo['sentiment']) || 'neutral',
          engagement: (a.engagement as IntentInfo['engagement']) || 'medium',
          summary: typeof a.summary === 'string' ? a.summary : undefined,
          analyzedAt: cacheTs,
          isStale,
        });
      }
      return map;
    },
    enabled,
    staleTime: 30 * 1000, // 30s — re-fetch fréquent pour voir les nouvelles analyses
  });

  // ─── Background re-analyze des chats stale ─────────────────────────
  // Quand un chat a un last_message plus récent que son analyse cached,
  // on déclenche auto-analyze-message en background (max 2 concurrent,
  // 1.5s entre chaque pour ne pas hammer Anthropic).
  const reanalyzedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!query.data || !accountId) return;

    const staleChats: Chat[] = [];
    for (const chat of chats) {
      const intent = query.data.get(chat.id);
      // Cas 1 : analyse existante mais stale
      if (intent?.isStale && !reanalyzedRef.current.has(chat.id)) {
        staleChats.push(chat);
      }
    }

    if (staleChats.length === 0) return;

    let cancelled = false;
    const launchReanalyze = async (chat: Chat, delayMs: number) => {
      await new Promise(r => setTimeout(r, delayMs));
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      reanalyzedRef.current.add(chat.id);
      try {
        const senderId = chat.attendees?.[0]?.id || null;
        await supabase.functions.invoke('auto-analyze-message', {
          body: {
            chat_id: chat.id,
            account_id: chat.account_id,
            sender_id: senderId,
          },
        });
        // Invalide la query pour forcer re-fetch des intents
        if (!cancelled) {
          queryClient.invalidateQueries({ queryKey: ['chat-intents', accountId] });
        }
      } catch (e) {
        console.debug('[useChatIntents] reanalyze failed for chat', chat.id, e);
      }
    };

    // Lance jusqu'à 2 reanalyze en parallèle, staggered
    staleChats.slice(0, 5).forEach((chat, i) => {
      launchReanalyze(chat, i * 1500);
    });

    return () => {
      cancelled = true;
    };
  }, [query.data, chats, accountId, queryClient]);

  return query;
}
