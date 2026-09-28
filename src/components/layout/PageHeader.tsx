/**
 * PageHeader : en-tête de page commun (docs/design/01-direction.md).
 *
 * - titre h1 en 20 px, graisse 600 ;
 * - méta optionnelle à droite du titre (compteur, statut) ;
 * - sous-titre en texte secondaire ;
 * - actions à droite, qui passent sous le titre sur téléphone.
 *
 * Usage :
 *   <PageHeader
 *     title="Calendrier"
 *     subtitle="25 sept. au 1 oct. · 3 entretiens"
 *     actions={<Button variant="primary">Programmer</Button>}
 *   />
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  /** Icône lucide-react (optionnelle), rendue en ton neutre */
  icon?: React.ElementType;
  /** Titre principal (h1) */
  title: string;
  /** Méta à droite du titre (compteur, badge…) */
  meta?: React.ReactNode;
  /** Sous-titre sous le titre */
  subtitle?: React.ReactNode;
  /** Actions à droite (boutons, bascules) */
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = React.memo(({
  icon: Icon,
  title,
  meta,
  subtitle,
  actions,
  className,
}) => {
  return (
    <header className={cn('mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          {Icon && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground-secondary">
              <Icon className="h-4 w-4" aria-hidden={true} />
            </span>
          )}
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {meta && <span className="shrink-0 text-sm text-muted-foreground">{meta}</span>}
        </div>
        {subtitle && <p className="max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>}
    </header>
  );
});

PageHeader.displayName = 'PageHeader';
