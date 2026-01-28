import { useState, useCallback, useEffect } from 'react';

/**
 * Unipile/LinkedIn API Quota Limits per account per day
 * Based on: https://developer.unipile.com/docs/provider-limits-and-restrictions
 */
export const LINKEDIN_LIMITS = {
  // Profile visits/retrieval: ~1000/day for Recruiter, ~100/day for standard
  PROFILE_VISITS_STANDARD: 100,
  PROFILE_VISITS_RECRUITER: 1000,
  // Search results fetched: 1000/day standard, 2500/day for Recruiter/Sales Nav
  SEARCH_RESULTS_STANDARD: 1000,
  SEARCH_RESULTS_PREMIUM: 2500,
  // Connection requests (invitations): 80-100/day for paid accounts
  INVITATIONS_PAID: 80,
  INVITATIONS_FREE: 5,
  // InMail: 150 credits/month for Recruiter, 30 for Lite
  // Technical daily max ~1000 but limited by monthly credits
  INMAIL_DAILY_RECRUITER: 50, // Conservative daily limit to preserve monthly credits
  INMAIL_DAILY_LITE: 10,
  INMAIL_MONTHLY_RECRUITER: 150,
  INMAIL_MONTHLY_LITE: 30,
  // Messages to connections: ~100/day
  MESSAGES: 100,
  // Other actions (comments, likes, etc.): ~100/day
  OTHER_ACTIONS: 100,
  // Min delay between actions (ms) - random between min and max
  MIN_DELAY_MS: 1000,
  MAX_DELAY_MS: 3000,
} as const;

interface QuotaState {
  searchResultsFetched: number;
  profileVisits: number;
  messagesSent: number;
  invitationsSent: number;
  inmailsSent: number;
  otherActions: number;
  lastReset: string; // ISO date string
}

interface QuotaUsage {
  current: number;
  limit: number;
  remaining: number;
  percentUsed: number;
}

interface UseUnipileQuotaReturn {
  quotas: QuotaState;
  getQuotaUsage: (type: keyof Omit<QuotaState, 'lastReset'>) => QuotaUsage;
  canPerformAction: (type: keyof Omit<QuotaState, 'lastReset'>, count?: number) => boolean;
  recordAction: (type: keyof Omit<QuotaState, 'lastReset'>, count?: number) => void;
  resetQuotas: () => void;
  isNearLimit: (type: keyof Omit<QuotaState, 'lastReset'>) => boolean;
  getRandomDelay: () => number;
  isPremiumAccount: boolean;
  setPremiumAccount: (isPremium: boolean) => void;
}

const STORAGE_KEY = 'unipile_quota_state';

const getInitialState = (): QuotaState => ({
  searchResultsFetched: 0,
  profileVisits: 0,
  messagesSent: 0,
  invitationsSent: 0,
  inmailsSent: 0,
  otherActions: 0,
  lastReset: new Date().toISOString().split('T')[0],
});

const getLimitForType = (type: keyof Omit<QuotaState, 'lastReset'>, isPremium: boolean): number => {
  switch (type) {
    case 'searchResultsFetched':
      return isPremium ? LINKEDIN_LIMITS.SEARCH_RESULTS_PREMIUM : LINKEDIN_LIMITS.SEARCH_RESULTS_STANDARD;
    case 'profileVisits':
      return isPremium ? LINKEDIN_LIMITS.PROFILE_VISITS_RECRUITER : LINKEDIN_LIMITS.PROFILE_VISITS_STANDARD;
    case 'messagesSent':
      return LINKEDIN_LIMITS.MESSAGES;
    case 'invitationsSent':
      return isPremium ? LINKEDIN_LIMITS.INVITATIONS_PAID : LINKEDIN_LIMITS.INVITATIONS_FREE;
    case 'inmailsSent':
      return isPremium ? LINKEDIN_LIMITS.INMAIL_DAILY_RECRUITER : LINKEDIN_LIMITS.INMAIL_DAILY_LITE;
    case 'otherActions':
      return LINKEDIN_LIMITS.OTHER_ACTIONS;
    default:
      return 100;
  }
};

export const useUnipileQuota = (accountId?: string | null): UseUnipileQuotaReturn => {
  const storageKey = accountId ? `${STORAGE_KEY}_${accountId}` : STORAGE_KEY;
  
  const [quotas, setQuotas] = useState<QuotaState>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as QuotaState;
        // Check if we need to reset (new day)
        const today = new Date().toISOString().split('T')[0];
        if (parsed.lastReset !== today) {
          return getInitialState();
        }
        return parsed;
      }
    } catch (e) {
      console.error('Error loading quota state:', e);
    }
    return getInitialState();
  });
  
  const [isPremiumAccount, setPremiumAccount] = useState(false);

  // Persist to localStorage whenever quotas change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(quotas));
    } catch (e) {
      console.error('Error saving quota state:', e);
    }
  }, [quotas, storageKey]);

  // Check for day reset
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    if (quotas.lastReset !== today) {
      setQuotas(getInitialState());
    }
  }, [quotas.lastReset]);

  const getQuotaUsage = useCallback((type: keyof Omit<QuotaState, 'lastReset'>): QuotaUsage => {
    const current = quotas[type];
    const limit = getLimitForType(type, isPremiumAccount);
    const remaining = Math.max(0, limit - current);
    const percentUsed = Math.min(100, (current / limit) * 100);
    
    return { current, limit, remaining, percentUsed };
  }, [quotas, isPremiumAccount]);

  const canPerformAction = useCallback((type: keyof Omit<QuotaState, 'lastReset'>, count = 1): boolean => {
    const { remaining } = getQuotaUsage(type);
    return remaining >= count;
  }, [getQuotaUsage]);

  const recordAction = useCallback((type: keyof Omit<QuotaState, 'lastReset'>, count = 1) => {
    setQuotas(prev => ({
      ...prev,
      [type]: prev[type] + count,
    }));
  }, []);

  const resetQuotas = useCallback(() => {
    setQuotas(getInitialState());
  }, []);

  const isNearLimit = useCallback((type: keyof Omit<QuotaState, 'lastReset'>): boolean => {
    const { percentUsed } = getQuotaUsage(type);
    return percentUsed >= 80;
  }, [getQuotaUsage]);

  const getRandomDelay = useCallback((): number => {
    return Math.floor(
      Math.random() * (LINKEDIN_LIMITS.MAX_DELAY_MS - LINKEDIN_LIMITS.MIN_DELAY_MS) 
      + LINKEDIN_LIMITS.MIN_DELAY_MS
    );
  }, []);

  return {
    quotas,
    getQuotaUsage,
    canPerformAction,
    recordAction,
    resetQuotas,
    isNearLimit,
    getRandomDelay,
    isPremiumAccount,
    setPremiumAccount,
  };
};
