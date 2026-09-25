/**
 * ErrorState : état d'erreur commun (docs/design/01-direction.md, § 8).
 *
 * Dit ce qui a échoué en mots simples et propose de réessayer. Le message
 * technique reste disponible, replié. Une erreur ne s'affiche jamais comme un
 * état vide.
 *
 * Usage :
 *   <ErrorState
 *     title="Impossible de charger les tâches"
 *     description="Vérifiez votre connexion, puis réessayez."
 *     detail={error?.message}
 *     onRetry={refetch}
 *   />
 */

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ErrorStateProps {
  /** Ce qui n'a pas pu se faire. */
  title: string;
  /** Ce que la personne peut faire. */
  description?: React.ReactNode;
  /** Message technique, montré replié. */
  detail?: string | null;
  onRetry?: () => void;
  /** Nouvelle tentative en cours. */
  retrying?: boolean;
  retryLabel?: string;
  /** Action secondaire (lien, bouton). */
  action?: React.ReactNode;
  /** page : plein écran ; default : carte ; compact : ligne dans une liste ou un panneau. */
  variant?: 'page' | 'default' | 'compact';
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title,
  description,
  detail,
  onRetry,
  retrying = false,
  retryLabel = 'Réessayer',
  action,
  variant = 'default',
  className,
}) => {
  const compact = variant === 'compact';

  const actions = (onRetry || action) && (
    <div className={cn('flex flex-wrap items-center gap-2', compact ? 'mt-3' : 'mt-5 justify-center')}>
      {onRetry && (
        <Button variant="primary" size="sm" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={cn(retrying && 'animate-spin')} aria-hidden="true" />
          {retrying ? 'Nouvelle tentative…' : retryLabel}
        </Button>
      )}
      {action}
    </div>
  );

  const technical = detail ? (
    <details className={cn('text-left', compact ? 'mt-2' : 'mt-4')}>
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Détails techniques</summary>
      <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{detail}</p>
    </details>
  ) : null;

  const card = (
    <div
      role="alert"
      className={cn(
        'rounded-xl border border-border bg-card',
        compact ? 'flex items-start gap-3 p-4 text-left' : 'p-6 text-center',
        variant === 'page' && 'w-full max-w-md',
        variant !== 'page' && className,
      )}
    >
      <span
        className={cn(
          'grid shrink-0 place-items-center rounded-lg bg-danger-muted text-danger',
          compact ? 'h-8 w-8' : 'mx-auto mb-3 h-10 w-10',
        )}
      >
        <AlertTriangle className={compact ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('font-semibold text-foreground', compact ? 'text-sm' : 'text-md')}>{title}</p>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {actions}
        {technical}
      </div>
    </div>
  );

  if (variant === 'page') {
    return <div className={cn('flex min-h-screen items-center justify-center bg-background p-6', className)}>{card}</div>;
  }
  return card;
};

ErrorState.displayName = 'ErrorState';
