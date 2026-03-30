import { useState, useCallback, useEffect } from 'react';
import { onQuotaAction } from '@/lib/quotaEvents';

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
/**
 * SAFE MODE LinkedIn quotas — conservative limits to protect accounts.
 * These are intentionally LOWER than Unipile's technical limits.
 * LinkedIn detects automation and bans accounts with high-volume activity.
 */
export const LINKEDIN_LIMITS = {
  // Profile visits/retrieval per day
  PROFILE_VISITS: {
    classic: 80,
    recruiter: 250,
    sales_navigator: 200,
  },
  // Search results fetched per day
  SEARCH_RESULTS: {
    classic: 999999,
    recruiter: 999999,
    sales_navigator: 999999,
  },
  // Connection requests (invitations) per day — SAFE MODE: max 20
  INVITATIONS: {
    classic: 5,
    recruiter: 20,
    sales_navigator: 20,
  },
  // InMail daily limits — SAFE MODE: conservative
  INMAIL_DAILY: {
    classic: 0,
    recruiter: 30,
    sales_navigator: 15,
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
  // Messages to connections per day — SAFE MODE: max 50
  MESSAGES: {
    classic: 40,
    recruiter: 50,
    sales_navigator: 50,
  },
  // Other actions (comments, likes, etc.) per day
  OTHER_ACTIONS: {
    classic: 50,
    recruiter: 80,
    sales_navigator: 80,
  },
  // Min delay between actions (ms) — SAFE MODE: 45-90 seconds
  // Simulates human behavior. LinkedIn detects sub-10s action patterns.
  MIN_DELAY_MS: 45000,
  MAX_DELAY_MS: 90000,
} as const;

/**
 * Warm-up schedule: new accounts start with low quotas and ramp up over 2 weeks.
 * Returns a multiplier (0.0 to 1.0) based on account age in days.
 */
export function getWarmupMultiplier(accountConnectedDays: number): number {
  if (accountConnectedDays <= 0) return 0.1;
  if (accountConnectedDays <= 2) return 0.15;  // Day 1-2: ~15% of limits
  if (accountConnectedDays <= 4) return 0.25;  // Day 3-4: ~25%
  if (accountConnectedDays <= 7) return 0.4;   // Day 5-7: ~40%
  if (accountConnectedDays <= 10) return 0.6;  // Day 8-10: ~60%
  if (accountConnectedDays <= 14) return 0.8;  // Day 11-14: ~80%
  return 1.0;                                   // Day 15+: full limits
}

/**
 * Cool-down: if a LinkedIn account received a warning, block all automation
 * for 48 hours. Returns true if the account is in cool-down.
 */
export function isInCooldown(lastWarningAt: string | null): boolean {
  if (!lastWarningAt) return false;
  const warningTime = new Date(lastWarningAt).getTime();
  const cooldownMs = 48 * 60 * 60 * 1000; // 48 hours
  return Date.now() - warningTime < cooldownMs;
}

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

  // Listen for global quota events from other parts of the app
  useEffect(() => {
    return onQuotaAction((event) => {
      // Only handle events for this account (or events without a specific account)
      if (event.accountId && accountId && event.accountId !== accountId) return;
      setQuotas(prev => ({
        ...prev,
        [event.type]: prev[event.type] + event.count,
      }));
    });
  }, [accountId]);

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
