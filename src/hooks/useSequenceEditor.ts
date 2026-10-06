// État de l'éditeur unique de séquence (lot 5d-2) : un tableau de
// SequenceStep, celui qu'enregistre useSequenceSave. Les gestes passent par
// les règles pures de src/lib/sequenceEditor.ts et de sequenceGraph.ts, pour
// produire les mêmes étapes que l'ancien éditeur.
//
// L'enregistrement (bouton, Ctrl/Cmd+S, brouillon local, fenêtres) se branche
// sur `steps`, `dirty`, `reset` et `restore` ; il n'est pas ici.
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { SequenceStep } from '@/types/sequence';
import type { StepPosition } from '@/components/outreach/sequence/sequenceGraph';
import { addVariantToSteps, removeStepFromSequence } from '@/components/outreach/sequence/sequenceGraph';
import {
  addStepAt,
  buildEditorFlow,
  moveStep,
  primaryOf,
  setAfterStep,
  updateStepGroup,
  updateVersion,
  type EditorFlow,
} from '@/lib/sequenceEditor';

/** Exécutions qui font partie de l'historique d'une étape (même liste que l'ancien éditeur). */
const HISTORY_EXECUTION_STATUSES = ['sent', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'skipped'];

export interface RemovalBlock {
  title: string;
  count: number;
}

export interface SequenceEditor {
  steps: SequenceStep[];
  flow: EditorFlow;
  /** Des modifications attendent d'être enregistrées. */
  dirty: boolean;
  selectedId: string | null;
  select: (stepId: string | null) => void;
  /** Ajoute une étape à l'emplacement et l'ouvre dans le panneau. */
  add: (position: StepPosition, actionType: SequenceStep['actionType']) => string | null;
  /** Champ propre à une version (texte, objet, IA, ton, part des envois). */
  updateVersion: (versionId: string, updates: Partial<SequenceStep>) => void;
  /** Réglage commun à toutes les versions de l'étape. */
  updateStep: (stepId: string, updates: Partial<SequenceStep>) => void;
  setAfter: (stepId: string, value: 'continue' | 'end' | string) => void;
  addVersion: (stepId: string) => string | null;
  /** Supprime une étape ou une version, après contrôle de l'historique d'envoi. */
  requestRemove: (stepId: string) => Promise<void>;
  move: (stepId: string, direction: 'up' | 'down') => void;
  checkingRemoval: boolean;
  removalBlock: RemovalBlock | null;
  dismissRemovalBlock: () => void;
  /** Repart d'un nouvel état enregistré (ouverture, enregistrement). */
  reset: (steps: SequenceStep[], persistedStepIds?: Iterable<string>) => void;
  /** Reprend des étapes modifiées (brouillon), sans changer l'état enregistré de référence. */
  restore: (steps: SequenceStep[]) => void;
  /** Revient à l'état enregistré de référence. */
  discard: () => void;
}

export function useSequenceEditor(initialSteps: SequenceStep[] = []): SequenceEditor {
  const [steps, setSteps] = useState<SequenceStep[]>(initialSteps);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialSteps));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkingRemoval, setCheckingRemoval] = useState(false);
  const [removalBlock, setRemovalBlock] = useState<RemovalBlock | null>(null);
  // Étapes déjà en base : elles peuvent avoir un historique d'envoi.
  const persistedRef = useRef<Set<string>>(new Set(initialSteps.map((s) => s.id)));
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;

  const flow = useMemo(() => buildEditorFlow(steps), [steps]);
  const dirty = useMemo(() => JSON.stringify(steps) !== baseline, [steps, baseline]);

  const reset = useCallback((next: SequenceStep[], persistedStepIds?: Iterable<string>) => {
    setSteps(next);
    setBaseline(JSON.stringify(next));
    persistedRef.current = new Set(persistedStepIds ?? next.map((s) => s.id));
    setSelectedId((current) => (current && next.some((s) => s.id === current) ? current : null));
  }, []);

  const restore = useCallback((next: SequenceStep[]) => {
    setSteps(next);
    setSelectedId(null);
  }, []);

  const discard = useCallback(() => {
    setSteps(JSON.parse(baselineRef.current) as SequenceStep[]);
    setSelectedId(null);
  }, []);

  const add = useCallback((position: StepPosition, actionType: SequenceStep['actionType']) => {
    const newId = crypto.randomUUID();
    const result = addStepAt(stepsRef.current, position, actionType, newId);
    if (!result.newStepId) {
      toast.error('Cet emplacement a changé : rouvrez « Ajouter une étape ».');
      return null;
    }
    setSteps(result.steps);
    setSelectedId(result.newStepId);
    return result.newStepId;
  }, []);

  const applyRemove = useCallback((stepId: string) => {
    const prev = stepsRef.current;
    const next = removeStepFromSequence(prev, stepId);
    setSteps(next);
    setSelectedId((current) => {
      if (!current || next.some((s) => s.id === current)) return current;
      // Version retirée : le panneau reste sur l'étape.
      const removed = prev.find((s) => s.id === stepId);
      const survivor = removed ? next.find((s) => s.order === removed.order) : undefined;
      return removed?.variantGroup && removed.variantGroup !== 'A' && survivor ? survivor.id : null;
    });
  }, []);

  /**
   * Comme l'ancien éditeur : une étape pas encore enregistrée part tout de
   * suite ; une étape déjà envoyée garde son historique (l'enregistrement
   * serait refusé), on l'explique au lieu de la supprimer.
   */
  const requestRemove = useCallback(async (stepId: string) => {
    const current = stepsRef.current;
    const target = current.find((s) => s.id === stepId);
    if (!target) return;
    const removedRows = target.variantGroup === 'A' ? current.filter((s) => s.order === target.order && s.variantGroup) : [target];
    const persisted = removedRows.map((s) => s.id).filter((id) => persistedRef.current.has(id));
    if (persisted.length === 0) {
      applyRemove(stepId);
      return;
    }
    setCheckingRemoval(true);
    try {
      const { count, error } = await supabase
        .from('sequence_step_executions')
        .select('id', { count: 'exact', head: true })
        .in('step_id', persisted)
        .in('status', HISTORY_EXECUTION_STATUSES);
      if (error) throw error;
      if (count === null) throw new Error('Comptage indisponible');
      if (count > 0) {
        const isVersion = !!target.variantGroup && target.variantGroup !== 'A';
        const number = buildEditorFlow(current).numbers.get(target.id) ?? target.order + 1;
        setRemovalBlock({
          // Titre affirmatif : la suppression n'est pas possible, la fenêtre l'explique (aucune question sans réponse).
          title: isVersion ? `La version ${target.variantGroup} de l’étape ${number} ne peut pas être retirée` : `L’étape ${number} ne peut pas être supprimée`,
          count,
        });
        return;
      }
      applyRemove(stepId);
    } catch (err) {
      console.error('[useSequenceEditor] history check failed:', err);
      toast.error('Impossible de vérifier l’historique de cette étape', {
        description: 'Elle n’a pas été supprimée. Réessayez dans un instant.',
      });
    } finally {
      setCheckingRemoval(false);
    }
  }, [applyRemove]);

  const addVersion = useCallback((stepId: string) => {
    const primary = primaryOf(stepsRef.current, stepId);
    if (!primary) return null;
    const newId = crypto.randomUUID();
    const next = addVariantToSteps(stepsRef.current, primary.id, newId);
    if (next === stepsRef.current) return null;
    setSteps(next);
    return newId;
  }, []);

  const move = useCallback((stepId: string, direction: 'up' | 'down') => {
    const next = moveStep(stepsRef.current, stepId, direction);
    if (next) setSteps(next);
  }, []);

  const updateOne = useCallback((versionId: string, updates: Partial<SequenceStep>) => {
    setSteps((prev) => updateVersion(prev, versionId, updates));
  }, []);
  const updateGroup = useCallback((stepId: string, updates: Partial<SequenceStep>) => {
    setSteps((prev) => updateStepGroup(prev, stepId, updates));
  }, []);
  const setAfter = useCallback((stepId: string, value: 'continue' | 'end' | string) => {
    setSteps((prev) => setAfterStep(prev, stepId, value));
  }, []);
  const dismissRemovalBlock = useCallback(() => setRemovalBlock(null), []);

  return {
    steps,
    flow,
    dirty,
    selectedId,
    select: setSelectedId,
    add,
    updateVersion: updateOne,
    updateStep: updateGroup,
    setAfter,
    addVersion,
    requestRemove,
    move,
    checkingRemoval,
    removalBlock,
    dismissRemovalBlock,
    reset,
    restore,
    discard,
  };
}
