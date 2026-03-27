import { supabase } from '@/integrations/supabase/client';

const AUTH_VALIDATION_TIMEOUT_MS = 4000;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs = AUTH_VALIDATION_TIMEOUT_MS): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('AUTH_VALIDATION_TIMEOUT')), timeoutMs);
    }),
  ]);
};

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

  if (!session.user?.id) {
    clearCorruptedTokens();
    supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    return { session: null, user: null };
  }

  try {
    const {
      data: { user },
      error,
    } = await withTimeout(supabase.auth.getUser());

    if (error || !user) {
      clearCorruptedTokens();
      supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      return { session: null, user: null };
    }

    return { session, user };
  } catch {
    // Token is corrupted or validation is hanging — purge synchronously,
    // then sign out in background to unblock the UI.
    clearCorruptedTokens();
    supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    return { session: null, user: null };
  }
};
