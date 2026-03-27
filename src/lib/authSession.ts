import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const INVALID_SESSION_PATTERNS = [
  'missing sub claim',
  'invalid claim',
  'bad_jwt',
  'jwt',
];

const isInvalidSessionError = (message?: string | null) => {
  const normalized = message?.toLowerCase() ?? '';
  return INVALID_SESSION_PATTERNS.some((pattern) => normalized.includes(pattern));
};

export const clearLocalAuthSession = async () => {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Ignore sign out failures for corrupted local sessions.
  }

  if (typeof window === 'undefined') return;

  Object.keys(window.localStorage)
    .filter((key) => key.startsWith('sb-'))
    .forEach((key) => window.localStorage.removeItem(key));
};

export const getValidatedSession = async (): Promise<{ session: Session | null; user: User | null }> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return { session: null, user: null };
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    if (isInvalidSessionError(error?.message)) {
      await clearLocalAuthSession();
    }

    return { session: null, user: null };
  }

  return { session, user };
};