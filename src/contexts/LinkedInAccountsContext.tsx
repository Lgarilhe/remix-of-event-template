import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';

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

  // Load accounts once user is authenticated
  useEffect(() => {
    let prevUserId: string | null = null;

    const checkAndLoad = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        prevUserId = session.user.id;
        reload();
      }
    };
    checkAndLoad();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        // If user changed, clear stale accounts first
        if (prevUserId && prevUserId !== session.user.id) {
          setAccounts([]);
          setHasLoaded(false);
        }
        prevUserId = session.user.id;
        reload();
      } else if (event === 'SIGNED_OUT') {
        prevUserId = null;
        setAccounts([]);
        setHasLoaded(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [reload]);

  const contextValue = useMemo(() => ({
    accounts,
    loading: loading && !hasLoaded,
    reload,
    clear,
  }), [accounts, loading, hasLoaded, reload, clear]);

  return (
    <LinkedInAccountsContext.Provider value={contextValue}>
      {children}
    </LinkedInAccountsContext.Provider>
  );
};
