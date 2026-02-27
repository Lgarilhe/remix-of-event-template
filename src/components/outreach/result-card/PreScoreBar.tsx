import React from 'react';
import { PreScoreResult } from '@/hooks/linkedin/preScoring';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';

interface PreScoreBarProps {
  preScore: PreScoreResult;
  hasLLMScore?: boolean;
}

const TIER_COLORS = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500',
  low: 'bg-destructive',
} as const;

const TIER_TEXT_COLORS = {
  high: 'text-emerald-600',
  medium: 'text-amber-600',
  low: 'text-destructive',
} as const;

const FLAG_STYLES: Record<string, { emoji: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' }> = {
  'Open to Work': { emoji: '🟢', variant: 'secondary' },
  'Aucun must-have matché': { emoji: '🔴', variant: 'destructive' },
  'Mismatch séniorité': { emoji: '🔴', variant: 'destructive' },
  'XP insuffisante': { emoji: '🔴', variant: 'destructive' },
  'Surqualifié': { emoji: '🟡', variant: 'outline' },
  'XP limite': { emoji: '🟡', variant: 'outline' },
  'Légèrement senior': { emoji: '🟡', variant: 'outline' },
  'Légèrement junior': { emoji: '🟡', variant: 'outline' },
  'Tenure courte': { emoji: '🟡', variant: 'outline' },
  'Tenure très courte': { emoji: '🔴', variant: 'destructive' },
};

function getFlag(flag: string) {
  for (const [key, style] of Object.entries(FLAG_STYLES)) {
    if (flag.startsWith(key) || flag.includes(key)) return style;
  }
  return { emoji: '⚪', variant: 'outline' as const };
}

const BreakdownRow: React.FC<{ label: string; value: number; max: number }> = ({ label, value, max }) => {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-20 text-muted-foreground truncate">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-destructive'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right tabular-nums text-muted-foreground">{value}/{max}</span>
    </div>
  );
};

export const PreScoreBar: React.FC<PreScoreBarProps> = ({ preScore, hasLLMScore }) => {
  const { tier, breakdown, flags } = preScore;
  const pct = preScore.preScore;

  // When LLM score exists, show reduced version
  if (hasLLMScore) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 cursor-help">
            <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
              <div className={`h-full ${TIER_COLORS[tier]}`} style={{ width: `${pct}%` }} />
            </div>
            <span className={`text-[9px] tabular-nums font-medium ${TIER_TEXT_COLORS[tier]}`}>{pct}%</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs p-3 space-y-2">
          <p className="text-xs font-semibold">Pre-score mécanique : {pct}%</p>
          <div className="space-y-1">
            <BreakdownRow label="Skills" value={breakdown.skills} max={40} />
            <BreakdownRow label="XP" value={breakdown.experience} max={20} />
            <BreakdownRow label="Séniorité" value={breakdown.seniority} max={15} />
            <BreakdownRow label="Localisation" value={breakdown.location} max={10} />
            <BreakdownRow label="Réceptivité" value={breakdown.receptivity} max={10} />
            <BreakdownRow label="Tenure" value={breakdown.tenure} max={5} />
          </div>
          {flags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1 border-t border-border">
              {flags.map((f, i) => {
                const style = getFlag(f);
                return <span key={i} className="text-[9px]">{style.emoji} {f}</span>;
              })}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Primary display — no LLM score yet
  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 cursor-help">
            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
              <div className={`h-full ${TIER_COLORS[tier]} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className={`text-[10px] tabular-nums font-semibold ${TIER_TEXT_COLORS[tier]}`}>{pct}%</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs p-3 space-y-2">
          <p className="text-xs font-semibold">Pre-score mécanique : {pct}%</p>
          <div className="space-y-1">
            <BreakdownRow label="Skills" value={breakdown.skills} max={40} />
            <BreakdownRow label="XP" value={breakdown.experience} max={20} />
            <BreakdownRow label="Séniorité" value={breakdown.seniority} max={15} />
            <BreakdownRow label="Localisation" value={breakdown.location} max={10} />
            <BreakdownRow label="Réceptivité" value={breakdown.receptivity} max={10} />
            <BreakdownRow label="Tenure" value={breakdown.tenure} max={5} />
          </div>
          {flags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1 border-t border-border">
              {flags.map((f, i) => {
                const style = getFlag(f);
                return <span key={i} className="text-[9px]">{style.emoji} {f}</span>;
              })}
            </div>
          )}
        </TooltipContent>
      </Tooltip>

      {/* Show max 2 important flags inline */}
      {flags.slice(0, 2).map((f, i) => {
        const style = getFlag(f);
        return (
          <Badge
            key={i}
            variant={style.variant}
            className="text-[9px] px-1.5 py-0 h-4 font-normal"
          >
            {style.emoji} {f.length > 25 ? f.slice(0, 22) + '…' : f}
          </Badge>
        );
      })}
    </div>
  );
};
