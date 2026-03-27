import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { getValidatedSession } from '@/lib/authSession';

export const useAuthReady = () => {
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let isMounted = true;

    const syncSession = async (nextSession?: Session | null) => {
      if (!isMounted) return;

      if (!nextSession?.access_token) {
        setSession(null);
        setUser(null);
        setIsReady(true);
        return;
      }

      const validated = await getValidatedSession();
      if (!isMounted) return;

      setSession(validated.session);
      setUser(validated.user);
      setIsReady(true);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncSession(nextSession ?? null);
    });

    void getValidatedSession().then((validated) => {
      if (!isMounted) return;
      setSession(validated.session);
      setUser(validated.user);
      setIsReady(true);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { isReady, session, user };
};