import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { classifyLinkedInStatus, type LinkedInHealth } from '@/lib/linkedinStatus';
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
  /** Vrai dès qu'une liste a été reçue du serveur pour l'utilisateur courant. Un échec de chargement ne compte pas. */
  ready: boolean;
  /** Vrai quand la dernière lecture de la liste a échoué ; repasse à false à la prochaine liste reçue. */
  loadError: boolean;
  reload: (includeOrgAccounts?: boolean) => Promise<void>;
  clear: () => void;
}

const LinkedInAccountsContext = createContext<LinkedInAccountsContextType>({
  accounts: [],
  loading: false,
  ready: false,
  loadError: false,
  reload: async () => {},
  clear: () => {},
});

export const useLinkedInAccounts = () => useContext(LinkedInAccountsContext);

export const LinkedInAccountsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  // hasLoaded passe à true même après un échec : loadedOk ne compte qu'une liste reçue.
  const [loadedOk, setLoadedOk] = useState(false);
  // Échec de la dernière lecture : sans lui, un premier chargement raté restait
  // affiché comme « Chargement… » sans fin, sans erreur ni « Réessayer ».
  const [loadError, setLoadError] = useState(false);
  const { isReady, user } = useAuthReady();
  const queryClient = useQueryClient();
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
        setLoadError(true);
        return;
      }
      setAccounts((data as any).accounts || []);
      setLoadedOk(true);
      setLoadError(false);
      // Les liaisons changent aussi côté serveur (webhook de connexion,
      // connect_cookie, réconciliation par nom de list) : on les relit avec la liste.
      void queryClient.invalidateQueries({ queryKey: ['member-linkedin-accounts'] });
    } catch (e) {
      console.error('Failed to load LinkedIn accounts:', e);
      setLoadError(true);
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [queryClient]);

  const clear = useCallback(() => {
    setAccounts([]);
    setHasLoaded(false);
    setLoadedOk(false);
    setLoadError(false);
  }, []);

  const resetState = useCallback(() => {
    prevUserIdRef.current = null;
    setAccounts([]);
    setHasLoaded(false);
    setLoadedOk(false);
    setLoadError(false);
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
        setLoadedOk(false);
        setLoadError(false);
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

  // ─── Alerte de déconnexion : le compte de l'utilisateur courant seulement ─────
  // Avant, chaque membre recevait celle des comptes de ses collègues (et des
  // orphelins listés en mode revendication), et UNKNOWN, STOPPED ou
  // PERMISSIONS passaient pour une panne dès la sortie de OK.
  const { getUserLinkedAccountId } = useMemberLinkedInAccounts();
  const myAccountId = user?.id ? getUserLinkedAccountId(user.id) : null;
  const prevHealthRef = useRef<{ accountId: string; health: LinkedInHealth } | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    const acc = myAccountId ? accounts.find(a => a.id === myAccountId) : undefined;
    if (!acc) return;
    const health = classifyLinkedInStatus(acc.status);
    const prev = prevHealthRef.current;
    prevHealthRef.current = { accountId: acc.id, health };
    if (prev?.accountId !== acc.id) return; // premier passage pour ce compte : pas d'alerte
    if (prev.health === 'connected' && health === 'needs_reconnect') {
      const isCredentials = (acc.status || '').trim().toUpperCase() === 'CREDENTIALS';
      toast.error(`${acc.name || 'Compte LinkedIn'} déconnecté`, {
        description: isCredentials
          ? 'Les identifiants ne sont plus valides. Reconnectez le compte.'
          : 'Le compte ne répond plus. Vérifiez sa configuration.',
        duration: 12000,
        action: {
          label: 'Reconnecter',
          onClick: () => navigate('/settings?tab=account'),
        },
      });
    }
  }, [accounts, myAccountId, navigate]);

  const contextValue = useMemo(() => ({
    accounts,
    loading: !isReady || (loading && !hasLoaded),
    ready: isReady && loadedOk,
    loadError,
    reload,
    clear,
  }), [accounts, isReady, loading, hasLoaded, loadedOk, loadError, reload, clear]);

  return (
    <LinkedInAccountsContext.Provider value={contextValue}>
      {children}
    </LinkedInAccountsContext.Provider>
  );
};
