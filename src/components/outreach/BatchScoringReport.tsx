import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Ban, ExternalLink, X, ChevronRight, Sparkles } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
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

export const BatchScoringReport: React.FC<BatchScoringReportProps> = ({
  entries,
  stats,
  durationMs,
  onClose,
}) => {
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [closing, setClosing] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);

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

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => onClose?.(), 300);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  if (entries.length === 0) return null;

  const goPercent = counts.all > 0 ? Math.round((counts.go / counts.all) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={closing ? { opacity: 0, y: -8 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="mx-3 sm:mx-4 mt-3 mb-3 border-2 border-foreground bg-background"
    >
      {/* Brutal accent bar */}
      <motion.div
        className="h-0.5 bg-brutal-accent"
        initial={{ scaleX: 0, transformOrigin: 'left' }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-3 py-2 border-b border-border gap-1.5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-brutal-accent shrink-0" />
          <span className="text-[11px] font-black text-foreground uppercase tracking-widest whitespace-nowrap">
            Scoring
          </span>
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
            {entries.length} profils{durationLabel && ` · ${durationLabel}`}
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Filter pills — brutal style */}
          {([
            { key: 'go' as const, count: counts.go, activeClass: 'bg-foreground text-background' },
            { key: 'maybe' as const, count: counts.maybe, activeClass: 'bg-foreground text-background' },
            { key: 'skip' as const, count: counts.skip, activeClass: 'bg-foreground text-background' },
          ] as const).map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(f => f === item.key ? 'all' : item.key)}
              className={cn(
                "h-5 px-1.5 text-[9px] font-black uppercase tracking-widest border border-foreground/20 transition-colors",
                filter === item.key
                  ? item.activeClass
                  : 'text-muted-foreground hover:text-foreground hover:border-foreground/40'
              )}
            >
              {item.key === 'go' ? '✓' : item.key === 'maybe' ? '?' : '✗'} {item.count}
            </button>
          ))}

          {/* Close */}
          {onClose && (
            <button
              onClick={handleClose}
              className="p-0.5 ml-1 text-muted-foreground hover:text-foreground border border-transparent hover:border-foreground/30 transition-colors"
              title="Échap"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 border-b border-border bg-muted/30 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
          <span>{stats.llmCalled} scorés IA</span>
          <span className="hidden sm:inline">·</span>
          <span>moy <span className="text-foreground">{stats.avgScore}</span>/100</span>
          {stats.llmCalled > 0 && (
            <>
              <span className="hidden sm:inline">·</span>
              <span>{stats.llmCalled} crédit{stats.llmCalled > 1 ? 's' : ''}</span>
            </>
          )}
          <div className="flex-1 min-w-0" />
          {/* Go ratio bar */}
          <div className="flex items-center gap-1.5">
            <div className="w-12 sm:w-16 h-1 bg-border overflow-hidden">
              <motion.div
                className="h-full bg-foreground"
                initial={{ width: 0 }}
                animate={{ width: `${goPercent}%` }}
                transition={{ duration: 0.6, ease: 'easeOut', delay: 0.2 }}
              />
            </div>
            <span className="text-foreground tabular-nums">{goPercent}%</span>
          </div>
        </div>
      )}

      {/* Entries */}
      <ScrollArea className="max-h-[240px]">
        <div>
          {filtered.map((entry, i) => (
            <ReportEntryRow
              key={entry.profileId}
              entry={entry}
              index={i}
              isSelected={selectedEntry === entry.profileId}
              onToggle={() => setSelectedEntry(s => s === entry.profileId ? null : entry.profileId)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="py-4 text-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              Aucun profil
            </div>
          )}
        </div>
      </ScrollArea>
    </motion.div>
  );
};

// ── Entry Row ──

interface ReportEntryRowProps {
  entry: BatchReportEntry;
  index: number;
  isSelected: boolean;
  onToggle: () => void;
}

const ScoreBadge: React.FC<{ score: number; recommendation: string }> = ({ score, recommendation }) => (
  <div className={cn(
    "w-7 h-7 flex items-center justify-center text-[10px] font-black tabular-nums shrink-0 border",
    recommendation === 'go'
      ? 'bg-foreground text-background border-foreground'
      : recommendation === 'maybe'
        ? 'bg-muted text-foreground border-foreground/40'
        : 'bg-muted/50 text-muted-foreground border-border'
  )}>
    {score}
  </div>
);

const ReportEntryRow: React.FC<ReportEntryRowProps> = ({ entry, index, isSelected, onToggle }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ delay: index * 0.03, duration: 0.2 }}
    className={cn(
      "group border-b border-border/50 last:border-0 cursor-pointer transition-colors",
      isSelected ? 'bg-muted/50' : 'hover:bg-muted/20'
    )}
    onClick={onToggle}
  >
    <div className="flex items-center gap-2.5 px-3 py-1.5">
      <ScoreBadge score={entry.score} recommendation={entry.recommendation} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-foreground truncate uppercase tracking-wider">
            {entry.name}
          </span>
          {entry.profileUrl && (
            <a
              href={entry.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground shrink-0 transition-colors opacity-0 group-hover:opacity-100"
              onClick={e => e.stopPropagation()}
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {entry.hardFilterPassed === false && (
            <span className="inline-flex items-center gap-0.5 text-[8px] px-1 py-px bg-destructive/10 text-destructive border border-destructive/20 font-black uppercase tracking-widest shrink-0">
              <Ban className="w-2 h-2" />
              KO
            </span>
          )}
        </div>
        {entry.headline && (
          <p className="text-[9px] text-muted-foreground truncate mt-px leading-tight">
            {entry.headline}
          </p>
        )}
      </div>

      <motion.div
        animate={{ rotate: isSelected ? 90 : 0 }}
        transition={{ duration: 0.12 }}
      >
        <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
      </motion.div>
    </div>

    <AnimatePresence>
      {isSelected && (entry.summary || entry.hardFilterKO) && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="overflow-hidden"
        >
          <div className="px-3 pb-2 ml-[2.375rem] text-[9px] text-muted-foreground space-y-0.5 border-l-2 border-foreground/10 pl-2">
            {entry.hardFilterKO && (
              <p>
                <span className="font-black text-foreground/60 uppercase tracking-widest text-[8px]">Filtre :</span>{' '}
                {entry.hardFilterKO}
              </p>
            )}
            {entry.summary && (
              <p className="leading-relaxed">{entry.summary}</p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </motion.div>
);
