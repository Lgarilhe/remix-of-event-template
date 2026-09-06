/**
 * useAutoPrefetchAnalyses — Pré-charge en background les analyses IA
 * pour les chats récents qui n'ont pas encore de cache.
 *
 * Pourquoi : le webhook Unipile cache déjà les analyses pour CHAQUE
 * nouveau message reçu (via `auto-analyze-message`). MAIS les messages
 * antérieurs au déploiement du webhook OU les chats jamais ouverts par
 * l'user n'ont pas leur cache → quand on clique IA, on attend 2-3s.
 *
 * Solution : au mount de l'inbox, pré-charger en background les
 * analyses des N chats les plus récents qui n'ont pas de cache.
 *
 * Throttling :
 *  - Max 5 analyses concurrentes (limit Supabase + Anthropic API)
 *  - 1 nouveau lancé toutes les 800ms (smooth, pas de burst)
 *  - Skip si onglet pas visible (économie quota)
 *  - Skip si chat_analysis_cache déjà à jour (< 24h)
 */

import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { autoAnalyzeKey, hasAutoAnalyzed, runAutoAnalyzeOnce } from '@/lib/autoAnalyzeGuard';
import type { Chat } from './useMessagesInbox';

const MAX_CONCURRENT = 3;
const STAGGER_MS = 800;
const TOP_N_CHATS = 10;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface PrefetchOptions {
  /** Chats triés par récence (last_message.timestamp desc) */
  chats: Chat[];
  /** Active/désactive le prefetch */
  enabled?: boolean;
}

export function useAutoPrefetchAnalyses({ chats, enabled = true }: PrefetchOptions) {
  // Garde « une fois par chat et par session » persistée (sessionStorage) :
  // un useRef était remis à zéro à chaque remount de l'inbox.

  useEffect(() => {
    if (!enabled || chats.length === 0) return;

    let cancelled = false;
    let inFlight = 0;
    const queue: Chat[] = [];

    const launchAnalysis = async (chat: Chat) => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return; // Skip si onglet pas visible
      }
      // On délègue à `auto-analyze-message` qui :
      // - Fetch les messages réels depuis Unipile
      // - Lance analyze-response avec le contexte complet (incl. jobs)
      // - Cache le résultat dans message_analysis_cache
      // C'est exactement ce que fait le webhook Unipile à chaque nouveau
      // message, on déclenche le même flow ici en background pour les
      // chats antérieurs. Promesse partagée avec la sélection et la
      // ré-analyse « stale » (une seule analyse par chat et par session).
      const guardKey = autoAnalyzeKey(chat);
      const senderId = chat.attendees?.[0]?.id || null;
      const pending = runAutoAnalyzeOnce(guardKey, () => supabase.functions.invoke('auto-analyze-message', {
        body: { chat_id: chat.id, account_id: chat.account_id, sender_id: senderId },
      }));
      if (!pending) return;
      inFlight++;

      try {
        await pending;
      } catch (e) {
        // Silent fail — c'est juste un prefetch
        console.debug('[prefetch] analyse failed for chat', chat.id, e);
      } finally {
        inFlight--;
        // Drain queue
        if (queue.length > 0 && inFlight < MAX_CONCURRENT && !cancelled) {
          const next = queue.shift()!;
          setTimeout(() => launchAnalysis(next), STAGGER_MS);
        }
      }
    };

    const prefetchTopChats = async () => {
      // Top N chats les plus récents (les chats sont déjà triés par recency
      // dans useMessagesInbox)
      const candidates = chats.slice(0, TOP_N_CHATS);
      if (candidates.length === 0) return;

      // Vérifie quelle est l'org_id (account_id) — toutes les chats de cet user
      const accountId = candidates[0]?.account_id;
      if (!accountId) return;

      // Récupère les caches déjà existants pour ces chats (1 seule query batch)
      const chatIds = candidates.map(c => c.id);
      const { data: existing } = await supabase
        .from('message_analysis_cache')
        .select('chat_id, updated_at')
        .eq('account_id', accountId)
        .in('chat_id', chatIds);

      const cachedMap = new Map(
        (existing || []).map((row) => [row.chat_id, new Date(row.updated_at).getTime()])
      );
      const now = Date.now();

      // Filtre : chats sans cache OU avec cache expiré (>24h)
      const toAnalyze = candidates.filter(chat => {
        if (hasAutoAnalyzed(autoAnalyzeKey(chat))) return false;
        // Dernier message envoyé par nous : rien de nouveau à analyser côté candidat
        if (chat.last_message?.is_sender === true) return false;
        const cachedAt = cachedMap.get(chat.id);
        if (!cachedAt) return true; // pas de cache
        return (now - cachedAt) > CACHE_TTL_MS; // cache expiré
      });

      if (toAnalyze.length === 0) {
        return; // tout est déjà en cache
      }

      // Launch initial batch (jusqu'à MAX_CONCURRENT)
      const initialBatch = toAnalyze.slice(0, MAX_CONCURRENT);
      const remaining = toAnalyze.slice(MAX_CONCURRENT);
      queue.push(...remaining);

      initialBatch.forEach((chat, i) => {
        // Stagger les premiers lancements
        setTimeout(() => launchAnalysis(chat), i * STAGGER_MS);
      });
    };

    // Délai initial pour ne pas bloquer le mount initial
    const initialDelay = setTimeout(prefetchTopChats, 1500);

    return () => {
      cancelled = true;
      clearTimeout(initialDelay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chats.length, enabled]);
}
