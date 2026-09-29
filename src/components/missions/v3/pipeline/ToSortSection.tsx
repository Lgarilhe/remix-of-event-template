// Refonte mission, lot 2 : section « À trier » repliée en bas de la liste
// (conception 4.2). Dépliée : mêmes lignes et mêmes cases que la liste, pages
// de 50, lecture seulement une fois dépliée. Pas de « Trier un par un » (lot 4).

import { forwardRef } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { MissionCandidateRow, MissionStepRef } from '../types';
import { CandidateList, useFrozenCandidateRows } from './CandidateList';

const TO_SORT = { stage: 'to_sort' as const, stepId: null };

interface ToSortSectionProps {
  projectId: string;
  /** Effectif « À trier » ; null s'il est inconnu. */
  count: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  steps: readonly MissionStepRef[];
  selectedIds: ReadonlySet<string>;
  activeRowId: string | null;
  now: number;
  onToggleRow: (row: MissionCandidateRow, checked: boolean) => void;
  onToggleAll: (rows: readonly MissionCandidateRow[], checked: boolean) => void;
  onOpen: (rowId: string) => void;
  /** Lignes affichées, pour l'ordre des flèches de la fiche. */
  onRowsChange: (rows: readonly MissionCandidateRow[]) => void;
}

export function toSortTitle(count: number | null): string {
  return count === null ? 'À trier' : `À trier (${count.toLocaleString('fr-FR')})`;
}

export const ToSortSection = forwardRef<HTMLElement, ToSortSectionProps>(function ToSortSection(
  { projectId, count, open, onOpenChange, steps, selectedIds, activeRowId, now, onToggleRow, onToggleAll, onOpen, onRowsChange },
  ref,
) {
  return (
    <section ref={ref} aria-label="À trier" className="scroll-mt-4">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors duration-150 ease-out hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn('h-4 w-4 text-muted-foreground transition-transform duration-150', open && 'rotate-90')}
              aria-hidden="true"
            />
            {toSortTitle(count)}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          {open && (
            <ToSortRows
              projectId={projectId}
              steps={steps}
              selectedIds={selectedIds}
              activeRowId={activeRowId}
              now={now}
              onToggleRow={onToggleRow}
              onToggleAll={onToggleAll}
              onOpen={onOpen}
              onRowsChange={onRowsChange}
            />
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
});

function ToSortRows({
  projectId,
  steps,
  selectedIds,
  activeRowId,
  now,
  onToggleRow,
  onToggleAll,
  onOpen,
  onRowsChange,
}: Omit<ToSortSectionProps, 'count' | 'open' | 'onOpenChange'>) {
  const list = useFrozenCandidateRows(projectId, TO_SORT, onRowsChange);

  if (list.isError && list.rows.length === 0) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-3">
        <p className="text-sm text-muted-foreground">Impossible de charger les candidats.</p>
        <Button variant="outline" size="xs" onClick={() => void list.refetch()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Réessayer
        </Button>
      </div>
    );
  }
  if (!list.isLoading && list.rows.length === 0) {
    return <p className="px-1 py-2 text-sm text-muted-foreground">Aucun profil à trier pour l'instant.</p>;
  }
  return (
    <CandidateList
      testId="to-sort-list"
      caption="Profils à trier"
      rows={list.rows}
      outOfFilter={list.outOfFilter}
      steps={steps}
      selectedIds={selectedIds}
      activeRowId={activeRowId}
      now={now}
      isLoading={list.isLoading}
      hasNextPage={list.hasNextPage}
      isFetchingNextPage={list.isFetchingNextPage}
      onLoadMore={() => void list.fetchNextPage()}
      orderDiffers={list.orderDiffers}
      onRefreshOrder={list.refreshOrder}
      onToggleRow={onToggleRow}
      onToggleAll={onToggleAll}
      onOpen={onOpen}
    />
  );
}
