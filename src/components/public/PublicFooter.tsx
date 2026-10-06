import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { KonektLogo } from '@/components/KonektLogo';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { cn } from '@/lib/utils';
import { PUBLIC_WIDTH, type PublicWidth } from './layout';

/** Lien du pied de page public : même style partout, cible de 44 px sur téléphone. */
export const publicFooterLinkClass =
  'inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground md:min-h-0';

const LINKS: { label: string; pathname: string; hash?: string }[] = [
  { label: 'Tarifs', pathname: '/pricing' },
  { label: 'Confidentialité', pathname: '/privacy' },
  { label: 'Mentions légales', pathname: '/privacy', hash: '#mentions-legales' },
];

interface PublicFooterProps {
  width?: PublicWidth;
  /** Liens propres à la page (éléments de liste), placés avant les liens légaux. */
  extra?: ReactNode;
  className?: string;
}

/** Pied de page commun des pages publiques : tarifs et liens légaux. */
export function PublicFooter({ width = 'default', extra, className }: PublicFooterProps) {
  const location = useLocation();
  return (
    <footer className={cn('border-t border-border bg-background', className)}>
      <div
        className={cn(
          'mx-auto flex flex-col gap-2 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6',
          PUBLIC_WIDTH[width],
        )}
      >
        <nav aria-label="Informations">
          <ul className="flex flex-wrap items-center gap-x-5">
            {extra}
            {LINKS.map((link) => {
              const current = location.pathname === link.pathname && (location.hash || '') === (link.hash || '');
              return (
                <li key={link.label}>
                  <Link
                    to={withPreviewAccessToken(link.pathname, '', link.hash)}
                    aria-current={current ? 'page' : undefined}
                    className={publicFooterLinkClass}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Konekt</p>
      </div>
    </footer>
  );
}

/** Signature des portails (candidat, client) : « Portail propulsé par Konekt ». */
export function PoweredByKonekt({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-center justify-center gap-1.5 text-xs text-muted-foreground', className)}>
      Portail propulsé par
      <KonektLogo theme="auto" size={14} ariaLabel="Konekt" />
    </p>
  );
}
