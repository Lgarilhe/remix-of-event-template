import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { Session } from '@supabase/supabase-js';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import { getValidatedSession } from '@/lib/authSession';

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
    let isMounted = true;
    let prevUserId: string | null = null;

    const resetState = () => {
      if (!isMounted) return;
      prevUserId = null;
      setAccounts([]);
      setHasLoaded(false);
      setLoading(false);
    };

    const syncAccounts = async (nextSession?: Session | null) => {
      if (!nextSession?.access_token) {
        resetState();
        return;
      }

      const { session, user } = await getValidatedSession();
      if (!isMounted || !session?.access_token || !user) {
        resetState();
        return;
      }

      if (prevUserId && prevUserId !== user.id) {
        setAccounts([]);
        setHasLoaded(false);
      }

      prevUserId = user.id;
      await reload();
    };

    void getValidatedSession().then(({ session, user }) => {
      if (!isMounted || !session?.access_token || !user) {
        resetState();
        return;
      }

      prevUserId = user.id;
      void reload();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        resetState();
        return;
      }

      void syncAccounts(session ?? null);
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
