/**
 * StatTile — tuile de KPI unifiée (design system).
 *
 * Pour les bandeaux de KPI en haut des pages (Dashboard, Tasks, Calendar…).
 * Carte arrondie, libellé discret, chiffre en graisse 600 et chiffres alignés.
 * La couleur d'un statut ne s'applique qu'au chiffre, et seulement si `accent`
 * (docs/design/01-direction.md : un zéro ne se met pas en avant).
 *
 * Usage :
 *   <StatTile label="En retard" value={3} icon={AlertCircle} variant="destructive" />
 */

import React from 'react';
import { cn } from '@/lib/utils';

export type StatTileVariant = 'default' | 'primary' | 'success' | 'warning' | 'destructive' | 'info';

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /** Petit indicateur à droite de la value (ex. trend) */
  trailing?: React.ReactNode;
  /** Variant pour accentuer (couleur + bg) */
  variant?: StatTileVariant;
  /** Mise en avant de la valeur quand > 0 */
  accent?: boolean;
  className?: string;
}

const VARIANT_STYLES: Record<StatTileVariant, { icon: string; value: string; bg: string }> = {
  default:     { icon: 'text-muted-foreground', value: 'text-foreground', bg: 'bg-card' },
  primary:     { icon: 'text-brand',            value: 'text-foreground', bg: 'bg-card' },
  success:     { icon: 'text-success',          value: 'text-success',    bg: 'bg-card' },
  warning:     { icon: 'text-warning',          value: 'text-warning',    bg: 'bg-card' },
  destructive: { icon: 'text-danger',           value: 'text-danger',     bg: 'bg-card' },
  info:        { icon: 'text-info',             value: 'text-info',       bg: 'bg-card' },
};

export const StatTile: React.FC<StatTileProps> = React.memo(({
  label,
  value,
  icon: Icon,
  trailing,
  variant = 'default',
  accent = false,
  className,
}) => {
  const styles = VARIANT_STYLES[variant];

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border border-border p-4 transition-colors',
        styles.bg,
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className={cn('h-3.5 w-3.5 shrink-0', accent ? styles.icon : 'text-muted-foreground')} aria-hidden={true} />}
        <span className="truncate text-xs font-medium text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('text-2xl font-semibold tracking-tight tabular-nums', accent && styles.value)}>
          {value}
        </span>
        {trailing && (
          <div className="shrink-0">
            {trailing}
          </div>
        )}
      </div>
    </div>
  );
});

StatTile.displayName = 'StatTile';

/**
 * StatGrid — grille responsive pour les StatTile avec gestion des bordures.
 * Usage : <StatGrid cols={{ base: 2, sm: 3, lg: 6 }}>{tiles}</StatGrid>
 *
 * Tuiles séparées par un espace de 12 px.
 */
export interface StatGridProps {
  children: React.ReactNode;
  /** Colonnes par breakpoint */
  cols?: { base?: number; sm?: number; md?: number; lg?: number };
  className?: string;
}

const COL_CLASSES = (col: number): string => {
  switch (col) {
    case 1: return 'grid-cols-1';
    case 2: return 'grid-cols-2';
    case 3: return 'grid-cols-3';
    case 4: return 'grid-cols-4';
    case 5: return 'grid-cols-5';
    case 6: return 'grid-cols-6';
    case 7: return 'grid-cols-7';
    default: return 'grid-cols-1';
  }
};

export const StatGrid: React.FC<StatGridProps> = ({ children, cols, className }) => {
  const base = COL_CLASSES(cols?.base ?? 2);
  const sm = cols?.sm ? `sm:${COL_CLASSES(cols.sm)}` : '';
  const md = cols?.md ? `md:${COL_CLASSES(cols.md)}` : '';
  const lg = cols?.lg ? `lg:${COL_CLASSES(cols.lg)}` : '';

  return (
    <div
      className={cn(
        'grid gap-3',
        base,
        sm,
        md,
        lg,
        className,
      )}
    >
      {children}
    </div>
  );
};
