import { supabase } from '@/integrations/supabase/client';

const AUTH_VALIDATION_TIMEOUT_MS = 4000;
let isInvalidatingLocalSession = false;

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

const isTransientValidationError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  return (
    lower.includes('auth_validation_timeout') ||
    lower.includes('timeout') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('fetch') ||
    lower.includes('abort') ||
    lower.includes('signal')
  );
};

const isDefinitiveInvalidSessionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  return (
    lower.includes('jwt') ||
    lower.includes('missing sub claim') ||
    lower.includes('invalid claim') ||
    lower.includes('invalid token') ||
    lower.includes('token has expired') ||
    lower.includes('refresh token') ||
    lower.includes('session missing') ||
    lower.includes('session_not_found') ||
    lower.includes('user from sub claim in jwt does not exist') ||
    (lower.includes('401') && !isTransientValidationError(error))
  );
};

const invalidateLocalSession = () => {
  if (isInvalidatingLocalSession) return;

  isInvalidatingLocalSession = true;
  clearCorruptedTokens();
  supabase.auth
    .signOut({ scope: 'local' })
    .catch(() => {})
    .finally(() => {
      isInvalidatingLocalSession = false;
    });
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
    invalidateLocalSession();
    return { session: null, user: null };
  }

  try {
    const {
      data: { user },
      error,
    } = await withTimeout(supabase.auth.getUser());

    if (error) {
      if (isDefinitiveInvalidSessionError(error)) {
        invalidateLocalSession();
        return { session: null, user: null };
      }

      return { session, user: session.user };
    }

    if (!user) {
      invalidateLocalSession();
      return { session: null, user: null };
    }

    return { session, user };
  } catch (error) {
    // Network hiccup or auth endpoint timeout: keep the local session instead
    // of force-signing the user out. Only purge when the token is definitively invalid.
    if (isDefinitiveInvalidSessionError(error)) {
      invalidateLocalSession();
      return { session: null, user: null };
    }

    return { session, user: session.user };
  }
};
