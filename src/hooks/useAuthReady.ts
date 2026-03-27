import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { clearCorruptedTokens } from '@/lib/authSession';

/**
 * Central auth-readiness hook.
 *
 * Rules (from Supabase docs):
 * 1. Use getSession() for initial hydration
 * 2. Use onAuthStateChange for subsequent updates
 * 3. NEVER call async Supabase methods (getUser, getSession, signOut)
 *    inside onAuthStateChange — it deadlocks the auth state machine
 */
export const useAuthReady = () => {
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let isMounted = true;

    // 1. Initial session restoration
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!isMounted) return;

      if (s?.user) {
        setSession(s);
        setUser(s.user);
      } else if (s && !s.user) {
        // Session exists but no user — corrupted token
        clearCorruptedTokens();
        setSession(null);
        setUser(null);
      }
      setIsReady(true);
    });

    // 2. Subsequent auth events — synchronous only, no async Supabase calls
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return;

      if (nextSession?.user) {
        setSession(nextSession);
        setUser(nextSession.user);
      } else {
        setSession(null);
        setUser(null);
      }
      setIsReady(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { isReady, session, user };
};
