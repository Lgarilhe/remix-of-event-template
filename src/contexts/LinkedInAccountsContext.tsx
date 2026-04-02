import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useAuthReady } from '@/hooks/useAuthReady';

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
  reload: () => Promise<void>;
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

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction('unipile-accounts', { action: 'list' });
      if (error || !data?.success) {
        setAccounts([]);
        return;
      }
      setAccounts((data as any).accounts || []);
    } catch (e) {
      console.error('Failed to load LinkedIn accounts:', e);
      setAccounts([]);
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
