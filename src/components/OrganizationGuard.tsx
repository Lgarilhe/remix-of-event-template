import { Navigate } from 'react-router-dom';
import { useOrganization } from '@/hooks/useOrganization';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { LowCreditBanner } from './ai/LowCreditBanner';

export const OrganizationGuard = ({ children }: { children: React.ReactNode }) => {
  const { isLoading, needsOnboarding } = useOrganization();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (needsOnboarding) {
    return <Navigate to={withPreviewAccessToken('/onboarding')} replace />;
  }

  return (
    <>
      <LowCreditBanner />
      {children}
    </>
  );
};
