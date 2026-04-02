import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Ban, ExternalLink, X, ChevronRight, Sparkles, TrendingUp, Clock, Brain, BarChart3 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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

/* ── Animation variants ── */
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.92, y: 30 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 340, damping: 28, mass: 0.8 },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 20,
    transition: { duration: 0.2, ease: 'easeIn' },
  },
};

const listContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.15 },
  },
};

const listItemVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring' as const, stiffness: 400, damping: 26 },
  },
};

export const BatchScoringReport: React.FC<BatchScoringReportProps> = ({
  entries,
  stats,
  durationMs,
  onClose,
}) => {
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const isOpen = entries.length > 0;

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

  const goPercent = counts.all > 0 ? Math.round((counts.go / counts.all) * 100) : 0;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <DialogContent className="sm:max-w-[540px] max-h-[85dvh] p-0 gap-0 border-2 border-border overflow-hidden bg-background">
        <DialogHeader className="sr-only">
          <DialogTitle>Rapport de scoring</DialogTitle>
          <DialogDescription>Résultats du scoring IA des profils</DialogDescription>
        </DialogHeader>

        {/* ── Accent bar ── */}
        <motion.div
          className="h-1 bg-gradient-to-r from-brutal-accent via-primary to-brutal-accent"
          initial={{ scaleX: 0, transformOrigin: 'left' }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* ── Header ── */}
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <motion.div
                initial={{ rotate: -180, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
              >
                <Sparkles className="w-5 h-5 text-brutal-accent" />
              </motion.div>
              <div>
                <h2 className="text-sm font-black uppercase tracking-widest text-foreground">
                  Scoring terminé
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5 font-medium">
                  {entries.length} profil{entries.length > 1 ? 's' : ''} analysé{entries.length > 1 ? 's' : ''}
                  {durationLabel && ` · ${durationLabel}`}
                </p>
              </div>
            </div>
            <button
              onClick={() => onClose?.()}
              className="p-1.5 text-muted-foreground hover:text-foreground border border-transparent hover:border-border transition-all rounded-sm"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Stats cards ── */}
          {stats && (
            <motion.div
              className="grid grid-cols-3 gap-2 mb-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
            >
              <StatCard
                icon={<Brain className="w-3.5 h-3.5" />}
                label="Scorés IA"
                value={stats.llmCalled}
                accent
              />
              <StatCard
                icon={<BarChart3 className="w-3.5 h-3.5" />}
                label="Score moyen"
                value={`${stats.avgScore}`}
                suffix="/100"
              />
              <StatCard
                icon={<TrendingUp className="w-3.5 h-3.5" />}
                label="Taux Go"
                value={`${goPercent}%`}
                highlight={goPercent > 50}
              />
            </motion.div>
          )}

          {/* ── Go ratio bar ── */}
          <motion.div
            className="h-1.5 bg-muted rounded-full overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <motion.div
              className="h-full bg-foreground rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${goPercent}%` }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.4 }}
            />
          </motion.div>

          {/* ── Filter pills ── */}
          <div className="flex items-center gap-1.5 mt-3">
            {([
              { key: 'all' as const, label: 'Tous', count: counts.all },
              { key: 'go' as const, label: '✓ Go', count: counts.go },
              { key: 'maybe' as const, label: '? Peut-être', count: counts.maybe },
              { key: 'skip' as const, label: '✗ Skip', count: counts.skip },
            ]).map((item) => (
              <motion.button
                key={item.key}
                onClick={() => setFilter(item.key)}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  "h-6 px-2.5 text-xs font-black uppercase tracking-widest border transition-all",
                  filter === item.key
                    ? 'bg-foreground text-background border-border'
                    : 'text-muted-foreground border-border hover:text-foreground hover:border-border'
                )}
              >
                {item.label} {item.count}
              </motion.button>
            ))}
          </div>
        </div>

        {/* ── Entries list ── */}
        <ScrollArea className="flex-1 max-h-[340px] border-t border-border">
          <motion.div
            variants={listContainerVariants}
            initial="hidden"
            animate="visible"
            key={filter}
          >
            {filtered.map((entry) => (
              <motion.div key={entry.profileId} variants={listItemVariants}>
                <ReportEntryRow
                  entry={entry}
                  isSelected={selectedEntry === entry.profileId}
                  onToggle={() => setSelectedEntry(s => s === entry.profileId ? null : entry.profileId)}
                />
              </motion.div>
            ))}
            {filtered.length === 0 && (
              <div className="py-8 text-center text-xs font-bold text-muted-foreground uppercase tracking-widest">
                Aucun profil dans cette catégorie
              </div>
            )}
          </motion.div>
        </ScrollArea>

        {/* ── Footer ── */}
        {stats && stats.llmCalled > 0 && (
          <motion.div
            className="px-5 py-2.5 border-t border-border bg-muted/20 flex items-center justify-between"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
              {stats.llmCalled} crédit{stats.llmCalled > 1 ? 's' : ''} IA utilisé{stats.llmCalled > 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-2.5 h-2.5" />
              {durationLabel}
            </div>
          </motion.div>
        )}
      </DialogContent>
    </Dialog>
  );
};

/* ── Stat Card ── */

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  suffix?: string;
  accent?: boolean;
  highlight?: boolean;
}> = ({ icon, label, value, suffix, accent, highlight }) => (
  <div className={cn(
    "border px-3 py-2 flex flex-col gap-1",
    accent ? 'border-accent/30 bg-accent/5' : 'border-border bg-muted/30'
  )}>
    <div className="flex items-center gap-1.5 text-muted-foreground">
      {icon}
      <span className="text-[8px] font-bold uppercase tracking-widest">{label}</span>
    </div>
    <span className={cn(
      "text-base font-black tabular-nums",
      highlight ? 'text-brutal-accent' : 'text-foreground'
    )}>
      {value}
      {suffix && <span className="text-xs font-bold text-muted-foreground ml-0.5">{suffix}</span>}
    </span>
  </div>
);

/* ── Entry Row ── */

const ScoreBadge: React.FC<{ score: number; recommendation: string }> = ({ score, recommendation }) => (
  <div className={cn(
    "w-8 h-8 flex items-center justify-center text-xs font-black tabular-nums shrink-0 border transition-colors",
    recommendation === 'go'
      ? 'bg-foreground text-background border-border'
      : recommendation === 'maybe'
        ? 'bg-muted text-foreground border-border'
        : 'bg-muted/50 text-muted-foreground border-border'
  )}>
    {score}
  </div>
);

interface ReportEntryRowProps {
  entry: BatchReportEntry;
  isSelected: boolean;
  onToggle: () => void;
}

const ReportEntryRow: React.FC<ReportEntryRowProps> = ({ entry, isSelected, onToggle }) => (
  <div
    className={cn(
      "group border-b border-border/50 last:border-0 cursor-pointer transition-colors",
      isSelected ? 'bg-muted/50' : 'hover:bg-muted/20'
    )}
    onClick={onToggle}
  >
    <div className="flex items-center gap-2.5 px-4 py-2">
      <ScoreBadge score={entry.score} recommendation={entry.recommendation} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-foreground truncate uppercase tracking-wider">
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
          <p className="text-xs text-muted-foreground truncate mt-px leading-tight">
            {entry.headline}
          </p>
        )}
      </div>

      <motion.div
        animate={{ rotate: isSelected ? 90 : 0 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
      </motion.div>
    </div>

    <AnimatePresence>
      {isSelected && (entry.summary || entry.hardFilterKO) && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="px-4 pb-2.5 ml-[2.625rem] text-xs text-muted-foreground space-y-1 border-l-2 border-border pl-2.5">
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
  </div>
);
