import { Navigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { LowCreditBanner } from './ai/LowCreditBanner';
import { TrialBanner } from './billing/TrialBanner';

export const OrganizationGuard = ({ children }: { children: React.ReactNode }) => {
  const { isLoading, isError, organization, needsOnboarding, refetchOrganization, isRefetchingOrganization } = useOrganization();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border border-border border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  // F3 : erreur de chargement de l'espace (réseau, 5xx, jeton expiré) SANS
  // donnée en cache → on n'envoie jamais l'utilisateur vers /onboarding
  // (risque de création d'un espace doublon). `!organization` évite d'éjecter
  // un utilisateur dont l'org est déjà chargée quand une refetch en arrière-plan échoue.
  if (isError && !organization) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full border border-destructive/30 bg-destructive/5 p-6 text-center">
          <AlertTriangle className="w-5 h-5 text-destructive mx-auto mb-2" />
          <p className="text-xs font-bold uppercase tracking-wider text-foreground mb-1">
            Impossible de charger votre espace de travail
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            Vérifiez votre connexion, puis réessayez.
          </p>
          <button
            type="button"
            disabled={isRefetchingOrganization}
            onClick={() => { void refetchOrganization(); }}
            className="relative overflow-hidden inline-flex items-center gap-1.5 h-8 px-4 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground disabled:opacity-60"
          >
            <RefreshCw className={isRefetchingOrganization ? 'w-3 h-3 animate-spin' : 'w-3 h-3'} />
            <span>{isRefetchingOrganization ? 'Nouvelle tentative…' : 'Réessayer'}</span>
          </button>
        </div>
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
        <TrialBanner />
      </div>
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </>
  );
};
