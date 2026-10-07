/**
 * EmptyState : état vide commun (docs/design/01-direction.md, § 8).
 *
 * Une phrase qui dit pourquoi c'est vide, et l'action qui remplit l'écran.
 * `src/components/ui/EmptyState.tsx` s'appuie sur ce composant. L'état vide
 * d'une page peut porter une illustration à la place de l'icône (§ Illustrations).
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
import { Illustration, type IllustrationName } from '@/components/ui/illustration';

export interface EmptyStateProps {
  /** Composant d'icône (lucide) ou élément déjà rendu */
  icon?: React.ElementType | React.ReactNode;
  /** Dessin à la place de l'icône, pour l'état vide d'une page ou d'une vue entière. */
  illustration?: IllustrationName;
  title: string;
  description?: React.ReactNode;
  /** Action principale (bouton, lien) */
  action?: React.ReactNode;
  /** Densité : compact dans une carte ou une colonne */
  variant?: 'default' | 'compact';
  /**
   * Niveau du titre, un cran sous le titre qui l'englobe : 2 à la place du
   * contenu d'une page, 3 (défaut) dans une section, 4 dans une carte titrée en h3.
   */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

function renderIcon(icon: EmptyStateProps['icon'], compact: boolean) {
  if (!icon) return null;
  const size = compact ? 'h-4 w-4' : 'h-5 w-5';
  let content: React.ReactNode = icon as React.ReactNode;
  if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null && '$$typeof' in icon && !React.isValidElement(icon))) {
    const Icon = icon as React.ElementType;
    content = <Icon className={size} aria-hidden={true} />;
  }
  return (
    <span
      className={cn(
        'mb-3 grid place-items-center rounded-lg bg-muted text-foreground',
        compact ? 'h-8 w-8' : 'h-10 w-10',
      )}
    >
      {content}
    </span>
  );
}

export const EmptyState: React.FC<EmptyStateProps> = React.memo(({
  icon,
  illustration,
  title,
  description,
  action,
  variant = 'default',
  headingLevel = 3,
  className,
}) => {
  const compact = variant === 'compact';
  const Heading = `h${headingLevel}` as const;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-border text-center',
        compact ? 'px-4 py-6' : 'px-6 py-12',
        className,
      )}
      role="status"
    >
      {illustration ? (
        <Illustration name={illustration} size={compact ? 'sm' : 'md'} className="mb-4" />
      ) : (
        renderIcon(icon, compact)
      )}
      <Heading className={cn('font-semibold text-foreground', compact ? 'text-sm' : 'text-md')}>{title}</Heading>
      {description && (
        <p className={cn('mt-1 max-w-md text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>{description}</p>
      )}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
});

EmptyState.displayName = 'EmptyState';
