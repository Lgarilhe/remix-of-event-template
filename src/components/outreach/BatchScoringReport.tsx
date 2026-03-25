import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, Ban, ExternalLink, X } from 'lucide-react';
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
  const [visible, setVisible] = useState(false);

  // Animate in on mount
  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

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

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => onClose?.(), 250);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.98 }}
      animate={visible ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: -12, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="mx-3 sm:mx-4 mt-3 mb-3 border-2 border-foreground bg-background shadow-[4px_4px_0px_0px_hsl(var(--foreground))]"
    >
      {/* Accent top bar */}
      <div className="h-1 bg-brutal-accent" />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <span className="text-xs font-black text-foreground uppercase tracking-widest">
            Compte rendu
          </span>
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
            {entries.length} profils{durationLabel && ` · ${durationLabel}`}
          </span>
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          }
        </button>

        <div className="flex items-center gap-3">
          {/* Compact counts */}
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
            <span className="text-foreground">✅ {counts.go}</span>
            <span className="text-foreground/60">🤔 {counts.maybe}</span>
            <span className="text-foreground/40">❌ {counts.skip}</span>
          </div>

          {/* Quick close button */}
          {onClose && (
            <button
              onClick={handleClose}
              className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Expandable body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {/* Stats row */}
            {stats && (
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground px-3 py-1.5 border-t border-border bg-muted/20 font-medium uppercase tracking-wider">
                <span>🧠 {stats.llmCalled} scorés</span>
                <span>📊 Moy: <span className="font-bold text-foreground">{stats.avgScore}/100</span></span>
                {stats.llmCalled > 0 && (
                  <span>✦ {stats.llmCalled} crédit{stats.llmCalled > 1 ? 's' : ''} IA</span>
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
                    "h-6 px-2 text-[10px] font-bold uppercase tracking-wider transition-all",
                    filter === tab.value
                      ? 'bg-foreground text-background shadow-[2px_2px_0px_0px_hsl(var(--muted-foreground))]'
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
                {filtered.map((entry, i) => (
                  <ReportEntryRow key={entry.profileId} entry={entry} index={i} />
                ))}
              </div>
            </ScrollArea>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const ReportEntryRow: React.FC<{ entry: BatchReportEntry; index: number }> = ({ entry, index }) => {
  const [showDetails, setShowDetails] = useState(false);

  const recEmoji = {
    go: '✅',
    maybe: '🤔',
    skip: '❌',
  }[entry.recommendation];

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.2 }}
      className="px-3 py-1.5 hover:bg-muted/20 transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs shrink-0">{recEmoji}</span>

        <span className={cn(
          "text-xs font-black tabular-nums w-7 text-right shrink-0",
          entry.score >= 70 ? 'text-foreground' :
          entry.score >= 45 ? 'text-foreground/60' : 'text-foreground/30'
        )}>
          {entry.score}
        </span>

        <span className="text-xs font-bold text-foreground truncate min-w-0 uppercase tracking-wide">
          {entry.name}
        </span>

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

        {entry.hardFilterPassed === false && (
          <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-muted text-foreground/60 border border-foreground/20 font-bold uppercase tracking-wider shrink-0">
            <Ban className="w-2.5 h-2.5" />
            Filtre KO
          </span>
        )}

        {entry.dismissed && entry.hardFilterPassed !== false && (
          <span className="text-[9px] px-1.5 py-0.5 bg-muted text-muted-foreground border border-foreground/10 font-bold uppercase tracking-wider shrink-0">
            Écarté
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-[9px] text-muted-foreground hover:text-foreground font-bold uppercase tracking-wider shrink-0 transition-colors"
        >
          {showDetails ? 'Masquer' : 'Détails'}
        </button>
      </div>

      {entry.headline && (
        <p className="text-[10px] text-muted-foreground truncate ml-[3.25rem] mt-0.5">
          {entry.headline}
        </p>
      )}

      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden mt-1.5 ml-[3.25rem] text-[10px] text-muted-foreground space-y-1 border-l-2 border-foreground/10 pl-2"
          >
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
