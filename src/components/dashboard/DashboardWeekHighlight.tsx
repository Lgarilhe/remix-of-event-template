/**
 * DashboardWeekHighlight — récap "cette semaine" condensé.
 *
 * Différent de l'analytics complet (`/pipeline?view=analytics`) : ici on a
 * 1 phrase highlight + 4 mini-stats inline + lien vers analytics complet.
 *
 * Le headline est calculé : on cherche la métrique avec la meilleure
 * progression vs semaine précédente et on l'affiche en gros ("+18% de
 * réponses cette semaine"). Si rien à dire (cohorte trop faible), on bascule
 * sur un volume neutre ("12 candidats contactés cette semaine").
 */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { differenceInDays, parseISO, subDays } from 'date-fns';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Users,
  Send,
  MessageCircle,
  CheckCircle2,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ATSCandidate } from '@/hooks/useATSData';

interface DashboardWeekHighlightProps {
  candidates: ATSCandidate[];
}

interface WeekStats {
  added: number;
  contacted: number;
  replied: number;
  won: number;
}

const isContactedHelper = (c: ATSCandidate) => {
  if (['messaged', 'replied', 'interested', 'not_interested'].includes(c.outreachStatus || '')) return true;
  if (['Contacté', 'Répondu'].includes(c.stage)) return true;
  if (c.sequenceStatus && ['active', 'completed', 'replied'].includes(c.sequenceStatus)) return true;
  if (c.source === 'inmail' && c.stage !== 'Nouveau') return true;
  return false;
};

const isRepliedHelper = (c: ATSCandidate) => {
  if (['Répondu', 'Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre', 'Gagné'].includes(c.stage)) return true;
  if (['replied', 'interested', 'not_interested'].includes(c.outreachStatus || '')) return true;
  if (c.sequenceStatus === 'replied') return true;
  return false;
};

const inWindow = (createdAt: string | null | undefined, start: Date, end: Date) => {
  if (!createdAt) return false;
  try {
    const d = parseISO(createdAt);
    return d >= start && d < end;
  } catch {
    return false;
  }
};

export const DashboardWeekHighlight: React.FC<DashboardWeekHighlightProps> = ({
  candidates,
}) => {
  const navigate = useNavigate();

  const { current, previous, headline, headlineTone } = useMemo(() => {
    const now = new Date();
    const weekStart = subDays(now, 7);
    const prevWeekStart = subDays(now, 14);

    const currentCohort = candidates.filter(c => inWindow(c.createdAt, weekStart, now));
    const previousCohort = candidates.filter(c => inWindow(c.createdAt, prevWeekStart, weekStart));

    // Replied this week is broader: anything with lastActivity OR createdAt this week that's replied
    const repliedThisWeek = candidates.filter(c => {
      if (!isRepliedHelper(c)) return false;
      const date = c.lastActivity || c.createdAt;
      if (!date) return false;
      return inWindow(date, weekStart, now);
    }).length;
    const repliedPrevWeek = candidates.filter(c => {
      if (!isRepliedHelper(c)) return false;
      const date = c.lastActivity || c.createdAt;
      if (!date) return false;
      return inWindow(date, prevWeekStart, weekStart);
    }).length;

    const cur: WeekStats = {
      added: currentCohort.length,
      contacted: currentCohort.filter(isContactedHelper).length,
      replied: repliedThisWeek,
      won: currentCohort.filter(c => c.stage === 'Gagné').length,
    };
    const prev: WeekStats = {
      added: previousCohort.length,
      contacted: previousCohort.filter(isContactedHelper).length,
      replied: repliedPrevWeek,
      won: previousCohort.filter(c => c.stage === 'Gagné').length,
    };

    // Pick the best signal for headline
    const candidates_metrics: Array<{
      label: string;
      cur: number;
      prev: number;
      delta: number;
      tone: 'positive' | 'negative' | 'neutral';
    }> = [];

    const computeDelta = (current: number, previous: number, threshold = 3) => {
      if (previous < threshold) return null;
      return Math.round(((current - previous) / previous) * 100);
    };

    const repliedDelta = computeDelta(cur.replied, prev.replied);
    const contactedDelta = computeDelta(cur.contacted, prev.contacted);
    const addedDelta = computeDelta(cur.added, prev.added);

    if (repliedDelta !== null && Math.abs(repliedDelta) >= 10) {
      candidates_metrics.push({
        label: 'réponses',
        cur: cur.replied,
        prev: prev.replied,
        delta: repliedDelta,
        tone: repliedDelta > 0 ? 'positive' : 'negative',
      });
    }
    if (contactedDelta !== null && Math.abs(contactedDelta) >= 10) {
      candidates_metrics.push({
        label: 'candidats contactés',
        cur: cur.contacted,
        prev: prev.contacted,
        delta: contactedDelta,
        tone: contactedDelta > 0 ? 'positive' : 'negative',
      });
    }
    if (addedDelta !== null && Math.abs(addedDelta) >= 10) {
      candidates_metrics.push({
        label: 'nouveaux candidats',
        cur: cur.added,
        prev: prev.added,
        delta: addedDelta,
        tone: addedDelta > 0 ? 'positive' : 'negative',
      });
    }

    // Sort by absolute delta desc, take strongest signal
    candidates_metrics.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    let headline: string;
    let tone: 'positive' | 'negative' | 'neutral';

    if (candidates_metrics.length > 0) {
      const best = candidates_metrics[0];
      const sign = best.delta > 0 ? '+' : '';
      headline = `${sign}${best.delta}% de ${best.label} cette semaine`;
      tone = best.tone;
    } else if (cur.contacted > 0) {
      headline = `${cur.contacted} candidat${cur.contacted > 1 ? 's' : ''} contacté${cur.contacted > 1 ? 's' : ''} cette semaine`;
      tone = 'neutral';
    } else if (cur.added > 0) {
      headline = `${cur.added} nouveau${cur.added > 1 ? 'x' : ''} candidat${cur.added > 1 ? 's' : ''} cette semaine`;
      tone = 'neutral';
    } else {
      headline = 'Pas encore d\'activité cette semaine';
      tone = 'neutral';
    }

    return { current: cur, previous: prev, headline, headlineTone: tone };
  }, [candidates]);

  const TrendBadge: React.FC<{ cur: number; prev: number; threshold?: number }> = ({ cur, prev, threshold = 3 }) => {
    if (prev < threshold) return null;
    const delta = Math.round(((cur - prev) / prev) * 100);
    if (Math.abs(delta) < 5) {
      return (
        <span className="inline-flex items-center text-[10px] text-muted-foreground/70">
          <Minus className="w-2.5 h-2.5" />
        </span>
      );
    }
    const positive = delta > 0;
    const Icon = positive ? TrendingUp : TrendingDown;
    return (
      <span
        className={cn(
          'inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums',
          positive ? 'text-success' : 'text-destructive',
        )}
      >
        <Icon className="w-2.5 h-2.5" />
        {positive ? '+' : ''}
        {delta}%
      </span>
    );
  };

  const headlineToneStyles = {
    positive: 'bg-success/10 text-success ring-success/30',
    negative: 'bg-destructive/10 text-destructive ring-destructive/30',
    neutral: 'bg-foreground/[0.06] text-foreground ring-border',
  }[headlineTone];

  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-5 py-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ring-1', headlineToneStyles)}>
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
              Cette semaine
            </p>
            <h2 className="font-display font-bold text-foreground text-[15px] tracking-tight leading-tight truncate">
              {headline}
            </h2>
          </div>
        </div>
        <button
          onClick={() => navigate('/pipeline?view=analytics')}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-background hover:bg-accent text-[11.5px] font-medium text-foreground transition-colors shrink-0 self-start lg:self-auto"
        >
          Analytics complet
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Mini stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-border">
        {[
          { icon: <Users className="w-3.5 h-3.5" />, label: 'Ajoutés', cur: current.added, prev: previous.added },
          { icon: <Send className="w-3.5 h-3.5" />, label: 'Contactés', cur: current.contacted, prev: previous.contacted },
          { icon: <MessageCircle className="w-3.5 h-3.5" />, label: 'Réponses', cur: current.replied, prev: previous.replied },
          { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: 'Placements', cur: current.won, prev: previous.won, threshold: 1 },
        ].map((stat, i) => (
          <div key={stat.label} className="px-4 py-3.5 flex items-center gap-3">
            <div className="h-7 w-7 rounded-lg bg-foreground/[0.06] text-muted-foreground flex items-center justify-center shrink-0">
              {stat.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-lg font-bold text-foreground tabular-nums leading-none">
                  {stat.cur}
                </span>
                <TrendBadge cur={stat.cur} prev={stat.prev} threshold={stat.threshold || 3} />
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mt-1">
                {stat.label}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
