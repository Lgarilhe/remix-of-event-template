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
  icon?: React.ElementType;
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
  cols?: { base?: number; sm?: number; md?: number; lg?: number; xl?: number };
  className?: string;
}

// Classes écrites en entier : Tailwind ne génère que les classes qu'il lit
// telles quelles dans le code (un `sm:${…}` construit à l'exécution n'existe pas).
const COLS: Record<number, { base: string; sm: string; md: string; lg: string; xl: string }> = {
  1: { base: 'grid-cols-1', sm: 'sm:grid-cols-1', md: 'md:grid-cols-1', lg: 'lg:grid-cols-1', xl: 'xl:grid-cols-1' },
  2: { base: 'grid-cols-2', sm: 'sm:grid-cols-2', md: 'md:grid-cols-2', lg: 'lg:grid-cols-2', xl: 'xl:grid-cols-2' },
  3: { base: 'grid-cols-3', sm: 'sm:grid-cols-3', md: 'md:grid-cols-3', lg: 'lg:grid-cols-3', xl: 'xl:grid-cols-3' },
  4: { base: 'grid-cols-4', sm: 'sm:grid-cols-4', md: 'md:grid-cols-4', lg: 'lg:grid-cols-4', xl: 'xl:grid-cols-4' },
  5: { base: 'grid-cols-5', sm: 'sm:grid-cols-5', md: 'md:grid-cols-5', lg: 'lg:grid-cols-5', xl: 'xl:grid-cols-5' },
  6: { base: 'grid-cols-6', sm: 'sm:grid-cols-6', md: 'md:grid-cols-6', lg: 'lg:grid-cols-6', xl: 'xl:grid-cols-6' },
  7: { base: 'grid-cols-7', sm: 'sm:grid-cols-7', md: 'md:grid-cols-7', lg: 'lg:grid-cols-7', xl: 'xl:grid-cols-7' },
};

export const StatGrid: React.FC<StatGridProps> = ({ children, cols, className }) => {
  return (
    <div
      className={cn(
        'grid gap-3',
        COLS[cols?.base ?? 2]?.base,
        cols?.sm && COLS[cols.sm]?.sm,
        cols?.md && COLS[cols.md]?.md,
        cols?.lg && COLS[cols.lg]?.lg,
        cols?.xl && COLS[cols.xl]?.xl,
        className,
      )}
    >
      {children}
    </div>
  );
};
