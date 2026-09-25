/**
 * DashboardWeekHighlight — la semaine en une phrase et quatre chiffres.
 *
 * La phrase met en avant la variation la plus nette par rapport à la semaine
 * précédente ; chaque chiffre a sa courbe sur sept jours. L'analyse détaillée
 * reste dans le pipeline (`/pipeline?view=analytics`).
 */

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { parseISO, subDays } from 'date-fns';
import { TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import { Section } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ATSCandidate } from '@/hooks/useATSData';
import { Sparkline } from './Sparkline';

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

/** Build a 7-day sparkline of a metric. */
const buildSparkline = (
  candidates: ATSCandidate[],
  predicate: (c: ATSCandidate) => boolean,
  useLastActivity: boolean = false,
): number[] => {
  const now = new Date();
  const buckets: number[] = Array(7).fill(0);
  candidates.forEach((c) => {
    if (!predicate(c)) return;
    const dateField = useLastActivity ? c.lastActivity || c.createdAt : c.createdAt;
    if (!dateField) return;
    try {
      const d = parseISO(dateField);
      const daysAgo = Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
      if (daysAgo >= 0 && daysAgo < 7) {
        buckets[6 - daysAgo] += 1;
      }
    } catch {
      // skip
    }
  });
  return buckets;
};

const StatCell: React.FC<{
  label: string;
  cur: number;
  prev: number;
  threshold?: number;
  sparkline: number[];
}> = ({ label, cur, prev, threshold = 3, sparkline }) => {
  // Variation affichée seulement si la semaine précédente donne une base utile.
  let trend: React.ReactNode = null;
  if (prev >= threshold) {
    const delta = Math.round(((cur - prev) / prev) * 100);
    if (Math.abs(delta) >= 5) {
      const positive = delta > 0;
      const Icon = positive ? TrendingUp : TrendingDown;
      trend = (
        <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', positive ? 'text-success' : 'text-danger')}>
          <Icon className="h-3 w-3" aria-hidden="true" />
          {positive ? '+' : ''}
          {delta} %
          <span className="sr-only"> par rapport à la semaine précédente</span>
        </span>
      );
    }
  }

  return (
    <div className="flex items-end justify-between gap-3 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-xl font-semibold tabular-nums text-foreground">{cur}</span>
          {trend}
        </p>
      </div>
      <Sparkline data={sparkline} width={64} height={20} />
    </div>
  );
};

export const DashboardWeekHighlight: React.FC<DashboardWeekHighlightProps> = ({ candidates }) => {
  const { current, previous, headline, sparklines } = useMemo(() => {
    const now = new Date();
    const weekStart = subDays(now, 7);
    const prevWeekStart = subDays(now, 14);

    const currentCohort = candidates.filter((c) => inWindow(c.createdAt, weekStart, now));
    const previousCohort = candidates.filter((c) => inWindow(c.createdAt, prevWeekStart, weekStart));

    const repliedThisWeek = candidates.filter((c) => {
      if (!isRepliedHelper(c)) return false;
      const date = c.lastActivity || c.createdAt;
      if (!date) return false;
      return inWindow(date, weekStart, now);
    }).length;
    const repliedPrevWeek = candidates.filter((c) => {
      if (!isRepliedHelper(c)) return false;
      const date = c.lastActivity || c.createdAt;
      if (!date) return false;
      return inWindow(date, prevWeekStart, weekStart);
    }).length;

    const cur: WeekStats = {
      added: currentCohort.length,
      contacted: currentCohort.filter(isContactedHelper).length,
      replied: repliedThisWeek,
      won: currentCohort.filter((c) => c.stage === 'Gagné').length,
    };
    const prev: WeekStats = {
      added: previousCohort.length,
      contacted: previousCohort.filter(isContactedHelper).length,
      replied: repliedPrevWeek,
      won: previousCohort.filter((c) => c.stage === 'Gagné').length,
    };

    // Courbes sur sept jours
    const sparklines = {
      added: buildSparkline(candidates, () => true, false),
      contacted: buildSparkline(candidates, isContactedHelper, false),
      replied: buildSparkline(candidates, isRepliedHelper, true),
      won: buildSparkline(candidates, (c) => c.stage === 'Gagné', true),
    };

    // La variation la plus nette donne la phrase d'en-tête
    const candidates_metrics: Array<{
      label: string;
      cur: number;
      prev: number;
      delta: number;
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
      });
    }
    if (contactedDelta !== null && Math.abs(contactedDelta) >= 10) {
      candidates_metrics.push({
        label: 'candidats contactés',
        cur: cur.contacted,
        prev: prev.contacted,
        delta: contactedDelta,
      });
    }
    if (addedDelta !== null && Math.abs(addedDelta) >= 10) {
      candidates_metrics.push({
        label: 'nouveaux candidats',
        cur: cur.added,
        prev: prev.added,
        delta: addedDelta,
      });
    }

    candidates_metrics.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    let headline: string;
    if (candidates_metrics.length > 0) {
      const best = candidates_metrics[0];
      const sign = best.delta > 0 ? '+' : '';
      headline = `${sign}${best.delta} % de ${best.label} par rapport à la semaine précédente`;
    } else if (cur.contacted > 0) {
      headline = `${cur.contacted} candidat${cur.contacted > 1 ? 's' : ''} contacté${cur.contacted > 1 ? 's' : ''} cette semaine`;
    } else if (cur.added > 0) {
      headline = `${cur.added} nouveau${cur.added > 1 ? 'x' : ''} candidat${cur.added > 1 ? 's' : ''} cette semaine`;
    } else {
      headline = "Pas encore d'activité cette semaine";
    }

    return { current: cur, previous: prev, headline, sparklines };
  }, [candidates]);

  return (
    <Section
      headingLevel={2}
      title="Cette semaine"
      action={
        <Button asChild variant="ghost" size="xs">
          <Link to="/pipeline?view=analytics">
            Voir l'analyse
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      }
    >
      <p className="border-b border-border px-4 py-3 text-md font-medium text-foreground">{headline}</p>
      <div className="grid grid-cols-2 divide-border max-lg:[&>*:nth-child(-n+2)]:border-b max-lg:[&>*:nth-child(odd)]:border-r lg:grid-cols-4 lg:divide-x">
        <StatCell label="Candidats ajoutés" cur={current.added} prev={previous.added} sparkline={sparklines.added} />
        <StatCell label="Contactés" cur={current.contacted} prev={previous.contacted} sparkline={sparklines.contacted} />
        <StatCell label="Réponses" cur={current.replied} prev={previous.replied} sparkline={sparklines.replied} />
        <StatCell label="Placements" cur={current.won} prev={previous.won} threshold={1} sparkline={sparklines.won} />
      </div>
    </Section>
  );
};
