/**
 * Affichage « Analyse » du pipeline global (revue design E-27).
 *
 * Chaque mesure porte le nom de ce qu'elle mesure : le temps passé dans
 * l'étape (depuis l'entrée dans l'étape, lot 0c-4), la répartition actuelle
 * par étape, la progression d'après l'étape actuelle (pas un historique des
 * passages). Barres monochromes à 3:1 au moins, valeur écrite à côté ;
 * l'accent (warning) ne signale que l'écart au délai de l'étape. Définitions
 * en infobulle, jugements avec leur barème.
 *
 * Design simplifié (lot Suite) : les chiffres du pipeline (ATSStats) passent
 * au-dessus, une seule fois ; ici, la santé du pipeline en trois chiffres sans
 * cadre, puis des sections séparées par un filet fin, sans carte. Une étape ou
 * un passage sans candidat ne s'affiche pas, la gravité d'un goulot s'écrit en
 * couleur sans pastille.
 */
import React, { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { InfoHint } from '@/components/ui/info-hint';
import { ATS_STAGES, type ATSCandidate, STAGNATION_DAYS, daysInStage } from '@/hooks/useATSData';
import { atsColumnTitle } from '@/lib/stageDisplay';
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
  /** Délai de l'étape en jours ; null pour À trier et Retenu, qui n'en ont pas. */
  guideTime: number | null;
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

/** Une section sans carte : un filet fin au-dessus, le titre, sa définition, le contenu. */
const Block: React.FC<{ title: string; subtitle?: string; definition: React.ReactNode; children: React.ReactNode }> = ({
  title,
  subtitle,
  definition,
  children,
}) => {
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 border-t border-border pt-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="shrink-0">{definition}</div>
      </header>
      {children}
    </section>
  );
};

/** Un chiffre de la santé du pipeline : fond doux sans bordure, comme le Bilan de la page mission. */
const Figure: React.FC<{ label: string; value: string; note: string; definition: React.ReactNode; tone?: 'warning' }> = ({
  label,
  value,
  note,
  definition,
  tone,
}) => (
  <div className="flex flex-col gap-1 rounded-xl bg-muted/60 px-4 py-3">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      {definition}
    </div>
    <p className={cn('text-2xl font-semibold tabular-nums', tone === 'warning' ? 'text-warning' : 'text-foreground')}>{value}</p>
    <p className="text-sm text-foreground-secondary">{note}</p>
  </div>
);

export const ATSPipelineAnalytics: React.FC<Props> = ({ candidates }) => {
  const { stageMetrics, bottlenecks, funnelSteps, kpis } = useMemo(() => {
    const now = new Date();

    // Stage metrics
    const metrics: StageMetrics[] = ACTIVE_STAGES.map(stage => {
      const stageCandidates = candidates.filter(c => c.stage === stage.key);
      const guideTime = STAGNATION_DAYS[stage.key] ?? null;

      const daysSinceAction = stageCandidates.map(c => daysInStage(c, now) ?? 0);

      const avgDays = daysSinceAction.length > 0
        ? Math.round(daysSinceAction.reduce((a, b) => a + b, 0) / daysSinceAction.length)
        : 0;

      const stagnantCount = guideTime === null ? 0 : daysSinceAction.filter(d => d > guideTime).length;

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
      .flatMap(m => m.guideTime !== null && m.stagnantCount > 0
        ? [{
            stage: m.label,
            count: m.stagnantCount,
            avgDays: m.avgDays,
            guideTime: m.guideTime,
            severity: (m.stagnantCount >= 5 || m.avgDays > m.guideTime * 2 ? 'critical' : 'warning') as 'critical' | 'warning',
          }]
        : [])
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
        from: atsColumnTitle(stage),
        to: atsColumnTitle(nextStage),
        fromCount: atOrBeyond,
        toCount: nextAtOrBeyond,
        rate,
      };
    });

    // Santé du pipeline
    const totalWon = candidates.filter(c => c.stage === 'Gagné').length;
    const totalLost = candidates.filter(c => c.stage === 'Perdu').length;
    const totalEnded = totalWon + totalLost;
    const winRate = totalEnded > 0 ? Math.round((totalWon / totalEnded) * 100) : 0;
    const totalStagnant = metrics.reduce((sum, m) => sum + m.stagnantCount, 0);
    // Moyenne sur les candidats engagés : À trier et Retenu, sans délai, ne tirent pas le rythme.
    const engaged = metrics.filter(m => m.guideTime !== null);
    const engagedCount = engaged.reduce((sum, m) => sum + m.count, 0);
    const overallAvgDays = engaged.length > 0
      ? Math.round(engaged.reduce((sum, m) => sum + m.avgDays * m.count, 0) / Math.max(engagedCount, 1))
      : 0;

    return {
      stageMetrics: metrics,
      bottlenecks,
      funnelSteps,
      kpis: { totalWon, totalEnded, winRate, totalStagnant, overallAvgDays, engagedCount },
    };
  }, [candidates]);

  const maxCount = Math.max(...stageMetrics.map(m => m.count), 1);
  // Pas de zéro affiché : une étape sans candidat, un passage sans candidat au départ ne s'affichent pas.
  const shownStages = stageMetrics.filter(m => m.count > 0);
  const shownSteps = funnelSteps.filter(step => step.fromCount > 0);

  // Pas de zéro : un chiffre sans candidat engagé, sans candidat bloqué ou sans sortie ne s'affiche pas.
  const hasFigures = kpis.engagedCount > 0 || kpis.totalEnded > 0;

  return (
    <div className="space-y-8">
      {hasFigures && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {kpis.engagedCount > 0 && (
            <Figure
              label="Jours dans l'étape"
              value={days(kpis.overallAvgDays)}
              note={`Rythme ${velocityOf(kpis.overallAvgDays).toLowerCase()}`}
              definition={
                <Definition label="Jours dans l'étape">
                  {"Moyenne, sur les candidats engagés (de Contacté à Offre), du nombre de jours écoulés depuis leur entrée dans leur étape actuelle. Rythme\u00a0: rapide jusqu'à 5 jours, modéré de 6 à 10 jours, lent au-delà."}
                </Definition>
              }
            />
          )}
          {kpis.totalStagnant > 0 && (
            <Figure
              label="Sans mouvement"
              value={String(kpis.totalStagnant)}
              note={`Fluidité ${fluidityOf(kpis.totalStagnant).toLowerCase()}`}
              tone="warning"
              definition={
                <Definition label="Sans mouvement">
                  {"Candidats restés dans leur étape plus longtemps que le délai de cette étape (de 3 à 10 jours selon l'étape). Les étapes À trier, Retenu, Embauché et Écarté n'ont pas de délai. Fluidité\u00a0: excellente à zéro, bonne à 1 ou 2, moyenne de 3 à 7, faible à partir de 8."}
                </Definition>
              }
            />
          )}
          {kpis.totalEnded > 0 && (
            <Figure
              label="Taux de réussite"
              value={percent(kpis.winRate)}
              note={`${plural(kpis.totalWon, 'embauché')} parmi ${plural(kpis.totalEnded, 'candidat sorti', 'candidats sortis')} du pipeline`}
              definition={
                <Definition label="Taux de réussite">
                  Part des candidats embauchés parmi ceux qui ont quitté le pipeline, embauchés ou écartés.
                </Definition>
              }
            />
          )}
        </div>
      )}

      {bottlenecks.length > 0 && (
        <Block
          title="Goulots d'étranglement"
          subtitle={plural(bottlenecks.length, 'étape')}
          definition={
            <Definition label="Goulots d'étranglement">
              {"Étapes où des candidats dépassent le délai prévu dans l'étape. Critique\u00a0: 5 candidats ou plus sans mouvement, ou une moyenne au-delà du double du délai de l'étape."}
            </Definition>
          }
        >
          <ul className="divide-y divide-border">
            {bottlenecks.map(b => (
              <li key={b.stage} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{b.stage}</p>
                  <p className="text-sm text-muted-foreground">
                    {plural(b.count, 'candidat')} sans mouvement depuis plus de {days(b.guideTime)}, {days(b.avgDays)} en moyenne dans l'étape
                  </p>
                </div>
                <span className={cn('shrink-0 text-sm font-medium', b.severity === 'critical' ? 'text-danger' : 'text-warning')}>
                  {b.severity === 'critical' ? 'Critique' : 'À surveiller'}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      {shownStages.length > 0 && (
        <Block
          title="Répartition par étape"
          subtitle="Candidats actifs"
          definition={
            <Definition label="Répartition par étape">
              Nombre de candidats actifs dans chaque étape. À droite, les jours passés en moyenne dans l'étape, comparés au délai de l'étape.
            </Definition>
          }
        >
          <ul className="space-y-3">
            {shownStages.map(metric => {
              const isOverGuide = metric.guideTime !== null && metric.avgDays > metric.guideTime;
              return (
                <li
                  key={metric.key}
                  className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[7.5rem_minmax(0,1fr)_2.5rem_minmax(0,16rem)]"
                >
                  <span className="truncate text-sm text-foreground">{metric.label}</span>
                  <Bar value={(metric.count / maxCount) * 100} />
                  <span className="text-right text-sm font-semibold tabular-nums text-foreground">
                    {metric.count}
                    <span className="sr-only"> candidat{metric.count > 1 ? 's' : ''}</span>
                  </span>
                  <span className={cn('col-span-3 text-xs sm:col-span-1', isOverGuide ? 'font-medium text-warning' : 'text-muted-foreground')}>
                    {metric.guideTime === null
                      ? `${days(metric.avgDays)} en moyenne, pas de délai pour cette étape`
                      : `${days(metric.avgDays)} en moyenne, ${isOverGuide ? 'au-delà du' : 'pour un'} délai de ${days(metric.guideTime)}`}
                    {metric.stagnantCount > 0 && `, ${metric.stagnantCount} sans mouvement`}
                  </span>
                </li>
              );
            })}
          </ul>
        </Block>
      )}

      {shownSteps.length > 0 && (
        <Block
          title="Progression d'une étape à la suivante"
          subtitle="D'après l'étape actuelle"
          definition={
            <Definition label="Progression d'une étape à la suivante">
              Parmi les candidats arrivés à une étape, la part de ceux qui ont atteint au moins la suivante. Calculée d'après l'étape actuelle de chaque candidat, et non d'après l'historique de ses passages ; les candidats écartés sont exclus.
            </Definition>
          }
        >
          <ul className="space-y-3">
            {shownSteps.map((step) => (
              <li
                key={step.from}
                className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[15rem_minmax(0,1fr)_3rem_5rem]"
              >
                <span className="col-span-2 flex min-w-0 items-center gap-1.5 text-sm text-foreground sm:col-span-1">
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
        </Block>
      )}
    </div>
  );
};

/** Squelette de l'analyse : quatre indicateurs, puis deux sections à barres. */
export const ATSPipelineAnalyticsSkeleton: React.FC = () => (
  <div className="space-y-8" role="status" aria-label="Chargement de l'analyse">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-xl bg-muted/60 p-4">
          <Skeleton className="h-4 w-24 rounded-sm" />
          <Skeleton className="h-8 w-12" />
        </div>
      ))}
    </div>
    {[0, 1].map((section) => (
      <div key={section} className="border-t border-border pt-6">
        <Skeleton className="h-4 w-44 rounded-sm" />
        <div className="mt-4 space-y-3">
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
