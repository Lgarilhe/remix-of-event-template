import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { readSourcingAgentSnapshot, type SourcingAgentCommand, type SourcingAgentSnapshot } from '@/types/sourcingAgent';

const CONFLICT_CODES = new Set(['CONTEXT_CHANGED', 'REVISION_CONFLICT', 'MEMORY_CONFLICT', 'PRIVACY_CHANGED', 'FILTERS_MEMORY_STALE', 'UNCERTAIN_PROFILE_REQUIRED', 'AGENT_LEASE_CHANGED', 'AGENT_NOT_READY', 'CALIBRATION_REQUIRED']);
const ERROR_MESSAGES: Record<string, string> = {
  CONTEXT_CHANGED: 'Les critères ont changé. Relisez le cadrage actualisé avant de continuer.',
  REVISION_CONFLICT: 'L’agent a été modifié entre-temps. Les informations ont été actualisées ; vérifiez-les avant de réessayer.',
  MEMORY_CONFLICT: 'Des mémoires se contredisent. Vérifiez les règles appliquées avant de continuer.',
  AGENT_FORBIDDEN: 'Vous ne pouvez pas gérer l’agent de cette mission.',
  ACCOUNT_FORBIDDEN: 'Choisissez votre propre compte LinkedIn connecté.',
  ACCOUNT_RECONNECT: 'Reconnectez votre compte LinkedIn avant de démarrer la recherche.',
  LICENSE_UNAVAILABLE: 'Cette licence LinkedIn n’est plus disponible. Actualisez les comptes et choisissez une licence accessible.',
  PLAN_REQUIRED: 'Votre abonnement ne permet pas cette recherche.',
  INSUFFICIENT_CREDITS: 'Les crédits IA disponibles sont insuffisants pour démarrer cette recherche.',
  CONTEXT_UNAVAILABLE: 'Le cadrage actuel n’a pas pu être vérifié. Réessayez.',
  INVALID_SETTINGS: 'Vérifiez les limites et la source choisies.',
  FILTERS_MEMORY_STALE: 'Les mémoires de recherche ont changé. Revoyez les filtres de recherche avant de recalibrer l’agent.',
  PRIVACY_CHANGED: 'Les données de ce profil ont été supprimées. Les propositions ont été actualisées.',
  SCORING_UNCERTAIN: 'Une évaluation a été interrompue. Traitez le profil concerné avant de reprendre.',
  UNCERTAIN_CONSENT_REQUIRED: 'Confirmez explicitement que ce profil doit être ignoré sans relancer son évaluation.',
  UNCERTAIN_PROFILE_REQUIRED: 'Ce profil n’est plus en attente de résolution. Les informations ont été actualisées.',
  AGENT_LEASE_CHANGED: 'L’état du passage en cours a changé. Actualisez l’agent avant de continuer.',
  AGENT_NOT_READY: 'Vérifiez les prérequis indiqués avant de démarrer ou de reprendre la recherche.',
  CALIBRATION_REQUIRED: 'Donnez au moins trois avis motivés, dont un profil pertinent, puis validez le calibrage avant de reprendre.',
  CALIBRATION_CONSENT_REQUIRED: 'Confirmez explicitement les profils à utiliser comme références de calibrage.',
  REVIEW_REQUIRED: 'Ajoutez un avis motivé de 5 à 1 000 caractères sur ce profil.',
  INVALID_REQUEST: 'Vérifiez les réglages et l’action choisie avant de réessayer.',
  FILTERS_INVALID: 'Vérifiez les filtres de recherche avant de poursuivre.',
  FILTERS_UNSUPPORTED: 'Certains filtres ne sont pas disponibles avec cette licence LinkedIn.',
  FILTERS_UNRESOLVED: 'Certains filtres doivent être précisés avant de rechercher.',
};

export class SourcingAgentRequestError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'SourcingAgentRequestError'; }
}

async function requestAgent(organizationId: string, projectId: string, body: Record<string, unknown>) {
  const { data, error } = await invokeEdgeFunction<SourcingAgentSnapshot>('sourcing-agent', {
    ...body, organization_id: organizationId, project_id: projectId,
  });
  if (error || data?.error) {
    const code = data?.error_code || error?.code || 'REQUEST_FAILED';
    throw new SourcingAgentRequestError(code, ERROR_MESSAGES[code] ?? 'L’agent n’a pas pu être actualisé. Vérifiez votre connexion, puis réessayez.');
  }
  return readSourcingAgentSnapshot(data, organizationId, projectId);
}

interface Scope { key: string; generation: number; alive: boolean }

export function useSourcingAgent(projectId: string, { enabled = true, pollWhileOpen = false }: { enabled?: boolean; pollWhileOpen?: boolean } = {}) {
  const { organizationId } = useOrganization();
  const { user, isReady } = useAuthReady();
  const queryClient = useQueryClient();
  const available = enabled && isReady && Boolean(organizationId && user?.id && projectId);
  const scopeKey = `${organizationId ?? ''}:${user?.id ?? ''}:${projectId}:${available}`;
  const scope = useRef<Scope>({ key: scopeKey, generation: 0, alive: true });
  if (scope.current.key !== scopeKey) scope.current = { key: scopeKey, generation: scope.current.generation + 1, alive: true };
  const generation = scope.current.generation;
  const current = () => scope.current.alive && scope.current.key === scopeKey && scope.current.generation === generation;
  const queryKey = ['sourcing-agent', organizationId, user?.id, projectId] as const;
  const inFlight = useRef<{ generation: number; token: object } | null>(null);
  const [pending, setPending] = useState<{ generation: number; action: SourcingAgentCommand['action'] } | null>(null);
  const [failure, setFailure] = useState<{ generation: number; message: string; code: string } | null>(null);
  const [, setLifecycle] = useState(0);

  useEffect(() => {
    if (!scope.current.alive) {
      scope.current.alive = true;
      setLifecycle((value) => value + 1);
    }
    return () => { scope.current = { ...scope.current, generation: scope.current.generation + 1, alive: false }; };
  }, []);

  const query = useQuery({
    queryKey, enabled: available,
    queryFn: async ({ signal }) => {
      // Reading React Query's signal makes an unobserved request cancellable,
      // including the development StrictMode effect replay. The HTTP wrapper
      // may finish, but its cancelled response cannot enter the query cache.
      const readGeneration = scope.current.generation;
      const readCurrent = () => !signal.aborted && scope.current.alive && scope.current.key === scopeKey && scope.current.generation === readGeneration;
      if (!organizationId || signal.aborted || scope.current.key !== scopeKey) throw new SourcingAgentRequestError('STALE_CONTEXT', 'Le contexte a changé.');
      const snapshot = await requestAgent(organizationId, projectId, { action: 'get' });
      if (!readCurrent()) throw new SourcingAgentRequestError('STALE_CONTEXT', 'Le contexte a changé.');
      const verified = queryClient.getQueryData<SourcingAgentSnapshot>(queryKey);
      if (verified?.agent && verified.agent.revision > (snapshot.agent?.revision ?? 0)) return verified;
      return snapshot;
    },
    staleTime: 10_000,
    retry: false,
    refetchInterval: (queryState) => {
      const status = queryState.state.data?.agent?.status;
      return available && (pollWhileOpen || status === 'active' || status === 'calibrating') ? 15_000 : false;
    },
    refetchIntervalInBackground: false,
  });
  const { refetch } = query;
  // A command can finish on the server after its local view was closed.
  // Reopening or returning to a scope always verifies that server state,
  // even when a previous "no agent" snapshot is still considered fresh.
  useEffect(() => { if (available) void refetch(); }, [available, scopeKey, refetch]);

  const mutate = async (command: SourcingAgentCommand): Promise<SourcingAgentSnapshot> => {
    if (!available || !organizationId || !current()) throw new SourcingAgentRequestError('STALE_CONTEXT', 'Le contexte a changé. Rouvrez l’agent.');
    if (inFlight.current?.generation === generation) throw new SourcingAgentRequestError('BUSY', 'Une action est déjà en cours.');
    const token = {};
    inFlight.current = { generation, token };
    setPending({ generation, action: command.action });
    setFailure(null);
    try {
      const snapshot = await requestAgent(organizationId, projectId, {
        ...command,
        expected_revision: command.expected_revision ?? query.data?.agent?.revision ?? 0,
        expected_context_key: command.expected_context_key ?? query.data?.context_key,
      });
      if (!current()) throw new SourcingAgentRequestError('STALE_CONTEXT', 'Le contexte a changé. Rouvrez l’agent pour vérifier le résultat.');
      queryClient.setQueryData(queryKey, snapshot);
      // These management actions can return before account and live-memory
      // reads so they remain available during an outage. Verify their full
      // prerequisites immediately before offering any subsequent paid action.
      if (['pause', 'stop', 'skip_uncertain'].includes(command.action)) {
        void queryClient.invalidateQueries({ queryKey, exact: true });
      }
      if (command.action === 'approve_calibration') {
        void queryClient.invalidateQueries({ queryKey: ['mission-jobs', organizationId] });
        void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      }
      return snapshot;
    } catch (error) {
      if (current()) {
        const message = error instanceof Error ? error.message : 'L’action n’a pas pu être effectuée. Réessayez.';
        setFailure({ generation, message, code: error instanceof SourcingAgentRequestError ? error.code : 'REQUEST_FAILED' });
        if (error instanceof SourcingAgentRequestError && CONFLICT_CODES.has(error.code)) {
          void queryClient.invalidateQueries({ queryKey, exact: true });
        }
      }
      throw error;
    } finally {
      if (inFlight.current?.token === token) inFlight.current = null;
      if (current()) setPending(null);
    }
  };

  return {
    ...query, data: available ? query.data : undefined,
    mutate,
    isSaving: pending?.generation === generation,
    pendingAction: pending?.generation === generation ? pending.action : null,
    actionError: failure?.generation === generation ? failure.message : null,
    actionErrorCode: failure?.generation === generation ? failure.code : null,
    clearActionError: () => setFailure(null),
    contextIdentity: `${scopeKey}:${generation}`,
  };
}
