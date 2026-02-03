import { useState, useCallback, useEffect } from 'react';

/**
 * LinkedIn API modes
 */
export type LinkedInApiMode = 'classic' | 'recruiter' | 'sales_navigator';

/**
 * Unipile/LinkedIn API Quota Limits per account per day
 * Based on: https://developer.unipile.com/docs/provider-limits-and-restrictions
 * 
 * Limits vary by subscription type:
 * - Classic: Basic LinkedIn limits
 * - Recruiter: Higher limits for recruiting activities
 * - Sales Navigator: Higher limits for sales activities
 */
export const LINKEDIN_LIMITS = {
  // Profile visits/retrieval per day
  PROFILE_VISITS: {
    classic: 100,
    recruiter: 1000,
    sales_navigator: 500,
  },
  // Search results fetched per day
  SEARCH_RESULTS: {
    classic: 3000,
    recruiter: 3000,
    sales_navigator: 3000,
  },
  // Connection requests (invitations) per day
  INVITATIONS: {
    classic: 5,
    recruiter: 100,
    sales_navigator: 80,
  },
  // InMail daily limits
  // Recruiter: 1000/day technical limit (but 150 credits/month, 200 first week)
  // Sales Nav: 50/month credits
  INMAIL_DAILY: {
    classic: 0,
    recruiter: 1000,
    sales_navigator: 50,
  },
  // InMail monthly credits (for tracking)
  INMAIL_MONTHLY: {
    classic: 0,
    recruiter: 150,
    sales_navigator: 50,
  },
  // Open Profile messages per month (Recruiter)
  OPEN_PROFILE_MONTHLY: {
    classic: 0,
    recruiter: 1000,
    sales_navigator: 0,
  },
  // Messages to connections per day
  MESSAGES: {
    classic: 100,
    recruiter: 150,
    sales_navigator: 150,
  },
  // Other actions (comments, likes, etc.) per day
  OTHER_ACTIONS: {
    classic: 100,
    recruiter: 150,
    sales_navigator: 150,
  },
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
  apiMode: LinkedInApiMode;
  setApiMode: (mode: LinkedInApiMode) => void;
  getLimitForType: (type: keyof Omit<QuotaState, 'lastReset'>) => number;
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

const getLimitForApiMode = (type: keyof Omit<QuotaState, 'lastReset'>, apiMode: LinkedInApiMode): number => {
  switch (type) {
    case 'searchResultsFetched':
      return LINKEDIN_LIMITS.SEARCH_RESULTS[apiMode];
    case 'profileVisits':
      return LINKEDIN_LIMITS.PROFILE_VISITS[apiMode];
    case 'messagesSent':
      return LINKEDIN_LIMITS.MESSAGES[apiMode];
    case 'invitationsSent':
      return LINKEDIN_LIMITS.INVITATIONS[apiMode];
    case 'inmailsSent':
      return LINKEDIN_LIMITS.INMAIL_DAILY[apiMode];
    case 'otherActions':
      return LINKEDIN_LIMITS.OTHER_ACTIONS[apiMode];
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
  
  const [apiMode, setApiMode] = useState<LinkedInApiMode>('classic');

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

  const getLimitForType = useCallback((type: keyof Omit<QuotaState, 'lastReset'>): number => {
    return getLimitForApiMode(type, apiMode);
  }, [apiMode]);

  const getQuotaUsage = useCallback((type: keyof Omit<QuotaState, 'lastReset'>): QuotaUsage => {
    const current = quotas[type];
    const limit = getLimitForType(type);
    const remaining = Math.max(0, limit - current);
    const percentUsed = Math.min(100, (current / limit) * 100);
    
    return { current, limit, remaining, percentUsed };
  }, [quotas, getLimitForType]);

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
    apiMode,
    setApiMode,
    getLimitForType,
  };
};
