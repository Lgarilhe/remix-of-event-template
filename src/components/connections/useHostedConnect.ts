/**
 * Connexion standard d'un compte depuis une carte ou une scène : un seul état
 * (au repos, préparation, départ) et la dernière erreur en clair. Voir
 * hostedConnect.ts pour ce qui se passe au clic.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection } from '@/hooks/useConnection';
import { connectionErrorMessage, NETWORK_LOST_CODE, type ConnectionProviderId } from '@/lib/connectionCopy';
import { startHostedConnection, type HostedConnectInput } from './hostedConnect';

const REDIRECT_GRACE_MS = 20_000;

export type HostedConnectPhase = 'idle' | 'starting' | 'redirecting';

export interface UseHostedConnect {
  phase: HostedConnectPhase;
  /** Le fournisseur dont le départ est en cours, pour montrer l'attente sur le bon bouton. */
  provider: ConnectionProviderId | null;
  /** Phrase de Konekt du dernier échec, null sinon. */
  error: string | null;
  busy: boolean;
  start: (input: HostedConnectInput & { onLeave?: () => void }) => Promise<void>;
  clearError: () => void;
}

export function useHostedConnect(): UseHostedConnect {
  const { api } = useConnection();
  const [phase, setPhase] = useState<HostedConnectPhase>('idle');
  const [provider, setProvider] = useState<ConnectionProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    // Retour par le bouton « page précédente » : la page revient figée sur « Redirection en cours… ».
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      busyRef.current = false;
      setPhase('idle');
      setProvider(null);
    };
    window.addEventListener('pageshow', onShow);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('pageshow', onShow);
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  const start = useCallback(async (input: HostedConnectInput & { onLeave?: () => void }) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setProvider(input.provider);
    setPhase('starting');
    try {
      const outcome = await startHostedConnection({ api, onLeave: input.onLeave }, input);
      if (!mountedRef.current) return;
      if (outcome.ok === false) {
        setError(outcome.message);
      } else {
        setPhase('redirecting');
        // Départ refusé par le navigateur (navigation annulée) : le bouton redevient utilisable après 20 s.
        resetTimerRef.current = window.setTimeout(() => {
          busyRef.current = false;
          if (mountedRef.current) {
            setPhase('idle');
            setProvider(null);
          }
        }, REDIRECT_GRACE_MS);
        return;
      }
    } catch {
      if (mountedRef.current) setError(connectionErrorMessage(NETWORK_LOST_CODE, input.provider));
    }
    busyRef.current = false;
    if (mountedRef.current) {
      setPhase('idle');
      setProvider(null);
    }
  }, [api]);

  const clearError = useCallback(() => setError(null), []);

  return { phase, provider, error, busy: phase !== 'idle', start, clearError };
}
