import type { ReactNode } from 'react';
import { Link, type To } from 'react-router-dom';
import { KonektLogo } from '@/components/KonektLogo';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { cn } from '@/lib/utils';
import { PUBLIC_WIDTH, type PublicWidth } from './layout';

interface PublicHeaderProps {
  /** Destination du logo (défaut : l'accueil). */
  homeTo?: To;
  /** Nom du lien du logo, lu par les lecteurs d'écran. */
  homeLabel?: string;
  /** Actions à droite : connexion, retour à l'application, autre page légale. */
  actions?: ReactNode;
  width?: PublicWidth;
  className?: string;
}

/**
 * En-tête commun des pages publiques (connexion, tarifs, pages légales,
 * profil public) : le logo, qui suit le thème, et une ou deux actions.
 */
export function PublicHeader({ homeTo, homeLabel = 'Konekt, accueil', actions, width = 'default', className }: PublicHeaderProps) {
  return (
    <header className={cn('border-b border-border bg-background', className)}>
      <div className={cn('mx-auto flex h-14 items-center justify-between gap-4 px-4 sm:px-6', PUBLIC_WIDTH[width])}>
        <Link
          to={homeTo ?? withPreviewAccessToken('/')}
          aria-label={homeLabel}
          className="-mx-1 inline-flex min-h-11 items-center rounded-md px-1 md:min-h-0"
        >
          <KonektLogo theme="auto" size={24} ariaLabel="" />
        </Link>
        {actions && <div className="flex min-w-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
