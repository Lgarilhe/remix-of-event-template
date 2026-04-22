/**
 * EmptyState — état vide unifié (design system).
 *
 * Remplace les blocs custom `text-center py-12 border border-dashed` qu'on
 * trouvait à 10+ endroits avec des paddings/styles incohérents.
 *
 * Usage:
 *   <EmptyState
 *     icon={CalendarIcon}
 *     title="Pas d'événement cette semaine"
 *     description="Les entretiens et messages programmés apparaîtront ici."
 *     action={<Button>Créer une mission</Button>}
 *   />
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  title: string;
  description?: string;
  /** Action principale (bouton, lien) */
  action?: React.ReactNode;
  /** Variant de densité */
  variant?: 'default' | 'compact';
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = React.memo(({
  icon: Icon,
  title,
  description,
  action,
  variant = 'default',
  className,
}) => {
  const compact = variant === 'compact';

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center border border-dashed border-border bg-background/50',
        compact ? 'py-6 px-4' : 'py-12 px-6',
        'animate-in fade-in-0 duration-300',
        className,
      )}
      role="status"
    >
      {Icon && (
        <Icon
          className={cn(
            'text-muted-foreground/40 mb-3',
            compact ? 'w-6 h-6' : 'w-10 h-10',
          )}
          aria-hidden={true}
        />
      )}
      <h3 className={cn(
        'font-bold uppercase tracking-wider text-foreground',
        compact ? 'text-xs' : 'text-sm',
      )}>
        {title}
      </h3>
      {description && (
        <p className={cn(
          'text-muted-foreground max-w-md mt-1.5',
          compact ? 'text-xs' : 'text-xs sm:text-sm',
        )}>
          {description}
        </p>
      )}
      {action && (
        <div className="mt-4">
          {action}
        </div>
      )}
    </div>
  );
});

EmptyState.displayName = 'EmptyState';
