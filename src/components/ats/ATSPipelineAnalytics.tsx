import React, { useMemo } from 'react';
import { ATSCandidate, ATS_STAGES } from '@/hooks/useATSData';
import { differenceInDays, parseISO } from 'date-fns';
import { AlertTriangle, Clock, TrendingDown, ArrowRight, BarChart3 } from 'lucide-react';

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
    
    // Count candidates at or beyond each stage
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
    <div className="space-y-6">
      {/* Bottleneck Alerts */}
      {bottlenecks.length > 0 && (
        <div className="border border-border bg-background">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-destructive/5">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <span className="text-xs font-bold uppercase tracking-wider text-destructive">
              Goulots d'étranglement détectés
            </span>
          </div>
          <div className="divide-y divide-border">
            {bottlenecks.map(b => (
              <div
                key={b.stage}
                className={`flex items-center justify-between px-4 py-3 ${
                  b.severity === 'critical' ? 'bg-destructive/5' : 'bg-warning/10'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    b.severity === 'critical' ? 'bg-destructive' : 'bg-yellow-500'
                  }`} />
                  <div>
                    <span className="text-sm font-semibold text-foreground">{b.stage}</span>
                    <p className="text-xs text-muted-foreground">
                      {b.count} candidat{b.count > 1 ? 's' : ''} bloqué{b.count > 1 ? 's' : ''} depuis &gt; {b.guideTime}j
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-sm font-bold tabular-nums ${
                    b.severity === 'critical' ? 'text-destructive' : 'text-yellow-400'
                  }`}>
                    ~{b.avgDays}j
                  </span>
                  <p className="text-xs text-muted-foreground">moy. en stage</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Time in Stage Distribution */}
      <div className="border border-border bg-background">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <Clock className="w-4 h-4 text-foreground" />
          <span className="text-xs font-bold uppercase tracking-wider">
            Temps moyen par étape
          </span>
        </div>
        <div className="p-4 space-y-2">
          {stageMetrics.map(metric => {
            const barWidth = metric.count > 0 ? (metric.count / maxCount) * 100 : 0;
            const isOverGuide = metric.avgDays > metric.guideTime;
            
            return (
              <div key={metric.key} className="flex items-center gap-3">
                <span className="text-xs font-medium text-foreground w-20 shrink-0 truncate uppercase tracking-wider">
                  {metric.label}
                </span>
                <div className="flex-1 h-6 bg-muted/30 border border-border relative overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      isOverGuide ? 'bg-destructive/70' : 'bg-foreground/20'
                    }`}
                    style={{ width: `${barWidth}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-2 justify-between">
                    <span className="text-xs font-bold tabular-nums text-foreground">
                      {metric.count}
                    </span>
                    <span className={`text-xs font-medium tabular-nums ${
                      isOverGuide ? 'text-destructive font-bold' : 'text-muted-foreground'
                    }`}>
                      {metric.avgDays}j / {metric.guideTime}j
                    </span>
                  </div>
                </div>
                {metric.stagnantCount > 0 && (
                  <span className="text-xs text-destructive font-bold tabular-nums shrink-0">
                    ⚠ {metric.stagnantCount}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Conversion Funnel */}
      <div className="border border-border bg-background">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
          <TrendingDown className="w-4 h-4 text-foreground" />
          <span className="text-xs font-bold uppercase tracking-wider">
            Taux de conversion entre étapes
          </span>
        </div>
        <div className="p-4 space-y-1">
          {funnelSteps.map((step, i) => (
            <div key={step.from} className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground w-20 shrink-0 truncate uppercase tracking-wider">
                {step.from}
              </span>
              <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-foreground w-20 shrink-0 truncate uppercase tracking-wider">
                {step.to}
              </span>
              <div className="flex-1 h-5 bg-muted/30 border border-border relative overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    step.rate >= 50 ? 'bg-emerald-500/40' :
                    step.rate >= 20 ? 'bg-foreground/20' :
                    'bg-destructive/30'
                  }`}
                  style={{ width: `${step.rate}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-bold tabular-nums text-foreground">
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
      </div>
    </div>
  );
};
