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
}

const LinkedInAccountsContext = createContext<LinkedInAccountsContextType>({
  accounts: [],
  loading: false,
  reload: async () => {},
});

export const useLinkedInAccounts = () => useContext(LinkedInAccountsContext);

export const LinkedInAccountsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [accounts, setAccounts] = useState<LinkedInAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await invokeEdgeFunction('unipile-accounts', { action: 'list' });
      if (data?.success) {
        setAccounts((data as any).accounts || []);
      }
    } catch (e) {
      console.error('Failed to load LinkedIn accounts:', e);
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, []);

  // Load accounts once user is authenticated
  useEffect(() => {
    const checkAndLoad = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        reload();
      }
    };
    checkAndLoad();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        reload();
      } else if (event === 'SIGNED_OUT') {
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
  }), [accounts, loading, hasLoaded, reload]);

  return (
    <LinkedInAccountsContext.Provider value={contextValue}>
      {children}
    </LinkedInAccountsContext.Provider>
  );
};
