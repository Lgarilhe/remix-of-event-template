/**
 * Affichage « Analyse » du pipeline global (revue design E-27).
 *
 * Chaque mesure porte le nom de ce qu'elle mesure : le temps écoulé depuis la
 * dernière action (pas le temps passé dans l'étape), la répartition actuelle
 * par étape, la progression d'après l'étape actuelle (pas un historique des
 * passages). Barres monochromes à 3:1 au moins, valeur écrite à côté ;
 * l'accent (warning) ne signale que l'écart au délai de l'étape. Définitions
 * en infobulle, jugements avec leur barème.
 */
import React, { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Section, StatGrid, StatTile } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { InfoHint } from '@/components/ui/info-hint';
import { ATS_STAGES, type ATSCandidate, STAGNATION_DAYS, daysSinceLastAction } from '@/hooks/useATSData';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/plural';

interface Props {
  candidates: ATSCandidate[];
}

// Active stages only (exclude terminal)
const ACTIVE_STAGES = ATS_STAGES.filter(s => s.key !== 'Gagné' && s.key !== 'Perdu');

const days = (n: number) => `${n}\u00a0j`;
const percent = (n: number) => `${n}\u00a0%`;
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

/** Bouton « i » d'une mesure : sa définition, ouvrable au doigt comme au clavier. */
const Definition: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <InfoHint label={`Définition\u00a0: ${label}`}>{children}</InfoHint>
);

/** Barre horizontale monochrome : piste `muted`, remplissage `muted-foreground` (plus de 3:1 dans les deux thèmes). */
const Bar: React.FC<{ value: number }> = ({ value }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
    <div className="h-full rounded-full bg-muted-foreground" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

const velocityOf = (avgDays: number) => (avgDays <= 5 ? 'Rapide' : avgDays <= 10 ? 'Modéré' : 'Lent');
const fluidityOf = (stagnant: number) =>
  stagnant === 0 ? 'Excellente' : stagnant < 3 ? 'Bonne' : stagnant < 8 ? 'Moyenne' : 'Faible';

export const ATSPipelineAnalytics: React.FC<Props> = ({ candidates }) => {
  const { stageMetrics, bottlenecks, funnelSteps, kpis } = useMemo(() => {
    const now = new Date();

    // Stage metrics
    const metrics: StageMetrics[] = ACTIVE_STAGES.map(stage => {
      const stageCandidates = candidates.filter(c => c.stage === stage.key);
      const guideTime = STAGNATION_DAYS[stage.key] || 7;

      const daysSinceAction = stageCandidates.map(c => daysSinceLastAction(c, now) ?? 0);

      const avgDays = daysSinceAction.length > 0
        ? Math.round(daysSinceAction.reduce((a, b) => a + b, 0) / daysSinceAction.length)
        : 0;

      const stagnantCount = daysSinceAction.filter(d => d > guideTime).length;

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

    // Progression d'après l'étape actuelle
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
      kpis: { totalActive, totalWon, totalEnded, winRate, totalStagnant, overallAvgDays },
    };
  }, [candidates]);

  const maxCount = Math.max(...stageMetrics.map(m => m.count), 1);

  return (
    <div className="space-y-4">
      <StatGrid cols={{ base: 1, sm: 2, xl: 4 }}>
        <StatTile
          label="Candidats actifs"
          value={kpis.totalActive}
          trailing={<Definition label="Candidats actifs">Candidats ni gagnés ni perdus. {plural(kpis.totalWon, 'gagné')} au total.</Definition>}
        />
        <StatTile
          label="Taux de réussite"
          value={percent(kpis.winRate)}
          trailing={
            <Definition label="Taux de réussite">
              Part des candidats gagnés parmi ceux qui ont quitté le pipeline, gagnés ou perdus ({kpis.totalEnded} à ce jour).
            </Definition>
          }
        />
        <StatTile
          label="Jours depuis la dernière action"
          value={days(kpis.overallAvgDays)}
          trailing={
            <Definition label="Jours depuis la dernière action">
              Moyenne, sur les candidats actifs, du nombre de jours écoulés depuis leur dernière action. Ce n'est pas le temps passé dans l'étape.
            </Definition>
          }
        />
        <StatTile
          label="Sans mouvement"
          value={kpis.totalStagnant}
          variant="warning"
          accent={kpis.totalStagnant > 0}
          trailing={
            <Definition label="Sans mouvement">
              Candidats restés sans action plus longtemps que le délai de leur étape (de 3 à 10 jours selon l'étape).
            </Definition>
          }
        />
      </StatGrid>

      {bottlenecks.length > 0 && (
        <Section
          headingLevel={2}
          title="Goulots d'étranglement"
          subtitle={plural(bottlenecks.length, 'étape')}
          action={
            <Definition label="Goulots d'étranglement">
              {"Étapes où des candidats dépassent le délai prévu sans action. Critique\u00a0: 5 candidats ou plus sans mouvement, ou une moyenne au-delà du double du délai de l'étape."}
            </Definition>
          }
        >
          <ul className="divide-y divide-border">
            {bottlenecks.map(b => (
              <li key={b.stage} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{b.stage}</p>
                  <p className="text-xs text-muted-foreground">
                    {plural(b.count, 'candidat')} sans mouvement depuis plus de {days(b.guideTime)}, {days(b.avgDays)} en moyenne depuis la dernière action
                  </p>
                </div>
                <Badge variant={b.severity === 'critical' ? 'danger' : 'warning'} className="shrink-0">
                  {b.severity === 'critical' ? 'Critique' : 'À surveiller'}
                </Badge>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        headingLevel={2}
        title="Répartition par étape"
        subtitle="Candidats actifs"
        action={
          <Definition label="Répartition par étape">
            Nombre de candidats actifs dans chaque étape. À droite, les jours écoulés en moyenne depuis leur dernière action, comparés au délai de l'étape.
          </Definition>
        }
      >
        <ul className="space-y-3 p-4">
          {stageMetrics.map(metric => {
            const isOverGuide = metric.avgDays > metric.guideTime;
            return (
              <li
                key={metric.key}
                className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[7.5rem_minmax(0,1fr)_2.5rem_minmax(0,16rem)]"
              >
                <span className="truncate text-xs font-medium text-foreground">{metric.label}</span>
                <Bar value={(metric.count / maxCount) * 100} />
                <span className="text-right text-sm font-semibold tabular-nums text-foreground">
                  {metric.count}
                  <span className="sr-only"> candidat{metric.count > 1 ? 's' : ''}</span>
                </span>
                <span className={cn('col-span-3 text-xs sm:col-span-1', isOverGuide ? 'font-medium text-warning' : 'text-muted-foreground')}>
                  {metric.count === 0
                    ? `Délai de l'étape\u00a0: ${days(metric.guideTime)}`
                    : `${days(metric.avgDays)} en moyenne, ${isOverGuide ? 'au-delà du' : 'pour un'} délai de ${days(metric.guideTime)}`}
                  {metric.stagnantCount > 0 && `, ${metric.stagnantCount} sans mouvement`}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        headingLevel={2}
        title="Progression d'une étape à la suivante"
        subtitle="D'après l'étape actuelle"
        action={
          <Definition label="Progression d'une étape à la suivante">
            Parmi les candidats arrivés à une étape, la part de ceux qui ont atteint au moins la suivante. Calculée d'après l'étape actuelle de chaque candidat, et non d'après l'historique de ses passages ; les candidats perdus sont exclus.
          </Definition>
        }
      >
        <ul className="space-y-3 p-4">
          {funnelSteps.map((step) => (
            <li
              key={step.from}
              className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[15rem_minmax(0,1fr)_3rem_5rem]"
            >
              <span className="col-span-2 flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground sm:col-span-1">
                <span className="truncate">{step.from}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">vers</span>
                <span className="truncate">{step.to}</span>
              </span>
              <Bar value={step.rate} />
              <span className="text-right text-sm font-semibold tabular-nums text-foreground">{percent(step.rate)}</span>
              <span className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block">
                {step.toCount} sur {step.fromCount}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section headingLevel={2} title="Santé du pipeline">
        <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">Rythme</p>
              <Definition label="Rythme">
                {"D'après les jours écoulés depuis la dernière action, en moyenne\u00a0: rapide jusqu'à 5 jours, modéré de 6 à 10 jours, lent au-delà."}
              </Definition>
            </div>
            <p className="mt-1 text-xl font-semibold text-foreground">{velocityOf(kpis.overallAvgDays)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{days(kpis.overallAvgDays)} en moyenne depuis la dernière action</p>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">Fluidité</p>
              <Definition label="Fluidité">
                {"D'après le nombre de candidats sans mouvement\u00a0: excellente à zéro, bonne à 1 ou 2, moyenne de 3 à 7, faible à partir de 8."}
              </Definition>
            </div>
            <p className="mt-1 text-xl font-semibold text-foreground">{fluidityOf(kpis.totalStagnant)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {plural(kpis.totalStagnant, 'candidat')} sans mouvement
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
};

/** Squelette de l'analyse : quatre indicateurs, puis deux sections à barres. */
export const ATSPipelineAnalyticsSkeleton: React.FC = () => (
  <div className="space-y-4" role="status" aria-label="Chargement de l'analyse">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-4 w-32 rounded-sm" />
          <Skeleton className="h-8 w-12" />
        </div>
      ))}
    </div>
    {[0, 1].map((section) => (
      <div key={section} className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-44 rounded-sm" />
        </div>
        <div className="space-y-3 p-4">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="h-3 w-24 rounded-sm" />
              <Skeleton className="h-2 flex-1 rounded-full" />
              <Skeleton className="h-4 w-8 rounded-sm" />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);
