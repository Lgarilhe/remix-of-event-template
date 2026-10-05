/**
 * ScoreRing : la note d'un candidat en anneau (design simplifié, règle 6,
 * docs/design/06-simplicite.md). Couleur de marque pour tous les niveaux, le
 * nombre au centre ; sans note, rien. Même rendu que l'anneau de la nouvelle
 * page mission (ScorePill, src/components/missions/v3/pipeline/CandidateListRow.tsx).
 */
import { cn } from '@/lib/utils';

const RING_SIZE = 32;
const RING_RADIUS = 13;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function ScoreRing({
  score,
  title,
  className,
}: {
  score: number | null | undefined;
  /** Infobulle : la recommandation de la notation, par exemple. */
  title?: string | null;
  className?: string;
}) {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  const rounded = Math.round(score);
  const share = Math.max(0, Math.min(100, rounded)) / 100;
  return (
    <span
      title={title ?? undefined}
      className={cn('relative inline-flex shrink-0 items-center justify-center text-xs font-semibold tabular-nums text-foreground', className)}
      style={{ width: RING_SIZE, height: RING_SIZE }}
    >
      <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" strokeWidth={2.5} className="stroke-foreground/15" />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={`${RING_LENGTH * share} ${RING_LENGTH}`}
          className="stroke-brand"
        />
      </svg>
      <span className="relative">
        <span className="sr-only">Note </span>
        {rounded}
      </span>
    </span>
  );
}
