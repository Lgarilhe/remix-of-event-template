/**
 * Connexion d'un compte (LinkedIn, WhatsApp, messagerie) : accès React aux
 * actions de connexion de `unipile-accounts`, avec le même appelant que les
 * cartes de Connexions (invokeEdgeFunction).
 *
 * - useConnectionCapabilities : ce que le serveur permet (connexion directe
 *   ou standard), lu une fois et gardé cinq minutes.
 * - useConnection : démarrer, répondre à une vérification, renvoyer un code,
 *   lire l'état, suivre une tentative (avec arrêt) et l'annuler.
 * - useNativeScreens : les écrans de connexion directe sont permis seulement si
 *   le serveur les annonce ET que l'interrupteur local est allumé
 *   (src/lib/connectionBeta.ts). Par défaut : la connexion standard.
 *
 * Les textes viennent de src/lib/connectionCopy.ts. Les identifiants saisis ne
 * sont ni journalisés ni gardés ici : ils passent dans la demande et nulle part
 * ailleurs.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import {
  CONNECTION_NATIVE_DEFAULT,
  connectionNativeParam,
  getConnectionNative,
  nativeScreensAllowed,
  setConnectionNative,
  subscribeConnectionNative,
  withoutConnectionNativeParam,
} from '@/lib/connectionBeta';
import type { ConnectionProviderId } from '@/lib/connectionCopy';
import {
  createConnectionApi,
  NO_CAPABILITIES,
  pollAttempt,
  type ApiFailure,
  type AttemptStatusView,
  type CheckpointInput,
  type ConnectionApi,
  type ConnectionCapabilities,
  type InvokeFn,
  type PollResult,
  type StartConnectionInput,
  type WaitingStep,
} from '@/components/connections/connectionApi';

/** Appel des actions : invokeEdgeFunction, dont la forme { data, error } est celle du contrat. */
const invoke: InvokeFn = (functionName, body) => invokeEdgeFunction(functionName, body) as ReturnType<InvokeFn>;

export const CONNECTION_CAPABILITIES_KEY = 'connection-capabilities';
const CAPABILITIES_STALE_MS = 5 * 60 * 1000;

/** Clés React Query à relire quand un compte vient d'être relié, reconnecté ou dissocié. */
export const ACCOUNT_QUERY_KEYS = [
  ['member-linkedin-accounts'],
  ['member-email-accounts'],
  ['member-whatsapp-accounts'],
  ['candidate-actions'],
  ['assistant-email-connector'],
  ['multichannel-inbox'],
] as const;

/** Les capacités annoncées par le serveur ; sans réponse, rien de direct n'est annoncé. */
export function useConnectionCapabilities(options: { enabled?: boolean } = {}) {
  const wanted = options.enabled ?? true;
  const { organizationId } = useOrganization();
  const { user, isReady } = useAuthReady();
  const api = useMemo(() => createConnectionApi(invoke, organizationId), [organizationId]);
  const query = useQuery<ConnectionCapabilities>({
    queryKey: [CONNECTION_CAPABILITIES_KEY, organizationId, user?.id],
    enabled: wanted && isReady && !!user?.id && !!organizationId,
    staleTime: CAPABILITIES_STALE_MS,
    retry: 1,
    queryFn: async () => {
      const result = await api.capabilities();
      if (result.ok === false) throw new Error(result.message);
      return result.capabilities;
    },
  });
  return {
    /** Les capacités reçues, sinon des valeurs sans connexion directe : la connexion standard reste possible. */
    capabilities: query.data ?? NO_CAPABILITIES,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** Interrupteur local des écrans de connexion directe (éteint par défaut). */
export function useConnectionNativeFlag(): boolean {
  return useSyncExternalStore(subscribeConnectionNative, getConnectionNative, () => CONNECTION_NATIVE_DEFAULT);
}

/**
 * ?connection-native=1 ou =0 : écrit l'interrupteur local, puis retire le
 * paramètre de l'adresse (remplacement, sans entrée d'historique). Monté une fois
 * par AppLayout, comme useSequencesBetaParamSync : le paramètre vaut sur toute
 * page de l'application, pas seulement sur Connexions.
 */
export function useConnectionNativeParamSync(): void {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const requested = connectionNativeParam(search);
  useEffect(() => {
    if (requested === null) return;
    setConnectionNative(requested);
    navigate(`${pathname}${withoutConnectionNativeParam(search)}${hash}`, { replace: true });
  }, [requested, pathname, search, hash, navigate]);
}

/** Champ des capacités du serveur qui commande ce fournisseur. */
export function nativeCapabilityOf(capabilities: ConnectionCapabilities, provider: ConnectionProviderId): boolean {
  switch (provider) {
    case 'linkedin': return capabilities.native.linkedin;
    case 'whatsapp': return capabilities.native.whatsapp;
    case 'imap': return capabilities.native.imap;
    default: return capabilities.native.oauth;
  }
}

/** Vrai quand les écrans de connexion directe de ce fournisseur sont permis (serveur ET interrupteur local). */
export function useNativeScreens(provider: ConnectionProviderId): boolean {
  const local = useConnectionNativeFlag();
  // Interrupteur local éteint : rien ne peut s'afficher, donc aucune requête au serveur.
  const { capabilities } = useConnectionCapabilities({ enabled: local });
  return nativeScreensAllowed(nativeCapabilityOf(capabilities, provider), local);
}

export interface WatchHandle {
  /** Résultat du suivi : tentative terminée, délai écoulé, arrêt, ou échec de lecture. */
  result: Promise<PollResult>;
  /** Arrête le suivi (ne touche pas à la tentative : voir `cancel`). */
  stop: () => void;
}

export interface WatchOptions {
  waitingStep?: WaitingStep;
  onUpdate?: (view: AttemptStatusView) => void;
  timeoutMs?: number;
}

export interface UseConnection {
  api: ConnectionApi;
  start: (input: StartConnectionInput) => ReturnType<ConnectionApi['start']>;
  checkpoint: (input: CheckpointInput, provider?: ConnectionProviderId) => ReturnType<ConnectionApi['checkpoint']>;
  resend: (input: { attemptId: string; challenge?: string }, provider?: ConnectionProviderId) => ReturnType<ConnectionApi['resend']>;
  status: (attemptId: string, waitingStep?: WaitingStep) => ReturnType<ConnectionApi['status']>;
  /** Annule la tentative côté serveur et arrête le suivi en cours. */
  cancel: (attemptId: string) => ReturnType<ConnectionApi['cancel']>;
  /** Suit une tentative jusqu'à sa fin. Un seul suivi à la fois : le précédent est arrêté. */
  watch: (attemptId: string, options?: WatchOptions) => WatchHandle;
  /** Arrête le suivi en cours, s'il y en a un. */
  stopWatching: () => void;
  /** Relit les comptes affichés (liaisons, liste) après une connexion, une reconnexion ou une dissociation. */
  refreshAccounts: () => Promise<void>;
}

export type { ApiFailure };

export function useConnection(): UseConnection {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const { reload: reloadLinkedInAccounts } = useLinkedInAccounts();
  const api = useMemo(() => createConnectionApi(invoke, organizationId), [organizationId]);
  const controllerRef = useRef<AbortController | null>(null);

  const stopWatching = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  // Le suivi s'arrête avec l'écran qui l'a lancé.
  useEffect(() => stopWatching, [stopWatching]);

  const watch = useCallback((attemptId: string, options: WatchOptions = {}): WatchHandle => {
    stopWatching();
    const controller = new AbortController();
    controllerRef.current = controller;
    const result = pollAttempt({
      status: api.status,
      attemptId,
      waitingStep: options.waitingStep,
      onUpdate: options.onUpdate,
      timeoutMs: options.timeoutMs,
      signal: controller.signal,
    }).finally(() => {
      if (controllerRef.current === controller) controllerRef.current = null;
    });
    return { result, stop: () => controller.abort() };
  }, [api, stopWatching]);

  const cancel = useCallback((attemptId: string) => {
    stopWatching();
    return api.cancel(attemptId);
  }, [api, stopWatching]);

  const refreshAccounts = useCallback(async () => {
    await Promise.all([
      ...ACCOUNT_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })),
      reloadLinkedInAccounts().catch(() => undefined),
    ]);
  }, [queryClient, reloadLinkedInAccounts]);

  return useMemo<UseConnection>(() => ({
    api,
    start: api.start,
    checkpoint: api.checkpoint,
    resend: api.resend,
    status: api.status,
    cancel,
    watch,
    stopWatching,
    refreshAccounts,
  }), [api, cancel, watch, stopWatching, refreshAccounts]);
}
