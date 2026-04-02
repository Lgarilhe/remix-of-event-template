import { useSyncExternalStore } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { getValidatedSession } from '@/lib/authSession';

/**
 * Central auth-readiness hook.
 *
 * Rules (from Supabase docs):
 * 1. Use getSession() for initial hydration
 * 2. Use onAuthStateChange for subsequent updates
 * 3. NEVER call async Supabase methods (getUser, getSession, signOut)
 *    inside onAuthStateChange — it deadlocks the auth state machine
 */
type AuthReadyState = {
  isReady: boolean;
  session: Session | null;
  user: User | null;
};

const initialAuthState: AuthReadyState = {
  isReady: false,
  session: null,
  user: null,
};

let authState: AuthReadyState = initialAuthState;
let authInitialized = false;
const listeners = new Set<() => void>();

const emitAuthChange = () => {
  listeners.forEach((listener) => listener());
};

const setAuthState = (nextState: AuthReadyState) => {
  const hasChanged =
    authState.isReady !== nextState.isReady ||
    authState.session?.access_token !== nextState.session?.access_token ||
    authState.user?.id !== nextState.user?.id;

  authState = nextState;

  if (hasChanged) {
    emitAuthChange();
  }
};

const initializeAuthReady = () => {
  if (authInitialized) return;
  authInitialized = true;

  // 1. Initial session restoration — validate token integrity once globally
  void getValidatedSession()
    .then(({ session, user }) => {
      setAuthState({
        isReady: true,
        session,
        user,
      });
    })
    .catch(() => {
      setAuthState({
        isReady: true,
        session: null,
        user: null,
      });
    });

  // 2. Subsequent auth events — synchronous only, no async Supabase calls
  supabase.auth.onAuthStateChange((_event, nextSession) => {
    if (nextSession?.user) {
      setAuthState({
        isReady: true,
        session: nextSession,
        user: nextSession.user,
      });
      return;
    }

    setAuthState({
      isReady: true,
      session: null,
      user: null,
    });
  });
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  initializeAuthReady();

  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => authState;

export const useAuthReady = () => {
  return useSyncExternalStore(subscribe, getSnapshot, () => initialAuthState);
};
