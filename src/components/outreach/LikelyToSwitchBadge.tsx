import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { LikelyToSwitchResult } from '@/hooks/linkedin/likelyToSwitch';

interface LikelyToSwitchBadgeProps {
  result: LikelyToSwitchResult;
}

const LEVEL_CONFIG = {
  high: { label: 'Très dispo', shortLabel: 'Dispo', bg: 'bg-success/10 border-green-300', text: 'text-green-700', dot: 'bg-green-500' },
  medium: { label: 'Potentiellement dispo', shortLabel: 'Signal', bg: 'bg-warning/10 border-yellow-300', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  low: { label: 'Peu de signaux', shortLabel: 'Faible', bg: 'bg-muted border-border', text: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  unknown: { label: 'Pas de signal', shortLabel: '', bg: '', text: '', dot: '' },
};

export const LikelyToSwitchBadge: React.FC<LikelyToSwitchBadgeProps> = ({ result }) => {
  if (result.level === 'unknown' || result.score === 0) return null;

  const config = LEVEL_CONFIG[result.level];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-xs font-medium cursor-default', config.bg, config.text)}>
          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', config.dot)} />
          {config.shortLabel}
          <span className="opacity-60">{result.score}%</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs p-3">
        <p className="font-semibold text-xs mb-2">Disponibilité : {config.label} ({result.score}%)</p>
        <div className="space-y-1.5">
          {result.signals.map((signal) => (
            <div key={signal.key} className="flex items-start gap-2 text-xs">
              <span className="shrink-0">{signal.active ? signal.emoji : '⬜'}</span>
              <div className="flex-1 min-w-0">
                <span className={cn('font-medium', !signal.active && 'line-through opacity-50')}>
                  {signal.label}
                </span>
                {signal.active && signal.detail && (
                  <p className="text-muted-foreground text-xs mt-0.5">{signal.detail}</p>
                )}
              </div>
              <span className="text-muted-foreground/50 shrink-0">{signal.weight}pt</span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
