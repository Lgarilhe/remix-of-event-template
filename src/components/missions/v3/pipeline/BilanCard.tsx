// Refonte mission, lot 2 : Bilan (conception 5.4). Trois taux sur les cumuls
// de get_mission_stage_counts, chacun avec son calcul écrit. Aucune alerte
// « aucune recherche lancée » (la date de dernière recherche n'a pas d'écrivain).

import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { MissionStageCounts } from '@/hooks/useMissionStageCounts';
import { BILAN_TITLE, bilanRates } from '../types';

interface BilanCardProps {
  counts: MissionStageCounts | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onClose: () => void;
}

export function BilanCard({ counts, isLoading, isError, onRetry, onClose }: BilanCardProps) {
  return (
    <section
      data-testid="bilan"
      aria-labelledby="bilan-title"
      className="rounded-xl border border-border bg-card p-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="bilan-title" className="text-sm font-semibold text-foreground">
          {BILAN_TITLE}
        </h2>
        <Button variant="ghost" size="xs" onClick={onClose}>
          <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Fermer
        </Button>
      </div>
      {counts ? (
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {bilanRates(counts).map((rate) => (
            <li key={rate.key} className="rounded-lg bg-muted/40 p-3">
              {rate.percent !== null && (
                <p className="text-xl font-semibold tabular-nums text-foreground">{rate.percent} %</p>
              )}
              <p className="text-sm text-foreground">{rate.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">{rate.detail}</p>
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
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
    </section>
  );
}
