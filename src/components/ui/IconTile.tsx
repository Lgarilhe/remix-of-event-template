import * as React from 'react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

type Tone = 'default' | 'brand' | 'success' | 'warning' | 'destructive' | 'info' | 'muted';
type Size = 'xs' | 'sm' | 'md' | 'lg';

interface IconTileProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Icône Lucide à afficher */
  icon?: LucideIcon;
  /** Tonalité de fond. Défaut neutre ; le ton porte le sens, jamais l'icône seule (01-direction.md). */
  tone?: Tone;
  /** Taille du tile carré + de l'icône. */
  size?: Size;
  /** Override className du wrapper si besoin. */
  className?: string;
  /** Override className de l'icône. */
  iconClassName?: string;
  /** Children (alternative à `icon` pour cas custom — ex emoji, image, lettre). */
  children?: React.ReactNode;
}

const TONE_CLASSES: Record<Tone, string> = {
  default: 'bg-muted text-foreground-secondary',
  brand: 'bg-brand/15 text-brand',
  success: 'bg-success-muted text-success',
  warning: 'bg-warning-muted text-warning',
  destructive: 'bg-danger-muted text-danger',
  info: 'bg-info-muted text-info',
  muted: 'bg-foreground/[0.04] text-foreground',
};

const SIZE_CLASSES: Record<Size, { tile: string; icon: string; rounded: string }> = {
  xs: { tile: 'h-6 w-6', icon: 'w-3 h-3', rounded: 'rounded-md' },
  sm: { tile: 'h-7 w-7', icon: 'w-3.5 h-3.5', rounded: 'rounded-md' },
  md: { tile: 'h-9 w-9', icon: 'w-4 h-4', rounded: 'rounded-lg' },
  lg: { tile: 'h-12 w-12', icon: 'w-5 h-5', rounded: 'rounded-xl' },
};

/**
 * Tile signature Konekt — petit carré coloré contenant une icône.
 *
 * Pattern utilisé partout dans le Dashboard, ATS, Calendar, etc. — auparavant
 * dupliqué inline ~60 fois. Centralisé ici pour garantir la cohérence
 * visuelle et permettre un changement de tonalité signature en un seul endroit.
 *
 * @example
 *   <IconTile icon={Search} />                          // neutre
 *   <IconTile icon={AlertTriangle} tone="warning" />    // jaune ambre
 *   <IconTile icon={Check} tone="success" size="lg" />  // vert succès, gros
 *   <IconTile size="xs">{emoji}</IconTile>              // emoji custom
 */
export const IconTile = React.forwardRef<HTMLDivElement, IconTileProps>(
  ({ icon: Icon, tone = 'default', size = 'md', className, iconClassName, children, ...rest }, ref) => {
    const tone_ = TONE_CLASSES[tone];
    const sz = SIZE_CLASSES[size];
    return (
      <div
        ref={ref}
        className={cn('grid place-items-center shrink-0', sz.tile, sz.rounded, tone_, className)}
        {...rest}
      >
        {Icon ? <Icon className={cn(sz.icon, iconClassName)} /> : children}
      </div>
    );
  },
);
IconTile.displayName = 'IconTile';

export default IconTile;
