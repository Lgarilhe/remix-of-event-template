import React from 'react';
import { normalizeScore, scoreAccessibleLabel, scoreLevel } from '@/lib/scoreScale';
import { cn } from '@/lib/utils';

const TONE = {
  strong: { stroke: 'stroke-success', text: 'text-success' },
  medium: { stroke: 'stroke-warning', text: 'text-warning' },
  weak: { stroke: 'stroke-muted-foreground', text: 'text-muted-foreground' },
} as const;

const RADIUS = 17;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Anneau de score, rempli jusqu'au score. Couleur et barème de scoreScale.ts. */
export const ScoreRing: React.FC<{ score: number; className?: string }> = ({ score, className }) => {
  const value = normalizeScore(score) ?? 0;
  const level = scoreLevel(value) ?? 'weak';
  const tone = TONE[level];
  return (
    <span role="img" aria-label={scoreAccessibleLabel(value)} className={cn('relative inline-flex h-11 w-11 shrink-0 items-center justify-center', className)}>
      <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="20" cy="20" r={RADIUS} fill="none" strokeWidth="3" className="stroke-border-strong" />
        <circle
          cx="20"
          cy="20"
          r={RADIUS}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - value / 100)}
          className={tone.stroke}
        />
      </svg>
      <span aria-hidden="true" className={cn('text-xs font-semibold tabular-nums', tone.text)}>
        {Math.round(value)}
      </span>
    </span>
  );
};
