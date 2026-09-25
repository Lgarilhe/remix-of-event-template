/**
 * EmptyState : état vide commun (docs/design/01-direction.md, § 8).
 *
 * Une phrase qui dit pourquoi c'est vide, et l'action qui remplit l'écran.
 * `src/components/ui/EmptyState.tsx` s'appuie sur ce composant.
 *
 * Usage :
 *   <EmptyState
 *     icon={CalendarIcon}
 *     title="Aucun entretien cette semaine"
 *     description="Les entretiens programmés depuis une mission apparaîtront ici."
 *     action={<Button variant="primary">Programmer un entretien</Button>}
 *   />
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** Composant d'icône (lucide) ou élément déjà rendu */
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> | React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** Action principale (bouton, lien) */
  action?: React.ReactNode;
  /** Densité : compact dans une carte ou une colonne */
  variant?: 'default' | 'compact';
  className?: string;
}

function renderIcon(icon: EmptyStateProps['icon'], compact: boolean) {
  if (!icon) return null;
  const size = compact ? 'h-4 w-4' : 'h-5 w-5';
  let content: React.ReactNode = icon as React.ReactNode;
  if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null && '$$typeof' in icon && !React.isValidElement(icon))) {
    const Icon = icon as React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
    content = <Icon className={size} aria-hidden={true} />;
  }
  return (
    <span
      className={cn(
        'mb-3 grid place-items-center rounded-lg bg-muted text-foreground-secondary',
        compact ? 'h-8 w-8' : 'h-10 w-10',
      )}
    >
      {content}
    </span>
  );
}

export const EmptyState: React.FC<EmptyStateProps> = React.memo(({
  icon,
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
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border text-center',
        compact ? 'px-4 py-6' : 'px-6 py-12',
        className,
      )}
      role="status"
    >
      {renderIcon(icon, compact)}
      <h3 className={cn('font-semibold text-foreground', compact ? 'text-sm' : 'text-md')}>{title}</h3>
      {description && (
        <p className={cn('mt-1 max-w-md text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>{description}</p>
      )}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
});

EmptyState.displayName = 'EmptyState';
