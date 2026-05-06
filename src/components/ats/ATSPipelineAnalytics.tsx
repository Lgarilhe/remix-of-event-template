import React, { useMemo } from 'react';
import { ATSCandidate, ATS_STAGES } from '@/hooks/useATSData';
import { differenceInDays, parseISO } from 'date-fns';
import {
  AlertTriangle,
  Clock,
  TrendingDown,
  ArrowRight,
  Users,
  Target,
  Activity,
  Gauge,
} from 'lucide-react';

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

const KPICard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
}> = ({ icon, label, value, hint, tone = 'default' }) => {
  const toneStyles = {
    default: 'bg-foreground/[0.06] text-foreground',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
  };

  return (
    <div className="rounded-xl bg-card border border-border p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${toneStyles[tone]}`}>
          {icon}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </span>
      </div>
      <div className="font-display text-2xl font-bold text-foreground tabular-nums tracking-tight leading-none">
        {value}
      </div>
      {hint && <div className="text-xs text-muted-foreground mt-1.5">{hint}</div>}
    </div>
  );
};

const SectionCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, children }) => (
  <div className="rounded-xl bg-card border border-border overflow-hidden">
    <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/20">
      <div className="h-9 w-9 rounded-lg bg-foreground/[0.06] text-foreground flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="font-display font-bold text-foreground text-[15px] tracking-tight leading-none">
          {title}
        </h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </div>
    </div>
    {children}
  </div>
);

export const ATSPipelineAnalytics: React.FC<Props> = ({ candidates }) => {
  const { stageMetrics, bottlenecks, funnelSteps, kpis } = useMemo(() => {
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

    // KPI summary
    const totalActive = candidates.filter(c => c.stage !== 'Gagné' && c.stage !== 'Perdu').length;
    const totalWon = candidates.filter(c => c.stage === 'Gagné').length;
    const totalLost = candidates.filter(c => c.stage === 'Perdu').length;
    const totalEnded = totalWon + totalLost;
    const winRate = totalEnded > 0 ? Math.round((totalWon / totalEnded) * 100) : 0;
    const totalStagnant = metrics.reduce((sum, m) => sum + m.stagnantCount, 0);
    const overallAvgDays = metrics.length > 0
      ? Math.round(metrics.reduce((sum, m) => sum + m.avgDays * m.count, 0) / Math.max(metrics.reduce((sum, m) => sum + m.count, 0), 1))
      : 0;

    return {
      stageMetrics: metrics,
      bottlenecks,
      funnelSteps,
      kpis: { totalActive, totalWon, winRate, totalStagnant, overallAvgDays },
    };
  }, [candidates]);

  const maxCount = Math.max(...stageMetrics.map(m => m.count), 1);

  return (
    <div className="space-y-4">
      {/* KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          icon={<Users className="w-4 h-4" />}
          label="Pipeline actif"
          value={kpis.totalActive}
          hint={`${kpis.totalWon} gagné${kpis.totalWon > 1 ? 's' : ''} au total`}
        />
        <KPICard
          icon={<Target className="w-4 h-4" />}
          label="Taux de win"
          value={`${kpis.winRate}%`}
          hint={kpis.winRate >= 30 ? 'Très bon ratio' : 'À optimiser'}
          tone={kpis.winRate >= 30 ? 'success' : kpis.winRate >= 15 ? 'default' : 'warning'}
        />
        <KPICard
          icon={<Activity className="w-4 h-4" />}
          label="Cycle moyen"
          value={`${kpis.overallAvgDays}j`}
          hint="Temps moyen en stage actif"
        />
        <KPICard
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Stagnants"
          value={kpis.totalStagnant}
          hint={kpis.totalStagnant === 0 ? 'Aucun blocage' : 'Candidats à relancer'}
          tone={kpis.totalStagnant === 0 ? 'success' : kpis.totalStagnant >= 5 ? 'destructive' : 'warning'}
        />
      </div>

      {/* Bottleneck Alerts */}
      {bottlenecks.length > 0 && (
        <div className="rounded-xl bg-card border border-destructive/30 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-destructive/20 bg-destructive/5">
            <div className="h-9 w-9 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-destructive text-[15px] tracking-tight leading-none">
                Goulots d'étranglement
              </h3>
              <p className="text-xs text-destructive/80 mt-1">
                {bottlenecks.length} étape{bottlenecks.length > 1 ? 's' : ''} avec des candidats bloqués
              </p>
            </div>
          </div>
          <div className="divide-y divide-border">
            {bottlenecks.map(b => (
              <div
                key={b.stage}
                className={`flex items-center justify-between px-5 py-3 ${
                  b.severity === 'critical' ? 'bg-destructive/[0.03]' : 'bg-warning/[0.03]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      b.severity === 'critical' ? 'bg-destructive' : 'bg-warning'
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="text-sm font-display font-semibold text-foreground tracking-tight">
                      {b.stage}
                    </span>
                    <p className="text-xs text-muted-foreground truncate">
                      {b.count} candidat{b.count > 1 ? 's' : ''} bloqué{b.count > 1 ? 's' : ''} · &gt; {b.guideTime}j
                    </p>
                  </div>
                </div>
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold tabular-nums border shrink-0 ${
                    b.severity === 'critical'
                      ? 'border-destructive/40 bg-destructive/10 text-destructive'
                      : 'border-warning/40 bg-warning/10 text-warning'
                  }`}
                >
                  ~{b.avgDays}j moy.
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Time in Stage Distribution */}
      <SectionCard
        icon={<Clock className="w-4 h-4" />}
        title="Temps moyen par étape"
        subtitle="Volume actuel et durée moyenne dans chaque étape, vs. temps cible"
      >
        <div className="p-5 space-y-3">
          {stageMetrics.map(metric => {
            const barWidth = metric.count > 0 ? (metric.count / maxCount) * 100 : 0;
            const isOverGuide = metric.avgDays > metric.guideTime;

            return (
              <div key={metric.key} className="flex items-center gap-3">
                <span className="text-xs font-medium text-foreground w-24 shrink-0 truncate">
                  {metric.label}
                </span>
                <div className="flex-1 h-8 bg-muted/40 rounded-full relative overflow-hidden border border-border">
                  <div
                    className={`h-full transition-all duration-500 rounded-full ${
                      isOverGuide
                        ? 'bg-gradient-to-r from-destructive/40 to-destructive/60'
                        : 'bg-gradient-to-r from-foreground/15 to-foreground/25'
                    }`}
                    style={{ width: `${barWidth}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-3 justify-between">
                    <span className="text-[11px] font-bold tabular-nums text-foreground">
                      {metric.count}
                    </span>
                    <span
                      className={`text-[11px] font-medium tabular-nums ${
                        isOverGuide ? 'text-destructive font-bold' : 'text-muted-foreground'
                      }`}
                    >
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
      <SectionCard
        icon={<TrendingDown className="w-4 h-4" />}
        title="Taux de conversion entre étapes"
        subtitle="Pourcentage de candidats qui passent d'une étape à la suivante"
      >
        <div className="p-5 space-y-2">
          {funnelSteps.map((step) => (
            <div key={step.from} className="flex items-center gap-2">
              <span className="text-xs font-medium text-foreground w-24 shrink-0 truncate">
                {step.from}
              </span>
              <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-xs font-medium text-foreground w-24 shrink-0 truncate">
                {step.to}
              </span>
              <div className="flex-1 h-7 bg-muted/40 rounded-full relative overflow-hidden border border-border">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    step.rate >= 50 ? 'bg-gradient-to-r from-success/40 to-success/60' :
                    step.rate >= 20 ? 'bg-gradient-to-r from-foreground/15 to-foreground/25' :
                    'bg-gradient-to-r from-destructive/30 to-destructive/40'
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

      {/* Pipeline Health Score */}
      <SectionCard
        icon={<Gauge className="w-4 h-4" />}
        title="Santé du pipeline"
        subtitle="Indicateurs combinés pour évaluer la qualité de votre flux"
      >
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-xl bg-muted/20 border border-border p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
              Vélocité
            </div>
            <div className="font-display text-xl font-bold text-foreground tabular-nums">
              {kpis.overallAvgDays <= 5 ? 'Rapide' : kpis.overallAvgDays <= 10 ? 'Modérée' : 'Lente'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {kpis.overallAvgDays}j en moyenne par étape
            </div>
          </div>

          <div className="rounded-xl bg-muted/20 border border-border p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
              Fluidité
            </div>
            <div className="font-display text-xl font-bold text-foreground tabular-nums">
              {kpis.totalStagnant === 0 ? 'Excellente' :
                kpis.totalStagnant < 3 ? 'Bonne' :
                kpis.totalStagnant < 8 ? 'Moyenne' : 'Faible'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {kpis.totalStagnant} candidat{kpis.totalStagnant > 1 ? 's' : ''} stagnant{kpis.totalStagnant > 1 ? 's' : ''}
            </div>
          </div>

          <div className="rounded-xl bg-muted/20 border border-border p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
              Conversion finale
            </div>
            <div className="font-display text-xl font-bold text-foreground tabular-nums">
              {kpis.winRate}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {kpis.totalWon} placement{kpis.totalWon > 1 ? 's' : ''} confirmé{kpis.totalWon > 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
};
