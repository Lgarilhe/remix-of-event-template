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

/**
 * Lecture synchrone du brouillon stocké pour un chat, hors cycle React.
 * Sert au changement de conversation : la valeur `draft` du rendu courant
 * est encore celle du chat précédent au moment où l'effet de restauration
 * s'exécute.
 */
export function readChatDraft(chatId: string | null | undefined): string {
  if (!chatId) return '';
  try {
    return localStorage.getItem(`${DRAFT_PREFIX}${chatId}`) || '';
  } catch {
    return '';
  }
}

/**
 * Écriture synchrone du brouillon, hors cycle React.
 * Une valeur vide efface le brouillon stocké : effacer son texte doit se
 * conserver comme n'importe quelle autre modification.
 */
function persistChatDraft(chatId: string, value: string): void {
  try {
    if (value.trim()) {
      localStorage.setItem(`${DRAFT_PREFIX}${chatId}`, value);
      const idx = loadIndex();
      idx[chatId] = Date.now();
      saveIndex(purgeOldDrafts(idx));
    } else {
      localStorage.removeItem(`${DRAFT_PREFIX}${chatId}`);
      const idx = loadIndex();
      delete idx[chatId];
      saveIndex(idx);
    }
  } catch {
    // localStorage plein ou navigation privée
  }
}

export function useChatDraft(chatId: string | null | undefined) {
  const [draft, setDraftState] = useState<string>('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dernière valeur saisie mais pas encore écrite. Sans elle, une sortie avant
  // la fin du délai perdait la dernière frappe : le minuteur était annulé, mais
  // rien n'était enregistré (audit UX du 09/09/2026, constat UX04).
  const pendingRef = useRef<{ chatId: string; value: string } | null>(null);

  /** Écrit tout de suite ce qui attendait, et annule le minuteur. */
  const flush = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) persistChatDraft(pending.chatId, pending.value);
  }, []);

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

  // Sortie du composant : on écrit ce qui attendait au lieu de le jeter.
  useEffect(() => flush, [flush]);

  // Changement de conversation : le brouillon en attente appartient à la
  // conversation qu'on quitte, il doit être écrit avant de charger la suivante.
  useEffect(() => {
    return () => {
      if (pendingRef.current && pendingRef.current.chatId !== chatId) flush();
    };
  }, [chatId, flush]);

  // Fermeture ou mise en arrière-plan de la page : même règle.
  useEffect(() => {
    const onLeave = () => flush();
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [flush]);

  /** Modifie le brouillon, avec écriture différée dans le stockage local. */
  const setDraft = useCallback((value: string) => {
    setDraftState(value);
    if (!chatId) return;

    pendingRef.current = { chatId, value };
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      pendingRef.current = null;
      persistChatDraft(chatId, value);
    }, SAVE_DEBOUNCE_MS);
  }, [chatId]);

  /** Clear le draft (à appeler après envoi message réussi) */
  const clearDraft = useCallback(() => {
    if (!chatId) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    // Sans ça, un `flush` ultérieur réécrirait le brouillon qu'on vient d'effacer.
    pendingRef.current = null;
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
