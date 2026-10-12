import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import {
  applyRemap,
  checkAccess,
  fetchPreview,
  fetchReadiness,
  isFailure,
  rollbackRemap,
  shareInFlight,
  type ApplyResult,
  type Failure,
  type MigrationInvoke,
  type Outcome,
  type Preview,
  type Readiness,
  type RollbackResult,
} from './basculeApi';

/**
 * État de la page « Bascule de la connexion » : accès, vérification, simulation, conversion et
 * annulation. Chaque étape a ses phases (repos, en cours, résultat, échec) ; un échec ne vide
 * jamais le résultat des autres étapes. Les appels passent par `unipile-migration`.
 */

export type Step<T> =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; value: T }
  | { phase: 'error'; failure: Failure };

export type AccessState = 'checking' | 'granted' | 'denied' | { error: Failure };

const invoke: MigrationInvoke = (body) => invokeEdgeFunction('unipile-migration', body);

export function useBascule() {
  const [access, setAccess] = useState<AccessState>('checking');
  const [readiness, setReadiness] = useState<Step<Readiness>>({ phase: 'idle' });
  const [preview, setPreview] = useState<Step<Preview>>({ phase: 'idle' });
  const [apply, setApply] = useState<Step<ApplyResult>>({ phase: 'idle' });
  const [rollback, setRollback] = useState<Step<RollbackResult>>({ phase: 'idle' });
  // Lot en cours d'annulation, pour le texte du dialogue et de l'état.
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);
  const mounted = useRef(true);
  // Vérification d'accès en cours : le double montage de l'effet (mode développement) la reprend, il ne la relance pas.
  const accessCall = useRef<Promise<Outcome<{ value: true }>> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const verifyAccess = useCallback(async () => {
    setAccess('checking');
    const outcome = await shareInFlight(accessCall, () => checkAccess(invoke));
    if (!mounted.current) return;
    if (isFailure(outcome)) setAccess(outcome.denied ? 'denied' : { error: outcome });
    else setAccess('granted');
  }, []);

  useEffect(() => {
    void verifyAccess();
  }, [verifyAccess]);

  // Un refus d'accès en cours de route (session d'un autre utilisateur) ferme la page.
  const settle = useCallback(<T,>(outcome: Outcome<{ value: T }>, set: (step: Step<T>) => void) => {
    if (!mounted.current) return;
    if (!isFailure(outcome)) set({ phase: 'done', value: outcome.value });
    else if (outcome.denied) setAccess('denied');
    else set({ phase: 'error', failure: outcome });
  }, []);

  const runReadiness = useCallback(async () => {
    setReadiness({ phase: 'loading' });
    settle(await fetchReadiness(invoke), setReadiness);
  }, [settle]);

  const runPreview = useCallback(async () => {
    setPreview({ phase: 'loading' });
    settle(await fetchPreview(invoke), setPreview);
  }, [settle]);

  const runApply = useCallback(async (confirm: string, allowUnmapped: boolean, planFingerprint: string) => {
    setApply({ phase: 'loading' });
    setRollback({ phase: 'idle' });
    const outcome = await applyRemap(invoke, confirm, allowUnmapped, planFingerprint);
    settle(outcome, setApply);
    // La simulation d'avant ne dit plus l'état de la base (ou plus celui des comptes) : elle est à refaire.
    if (mounted.current && (!isFailure(outcome) || outcome.lost || outcome.code === 'plan_changed')) setPreview({ phase: 'idle' });
  }, [settle]);

  const runRollback = useCallback(async (batchId: string) => {
    setRollbackTarget(batchId);
    setRollback({ phase: 'loading' });
    const outcome = await rollbackRemap(invoke, batchId);
    settle(outcome, setRollback);
    // Résultat inconnu (réponse perdue) : la simulation d'avant ne dit plus l'état de la base.
    if (mounted.current && (!isFailure(outcome) || outcome.lost)) setPreview({ phase: 'idle' });
  }, [settle]);

  return {
    access, verifyAccess,
    readiness, runReadiness,
    preview, runPreview,
    apply, runApply,
    rollback, runRollback, rollbackTarget,
  };
}
