import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { SEOHead } from '@/components/SEOHead';
import { KonektLogo } from '@/components/KonektLogo';
import { Button } from '@/components/ui/button';
import { withPreviewAccessToken } from '@/lib/previewToken';

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV) console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <SEOHead
        title="Page introuvable | Konekt"
        description="La page que vous cherchez n'existe pas."
      />
      <div className="w-full max-w-sm text-center">
        <KonektLogo variant="full" theme="auto" size={28} className="mx-auto mb-8" />
        <p className="eyebrow">Erreur 404</p>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Cette page n'existe pas</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Le lien est peut-être ancien, ou la page a changé d'adresse.
        </p>
        <div className="mt-6 flex justify-center">
          <Button asChild variant="primary">
            <Link to={withPreviewAccessToken('/dashboard')}>Retour au tableau de bord</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
