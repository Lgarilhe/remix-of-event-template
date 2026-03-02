import React from 'react';
import { CheckCircle2, Filter, Brain, Zap, BarChart3, Coins } from 'lucide-react';
import type { BatchScoringStats as Stats } from './JobScoreDisplay';

interface BatchScoringStatsProps {
  stats: Stats;
  durationMs?: number;
}

export const BatchScoringStats: React.FC<BatchScoringStatsProps> = ({ stats, durationMs }) => {
  const durationLabel = durationMs
    ? durationMs > 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
    : null;

  return (
    <div className="border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-bold text-foreground">
        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
        {stats.total} profils analysés{durationLabel && ` en ${durationLabel}`}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-1.5 gap-x-4 text-[11px] text-muted-foreground pl-6">
        <div className="flex items-center gap-1.5">
          <Filter className="w-3 h-3 text-red-400" />
          <span>{stats.hardFiltered} éliminés par filtres</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-amber-400" />
          <span>{stats.llmSkipped} trop faibles pour l'IA</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Brain className="w-3 h-3 text-purple-400" />
          <span>{stats.llmCalled} scorés par l'IA</span>
        </div>
        <div className="flex items-center gap-1.5">
          <BarChart3 className="w-3 h-3 text-foreground/50" />
          <span>Score moyen: <span className="font-semibold text-foreground">{stats.avgScore}/100</span></span>
        </div>
        {stats.totalTokens > 0 && (
          <div className="flex items-center gap-1.5">
            <Coins className="w-3 h-3 text-foreground/50" />
            <span>Tokens: {stats.totalTokens.toLocaleString()}</span>
          </div>
        )}
      </div>
    </div>
  );
};
