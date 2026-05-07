import * as React from 'react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

type Tone = 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'muted';
type Size = 'xs' | 'sm' | 'md' | 'lg';

interface IconTileProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Icône Lucide à afficher */
  icon?: LucideIcon;
  /** Tonalité de fond. Défaut "default" = vert Konekt signature (bg-emerald-500/15). */
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
  default: 'bg-emerald-500/15 text-foreground',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/15 text-destructive',
  info: 'bg-info/15 text-info',
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
 *   <IconTile icon={Search} />                          // default green
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
