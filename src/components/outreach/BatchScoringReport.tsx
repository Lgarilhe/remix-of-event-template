import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Ban, ExternalLink, X, ChevronRight, Sparkles, Brain, BarChart3 } from 'lucide-react';
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

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  if (entries.length === 0) return null;

  const goPercent = counts.all > 0 ? Math.round((counts.go / counts.all) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.96 }}
      animate={closing
        ? { opacity: 0, y: -20, scale: 0.96, transition: { duration: 0.25 } }
        : { opacity: 1, y: 0, scale: 1 }
      }
      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
      className="mx-3 sm:mx-4 mt-3 mb-3 relative overflow-hidden border border-border bg-background"
      style={{ boxShadow: '0 8px 32px -8px hsl(var(--foreground) / 0.12)' }}
    >
      {/* Animated gradient accent bar */}
      <motion.div
        className="h-1 bg-gradient-to-r from-brutal-accent via-primary to-brutal-accent"
        initial={{ scaleX: 0, transformOrigin: 'left' }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
      />

      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ rotate: -180, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
          >
            <Sparkles className="w-4 h-4 text-brutal-accent" />
          </motion.div>
          <div>
            <span className="text-xs font-black text-foreground uppercase tracking-widest">
              Scoring terminé
            </span>
            <span className="text-[10px] text-muted-foreground ml-2 font-medium">
              {entries.length} profils{durationLabel && ` · ${durationLabel}`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Animated score pills */}
          <div className="flex items-center gap-1.5">
            {[
              { key: 'go' as const, count: counts.go, bg: 'bg-emerald-500', label: 'Go' },
              { key: 'maybe' as const, count: counts.maybe, bg: 'bg-amber-400', label: 'Maybe' },
              { key: 'skip' as const, count: counts.skip, bg: 'bg-foreground/20', label: 'Skip' },
            ].map((item, i) => (
              <motion.button
                key={item.key}
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 + i * 0.08, type: 'spring', stiffness: 500 }}
                onClick={() => setFilter(f => f === item.key ? 'all' : item.key)}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-all",
                  filter === item.key
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className={cn("w-2 h-2 rounded-full shrink-0", item.bg)} />
                {item.count}
              </motion.button>
            ))}
          </div>

          {/* Close */}
          {onClose && (
            <motion.button
              whileHover={{ scale: 1.15, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleClose}
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              title="Fermer (Échap)"
            >
              <X className="w-4 h-4" />
            </motion.button>
          )}
        </div>
      </div>

      {/* Stats bar — subtle, one line */}
      {stats && (
        <div className="flex items-center gap-4 px-4 py-1.5 border-t border-border/50 bg-muted/30">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Brain className="w-3 h-3" />
            <span>{stats.llmCalled} scorés</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <BarChart3 className="w-3 h-3" />
            <span>Moy: <span className="font-bold text-foreground">{stats.avgScore}</span>/100</span>
          </div>
          {stats.llmCalled > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Sparkles className="w-3 h-3" />
              <span>{stats.llmCalled} crédit{stats.llmCalled > 1 ? 's' : ''} IA</span>
            </div>
          )}
          {/* Mini progress bar showing go ratio */}
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 bg-muted overflow-hidden">
              <motion.div
                className="h-full bg-emerald-500"
                initial={{ width: 0 }}
                animate={{ width: `${goPercent}%` }}
                transition={{ duration: 0.8, ease: 'easeOut', delay: 0.4 }}
              />
            </div>
            <span className="text-[10px] font-bold text-foreground tabular-nums">{goPercent}% Go</span>
          </div>
        </div>
      )}

      {/* Entries list with stagger */}
      <ScrollArea className="max-h-[260px] border-t border-border/50">
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
            <div className="py-6 text-center text-xs text-muted-foreground">
              Aucun profil dans cette catégorie
            </div>
          )}
        </div>
      </ScrollArea>
    </motion.div>
  );
};

// ── Entry Row ──────────────────────────────────────────────

interface ReportEntryRowProps {
  entry: BatchReportEntry;
  index: number;
  isSelected: boolean;
  onToggle: () => void;
}

const ScoreBadge: React.FC<{ score: number; recommendation: string }> = ({ score, recommendation }) => {
  const bg = recommendation === 'go'
    ? 'bg-emerald-500'
    : recommendation === 'maybe'
      ? 'bg-amber-400'
      : 'bg-foreground/20';

  return (
    <div className={cn(
      "w-8 h-8 flex items-center justify-center text-xs font-black tabular-nums shrink-0",
      bg,
      recommendation === 'go' || recommendation === 'maybe' ? 'text-white' : 'text-foreground/60'
    )}>
      {score}
    </div>
  );
};

const ReportEntryRow: React.FC<ReportEntryRowProps> = ({ entry, index, isSelected, onToggle }) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.25, ease: 'easeOut' }}
      className={cn(
        "group border-b border-border/30 last:border-0 cursor-pointer transition-colors",
        isSelected ? 'bg-muted/40' : 'hover:bg-muted/20'
      )}
      onClick={onToggle}
    >
      <div className="flex items-center gap-3 px-4 py-2">
        <ScoreBadge score={entry.score} recommendation={entry.recommendation} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-foreground truncate uppercase tracking-wide">
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
              <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-destructive/10 text-destructive border border-destructive/20 font-bold uppercase tracking-wider shrink-0">
                <Ban className="w-2.5 h-2.5" />
                KO
              </span>
            )}
          </div>
          {entry.headline && (
            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
              {entry.headline}
            </p>
          )}
        </div>

        <motion.div
          animate={{ rotate: isSelected ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
        </motion.div>
      </div>

      {/* Expandable detail */}
      <AnimatePresence>
        {isSelected && (entry.summary || entry.hardFilterKO) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-2.5 pl-[3.75rem] text-[10px] text-muted-foreground space-y-1">
              {entry.hardFilterKO && (
                <p>
                  <span className="font-bold text-destructive/70 uppercase tracking-wider text-[9px]">Filtre :</span>{' '}
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
};
