import { supabase } from '@/integrations/supabase/client';

/**
 * Synchronously purge all Supabase auth tokens from localStorage.
 * Does NOT call supabase.auth.signOut() to avoid triggering
 * onAuthStateChange re-entrancy / deadlocks.
 */
export const clearCorruptedTokens = () => {
  if (typeof window === 'undefined') return;
  Object.keys(window.localStorage)
    .filter((key) => key.startsWith('sb-'))
    .forEach((key) => window.localStorage.removeItem(key));
};

/**
 * Validate the current session by calling getUser() (network round-trip).
 * IMPORTANT: NEVER call this from inside an onAuthStateChange callback —
 * it will deadlock the Supabase auth state machine.
 *
 * Returns { session, user } if valid, or { session: null, user: null }
 * and clears corrupted tokens if the JWT is bad.
 */
export const getValidatedSession = async () => {
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
    // Token is corrupted — purge synchronously, then sign out in background
    clearCorruptedTokens();
    supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    return { session: null, user: null };
  }

  return { session, user };
};
