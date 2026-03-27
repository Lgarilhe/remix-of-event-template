import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Pages that don't require authentication
const PUBLIC_ROUTES = ['/', '/auth', '/discover', '/event', '/jobs'];

export const useAuthGuard = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Initial session check — safe to call async outside onAuthStateChange
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session?.user);
      setIsLoading(false);
    });

    // Subsequent events — NO async Supabase calls inside callback
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        setIsAuthenticated(false);
        
        const isPublicRoute = PUBLIC_ROUTES.some(route => 
          location.pathname === route || location.pathname.startsWith(route + '/')
        );
        
        if (!isPublicRoute) {
          toast.error('Session expirée', {
            description: 'Veuillez vous reconnecter pour continuer.',
            duration: 5000,
          });
          navigate('/auth', { 
            state: { from: location.pathname, sessionExpired: true } 
          });
        }
      } else if (session?.user) {
        setIsAuthenticated(true);
      }
      
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [navigate, location.pathname]);

  return { isAuthenticated, isLoading };
};
