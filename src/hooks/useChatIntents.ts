/**
 * useChatIntents — Charge les intents/analyses cachées pour les chats
 * affichés dans la sidebar. Permet d'afficher un badge couleur sur
 * chaque chat ("🟢 Intéressé", "🔴 Décline", "💬 Demande info"...).
 *
 * Source : table `message_analysis_cache` (déjà alimentée par
 * `analyze-response` quand l'user ouvre le panel IA).
 *
 * Performance :
 *  - 1 seule query batch pour tous les chats visibles
 *  - Cache React Query 5min (staleTime)
 *  - Re-fetch quand chats change OU quand on revient sur la page
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from './useAuthReady';

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
  confidence: number; // 0-100
  sentiment: 'positive' | 'neutral' | 'negative';
  engagement: 'high' | 'medium' | 'low';
  summary?: string;
}

export interface ChatIntentMetadata {
  emoji: string;
  label: string;
  /** Tailwind classes pour le badge */
  color: string;
}

/** Mapping intent → metadata UI */
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

export function useChatIntents(chatIds: string[], accountId: string | null) {
  const { isReady, user } = useAuthReady();
  const enabled = isReady && !!user && !!accountId && chatIds.length > 0;

  return useQuery({
    queryKey: ['chat-intents', accountId, chatIds.sort().join(',')],
    queryFn: async (): Promise<Map<string, IntentInfo>> => {
      if (!accountId || chatIds.length === 0) return new Map();

      // Query batch de tous les analyses pour les chats visibles
      const { data, error } = await supabase
        .from('message_analysis_cache')
        .select('chat_id, analysis')
        .eq('account_id', accountId)
        .in('chat_id', chatIds);

      if (error) {
        console.error('[useChatIntents] fetch error:', error);
        return new Map();
      }

      const map = new Map<string, IntentInfo>();
      for (const row of data || []) {
        const a = row.analysis as Record<string, unknown> | null;
        if (!a || typeof a !== 'object') continue;

        const intent = a.intent as ChatIntent | undefined;
        if (!intent || !(intent in INTENT_META)) continue;

        map.set(row.chat_id, {
          intent,
          confidence: typeof a.intentConfidence === 'number' ? a.intentConfidence : 0,
          sentiment: (a.sentiment as IntentInfo['sentiment']) || 'neutral',
          engagement: (a.engagement as IntentInfo['engagement']) || 'medium',
          summary: typeof a.summary === 'string' ? a.summary : undefined,
        });
      }
      return map;
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5min
  });
}
