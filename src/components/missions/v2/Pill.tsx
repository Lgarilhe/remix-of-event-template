/**
 * Pill — Composant primitif pour les pastilles d'état (status, score AI…).
 *
 * Inspiré du design v2 (Claude Design). 5 variants :
 *   - muted : par défaut (gris)
 *   - success : vert (status-success)
 *   - info : bleu (status-info)
 *   - warning : orange (status-warning)
 *   - ai : gradient Skalr soft (violet → rose) — moments WOW IA
 *
 * Supporte un dot pulse (animé) à gauche, et une icon Lucide.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { Loader2, type LucideIcon } from 'lucide-react';

export type PillVariant = 'muted' | 'success' | 'info' | 'warning' | 'ai';

export interface PillProps {
  variant?: PillVariant;
  /** Composant icône Lucide (ou null/undefined). */
  icon?: LucideIcon | null;
  /** Affiche un dot pulse à gauche (cohérent avec la variant color). */
  pulse?: boolean;
  /** Spinner loader à la place du contenu. */
  loading?: boolean;
  className?: string;
  children: React.ReactNode;
}

const VARIANT_STYLES: Record<PillVariant, React.CSSProperties> = {
  muted: { background: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' },
  success: { background: 'hsl(var(--status-success-muted))', color: 'hsl(var(--status-success))' },
  info: { background: 'hsl(var(--status-info-muted))', color: 'hsl(var(--status-info))' },
  warning: { background: 'hsl(var(--status-warning-muted))', color: 'hsl(var(--status-warning))' },
  ai: {
    background: 'linear-gradient(135deg, hsl(271 81% 56% / 0.18), hsl(330 81% 60% / 0.18))',
    color: 'hsl(330 81% 75%)',
    border: '1px solid hsl(271 81% 56% / 0.3)',
  },
};

export const Pill: React.FC<PillProps> = ({
  variant = 'muted',
  icon: Icon,
  pulse = false,
  loading = false,
  className,
  children,
}) => {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap',
        className,
      )}
      style={VARIANT_STYLES[variant]}
    >
      {pulse && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: 'currentColor', animation: 'konektPulseDot 1.6s ease-in-out infinite' }}
        />
      )}
      {loading ? (
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
      ) : Icon ? (
        <Icon className="w-2.5 h-2.5" strokeWidth={2.5} />
      ) : null}
      {children}
    </span>
  );
};
