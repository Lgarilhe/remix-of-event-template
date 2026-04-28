/**
 * useChatDraft — Sauvegarde automatique du brouillon de message par chat_id.
 *
 * Pourquoi : l'inbox ne doit JAMAIS perdre un message en cours de rédaction
 * (frustration #1 inbox modernes). Si l'user navigue ailleurs, ferme l'app,
 * ou tab switch, le draft est restauré au retour.
 *
 * Stockage : localStorage par chat_id (key: konekt_chat_draft_{chat_id})
 * - TTL implicite : pas d'expiration auto (l'user peut revenir 2 jours après)
 * - Cleanup : automatique quand le message est envoyé (clearDraft())
 *
 * Usage :
 *   const { draft, setDraft, clearDraft } = useChatDraft(chatId);
 *   <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
 *
 * Anti-pollution : si > 100 drafts en localStorage, on purge le plus vieux
 * (basé sur lastTouched timestamp).
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const DRAFT_PREFIX = 'konekt_chat_draft_';
const DRAFT_INDEX_KEY = 'konekt_chat_draft_index'; // { [chatId]: timestamp }
const MAX_DRAFTS = 100;
const SAVE_DEBOUNCE_MS = 500;

interface DraftIndex {
  [chatId: string]: number; // timestamp last touched
}

function loadIndex(): DraftIndex {
  try {
    const raw = localStorage.getItem(DRAFT_INDEX_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as DraftIndex;
  } catch {
    return {};
  }
}

function saveIndex(idx: DraftIndex): void {
  try {
    localStorage.setItem(DRAFT_INDEX_KEY, JSON.stringify(idx));
  } catch {
    // localStorage full ou private mode
  }
}

/** Purge les drafts les plus vieux si on dépasse MAX_DRAFTS */
function purgeOldDrafts(idx: DraftIndex): DraftIndex {
  const entries = Object.entries(idx);
  if (entries.length <= MAX_DRAFTS) return idx;

  // Sort par timestamp ASC, supprimer les plus vieux
  entries.sort((a, b) => a[1] - b[1]);
  const toDelete = entries.slice(0, entries.length - MAX_DRAFTS);
  const newIdx = { ...idx };
  for (const [chatId] of toDelete) {
    try {
      localStorage.removeItem(`${DRAFT_PREFIX}${chatId}`);
    } catch { /* noop */ }
    delete newIdx[chatId];
  }
  return newIdx;
}

export function useChatDraft(chatId: string | null | undefined) {
  const [draft, setDraftState] = useState<string>('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load draft when chatId changes
  useEffect(() => {
    if (!chatId) {
      setDraftState('');
      return;
    }
    try {
      const stored = localStorage.getItem(`${DRAFT_PREFIX}${chatId}`);
      setDraftState(stored || '');
    } catch {
      setDraftState('');
    }
  }, [chatId]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  /** Set the draft + debounced save to localStorage */
  const setDraft = useCallback((value: string) => {
    setDraftState(value);
    if (!chatId) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      try {
        if (value.trim()) {
          localStorage.setItem(`${DRAFT_PREFIX}${chatId}`, value);
          // Update index
          const idx = loadIndex();
          idx[chatId] = Date.now();
          saveIndex(purgeOldDrafts(idx));
        } else {
          // Empty draft → cleanup
          localStorage.removeItem(`${DRAFT_PREFIX}${chatId}`);
          const idx = loadIndex();
          delete idx[chatId];
          saveIndex(idx);
        }
      } catch {
        // localStorage full ou private mode
      }
    }, SAVE_DEBOUNCE_MS);
  }, [chatId]);

  /** Clear le draft (à appeler après envoi message réussi) */
  const clearDraft = useCallback(() => {
    if (!chatId) return;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    setDraftState('');
    try {
      localStorage.removeItem(`${DRAFT_PREFIX}${chatId}`);
      const idx = loadIndex();
      delete idx[chatId];
      saveIndex(idx);
    } catch { /* noop */ }
  }, [chatId]);

  return {
    draft,
    setDraft,
    clearDraft,
    /** True si l'user a un draft non vide pour ce chat */
    hasDraft: draft.trim().length > 0,
  };
}
