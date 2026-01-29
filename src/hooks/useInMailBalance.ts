import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface InMailBalance {
  premium: number | null;
  recruiter: number | null;
  sales_navigator: number | null;
}

interface UseInMailBalanceReturn {
  balance: InMailBalance | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  hasCredits: (type: 'premium' | 'recruiter' | 'sales_navigator', count?: number) => boolean;
  getCredits: (type: 'premium' | 'recruiter' | 'sales_navigator') => number;
}

export const useInMailBalance = (accountId: string | null): UseInMailBalanceReturn => {
  const [balance, setBalance] = useState<InMailBalance | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    if (!accountId) {
      setBalance(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('unipile-accounts', {
        body: { action: 'inmail_balance', account_id: accountId },
      });

      if (fnError) throw fnError;

      if (!data?.success) {
        throw new Error(data?.error || 'Erreur lors de la récupération du solde');
      }

      setBalance(data.balance);
    } catch (err) {
      console.error('Error fetching InMail balance:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
      setBalance(null);
    } finally {
      setIsLoading(false);
    }
  }, [accountId]);

  // Fetch on mount and when accountId changes
  useEffect(() => {
    if (accountId) {
      fetchBalance();
    }
  }, [accountId, fetchBalance]);

  const getCredits = useCallback((type: 'premium' | 'recruiter' | 'sales_navigator'): number => {
    if (!balance) return 0;
    return balance[type] ?? 0;
  }, [balance]);

  const hasCredits = useCallback((
    type: 'premium' | 'recruiter' | 'sales_navigator', 
    count = 1
  ): boolean => {
    return getCredits(type) >= count;
  }, [getCredits]);

  return {
    balance,
    isLoading,
    error,
    refetch: fetchBalance,
    hasCredits,
    getCredits,
  };
};
