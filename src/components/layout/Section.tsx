/**
 * Section — wrapper de section unifié (titre + icône + action + content).
 *
 * Remplace les 15+ définitions inline de `<Section>` dans les dashboards,
 * SequenceAnalytics, etc. qui divergent sur le padding/border/fontsize.
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface SectionProps {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  /** Action à droite (lien "Voir tout", bouton, tabs) */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Padding interne (défaut : aucun — laisser les children gérer) */
  padded?: boolean;
  className?: string;
  /** Tag sémantique (section/article/aside) */
  as?: 'section' | 'article' | 'aside' | 'div';
  /** Niveau du titre : 2 sous le titre de page, 3 (défaut) dans une page déjà découpée. */
  headingLevel?: 2 | 3;
}

export const Section: React.FC<SectionProps> = ({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
  padded = false,
  className,
  as: Component = 'section',
  headingLevel = 3,
}) => {
  const headingId = React.useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Component aria-labelledby={headingId} className={cn('rounded-xl border border-border bg-card', className)}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden={true} />}
          <Heading id={headingId} className="truncate text-sm font-semibold text-foreground">
            {title}
          </Heading>
          {subtitle && (
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              · {subtitle}
            </span>
          )}
        </div>
        {action && (
          <div className="shrink-0">
            {action}
          </div>
        )}
      </header>
      <div className={cn(padded && 'p-4')}>
        {children}
      </div>
    </Component>
  );
};
