/**
 * useChatSuggestedAction — action la plus prioritaire que l'analyse IA a déjà
 * mise en cache pour une conversation (message_analysis_cache.analysis,
 * suggestedActions). Lecture seule : aucune analyse n'est lancée ici, donc
 * aucun crédit n'est débité. Les analyses viennent du webhook, du préchargement
 * de la liste et du bouton « Suggestions » (analyze-response).
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { pickSuggestedAction, type SuggestedAction } from '@/lib/inboxThreadState';
import { useAuthReady } from './useAuthReady';
import type { Chat } from './useMessagesInbox';

export interface CachedSuggestion {
  action: SuggestedAction | null;
  /** Date de l'analyse : une analyse plus ancienne que le dernier message du candidat est périmée. */
  analyzedAt: string | null;
}

export function useChatSuggestedAction(chat: Chat | null, enabled: boolean) {
  const { isReady, user } = useAuthReady();
  const chatId = chat?.id ?? null;
  const accountId = chat?.account_id || null;

  return useQuery({
    // Préfixe ['chat-intents', accountId] : les analyses relancées par la liste invalident aussi cette lecture.
    queryKey: ['chat-intents', accountId, 'suggested-action', chatId],
    enabled: enabled && isReady && !!user && !!chatId && !!accountId,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<CachedSuggestion> => {
      const { data, error } = await supabase
        .from('message_analysis_cache')
        .select('analysis, updated_at')
        .eq('account_id', accountId as string)
        .eq('chat_id', chatId as string)
        .maybeSingle();
      if (error || !data) {
        if (error) console.error('[useChatSuggestedAction] fetch error:', error);
        return { action: null, analyzedAt: null };
      }
      return { action: pickSuggestedAction(data.analysis), analyzedAt: data.updated_at ?? null };
    },
  });
}
