import React, { useState, useMemo } from 'react';
import { CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp, Ban, Target, ExternalLink, Brain, Filter, Zap, Coins, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { BatchScoringStats } from './JobScoreDisplay';

export interface BatchReportEntry {
  profileId: string;
  name: string;
  headline?: string;
  profileUrl?: string;
  score: number;
  recommendation: 'go' | 'maybe' | 'skip';
  summary: string;
  hardFilterPassed?: boolean;
  hardFilterKO?: string;
  skippedLLM?: boolean;
  dismissed: boolean;
}

interface BatchScoringReportProps {
  entries: BatchReportEntry[];
  stats: BatchScoringStats | null;
  durationMs?: number;
  onClose?: () => void;
}

type ReportFilter = 'all' | 'go' | 'maybe' | 'skip';

const FILTER_TABS: { value: ReportFilter; label: string; emoji: string }[] = [
  { value: 'all', label: 'Tous', emoji: '📊' },
  { value: 'go', label: 'Go', emoji: '✅' },
  { value: 'maybe', label: 'Maybe', emoji: '🤔' },
  { value: 'skip', label: 'Écartés', emoji: '❌' },
];

export const BatchScoringReport: React.FC<BatchScoringReportProps> = ({
  entries,
  stats,
  durationMs,
  onClose,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [filter, setFilter] = useState<ReportFilter>('all');

  const counts = useMemo(() => ({
    all: entries.length,
    go: entries.filter(e => e.recommendation === 'go').length,
    maybe: entries.filter(e => e.recommendation === 'maybe').length,
    skip: entries.filter(e => e.recommendation === 'skip' || e.dismissed).length,
  }), [entries]);

  const filtered = useMemo(() => {
    if (filter === 'all') return entries;
    if (filter === 'skip') return entries.filter(e => e.recommendation === 'skip' || e.dismissed);
    return entries.filter(e => e.recommendation === filter);
  }, [entries, filter]);

  const durationLabel = durationMs
    ? durationMs > 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
    : null;

  if (entries.length === 0) return null;

  return (
    <div className="border border-foreground bg-muted/20 mb-3 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs font-bold text-foreground">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>Compte rendu du scoring — {entries.length} profils{durationLabel && ` en ${durationLabel}`}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-emerald-600 font-semibold">✅ {counts.go}</span>
            <span className="text-amber-600 font-semibold">🤔 {counts.maybe}</span>
            <span className="text-red-500 font-semibold">❌ {counts.skip}</span>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <>
          {/* Stats row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-y-1 gap-x-4 text-[10px] text-muted-foreground px-3 py-1.5 border-t border-border/50 bg-muted/30">
              <div className="flex items-center gap-1">
                <Filter className="w-3 h-3 text-red-400" />
                <span>{stats.hardFiltered} éliminés par filtres</span>
              </div>
              <div className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" />
                <span>{stats.llmSkipped} sans IA</span>
              </div>
              <div className="flex items-center gap-1">
                <Brain className="w-3 h-3 text-purple-400" />
                <span>{stats.llmCalled} scorés par IA</span>
              </div>
              <div className="flex items-center gap-1">
                <BarChart3 className="w-3 h-3" />
                <span>Moy: <span className="font-semibold text-foreground">{stats.avgScore}/100</span></span>
              </div>
              {stats.totalTokens > 0 && (
                <div className="flex items-center gap-1">
                  <Coins className="w-3 h-3" />
                  <span>{stats.totalTokens.toLocaleString()} tokens</span>
                </div>
              )}
            </div>
          )}

          {/* Filter tabs */}
          <div className="flex items-center gap-px px-3 py-1.5 border-t border-border/50">
            {FILTER_TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={cn(
                  "h-6 px-2 text-[10px] font-medium transition-colors",
                  filter === tab.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                )}
              >
                {tab.emoji} {tab.label} {counts[tab.value] > 0 && `(${counts[tab.value]})`}
              </button>
            ))}
          </div>

          {/* Entries list */}
          <ScrollArea className="max-h-[300px] border-t border-border/50">
            <div className="divide-y divide-border/30">
              {filtered.map(entry => (
                <ReportEntryRow key={entry.profileId} entry={entry} />
              ))}
            </div>
          </ScrollArea>

          {/* Close button */}
          {onClose && (
            <div className="flex justify-end px-3 py-1.5 border-t border-border/50">
              <Button variant="ghost" size="sm" onClick={onClose} className="h-6 text-[10px]">
                Fermer le rapport
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const ReportEntryRow: React.FC<{ entry: BatchReportEntry }> = ({ entry }) => {
  const [showDetails, setShowDetails] = useState(false);

  const recConfig = {
    go: { icon: CheckCircle2, label: 'Go', cls: 'text-emerald-600' },
    maybe: { icon: AlertCircle, label: 'Maybe', cls: 'text-amber-600' },
    skip: { icon: XCircle, label: 'Skip', cls: 'text-red-500' },
  }[entry.recommendation];

  const Icon = recConfig.icon;

  return (
    <div className="px-3 py-1.5 hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        {/* Recommendation icon */}
        <Icon className={cn("w-3.5 h-3.5 shrink-0", recConfig.cls)} />

        {/* Score */}
        <span className={cn(
          "text-xs font-bold tabular-nums w-8 text-right shrink-0",
          entry.score >= 70 ? 'text-emerald-600' :
          entry.score >= 45 ? 'text-amber-600' : 'text-red-500'
        )}>
          {entry.score}
        </span>

        {/* Name */}
        <span className="text-xs font-medium text-foreground truncate min-w-0">
          {entry.name}
        </span>

        {/* LinkedIn link */}
        {entry.profileUrl && (
          <a
            href={entry.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0077B5] hover:text-[#005885] shrink-0"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}

        {/* Hard filter badge */}
        {entry.hardFilterPassed === false && (
          <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-200 shrink-0">
            <Ban className="w-2.5 h-2.5" />
            Filtre KO
          </span>
        )}

        {/* Dismissed badge */}
        {entry.dismissed && entry.hardFilterPassed !== false && (
          <span className="text-[9px] px-1.5 py-0.5 bg-muted text-muted-foreground border border-border shrink-0">
            Écarté
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Details toggle */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-[9px] text-muted-foreground hover:text-foreground shrink-0"
        >
          {showDetails ? 'Masquer' : 'Détails'}
        </button>
      </div>

      {/* Headline */}
      {entry.headline && (
        <p className="text-[10px] text-muted-foreground truncate ml-[3.25rem]">
          {entry.headline}
        </p>
      )}

      {/* Expanded details */}
      {showDetails && (
        <div className="mt-1 ml-[3.25rem] text-[10px] text-muted-foreground space-y-0.5">
          {entry.hardFilterKO && (
            <p className="text-red-500">
              <strong>Raison du filtre :</strong> {entry.hardFilterKO}
            </p>
          )}
          {entry.summary && (
            <p>
              <strong>Résumé :</strong> {entry.summary}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
