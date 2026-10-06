// Refonte mission, lot 2 : barre d'étapes « En ce moment » (conception 4.2,
// zone 4). Effectifs actuels de get_mission_stage_counts, sous le nom de
// l'étape ; chaque puce filtre la liste (?etape=). Jamais de zéro inventé :
// pendant le chargement les puces sont grises et sans chiffre, en cas d'erreur
// la barre le dit. Tant que les étapes d'entretien de la mission se lisent,
// le groupe Suivi reste gris (jamais une puce « En entretien » remplacée
// ensuite) ; si leur lecture échoue, la barre le dit.
//
// Design simplifié (retour du 04/10/2026, « trop chargé ») : une seule rangée de
// puces sans cadre, sans titres de groupe visibles (les groupes gardent leur
// nom accessible) ; l'effectif nul ne s'écrit pas (la puce reste, son nom
// accessible dit « 0 »), la puce choisie se détache par un fond neutre.
//
// Téléphone (sous sm) : la rangée défile à l'horizontale, précédée de « Tous » ;
// puces de 32 px dans une cible tactile de 44 px.

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { GENERAL_STAGE_LABEL, MISSION_STEP_MISSING_LABEL } from '@/lib/stageDisplay';
import { cn } from '@/lib/utils';
import type { MissionStageCounts } from '@/hooks/useMissionStageCounts';
import { NO_STEP, sameStageFilter, stageFilterParam, type MissionStepRef, type StageFilter } from '../types';

interface StageChip {
  filter: StageFilter;
  label: string;
  count: number | null;
}

interface StageBarProps {
  counts: MissionStageCounts | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  steps: readonly MissionStepRef[];
  /** Étapes d'entretien en cours de lecture. */
  stepsLoading?: boolean;
  /** Lecture des étapes d'entretien en échec. */
  stepsFailed?: boolean;
  onRetrySteps?: () => void;
  activeFilter: StageFilter | null;
  onToggle: (filter: StageFilter) => void;
}

/** Libellés des puces du groupe Sourcing et contact (pluriel, conception 4.1). */
const CHIP_LABEL = { to_sort: 'À trier', retained: 'Retenus', contacted: 'Contactés', replied: 'A répondu' } as const;

function chipsOf(counts: MissionStageCounts | null, steps: readonly MissionStepRef[]) {
  const n = (v: number | undefined) => (counts ? v ?? 0 : null);
  const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);
  const sourcing: StageChip[] = (['to_sort', 'retained', 'contacted', 'replied'] as const).map((stage) => ({
    filter: { stage, stepId: null },
    label: CHIP_LABEL[stage],
    count: n(counts?.[stage === 'to_sort' ? 'toSort' : stage]),
  }));
  const follow: StageChip[] = [];
  if (ordered.length > 0) {
    for (const step of ordered) {
      follow.push({
        filter: { stage: 'interviewing', stepId: step.id },
        label: step.name,
        count: n(counts?.interviewingByStep[step.id]),
      });
    }
    const missing = counts?.interviewingByStep[NO_STEP] ?? 0;
    if (missing > 0) {
      follow.push({ filter: { stage: 'interviewing', stepId: NO_STEP }, label: MISSION_STEP_MISSING_LABEL, count: missing });
    }
  } else {
    follow.push({ filter: { stage: 'interviewing', stepId: null }, label: GENERAL_STAGE_LABEL.interviewing, count: n(counts?.interviewing) });
  }
  follow.push({ filter: { stage: 'hired', stepId: null }, label: GENERAL_STAGE_LABEL.hired, count: n(counts?.hired) });
  const rejected: StageChip = { filter: { stage: 'rejected', stepId: null }, label: 'Écartés', count: n(counts?.rejected) };
  return { sourcing, follow, rejected };
}

/** Forme des puces : 32 px, texte de 14 px, sans cadre ; cible de 44 px par ::before sur téléphone. */
const CHIP_SHAPE =
  'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm transition-colors duration-150 ease-out ' +
  'before:absolute before:inset-x-0 before:-inset-y-1.5 sm:max-w-full sm:shrink sm:before:hidden';
const CHIP_ACTIVE = 'bg-muted font-semibold text-foreground';
const CHIP_IDLE = 'text-foreground-secondary hover:bg-accent hover:text-foreground';

function Chip({ chip, active, loading, onToggle }: { chip: StageChip; active: boolean; loading: boolean; onToggle: (f: StageFilter) => void }) {
  const zero = chip.count === 0;
  return (
    <button
      type="button"
      aria-pressed={active}
      data-stage={stageFilterParam(chip.filter)}
      aria-label={chip.count === null ? chip.label : `${chip.label} ${chip.count}`}
      onClick={() => onToggle(chip.filter)}
      className={cn(
        CHIP_SHAPE,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        active ? CHIP_ACTIVE : CHIP_IDLE,
      )}
    >
      <span className={cn('truncate', zero && !active && 'text-muted-foreground')}>{chip.label}</span>
      {loading ? (
        <Skeleton className="h-3 w-4" aria-hidden="true" />
      ) : chip.count !== null && !zero ? (
        <span className="font-semibold tabular-nums text-foreground" aria-hidden="true">
          {chip.count.toLocaleString('fr-FR')}
        </span>
      ) : null}
    </button>
  );
}

export function StageBar({
  counts,
  isLoading,
  isError,
  onRetry,
  steps,
  stepsLoading = false,
  stepsFailed = false,
  onRetrySteps,
  activeFilter,
  onToggle,
}: StageBarProps) {
  const { sourcing, follow, rejected } = chipsOf(counts, steps);
  const loading = isLoading && !counts;
  const hired = follow[follow.length - 1];

  return (
    <section data-testid="stage-bar" aria-labelledby="stage-bar-title" className="space-y-2">
      <h2 id="stage-bar-title" className="sr-only">
        En ce moment
      </h2>
      {isError && !counts ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
          <p className="text-sm text-muted-foreground">Effectifs indisponibles pour l'instant.</p>
          <Button variant="outline" size="xs" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Réessayer
          </Button>
        </div>
      ) : (
        <div className="-mx-3 flex items-center gap-1 overflow-x-auto px-3 py-1.5 scrollbar-hide sm:mx-0 sm:flex-wrap sm:gap-y-1.5 sm:overflow-visible sm:p-0">
          {/* Téléphone : « Tous » retire le filtre d'étape (pas de chiffre : aucun total lu ici). */}
          <button
            type="button"
            aria-pressed={activeFilter === null}
            onClick={() => {
              if (activeFilter) onToggle(activeFilter);
            }}
            className={cn(
              CHIP_SHAPE,
              'sm:hidden',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              activeFilter === null ? CHIP_ACTIVE : CHIP_IDLE,
            )}
          >
            Tous
          </button>
          {[
            { title: 'Sourcing et contact', chips: sourcing },
            { title: 'Suivi', chips: follow },
          ].map((group) => (
            <div key={group.title} role="group" aria-label={group.title} className="flex shrink-0 items-center gap-1 sm:min-w-0 sm:shrink sm:flex-wrap">
              {group.chips === follow && stepsLoading ? (
                <span className="contents" aria-busy="true" aria-label="Chargement des étapes d'entretien">
                  <Skeleton className="h-7 w-28 rounded-lg" aria-hidden="true" />
                  <Skeleton className="h-7 w-24 rounded-lg" aria-hidden="true" />
                </span>
              ) : group.chips === follow && stepsFailed ? (
                <>
                  <span role="alert" className="inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    Étapes d'entretien indisponibles.
                    {onRetrySteps && (
                      <Button variant="outline" size="xs" onClick={onRetrySteps}>
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                        Réessayer
                      </Button>
                    )}
                  </span>
                  <Chip
                    chip={hired}
                    active={sameStageFilter(activeFilter, hired.filter)}
                    loading={loading}
                    onToggle={onToggle}
                  />
                </>
              ) : (
                group.chips.map((chip) => (
                  <Chip
                    key={stageFilterParam(chip.filter)}
                    chip={chip}
                    active={sameStageFilter(activeFilter, chip.filter)}
                    loading={loading}
                    onToggle={onToggle}
                  />
                ))
              )}
            </div>
          ))}
          <div className="flex shrink-0 items-center gap-1">
            <Chip chip={rejected} active={sameStageFilter(activeFilter, rejected.filter)} loading={loading} onToggle={onToggle} />
          </div>
        </div>
      )}
    </section>
  );
}
