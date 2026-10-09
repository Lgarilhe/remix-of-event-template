import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { candidateActionCanResume, candidateActionCompleted, candidateActionExecutionOrder, candidateActionNeedsReview, type CandidateActionScope, type CandidateActionPlan, type CandidateActionEdits, type CandidateActionsResponse, type CandidateActionMessageRecord } from '@/lib/candidateActions';

type ActionsPayload = CandidateActionsResponse & { success: boolean; plan?: CandidateActionPlan; messages?: CandidateActionMessageRecord[]; generation?: { estimated: number; level: string; styleSummary: string; model: string } };
type Operation = 'generate' | 'save' | 'execute' | 'dismiss' | 'restore';

/** Les mutations conservent la portée capturée avant l'appel, même si la fiche change. */
export function useCandidateActions(scope: Omit<CandidateActionScope, 'organization_id'> | null, onChanged?: () => void) {
  const { user, isReady } = useAuthReady();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const fullScope = scope && organizationId ? { ...scope, organization_id: organizationId } : null;
  const scopeKey = JSON.stringify([user?.id, organizationId, scope?.candidate_id, scope?.linkedin_url, scope?.project_id, scope?.account_id, scope?.chat_id]);
  const queryKey = ['candidate-actions', scopeKey];
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const [operation, setOperation] = useState<{ scope: string; type: Operation; planId?: string } | null>(null);
  const [failure, setFailure] = useState<{ scope: string; type: Operation; message: string } | null>(null);
  const [unverified, setUnverified] = useState<Record<string, string[]>>({});
  const inFlight = useRef(new Set<string>());
  const enabled = isReady && !!user && !!fullScope?.candidate_id;
  const generating = operation?.scope === scopeKey && operation.type === 'generate';
  const query = useQuery({
    queryKey,
    enabled: enabled && !generating,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async (): Promise<ActionsPayload> => {
      const response = await invokeEdgeFunction<ActionsPayload>('candidate-actions', { action: 'list', ...fullScope });
      if (response.error || !response.data?.success) throw response.error || new Error(response.data?.error || 'Les actions enregistrées n’ont pas pu être chargées. Réessayez leur lecture.');
      return response.data;
    },
  });

  const request = async (action: string, params: Record<string, unknown> = {}) => {
    const response = await invokeEdgeFunction<ActionsPayload>('candidate-actions', { action, ...fullScope, ...params });
    if (response.error || !response.data?.success) throw response.error || new Error(response.data?.error || 'Cette action n’a pas pu être enregistrée.');
    return response.data;
  };
  const storePlan = (plan: CandidateActionPlan) => queryClient.setQueryData<ActionsPayload>(queryKey, previous => previous && ({ ...previous, plans: [plan, ...previous.plans.filter(item => item.id !== plan.id)] }));
  const invalidate = async () => {
    await Promise.all(['multichannel-inbox', 'candidate-actions', 'profile-activity', 'candidate-messages', 'candidate-full-profile', 'mission-v3', 'candidate-comments', 'candidate-evaluations', 'candidate-scorecard', 'qualification-sessions'].map(prefix => queryClient.invalidateQueries({ queryKey: [prefix] })));
    if (currentScope.current === scopeKey) changed.current?.();
  };
  const run = async <T,>(type: Operation, planId: string | undefined, work: () => Promise<T>): Promise<T | null> => {
    if (!enabled || inFlight.current.has(scopeKey)) return null;
    inFlight.current.add(scopeKey);
    setOperation({ scope: scopeKey, type, planId });
    setFailure(null);
    try { return await work(); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (type !== 'execute' && /CONTEXT_CHANGED|REVISION|TARGET_CHANGED|EVALUATION_CHANGED|MEMBER_CHANGED/.test(code)) {
        try { queryClient.setQueryData(queryKey, await request('list')); } catch { /* Le texte local reste disponible. */ }
      }
      if (currentScope.current === scopeKey) setFailure({ scope: scopeKey, type, message: error instanceof Error ? error.message : 'L’action n’a pas pu être terminée. Votre contenu est conservé.' });
      return null;
    } finally {
      inFlight.current.delete(scopeKey);
      if (currentScope.current === scopeKey) setOperation(null);
    }
  };

  const generate = () => {
    // Sans première lecture confirmée, ni contexte ni coût ne sont connus.
    // Cette garde protège aussi les appels autres que le bouton de l'interface.
    if (!query.data?.success) return Promise.resolve(null);
    return run('generate', undefined, async () => {
      // Une relecture déjà partie ne doit pas remplacer le résultat de ce clic.
      await queryClient.cancelQueries({ queryKey, exact: true });
      const response = await invokeWithCredits<ActionsPayload>('candidate-actions', 'candidate_actions', { action: 'generate', ...fullScope }, { modelOverride: query.data?.generation?.model, description: 'Préparer les prochaines actions du candidat' });
      if (response.error || !response.data?.success) throw response.error || new Error(response.data?.error || 'Les prochaines actions n’ont pas pu être préparées.');
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, response.data);
      return response.data;
    });
  };
  const save = (plan: CandidateActionPlan, edits: CandidateActionEdits) => run('save', plan.id, async () => {
    const response = await request('save', { plan_id: plan.id, revision: plan.revision, edits });
    if (!response.plan) throw new Error('Le brouillon n’a pas pu être confirmé. Actualisez les actions.');
    storePlan(response.plan);
    return response.plan;
  });
  const execute = (plan: CandidateActionPlan, edits: CandidateActionEdits) => run('execute', plan.id, async () => {
    if (unverified[scopeKey]?.includes(plan.id)) throw new Error('Vérifiez le résultat enregistré avant de reprendre cette action.');
    let latest = plan;
    if (latest.status === 'draft') {
      if (Object.keys(edits).length) {
        const saved = await request('save', { plan_id: latest.id, revision: latest.revision, edits });
        if (!saved.plan) throw new Error('Vos modifications n’ont pas pu être confirmées.');
        latest = saved.plan;
        storePlan(latest);
      }
      const approved = await request('approve', { plan_id: latest.id, revision: latest.revision });
      if (!approved.plan) throw new Error('La validation n’a pas pu être confirmée.');
      latest = approved.plan;
      storePlan(latest);
    } else if (!candidateActionCanResume(latest)) {
      throw new Error('Actualisez le résultat avant de reprendre cette action.');
    }
    for (const effect of candidateActionExecutionOrder(latest.effects)) {
      if (!['prepared', 'failed'].includes(effect.status)) continue;
      try {
        const response = await request('execute_effect', { plan_id: latest.id, effect_id: effect.id });
        if (!response.plan) throw new Error('Le résultat de l’action reste à vérifier.');
        latest = response.plan;
        storePlan(latest);
      } catch (error) {
        // Une réponse perdue peut cacher un envoi réussi : lire le journal sans réexécuter.
        try {
          const reread = await request('list');
          queryClient.setQueryData(queryKey, reread);
          latest = reread.plans.find(item => item.id === latest.id) ?? latest;
        } catch {
          // Sans journal lisible, le dernier état local ne prouve pas l'absence d'envoi.
          setUnverified(previous => ({ ...previous, [scopeKey]: [...new Set([...(previous[scopeKey] ?? []), latest.id])] }));
        }
        await invalidate();
        throw error;
      }
      if (candidateActionNeedsReview(latest) || latest.effects.some(item => item.id === effect.id && item.status === 'failed')) break;
    }
    await invalidate();
    return latest;
  });
  const setDismissed = (plan: CandidateActionPlan, dismissed: boolean) => run(dismissed ? 'dismiss' : 'restore', plan.id, async () => {
    const response = await request(dismissed ? 'dismiss' : 'restore', { plan_id: plan.id, revision: plan.revision });
    if (response.plan) storePlan(response.plan);
    else await query.refetch();
    return response.plan;
  });
  const refresh = async () => {
    const result = await query.refetch();
    if (!result.isError && result.data) {
      setUnverified(previous => ({ ...previous, [scopeKey]: [] }));
      if (currentScope.current === scopeKey) setFailure(null);
    }
    return result;
  };
  const plans = query.data?.plans ?? [];
  const readError = query.isError ? query.error instanceof Error ? query.error.message : 'Les actions enregistrées n’ont pas pu être chargées. Réessayez leur lecture.' : null;
  const operationError = failure?.scope === scopeKey ? { type: failure.type, message: failure.message } : null;
  // Une relecture en panne conserve les préparations connues ; une première
  // lecture non confirmée ne prouve ni l'absence de canal ni le coût de l'IA.
  const contextLoaded = !!query.data?.success;
  return { scopeKey, enabled, plans, messages: query.data?.messages ?? [], unverifiedPlanIds: unverified[scopeKey] ?? [], warnings: query.data?.warnings ?? [], channels: query.data?.channels ?? [], generation: query.data?.generation, contextLoaded, readError, operationError, loading: query.isLoading && enabled, fetching: query.isFetching, error: operationError?.message || readError, operation: operation?.scope === scopeKey ? operation : null, hasActions: plans.some(plan => plan.status !== 'dismissed' && !candidateActionCompleted(plan)), generate, save, execute, setDismissed, refresh };
}

export type CandidateActionsController = ReturnType<typeof useCandidateActions>;
