import { Navigate, useLocation } from 'react-router-dom';
import { useAuthReady } from '@/hooks/useAuthReady';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { EXTENSION_REVEAL_STORAGE_KEY } from '@/lib/settingsRoutes';

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isReady, session } = useAuthReady();
  const location = useLocation();

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    // Le détour par /auth perd le hash : #extension (page de confidentialité de
    // l'extension) passe par le mémo de session que lit Connexions au retour.
    if (location.hash === '#extension') {
      try { sessionStorage.setItem(EXTENSION_REVEAL_STORAGE_KEY, '1'); } catch { /* stockage indisponible */ }
    }
    return <Navigate to={withPreviewAccessToken('/auth')} state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
};
