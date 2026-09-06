import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useAuthReady } from '@/hooks/useAuthReady';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

interface LinkedInAccount {
  id: string;
  name?: string;
  status?: string;
  profile_picture_url?: string;
  [key: string]: any;
}

interface LinkedInAccountsContextType {
  accounts: LinkedInAccount[];
  loading: boolean;
  reload: (includeOrgAccounts?: boolean) => Promise<void>;
  clear: () => void;
}

const LinkedInAccountsContext = createContext<LinkedInAccountsContextType>({
  accounts: [],
  loading: false,
  reload: async () => {},
  clear: () => {},
});

export const useLinkedInAccounts = () => useContext(LinkedInAccountsContext);

export const LinkedInAccountsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const { isReady, user } = useAuthReady();
  const prevUserIdRef = React.useRef<string | null>(null);

  /**
   * @param includeOrgAccounts si true, retourne aussi les comptes Unipile org
   * non encore mappés à un user (utile pour le claim manuel après webhook foiré)
   */
  const reload = useCallback(async (includeOrgAccounts = false) => {
    setLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction('unipile-accounts', {
        action: 'list',
        include_org_accounts: includeOrgAccounts,
      });
      if (error || !data?.success) {
        // Erreur transitoire : on garde la liste précédente plutôt que de
        // démonter les écrans qui en dépendent (sourcing en cours).
        console.warn('Failed to load LinkedIn accounts:', error || (data as any)?.error);
        return;
      }
      setAccounts((data as any).accounts || []);
    } catch (e) {
      console.error('Failed to load LinkedIn accounts:', e);
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, []);

  const clear = useCallback(() => {
    setAccounts([]);
    setHasLoaded(false);
  }, []);

  const resetState = useCallback(() => {
    prevUserIdRef.current = null;
    setAccounts([]);
    setHasLoaded(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isReady) return;

    if (!user?.id) {
      resetState();
      return;
    }

    if (prevUserIdRef.current && prevUserIdRef.current !== user.id) {
        setAccounts([]);
        setHasLoaded(false);
    }

    prevUserIdRef.current = user.id;
    void reload();
  }, [isReady, user?.id, reload, resetState]);

  useEffect(() => {
    if (!isReady || !user?.id) return;

    const healthCheckInterval = setInterval(() => {
      reload().catch(() => {});
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(healthCheckInterval);
    };
  }, [isReady, user?.id, reload]);

  // ─── Détecte les transitions OK → déconnecté pour notifier le user ─────
  // Patterns Unipile : OK / CONNECTING / CREDENTIALS / ERROR / DISCONNECTED.
  // Toute valeur différente de OK considérée problématique (sauf premier load).
  const prevStatusesRef = useRef<Map<string, string> | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (accounts.length === 0) return;

    const currentStatuses = new Map(
      accounts.map(a => [a.id, (a.status || 'UNKNOWN').toUpperCase()]),
    );

    // Premier passage : on enregistre juste l'état initial sans toaster
    if (prevStatusesRef.current === null) {
      prevStatusesRef.current = currentStatuses;
      return;
    }

    // Détecter les transitions OK → KO
    const prev = prevStatusesRef.current;
    for (const [accId, currStatus] of currentStatuses) {
      const prevStatus = prev.get(accId);
      const wasOk = prevStatus === 'OK';
      const isProblem = currStatus !== 'OK' && currStatus !== 'CONNECTING';
      if (wasOk && isProblem) {
        const acc = accounts.find(a => a.id === accId);
        const accName = acc?.name || 'Compte LinkedIn';
        toast.error(`${accName} déconnecté`, {
          description:
            currStatus === 'CREDENTIALS'
              ? 'Les identifiants ne sont plus valides. Reconnectez le compte.'
              : 'Le compte ne répond plus. Vérifiez sa configuration.',
          duration: 12000,
          action: {
            label: 'Reconnecter',
            onClick: () => navigate('/settings?tab=account'),
          },
        });
      }
    }

    prevStatusesRef.current = currentStatuses;
  }, [accounts, navigate]);

  const contextValue = useMemo(() => ({
    accounts,
    loading: !isReady || (loading && !hasLoaded),
    reload,
    clear,
  }), [accounts, isReady, loading, hasLoaded, reload, clear]);

  return (
    <LinkedInAccountsContext.Provider value={contextValue}>
      {children}
    </LinkedInAccountsContext.Provider>
  );
};
