import { Navigate } from 'react-router-dom';
import { useOrganization } from '@/hooks/useOrganization';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { LowCreditBanner } from './ai/LowCreditBanner';

export const OrganizationGuard = ({ children }: { children: React.ReactNode }) => {
  const { isLoading, needsOnboarding } = useOrganization();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (needsOnboarding) {
    return <Navigate to={withPreviewAccessToken('/onboarding')} replace />;
  }

  // FIX layout (BUG zone de saisie inbox invisible — 2026-04-28) :
  // Le LowCreditBanner (~40px) et children sont rendus dans <main> qui est un
  // flex container (cf AppLayout). Le banner garde sa hauteur intrinsèque
  // (shrink-0) et children prend le reste avec flex-1 + min-h-0 pour pouvoir
  // imbriquer des layouts h-full sans déborder.
  return (
    <>
      <div className="shrink-0">
        <LowCreditBanner />
      </div>
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </>
  );
};
