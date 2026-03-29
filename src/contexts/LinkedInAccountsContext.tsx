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

  useEffect(() => {
    let isMounted = true;
    let prevUserId: string | null = null;

    const resetState = () => {
      if (!isMounted) return;
      prevUserId = null;
      setAccounts([]);
      setHasLoaded(false);
      setLoading(false);
    };

    // Initial check — safe to call async here (not inside onAuthStateChange)
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!isMounted) return;
        if (!session?.user) {
          resetState();
          return;
        }
        prevUserId = session.user.id;
        void reload();
      })
      .catch((error) => {
        console.warn('[LinkedInAccountsContext] Initial session check failed:', error);
        resetState();
      });

    // Subsequent auth events — NO async Supabase calls inside callback
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;

      if (event === 'SIGNED_OUT' || !session?.user) {
        resetState();
        return;
      }

      const newUserId = session.user.id;
      if (prevUserId && prevUserId !== newUserId) {
        setAccounts([]);
        setHasLoaded(false);
      }
      prevUserId = newUserId;

      // reload() calls an edge function, not a Supabase auth method — safe
      void reload();
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
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
