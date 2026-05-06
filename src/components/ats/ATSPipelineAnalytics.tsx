import React, { useMemo } from 'react';
import { ATSCandidate, ATS_STAGES } from '@/hooks/useATSData';
import { differenceInDays, parseISO } from 'date-fns';
import { AlertTriangle, Clock, TrendingDown, ArrowRight } from 'lucide-react';

interface Props {
  candidates: ATSCandidate[];
}

// Guide times per stage (days) — same as in card stagnation
const GUIDE_TIMES: Record<string, number> = {
  'Nouveau': 3, 'Contacté': 5, 'Répondu': 3, 'Pressenti': 5,
  'Pré-qualif': 7, 'CV envoyé': 5, 'ITW en cours': 10, 'Offre': 7,
};

// Active stages only (exclude terminal)
const ACTIVE_STAGES = ATS_STAGES.filter(s => s.key !== 'Gagné' && s.key !== 'Perdu');

interface StageMetrics {
  key: string;
  label: string;
  count: number;
  avgDays: number;
  stagnantCount: number;
  guideTime: number;
}

interface Bottleneck {
  stage: string;
  count: number;
  avgDays: number;
  guideTime: number;
  severity: 'warning' | 'critical';
}

const SectionCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  tone?: 'default' | 'destructive';
  children: React.ReactNode;
}> = ({ icon, title, tone = 'default', children }) => (
  <div className="rounded-xl bg-card border border-border overflow-hidden">
    <div
      className={`flex items-center gap-2 px-4 py-2.5 border-b ${
        tone === 'destructive' ? 'border-destructive/20 bg-destructive/5' : 'border-border bg-muted/40'
      }`}
    >
      <div
        className={`h-7 w-7 rounded-lg flex items-center justify-center ${
          tone === 'destructive' ? 'bg-destructive/10 text-destructive' : 'bg-foreground/[0.06] text-foreground'
        }`}
      >
        {icon}
      </div>
      <span
        className={`text-[10px] uppercase tracking-wider font-bold ${
          tone === 'destructive' ? 'text-destructive' : 'text-foreground'
        }`}
      >
        {title}
      </span>
    </div>
    {children}
  </div>
);

export const ATSPipelineAnalytics: React.FC<Props> = ({ candidates }) => {
  const { stageMetrics, bottlenecks, funnelSteps } = useMemo(() => {
    const now = new Date();

    // Stage metrics
    const metrics: StageMetrics[] = ACTIVE_STAGES.map(stage => {
      const stageCandidates = candidates.filter(c => c.stage === stage.key);
      const guideTime = GUIDE_TIMES[stage.key] || 7;

      const daysInStage = stageCandidates.map(c => {
        const lastDate = c.lastActivity ? parseISO(c.lastActivity) : parseISO(c.createdAt);
        return differenceInDays(now, lastDate);
      });

      const avgDays = daysInStage.length > 0
        ? Math.round(daysInStage.reduce((a, b) => a + b, 0) / daysInStage.length)
        : 0;

      const stagnantCount = daysInStage.filter(d => d > guideTime).length;

      return {
        key: stage.key,
        label: stage.label,
        count: stageCandidates.length,
        avgDays,
        stagnantCount,
        guideTime,
      };
    });

    // Bottlenecks: stages with stagnant candidates
    const bottlenecks: Bottleneck[] = metrics
      .filter(m => m.stagnantCount > 0)
      .map(m => ({
        stage: m.label,
        count: m.stagnantCount,
        avgDays: m.avgDays,
        guideTime: m.guideTime,
        severity: (m.stagnantCount >= 5 || m.avgDays > m.guideTime * 2 ? 'critical' : 'warning') as 'critical' | 'warning',
      }))
      .sort((a, b) => b.count - a.count);

    // Funnel conversion
    const orderedStages = ['Nouveau', 'Contacté', 'Répondu', 'Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre', 'Gagné'];

    const STAGE_ORDER: Record<string, number> = {};
    orderedStages.forEach((s, i) => { STAGE_ORDER[s] = i; });

    const funnelSteps = orderedStages.slice(0, -1).map((stage, i) => {
      const nextStage = orderedStages[i + 1];
      const currentIdx = i;
      const nextIdx = i + 1;

      const atOrBeyond = candidates.filter(c => {
        const idx = STAGE_ORDER[c.stage];
        return idx !== undefined && idx >= currentIdx && c.stage !== 'Perdu';
      }).length;

      const nextAtOrBeyond = candidates.filter(c => {
        const idx = STAGE_ORDER[c.stage];
        return idx !== undefined && idx >= nextIdx && c.stage !== 'Perdu';
      }).length;

      const rate = atOrBeyond > 0 ? Math.round((nextAtOrBeyond / atOrBeyond) * 100) : 0;

      return {
        from: stage,
        to: nextStage,
        fromCount: atOrBeyond,
        toCount: nextAtOrBeyond,
        rate,
      };
    });

    return { stageMetrics: metrics, bottlenecks, funnelSteps };
  }, [candidates]);

  const maxCount = Math.max(...stageMetrics.map(m => m.count), 1);

  return (
    <div className="space-y-4">
      {/* Bottleneck Alerts */}
      {bottlenecks.length > 0 && (
        <SectionCard
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          title="Goulots d'étranglement détectés"
          tone="destructive"
        >
          <div className="divide-y divide-border">
            {bottlenecks.map(b => (
              <div
                key={b.stage}
                className={`flex items-center justify-between px-4 py-3 ${
                  b.severity === 'critical' ? 'bg-destructive/5' : 'bg-warning/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    b.severity === 'critical' ? 'bg-destructive' : 'bg-warning'
                  }`} />
                  <div>
                    <span className="text-sm font-display font-semibold text-foreground tracking-tight">
                      {b.stage}
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {b.count} candidat{b.count > 1 ? 's' : ''} bloqué{b.count > 1 ? 's' : ''} depuis &gt; {b.guideTime}j
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold tabular-nums border ${
                      b.severity === 'critical'
                        ? 'border-destructive/40 bg-destructive/10 text-destructive'
                        : 'border-warning/40 bg-warning/10 text-warning'
                    }`}
                  >
                    ~{b.avgDays}j
                  </span>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">moy. en stage</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Time in Stage Distribution */}
      <SectionCard icon={<Clock className="w-3.5 h-3.5" />} title="Temps moyen par étape">
        <div className="p-4 space-y-2">
          {stageMetrics.map(metric => {
            const barWidth = metric.count > 0 ? (metric.count / maxCount) * 100 : 0;
            const isOverGuide = metric.avgDays > metric.guideTime;

            return (
              <div key={metric.key} className="flex items-center gap-3">
                <span className="text-xs font-medium text-foreground w-24 shrink-0 truncate">
                  {metric.label}
                </span>
                <div className="flex-1 h-7 bg-muted/40 rounded-full relative overflow-hidden border border-border">
                  <div
                    className={`h-full transition-all duration-500 ${
                      isOverGuide ? 'bg-destructive/60' : 'bg-foreground/15'
                    }`}
                    style={{ width: `${barWidth}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-3 justify-between">
                    <span className="text-[11px] font-bold tabular-nums text-foreground">
                      {metric.count}
                    </span>
                    <span className={`text-[11px] font-medium tabular-nums ${
                      isOverGuide ? 'text-destructive font-bold' : 'text-muted-foreground'
                    }`}>
                      {metric.avgDays}j / {metric.guideTime}j
                    </span>
                  </div>
                </div>
                {metric.stagnantCount > 0 ? (
                  <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full border border-destructive/40 bg-destructive/10 text-destructive font-bold tabular-nums shrink-0">
                    <AlertTriangle className="w-3 h-3" />
                    {metric.stagnantCount}
                  </span>
                ) : (
                  <span className="w-12 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* Conversion Funnel */}
      <SectionCard icon={<TrendingDown className="w-3.5 h-3.5" />} title="Taux de conversion entre étapes">
        <div className="p-4 space-y-2">
          {funnelSteps.map((step) => (
            <div key={step.from} className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground w-24 shrink-0 truncate">
                {step.from}
              </span>
              <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-foreground w-24 shrink-0 truncate">
                {step.to}
              </span>
              <div className="flex-1 h-6 bg-muted/40 rounded-full relative overflow-hidden border border-border">
                <div
                  className={`h-full transition-all duration-500 ${
                    step.rate >= 50 ? 'bg-success/40' :
                    step.rate >= 20 ? 'bg-foreground/15' :
                    'bg-destructive/30'
                  }`}
                  style={{ width: `${step.rate}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[11px] font-bold tabular-nums text-foreground">
                    {step.rate}%
                  </span>
                </div>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-16 text-right">
                {step.fromCount} → {step.toCount}
              </span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
};
