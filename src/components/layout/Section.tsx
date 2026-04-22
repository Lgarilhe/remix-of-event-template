/**
 * Section — wrapper de section unifié (titre + icône + action + content).
 *
 * Remplace les 15+ définitions inline de `<Section>` dans ATSDashboard,
 * SequenceAnalytics, etc. qui divergent sur le padding/border/fontsize.
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface SectionProps {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /** Action à droite (lien "Voir tout", bouton, tabs) */
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Padding interne (défaut : aucun — laisser les children gérer) */
  padded?: boolean;
  className?: string;
  /** Tag sémantique (section/article/aside) */
  as?: 'section' | 'article' | 'aside' | 'div';
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
}) => {
  return (
    <Component className={cn('border border-border bg-background', className)}>
      <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden={true} />}
          <h3 className="text-xs uppercase tracking-wider font-bold text-foreground truncate">
            {title}
          </h3>
          {subtitle && (
            <span className="text-xs text-muted-foreground tracking-wide hidden sm:inline truncate">
              — {subtitle}
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
