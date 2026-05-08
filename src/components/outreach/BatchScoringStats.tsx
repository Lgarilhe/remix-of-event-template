import React from 'react';
import { CheckCircle2, Brain, BarChart3, Sparkles, Zap } from 'lucide-react';
import type { BatchScoringStats as Stats } from './JobScoreDisplay';

interface BatchScoringStatsProps {
  stats: Stats;
  durationMs?: number;
}

// Map model id → label court pour l'affichage user-facing.
// On évite de mentionner "Anthropic" / "Claude" pour ne pas exposer le vendor.
const MODEL_LABELS: Record<string, string> = {
  'claude-haiku-4-5': 'IA rapide',
  'claude-sonnet-4-6': 'IA équilibrée',
  'claude-sonnet-4-5': 'IA équilibrée',
  'claude-opus-4-6': 'IA premium',
};

export const BatchScoringStats: React.FC<BatchScoringStatsProps> = ({ stats, durationMs }) => {
  const durationLabel = durationMs
    ? durationMs > 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
    : null;

  const escalated = stats.escalated ?? 0;
  const escalationLabel = stats.escalationModel ? MODEL_LABELS[stats.escalationModel] ?? null : null;

  return (
    <div className="border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-bold text-foreground">
        <CheckCircle2 className="w-4 h-4 text-success" />
        {stats.total} profils analysés{durationLabel && ` en ${durationLabel}`}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground pl-6 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Brain className="w-3 h-3 text-purple-400" />
          <span>{stats.llmCalled} scorés par l'IA</span>
        </div>
        <div className="flex items-center gap-1.5">
          <BarChart3 className="w-3 h-3 text-foreground/50" />
          <span>Moy: <span className="font-semibold text-foreground">{stats.avgScore}/100</span></span>
        </div>
        {escalated > 0 && (
          <div
            className="flex items-center gap-1.5"
            title={`${escalated} profil${escalated > 1 ? 's' : ''} borderline ré-évalué${escalated > 1 ? 's' : ''} par une ${escalationLabel ?? 'IA plus puissante'} pour plus de précision`}
          >
            <Zap className="w-3 h-3 text-amber-400" />
            <span>
              {escalated} ré-évalué{escalated > 1 ? 's' : ''}
              {escalationLabel && ` (${escalationLabel})`}
            </span>
          </div>
        )}
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
