import React, { useState, useMemo, useEffect } from 'react';
import { Ban, ExternalLink, X, ChevronRight, Sparkles, TrendingUp, Clock, Brain, BarChart3, Check, HelpCircle, Zap } from 'lucide-react';
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
      <DialogContent className="sm:max-w-[600px] max-h-[90dvh] p-0 gap-0 border border-border overflow-hidden bg-background rounded-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Rapport de scoring</DialogTitle>
          <DialogDescription>Résultats du scoring IA des profils</DialogDescription>
        </DialogHeader>

        {/* ── Accent gradient bar (Skalr) ── */}
        <motion.div
          className="h-1 konekt-skalr-bg"
          initial={{ scaleX: 0, transformOrigin: 'left' }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* ── Header ── */}
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <motion.div
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 240, damping: 20, delay: 0.1 }}
                className="h-10 w-10 rounded-xl grid place-items-center konekt-skalr-bg konekt-shine flex-shrink-0"
              >
                <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
              </motion.div>
              <div className="min-w-0">
                <h2 className="font-display text-[17px] font-bold leading-tight">
                  Scoring terminé
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {entries.length} profil{entries.length > 1 ? 's' : ''} analysé{entries.length > 1 ? 's' : ''}
                  {durationLabel && (
                    <>
                      <span className="mx-1.5 text-muted-foreground/40">·</span>
                      <span className="inline-flex items-center gap-1 align-middle">
                        <Clock className="w-3 h-3" /> {durationLabel}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={() => onClose?.()}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors rounded-md"
              aria-label="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Stats cards ── */}
          {stats && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              className="mb-4 space-y-2"
            >
              <div className="grid grid-cols-3 gap-2.5">
                <StatCard
                  icon={<Brain className="w-3.5 h-3.5" />}
                  label="Scorés IA"
                  value={stats.llmCalled}
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
                  highlight={goPercent > 30}
                />
              </div>
              {/* Tiered routing — ligne discrète quand certains profils ont
                  été ré-évalués par une IA plus puissante (qualité +) */}
              {(stats.escalated ?? 0) > 0 && (
                <div
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground pl-1"
                  title="Profils borderline ré-évalués par une IA plus puissante pour plus de précision"
                >
                  <Zap className="w-3 h-3 text-amber-400 shrink-0" />
                  <span>
                    <span className="font-semibold text-foreground">{stats.escalated}</span>
                    {' profil'}{(stats.escalated ?? 0) > 1 ? 's' : ''}{' ré-évalué'}{(stats.escalated ?? 0) > 1 ? 's' : ''}{' par une IA plus précise'}
                  </span>
                </div>
              )}
            </motion.div>
          )}

          {/* ── Go ratio bar ── */}
          <motion.div
            className="h-1.5 bg-muted rounded-full overflow-hidden mb-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{
                background: goPercent > 30
                  ? 'linear-gradient(90deg, hsl(var(--status-success)), hsl(142 71% 55%))'
                  : 'hsl(var(--foreground))',
              }}
              initial={{ width: 0 }}
              animate={{ width: `${goPercent}%` }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.4 }}
            />
          </motion.div>

          {/* ── Filter pills ── */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <FilterPill
              label="Tous"
              count={counts.all}
              active={filter === 'all'}
              onClick={() => setFilter('all')}
            />
            <FilterPill
              label="Go"
              count={counts.go}
              variant="success"
              active={filter === 'go'}
              onClick={() => setFilter('go')}
            />
            <FilterPill
              label="Peut-être"
              count={counts.maybe}
              variant="info"
              active={filter === 'maybe'}
              onClick={() => setFilter('maybe')}
            />
            <FilterPill
              label="Skip"
              count={counts.skip}
              variant="muted"
              active={filter === 'skip'}
              onClick={() => setFilter('skip')}
            />
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
              <div className="py-10 text-center">
                <p className="text-sm text-muted-foreground">Aucun profil dans cette catégorie</p>
              </div>
            )}
          </motion.div>
        </ScrollArea>

        {/* ── Footer ── */}
        {stats && stats.llmCalled > 0 && (
          <motion.div
            className="px-6 py-3 border-t border-border bg-muted/20 flex items-center justify-between"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" />
              {stats.llmCalled} crédit{stats.llmCalled > 1 ? 's' : ''} IA utilisé{stats.llmCalled > 1 ? 's' : ''}
            </span>
            {durationLabel && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {durationLabel}
              </span>
            )}
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
  highlight?: boolean;
}> = ({ icon, label, value, suffix, highlight }) => (
  <div
    className={cn(
      'rounded-lg px-3 py-2.5 border bg-card transition-colors',
      highlight ? 'border-success/40' : 'border-border',
    )}
    style={highlight ? { background: 'hsl(var(--status-success-muted) / 0.4)' } : undefined}
  >
    <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
      {icon}
      <span className="text-[10px] font-semibold">{label}</span>
    </div>
    <span
      className={cn(
        'font-display text-lg font-bold tabular-nums leading-tight',
        highlight ? '' : 'text-foreground',
      )}
      style={highlight ? { color: 'hsl(var(--status-success))' } : undefined}
    >
      {value}
      {suffix && <span className="text-xs font-medium text-muted-foreground ml-0.5">{suffix}</span>}
    </span>
  </div>
);

/* ── Filter Pill ── */

const FilterPill: React.FC<{
  label: string;
  count: number;
  variant?: 'success' | 'info' | 'muted';
  active: boolean;
  onClick: () => void;
}> = ({ label, count, variant, active, onClick }) => {
  const variantColor = variant === 'success'
    ? 'hsl(var(--status-success))'
    : variant === 'info'
      ? 'hsl(var(--status-info))'
      : variant === 'muted'
        ? 'hsl(var(--muted-foreground))'
        : 'hsl(var(--foreground))';

  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className={cn(
        'h-7 px-3 rounded-full text-xs font-medium border transition-all flex items-center gap-1.5',
        active
          ? 'bg-foreground text-background border-foreground'
          : 'bg-card text-foreground border-border hover:border-foreground/30 hover:bg-accent',
      )}
    >
      {variant && !active && (
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: variantColor }} />
      )}
      <span>{label}</span>
      <span
        className={cn(
          'tabular-nums font-mono text-[11px]',
          active ? 'opacity-70' : 'text-muted-foreground',
        )}
      >
        {count}
      </span>
    </motion.button>
  );
};

/* ── Score Badge (avec couleur sémantique selon la reco) ── */

const ScoreBadge: React.FC<{ score: number; recommendation: string }> = ({ score, recommendation }) => {
  const config =
    recommendation === 'go'
      ? {
          bg: 'hsl(var(--status-success-muted))',
          color: 'hsl(var(--status-success))',
          icon: <Check className="w-2.5 h-2.5" strokeWidth={3} />,
        }
      : recommendation === 'maybe'
        ? {
            bg: 'hsl(var(--status-info-muted))',
            color: 'hsl(var(--status-info))',
            icon: <HelpCircle className="w-2.5 h-2.5" strokeWidth={2.5} />,
          }
        : {
            bg: 'hsl(var(--muted))',
            color: 'hsl(var(--muted-foreground))',
            icon: null,
          };

  return (
    <div
      className="w-10 h-10 rounded-lg flex flex-col items-center justify-center shrink-0 border"
      style={{
        background: config.bg,
        borderColor: config.color,
        color: config.color,
      }}
    >
      <span className="text-[13px] font-bold tabular-nums leading-none font-display">{score}</span>
      {config.icon && <div className="mt-0.5">{config.icon}</div>}
    </div>
  );
};

/* ── Entry Row ── */

interface ReportEntryRowProps {
  entry: BatchReportEntry;
  isSelected: boolean;
  onToggle: () => void;
}

const ReportEntryRow: React.FC<ReportEntryRowProps> = ({ entry, isSelected, onToggle }) => (
  <div
    className={cn(
      'group border-b border-border/50 last:border-0 cursor-pointer transition-colors',
      isSelected ? 'bg-muted/40' : 'hover:bg-muted/20',
    )}
    onClick={onToggle}
  >
    <div className="flex items-center gap-3 px-4 py-2.5">
      <ScoreBadge score={entry.score} recommendation={entry.recommendation} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-foreground truncate">
            {entry.name}
          </span>
          {entry.profileUrl && (
            <a
              href={entry.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground shrink-0 transition-colors opacity-0 group-hover:opacity-100"
              onClick={e => e.stopPropagation()}
              aria-label="Ouvrir le profil LinkedIn"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {entry.hardFilterPassed === false && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
              style={{
                background: 'hsl(var(--destructive) / 0.12)',
                color: 'hsl(var(--destructive))',
              }}
            >
              <Ban className="w-2.5 h-2.5" />
              KO
            </span>
          )}
        </div>
        {entry.headline && (
          <p className="text-xs text-muted-foreground truncate mt-0.5 leading-tight">
            {entry.headline}
          </p>
        )}
      </div>

      <motion.div
        animate={{ rotate: isSelected ? 90 : 0 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
      >
        <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
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
          <div className="px-4 pb-3 ml-[3.25rem] text-xs text-muted-foreground space-y-1.5 border-l-2 border-border pl-3">
            {entry.hardFilterKO && (
              <p>
                <span className="text-[10px] font-semibold text-foreground/70 mr-1">Filtre :</span>
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
