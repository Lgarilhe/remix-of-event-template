/**
 * PageHeader — titre de page unifié (design system).
 *
 * Force la cohérence du header sur toutes les pages applicatives :
 * - icône (optionnelle) + titre h1 en `text-xl sm:text-2xl font-bold tracking-tight`
 * - sous-titre / compteur (optionnel) `text-xs font-mono uppercase tracking-wider`
 * - zone actions à droite (boutons, toggles, tabs)
 * - wrap propre sur mobile
 *
 * Usage:
 *   <PageHeader
 *     icon={CalendarIcon}
 *     title="Calendrier"
 *     meta={`${events.length} événements`}
 *     actions={<Button>Actualiser</Button>}
 *   />
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  /** Icône lucide-react (optionnelle) */
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /** Titre principal (h1) */
  title: string;
  /** Meta à droite du titre (compteur, badge, etc.) */
  meta?: React.ReactNode;
  /** Sous-titre explicatif sous le titre */
  subtitle?: string;
  /** Actions à droite (boutons, toggles, tabs) */
  actions?: React.ReactNode;
  /** Custom class */
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
    <header className={cn('flex items-start justify-between gap-3 mb-4 flex-wrap', className)}>
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
          {Icon && <Icon className="w-5 h-5 text-foreground shrink-0" aria-hidden={true} />}
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight truncate">
            {title}
          </h1>
          {meta && (
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground shrink-0">
              {meta}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </header>
  );
});

PageHeader.displayName = 'PageHeader';
