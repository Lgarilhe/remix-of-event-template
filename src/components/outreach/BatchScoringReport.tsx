import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Ban, ExternalLink } from 'lucide-react';
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
    <div className="border border-foreground bg-background mb-3">
      {/* Header bar */}
      <div className="h-0.5 bg-brutal-accent" />
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-foreground uppercase tracking-widest">
            Compte rendu — {entries.length} profils{durationLabel && ` en ${durationLabel}`}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
            <span className="text-foreground">✅ {counts.go}</span>
            <span className="text-foreground/60">🤔 {counts.maybe}</span>
            <span className="text-foreground/40">❌ {counts.skip}</span>
          </div>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          }
        </div>
      </button>

      {expanded && (
        <>
          {/* Stats row */}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-y-1 gap-x-4 text-[10px] text-muted-foreground px-3 py-1.5 border-t border-border bg-muted/20 font-medium uppercase tracking-wider">
              <span>🚫 {stats.hardFiltered} éliminés par filtres</span>
              <span>⚡ {stats.llmSkipped} sans IA</span>
              <span>🧠 {stats.llmCalled} scorés par IA</span>
              <span>📊 Moy: <span className="font-bold text-foreground">{stats.avgScore}/100</span></span>
              {stats.totalTokens > 0 && (
                <span>🪙 {stats.totalTokens.toLocaleString()} tokens</span>
              )}
            </div>
          )}

          {/* Filter tabs */}
          <div className="flex items-center gap-px px-3 py-1.5 border-t border-border">
            {FILTER_TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={cn(
                  "h-6 px-2 text-[10px] font-bold uppercase tracking-wider transition-colors",
                  filter === tab.value
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                )}
              >
                {tab.emoji} {tab.label} {counts[tab.value] > 0 && `(${counts[tab.value]})`}
              </button>
            ))}
          </div>

          {/* Entries list */}
          <ScrollArea className="max-h-[280px] border-t border-border">
            <div className="divide-y divide-border/40">
              {filtered.map(entry => (
                <ReportEntryRow key={entry.profileId} entry={entry} />
              ))}
            </div>
          </ScrollArea>

          {/* Close */}
          {onClose && (
            <div className="flex justify-end px-3 py-1.5 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-6 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
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

  const recEmoji = {
    go: '✅',
    maybe: '🤔',
    skip: '❌',
  }[entry.recommendation];

  return (
    <div className="px-3 py-1.5 hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        {/* Recommendation emoji */}
        <span className="text-xs shrink-0">{recEmoji}</span>

        {/* Score */}
        <span className={cn(
          "text-xs font-black tabular-nums w-7 text-right shrink-0",
          entry.score >= 70 ? 'text-foreground' :
          entry.score >= 45 ? 'text-foreground/60' : 'text-foreground/30'
        )}>
          {entry.score}
        </span>

        {/* Name */}
        <span className="text-xs font-bold text-foreground truncate min-w-0 uppercase tracking-wide">
          {entry.name}
        </span>

        {/* LinkedIn link */}
        {entry.profileUrl && (
          <a
            href={entry.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink className="w-3 h-3" />
          </a>
        )}

        {/* Hard filter badge */}
        {entry.hardFilterPassed === false && (
          <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-muted text-foreground/60 border border-foreground/20 font-bold uppercase tracking-wider shrink-0">
            <Ban className="w-2.5 h-2.5" />
            Filtre KO
          </span>
        )}

        {/* Dismissed badge */}
        {entry.dismissed && entry.hardFilterPassed !== false && (
          <span className="text-[9px] px-1.5 py-0.5 bg-muted text-muted-foreground border border-foreground/10 font-bold uppercase tracking-wider shrink-0">
            Écarté
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Details toggle */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-[9px] text-muted-foreground hover:text-foreground font-bold uppercase tracking-wider shrink-0 transition-colors"
        >
          {showDetails ? 'Masquer' : 'Détails'}
        </button>
      </div>

      {/* Headline */}
      {entry.headline && (
        <p className="text-[10px] text-muted-foreground truncate ml-[3.25rem] mt-0.5">
          {entry.headline}
        </p>
      )}

      {/* Expanded details */}
      {showDetails && (
        <div className="mt-1.5 ml-[3.25rem] text-[10px] text-muted-foreground space-y-1 border-l-2 border-foreground/10 pl-2">
          {entry.hardFilterKO && (
            <p>
              <span className="font-bold text-foreground/70 uppercase tracking-wider text-[9px]">Raison filtre :</span>{' '}
              {entry.hardFilterKO}
            </p>
          )}
          {entry.summary && (
            <p>
              <span className="font-bold text-foreground/70 uppercase tracking-wider text-[9px]">Résumé :</span>{' '}
              {entry.summary}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
