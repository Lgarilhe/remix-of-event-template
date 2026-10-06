/**
 * Brouillon local de l'éditeur unique de séquence (lot 5d-2), une entrée par
 * séquence (ou par création), rangée par utilisateur et par organisation
 * (src/lib/editorDraft.ts : stockage du navigateur, chaque accès sous
 * try/catch, 7 jours au plus, effacé à la déconnexion).
 *
 * - Écrit une seconde après la dernière modification, tout de suite avant un
 *   rechargement (`flush`), et au départ de l'éditeur (page quittée, retour du
 *   navigateur, autre séquence) avec la dernière saisie si cette seconde n'est
 *   pas écoulée ; effacé dès qu'il ne reste rien à enregistrer, ou par `clear`
 *   (enregistrement, départ confirmé sans enregistrer).
 * - Repris à l'ouverture seulement s'il part du même état enregistré
 *   (`base`) : une séquence modifiée depuis, par un collègue ou dans un autre
 *   onglet, n'est jamais recouverte par une vieille saisie.
 * - Ne contient que ce que l'éditeur enregistrera (étapes, nom, réglages),
 *   jamais une valeur d'aperçu d'un candidat.
 */
import { useCallback, useEffect, useRef } from 'react';
import { clearEditorDraft, editorDraftSavedAt, loadEditorDraft, saveEditorDraft } from '@/lib/editorDraft';

const WRITE_DELAY_MS = 1000;

interface StoredSequenceDraft<T> {
  base: string;
  value: T;
}

/** Clé du brouillon : utilisateur, organisation et séquence (ou création). `null` tant que l'un manque. */
export function sequenceEditorDraftKey(userId: string | null | undefined, organizationId: string | null | undefined, target: string): string | null {
  if (!userId || !organizationId || !target) return null;
  return `sequence-editor:${userId}:${organizationId}:${target}`;
}

interface DraftOptions<T> {
  key: string | null;
  /** État enregistré de départ ; null tant qu'il n'est pas lu (rien n'est écrit ni repris). */
  base: string | null;
  value: T;
  dirty: boolean;
  /** Brouillon du même état de départ trouvé à l'ouverture. */
  onRestore: (value: T, savedAt: Date | null) => void;
}

type Snapshot<T> = { key: string | null; base: string | null; value: T; dirty: boolean };

export function useSequenceEditorDraft<T>({ key, base, value, dirty, onRestore }: DraftOptions<T>) {
  const restoredFor = useRef<string | null>(null);
  const latest = useRef<Snapshot<T>>({ key, base, value, dirty });
  latest.current = { key, base, value, dirty };
  // Dernier état affiché : au nettoyage d'un changement de clé, `latest` porte déjà la nouvelle clé.
  const committed = useRef<Snapshot<T>>({ key, base, value, dirty });
  // Une modification attend son écriture (temporisation en cours).
  const pending = useRef(false);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // Reprise : une fois par clé et par état de départ.
  useEffect(() => {
    if (!key || base === null) return;
    const marker = `${key}\u0001${base}`;
    if (restoredFor.current === marker) return;
    restoredFor.current = marker;
    const stored = loadEditorDraft<StoredSequenceDraft<T>>(key);
    if (!stored || typeof stored !== 'object' || stored.base !== base) {
      if (stored) clearEditorDraft(key);
      return;
    }
    onRestoreRef.current(stored.value, editorDraftSavedAt(key));
  }, [key, base]);

  const writeSnapshot = useCallback((snapshot: Snapshot<T>) => {
    const { key: k, base: b, value: v, dirty: d } = snapshot;
    if (!k || b === null || restoredFor.current !== `${k}\u0001${b}`) return;
    pending.current = false;
    try {
      if (d) saveEditorDraft<StoredSequenceDraft<T>>(k, { base: b, value: v });
      else clearEditorDraft(k);
    } catch {
      // Stockage indisponible : le brouillon est perdu, pas la saisie en cours.
    }
  }, []);
  const write = useCallback(() => writeSnapshot(latest.current), [writeSnapshot]);

  useEffect(() => {
    committed.current = { key, base, value, dirty };
  });

  useEffect(() => {
    pending.current = true;
    const timer = window.setTimeout(write, WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [key, base, value, dirty, write]);

  // Départ de l'éditeur (démontage) ou autre séquence (nouvelle clé) avant la fin de la temporisation : écrit tout de suite.
  useEffect(() => () => {
    if (pending.current) writeSnapshot(committed.current);
  }, [key, writeSnapshot]);

  const clear = useCallback(() => {
    pending.current = false;
    const k = latest.current.key;
    if (!k) return;
    try {
      clearEditorDraft(k);
    } catch {
      // Stockage indisponible : rien à effacer.
    }
  }, []);

  return { flush: write, clear };
}
