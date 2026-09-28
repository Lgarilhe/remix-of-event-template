import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Link2Off, RefreshCw, SearchX, WifiOff, type LucideIcon } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { KonektLogo } from '@/components/KonektLogo';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/IconTile';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { cn } from '@/lib/utils';

/**
 * Nature de l'impasse :
 * - link : lien invalide ou expiré (rien à réessayer, il faut un nouveau lien) ;
 * - missing : la page demandée n'existe pas ou n'est plus publique ;
 * - network : le service n'a pas répondu (réessayer peut suffire).
 */
export type PublicDeadEndKind = 'link' | 'missing' | 'network';

const ICONS: Record<PublicDeadEndKind, LucideIcon> = {
  link: Link2Off,
  missing: SearchX,
  network: WifiOff,
};

interface PublicDeadEndProps {
  kind: PublicDeadEndKind;
  title: string;
  description: ReactNode;
  /** Nouvelle tentative (erreurs de connexion). */
  onRetry?: () => void;
  retrying?: boolean;
  /** Action secondaire (lien vers l'accueil…). */
  action?: ReactNode;
  seo?: { title: string; description: string };
}

/**
 * Écran d'impasse unique des pages publiques (portails, profil public,
 * désinscription) : la marque, un titre, une phrase, une action. Un lien
 * expiré et un problème de connexion ne se ressemblent pas : le second est une
 * erreur, avec « Réessayer ».
 */
export function PublicDeadEnd({ kind, title, description, onRetry, retrying = false, action, seo }: PublicDeadEndProps) {
  const isError = kind === 'network';
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {seo && <SEOHead title={seo.title} description={seo.description} />}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <Link
          to={withPreviewAccessToken('/')}
          aria-label="Konekt, accueil"
          className="mb-8 inline-flex min-h-11 items-center rounded-md px-1 md:min-h-0"
        >
          <KonektLogo theme="auto" size={24} ariaLabel="" />
        </Link>
        <div
          role={isError ? 'alert' : undefined}
          className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center sm:p-8"
        >
          <IconTile icon={ICONS[kind]} tone={isError ? 'destructive' : 'default'} size="lg" className="mx-auto mb-4" />
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          {(onRetry || action) && (
            <div className="mt-6 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
              {onRetry && (
                <Button variant="primary" onClick={onRetry} disabled={retrying} className="max-md:h-11">
                  <RefreshCw className={cn(retrying && 'animate-spin')} aria-hidden="true" />
                  {retrying ? 'Nouvelle tentative…' : 'Réessayer'}
                </Button>
              )}
              {action}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
