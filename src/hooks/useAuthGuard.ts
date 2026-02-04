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
    // Set up auth state listener BEFORE checking session
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[AuthGuard] Auth event:', event);
      
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' && !session) {
        setIsAuthenticated(false);
        
        // Check if current route requires auth
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
      } else if (session) {
        setIsAuthenticated(true);
      }
      
      setIsLoading(false);
    });

    // Check initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.error('[AuthGuard] Session error:', error);
        setIsAuthenticated(false);
        
        const isPublicRoute = PUBLIC_ROUTES.some(route => 
          location.pathname === route || location.pathname.startsWith(route + '/')
        );
        
        if (!isPublicRoute) {
          toast.error('Erreur de session', {
            description: 'Veuillez vous reconnecter.',
            duration: 5000,
          });
          navigate('/auth', { 
            state: { from: location.pathname, sessionExpired: true } 
          });
        }
      } else {
        setIsAuthenticated(!!session);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [navigate, location.pathname]);

  return { isAuthenticated, isLoading };
};
