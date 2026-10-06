/**
 * Icônes qui attendent (docs/design/01-direction.md, § 7) : elles bougent
 * doucement quand quelque chose attend l'utilisateur, et restent fixes quand
 * le système demande moins d'animations (règle globale de src/index.css).
 * Toutes décoratives : le texte voisin dit ce qui attend.
 *
 * - TypingIcon : une bulle où trois points s'écrivent (réponses de candidats).
 * - HourglassIcon : un sablier qui se retourne (candidats qui n'avancent plus).
 * - AlarmIcon : un réveil qui sonne (tâches en retard).
 * - SparkleIcon : l'étoile de l'assistant qui scintille.
 * - PingDot : un point dont le halo s'élargit (un candidat attend une réponse).
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

interface IconProps {
  className?: string;
}

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

// Pivot autour de la forme dessinée, pas de la boîte de l'icône.
const aroundShape = (origin = 'center'): React.CSSProperties => ({
  transformBox: 'fill-box',
  transformOrigin: origin,
});

export function TypingIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={cn('size-5', className)}>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
      {[8, 12, 16].map((cx, index) => (
        <circle
          key={cx}
          cx={cx}
          cy={12}
          r={1.15}
          fill="currentColor"
          stroke="none"
          className="animate-typing-dot"
          style={{ animationDelay: `${index * 180}ms` }}
        />
      ))}
    </svg>
  );
}

export function HourglassIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={cn('size-5', className)}>
      <g className="animate-hourglass-flip" style={aroundShape()}>
        <path d="M5 22h14" />
        <path d="M5 2h14" />
        <path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22" />
        <path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2" />
      </g>
    </svg>
  );
}

export function AlarmIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={cn('size-4', className)}>
      <g className="animate-alarm-ring" style={aroundShape('50% 15%')}>
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l2 2" />
        <path d="M5 3 2 6" />
        <path d="m22 6-3-3" />
      </g>
    </svg>
  );
}

export function SparkleIcon({ className }: IconProps) {
  return (
    <svg {...svgProps} className={cn('size-4', className)}>
      <path
        className="animate-twinkle"
        style={aroundShape()}
        d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"
      />
      <path d="M19 3v4M17 5h4" />
    </svg>
  );
}

const PING_TONES = {
  warning: 'bg-warning',
  danger: 'bg-danger',
  brand: 'bg-brand',
  success: 'bg-success',
} as const;

export function PingDot({ tone = 'warning', className }: IconProps & { tone?: keyof typeof PING_TONES }) {
  return (
    <span aria-hidden="true" className={cn('relative inline-flex size-2 shrink-0', className)}>
      <span className={cn('absolute inset-0 animate-ping-slow rounded-full opacity-60', PING_TONES[tone])} />
      <span className={cn('relative inline-flex size-2 rounded-full', PING_TONES[tone])} />
    </span>
  );
}
