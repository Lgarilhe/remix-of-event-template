// Refonte mission, lot 2 : Bilan (conception 5.4). Trois taux sur les cumuls
// de get_mission_stage_counts, chacun avec son calcul (en infobulle et pour les
// lecteurs d'écran) et une barre de progression. Aucune alerte « aucune
// recherche lancée » (la date de dernière recherche n'a pas d'écrivain). Le
// bouton Bilan de la ligne d'outils ouvre et ferme l'encart.

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { MissionStageCounts } from '@/hooks/useMissionStageCounts';
import { BILAN_TITLE, bilanRates } from '../types';

interface BilanCardProps {
  counts: MissionStageCounts | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function BilanCard({ counts, isLoading, isError, onRetry }: BilanCardProps) {
  return (
    <section
      data-testid="bilan"
      aria-labelledby="bilan-title"
      className="rounded-xl border border-border bg-card px-5 py-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <h2 id="bilan-title" className="text-sm font-semibold text-foreground">
          Bilan
        </h2>
        <span className="text-[12.5px] text-muted-foreground">{BILAN_TITLE}, calculé sur les dates de chaque étape</span>
      </div>
      {counts ? (
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {bilanRates(counts).map((rate) => (
            <li key={rate.key} title={rate.detail} className="flex flex-col gap-1.5 rounded-[10px] bg-muted/60 px-3.5 py-3">
              {rate.percent !== null && (
                <p className="text-[22px] font-semibold leading-tight tabular-nums text-foreground">{rate.percent} %</p>
              )}
              <p className="text-[13px] text-foreground/90">{rate.text}</p>
              <p className="sr-only">{rate.detail}</p>
              <span className="block h-1 rounded-full bg-foreground/10" aria-hidden="true">
                <span className="block h-1 rounded-full bg-brand" style={{ width: `${rate.percent ?? 0}%` }} />
              </span>
            </li>
          ))}
        </ul>
      ) : isError ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">Bilan indisponible pour l'instant.</p>
          <Button variant="outline" size="xs" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Réessayer
          </Button>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-3" aria-busy={isLoading}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-[10px]" />
          ))}
        </div>
      )}
    </section>
  );
}
