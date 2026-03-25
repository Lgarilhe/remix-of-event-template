import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { SEOHead } from '@/components/SEOHead';

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV) console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <SEOHead
        title="404 — Page introuvable | Skalr"
        description="La page que vous cherchez n'existe pas."
      />
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold text-foreground uppercase tracking-wider">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Page introuvable</p>
        <a href="/" className="text-foreground underline hover:opacity-70 transition-opacity text-sm uppercase tracking-wider">
          Retour à l'accueil
        </a>
      </div>
    </div>
  );
};

export default NotFound;
