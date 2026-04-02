import React from 'react';
import { PreScoreResult } from '@/hooks/linkedin/preScoring';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

interface PreScoreBarProps {
  preScore: PreScoreResult;
  hasLLMScore?: boolean;
}

const TIER_STYLES = {
  high: { bar: 'bg-foreground', text: 'text-foreground', label: 'HIGH' },
  medium: { bar: 'bg-foreground/60', text: 'text-foreground/70', label: 'MED' },
  low: { bar: 'bg-destructive', text: 'text-destructive', label: 'LOW' },
} as const;

const FLAG_STYLES: Record<string, { icon: string; level: 'error' | 'warn' | 'info' }> = {
  'Open to Work': { icon: '◉', level: 'info' },
  'Aucun must-have matché': { icon: '✕', level: 'error' },
  'Mismatch séniorité': { icon: '✕', level: 'error' },
  'XP insuffisante': { icon: '✕', level: 'error' },
  'Surqualifié': { icon: '▲', level: 'warn' },
  'XP limite': { icon: '▲', level: 'warn' },
  'Légèrement senior': { icon: '▲', level: 'warn' },
  'Légèrement junior': { icon: '▼', level: 'warn' },
  'Tenure courte': { icon: '▲', level: 'warn' },
  'Tenure très courte': { icon: '✕', level: 'error' },
};

function getFlag(flag: string) {
  for (const [key, style] of Object.entries(FLAG_STYLES)) {
    if (flag.startsWith(key) || flag.includes(key)) return style;
  }
  return { icon: '—', level: 'info' as const };
}

const flagLevelClass = {
  error: 'border-destructive text-destructive bg-destructive/5',
  warn: 'border-border text-foreground/70 bg-muted',
  info: 'border-primary/30 text-primary bg-primary/5',
};

const BreakdownRow: React.FC<{ label: string; value: number; max: number }> = ({ label, value, max }) => {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-muted-foreground uppercase tracking-wider truncate">{label}</span>
      <div className="flex-1 h-1 bg-muted overflow-hidden">
        <div
          className={`h-full transition-all ${pct >= 70 ? 'bg-foreground' : pct >= 40 ? 'bg-accent/500' : 'bg-destructive'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right tabular-nums text-muted-foreground font-medium">{value}/{max}</span>
    </div>
  );
};

const TooltipBreakdown: React.FC<{ pct: number; breakdown: PreScoreResult['breakdown']; flags: string[] }> = ({ pct, breakdown, flags }) => (
  <div className="space-y-2">
    <p className="text-xs font-semibold uppercase tracking-wider border-b border-border pb-1">
      Pre-score · {pct}%
    </p>
    <div className="space-y-1">
      <BreakdownRow label="Skills" value={breakdown.skills} max={40} />
      <BreakdownRow label="XP" value={breakdown.experience} max={20} />
      <BreakdownRow label="Séniorité" value={breakdown.seniority} max={15} />
      <BreakdownRow label="Lieu" value={breakdown.location} max={10} />
      <BreakdownRow label="Réceptivité" value={breakdown.receptivity} max={10} />
      <BreakdownRow label="Tenure" value={breakdown.tenure} max={5} />
    </div>
    {flags.length > 0 && (
      <div className="flex flex-wrap gap-1 pt-1.5 border-t border-border">
        {flags.map((f, i) => {
          const style = getFlag(f);
          return (
            <span key={i} className={`text-xs font-medium ${style.level === 'error' ? 'text-destructive' : style.level === 'warn' ? 'text-foreground/60' : 'text-primary'}`}>
              {style.icon} {f}
            </span>
          );
        })}
      </div>
    )}
  </div>
);

export const PreScoreBar: React.FC<PreScoreBarProps> = ({ preScore, hasLLMScore }) => {
  const { tier, breakdown, flags } = preScore;
  const pct = preScore.preScore;
  const tierStyle = TIER_STYLES[tier];

  // Reduced display when LLM score exists
  if (hasLLMScore) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 cursor-help">
            <div className="w-10 h-[3px] bg-muted overflow-hidden">
              <div className={`h-full ${tierStyle.bar}`} style={{ width: `${pct}%` }} />
            </div>
            <span className={`text-xs tabular-nums font-semibold uppercase tracking-wider ${tierStyle.text}`}>
              {pct}%
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs p-3 rounded-none border-border">
          <TooltipBreakdown pct={pct} breakdown={breakdown} flags={flags} />
        </TooltipContent>
      </Tooltip>
    );
  }

  // Primary display
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 cursor-help shrink-0">
            <span className={`text-xs font-bold uppercase tracking-widest ${tierStyle.text}`}>
              {tierStyle.label}
            </span>
            <div className="w-14 h-[3px] bg-muted overflow-hidden">
              <div className={`h-full ${tierStyle.bar} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className={`text-xs tabular-nums font-semibold ${tierStyle.text}`}>
              {pct}%
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs p-3 rounded-none border-border">
          <TooltipBreakdown pct={pct} breakdown={breakdown} flags={flags} />
        </TooltipContent>
      </Tooltip>

      {/* Max 2 inline flags */}
      {flags.slice(0, 2).map((f, i) => {
        const style = getFlag(f);
        return (
          <Badge
            key={i}
            variant="outline"
            className={`text-xs px-1.5 py-0 h-4 font-medium rounded-none max-w-[140px] truncate ${flagLevelClass[style.level]}`}
          >
            {style.icon} {f.length > 20 ? f.slice(0, 17) + '…' : f}
          </Badge>
        );
      })}
    </div>
  );
};
