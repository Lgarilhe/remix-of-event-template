/**
 * Enregistrement explicite de l'éditeur unique de séquence (lot 5d-2), par le
 * bouton « Enregistrer » de l'en-tête ou Ctrl/Cmd+S. Mêmes gardes que
 * l'ancien éditeur (SequenceBuilder.handleSave), dans le même ordre :
 * 1. points bloquants de validateSequence : refus, le premier est dit ;
 * 2. étapes déjà en base retirées alors que des candidats sont en cours (ou
 *    leur nombre est inconnu) : « Supprimer N étapes ? » ;
 * 3. points à confirmer (étape qu'aucun chemin n'atteint, condition retirée,
 *    variable inconnue avec texte de secours) : « Enregistrer malgré ces
 *    points ? » ;
 * 4. l'écriture elle-même (`perform`, qui passe par useSequenceSave pour les
 *    étapes) : un échec garde les modifications et dit pourquoi.
 * État d'enregistrement de l'en-tête : « Modifications non enregistrées »,
 * « Enregistrement… », « Enregistré à 14 h 32 », « Échec de l'enregistrement ».
 */
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SequenceIssue } from '@/components/outreach/sequence/sequenceGraph';
import { plural } from '@/lib/plural';

export type EditorSaveState = 'unsaved' | 'saving' | 'saved' | 'error' | null;

/** Vérifications qui demandent une confirmation avant d'enregistrer (ancienne alerte d'enregistrement). */
export const CONFIRM_BEFORE_SAVE_CHECKS: readonly string[] = ['unreachable', 'retired_condition', 'unknown_variables'];

interface SaveFlowOptions {
  dirty: boolean;
  /** Points bloquants pour cet enregistrement. */
  errors: readonly SequenceIssue[];
  /** Recommandations de validateSequence (seules celles de CONFIRM_BEFORE_SAVE_CHECKS sont confirmées). */
  warnings: readonly SequenceIssue[];
  /** Étapes déjà en base retirées dans l'éditeur (versions comptées une fois). */
  removedStepCount: number;
  /** Candidats en cours ; undefined si le nombre n'a pas pu être lu. */
  activeEnrollmentCount: number | undefined;
  /** Écriture ; lève une erreur au message lisible en cas d'échec. */
  perform: () => Promise<void>;
  /** Points bloquants : l'éditeur montre le premier. */
  onBlocked: (errors: readonly SequenceIssue[]) => void;
}

export interface EditorSaveFlow {
  state: EditorSaveState;
  savedAt: Date | null;
  saving: boolean;
  save: () => void;
  warningsDialog: { open: boolean; items: string[]; confirm: () => void; cancel: () => void };
  removalDialog: { open: boolean; count: number; activeCount: number | undefined; confirm: () => void; cancel: () => void };
}

export function useEditorSaveFlow({
  dirty,
  errors,
  warnings,
  removedStepCount,
  activeEnrollmentCount,
  perform,
  onBlocked,
}: SaveFlowOptions): EditorSaveFlow {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [warningsOpen, setWarningsOpen] = useState(false);
  // Contenu gardé pendant la fermeture des fenêtres (pas de texte vide pendant l'animation).
  const [pendingWarnings, setPendingWarnings] = useState<string[]>([]);
  const [removalOpen, setRemovalOpen] = useState(false);
  const [pendingRemoved, setPendingRemoved] = useState(0);
  const savingRef = useRef(false);

  const run = useCallback(async (opts: { removalConfirmed?: boolean; warningsConfirmed?: boolean } = {}) => {
    if (savingRef.current) return;
    if (errors.length > 0) {
      toast.error(`${plural(errors.length, 'point')} à corriger avant d’enregistrer`, {
        description: errors[0].message + (errors.length > 1 ? ` (et ${plural(errors.length - 1, 'autre')})` : ''),
      });
      onBlocked(errors);
      return;
    }
    if (!opts.removalConfirmed && removedStepCount > 0 && (activeEnrollmentCount ?? 1) > 0) {
      setPendingRemoved(removedStepCount);
      setRemovalOpen(true);
      return;
    }
    if (!opts.warningsConfirmed) {
      const toConfirm = warnings.filter((w) => CONFIRM_BEFORE_SAVE_CHECKS.includes(w.check)).map((w) => w.message);
      if (toConfirm.length > 0) {
        setPendingWarnings(toConfirm);
        setWarningsOpen(true);
        return;
      }
    }
    savingRef.current = true;
    setSaving(true);
    setFailed(false);
    try {
      await perform();
      setSavedAt(new Date());
    } catch (err) {
      console.error('[useEditorSaveFlow] enregistrement en échec :', err);
      setFailed(true);
      const reason = err instanceof Error && err.message ? err.message : null;
      toast.error('Échec de l’enregistrement', {
        description: reason ?? 'Vos modifications sont toujours là. Vérifiez votre connexion, puis réessayez.',
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [errors, warnings, removedStepCount, activeEnrollmentCount, perform, onBlocked]);

  const save = useCallback(() => { void run(); }, [run]);

  let state: EditorSaveState = null;
  if (saving) state = 'saving';
  else if (failed && dirty) state = 'error';
  else if (dirty) state = 'unsaved';
  else if (savedAt) state = 'saved';

  return {
    state,
    savedAt,
    saving,
    save,
    warningsDialog: {
      open: warningsOpen,
      items: pendingWarnings,
      confirm: () => {
        setWarningsOpen(false);
        void run({ removalConfirmed: true, warningsConfirmed: true });
      },
      cancel: () => setWarningsOpen(false),
    },
    removalDialog: {
      open: removalOpen,
      count: pendingRemoved,
      activeCount: activeEnrollmentCount,
      confirm: () => {
        setRemovalOpen(false);
        void run({ removalConfirmed: true });
      },
      cancel: () => setRemovalOpen(false),
    },
  };
}
