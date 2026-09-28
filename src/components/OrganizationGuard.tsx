import { Navigate } from 'react-router-dom';
import { useOrganization } from '@/hooks/useOrganization';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { Spinner } from '@/components/ui/spinner';
import { ErrorState } from '@/components/layout/ErrorState';

export const OrganizationGuard = ({ children }: { children: React.ReactNode }) => {
  const { isLoading, isError, organization, needsOnboarding, refetchOrganization, isRefetchingOrganization } = useOrganization();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Chargement de votre espace" />
      </div>
    );
  }

  // F3 : erreur de chargement de l'espace (réseau, 5xx, jeton expiré) SANS
  // donnée en cache → on n'envoie jamais l'utilisateur vers /onboarding
  // (risque de création d'un espace doublon). `!organization` évite d'éjecter
  // un utilisateur dont l'org est déjà chargée quand une refetch en arrière-plan échoue.
  if (isError && !organization) {
    return (
      <ErrorState
        variant="page"
        title="Impossible de charger votre espace de travail"
        description="Vérifiez votre connexion, puis réessayez."
        onRetry={() => { void refetchOrganization(); }}
        retrying={isRefetchingOrganization}
      />
    );
  }

  if (needsOnboarding) {
    return <Navigate to={withPreviewAccessToken('/onboarding')} replace />;
  }

  // Les bandeaux d'essai et de crédits IA sont rendus par AppLayout, dans la
  // zone principale : ici, au-dessus du gabarit, la barre latérale fixe en
  // masquait le début (dont « Essai : N jours restants »).
  return <>{children}</>;
};
