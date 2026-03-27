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

    // 1. Initial session restoration — validate token integrity
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (!isMounted) return;

      if (s?.user) {
        // Verify the token is actually valid via network call
        const { data: { user }, error } = await supabase.auth.getUser();
        if (!isMounted) return;
        if (user && !error) {
          setSession(s);
          setUser(user);
        } else {
          // Corrupted token
          clearCorruptedTokens();
          setSession(null);
          setUser(null);
        }
      } else if (s && !s.user) {
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
