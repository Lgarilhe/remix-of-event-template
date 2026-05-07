import React from 'react';
import { CheckCircle2, Brain, BarChart3, Sparkles } from 'lucide-react';
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
        <CheckCircle2 className="w-4 h-4 text-success" />
        {stats.total} profils analysés{durationLabel && ` en ${durationLabel}`}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground pl-6">
        <div className="flex items-center gap-1.5">
          <Brain className="w-3 h-3 text-purple-400" />
          <span>{stats.llmCalled} scorés par l'IA</span>
        </div>
        <div className="flex items-center gap-1.5">
          <BarChart3 className="w-3 h-3 text-foreground/50" />
          <span>Moy: <span className="font-semibold text-foreground">{stats.avgScore}/100</span></span>
        </div>
        {stats.llmCalled > 0 && (
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-foreground/50" />
            <span>{stats.llmCalled} crédit{stats.llmCalled > 1 ? 's' : ''} IA</span>
          </div>
        )}
      </div>
    </div>
  );
};
