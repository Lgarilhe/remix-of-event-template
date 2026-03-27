import { Navigate, useLocation } from 'react-router-dom';
import { useAuthReady } from '@/hooks/useAuthReady';

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isReady, session } = useAuthReady();
  const location = useLocation();

  if (!isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
};
