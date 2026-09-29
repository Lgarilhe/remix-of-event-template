// Refonte mission, lot 2 : tableau des candidats de la nouvelle page mission
// (liste en cours, liste filtrée par étape, section À trier). Pages de 50,
// ordre figé pour la session (frozenOrder.ts), sélection partagée.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useKnownStagesVersion, useMissionCandidateRows } from '@/hooks/useMissionCandidateRows';
import {
  PIPELINE_PAGE_SIZE,
  rowMatchesFilter,
  stageFilterKey,
  type MissionCandidateRow,
  type MissionStepRef,
  type StageFilter,
} from '../types';
import { CandidateListRow } from './CandidateListRow';
import { applyKnownStages, arrangeFrozen, frozenOrderKey, resetFrozenOrder, type ArrangedRows } from './frozenOrder';

const NO_ROWS: ArrangedRows<MissionCandidateRow> = { rows: [], outOfFilter: new Set(), orderDiffers: false };

/**
 * Lignes d'une liste (filtre null : en cours), étapes connues appliquées, dans
 * l'ordre figé de la session. onRowsChange reçoit les lignes affichées.
 */
export function useFrozenCandidateRows(
  projectId: string,
  filter: StageFilter | null,
  onRowsChange?: (rows: readonly MissionCandidateRow[]) => void,
) {
  const query = useMissionCandidateRows(projectId, filter);
  const knownVersion = useKnownStagesVersion();
  const [epoch, setEpoch] = useState(0);
  const filterKey = stageFilterKey(filter);
  const key = frozenOrderKey(projectId, filterKey);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const arranged = useMemo(() => {
    if (!query.data) return NO_ROWS;
    const fetched = applyKnownStages(query.data.pages.flat(), query.dataUpdatedAt);
    const current = filterRef.current;
    return arrangeFrozen(key, fetched, (row) => rowMatchesFilter(row, current));
    // knownVersion et epoch : relire après un geste et après « Actualiser l'ordre ».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, query.dataUpdatedAt, key, knownVersion, epoch]);

  const refreshOrder = useCallback(() => {
    resetFrozenOrder(key);
    setEpoch((n) => n + 1);
  }, [key]);

  const notify = useRef(onRowsChange);
  notify.current = onRowsChange;
  useEffect(() => {
    notify.current?.(arranged.rows);
  }, [arranged.rows]);

  return {
    rows: arranged.rows,
    outOfFilter: arranged.outOfFilter,
    orderDiffers: arranged.orderDiffers,
    refreshOrder,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    hasNextPage: !!query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  };
}

interface CandidateListProps {
  rows: readonly MissionCandidateRow[];
  outOfFilter: ReadonlySet<string>;
  steps: readonly MissionStepRef[];
  selectedIds: ReadonlySet<string>;
  activeRowId: string | null;
  now: number;
  /** Nom du tableau (lecteurs d'écran). */
  caption: string;
  testId?: string;
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  orderDiffers: boolean;
  onRefreshOrder: () => void;
  onToggleRow: (row: MissionCandidateRow, checked: boolean) => void;
  onToggleAll: (rows: readonly MissionCandidateRow[], checked: boolean) => void;
  onOpen: (rowId: string) => void;
}

function LoadingRows() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <tr key={i} className="border-b border-border last:border-b-0" aria-hidden="true">
          <td className="w-10 py-3 pl-3 pr-1">
            <Skeleton className="h-4 w-4" />
          </td>
          <td className="py-3 pr-3">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="mt-1.5 h-3 w-56 max-w-full" />
          </td>
          <td className="hidden py-3 pr-3 sm:table-cell">
            <Skeleton className="h-4 w-24" />
          </td>
          <td className="hidden py-3 pr-3 md:table-cell">
            <Skeleton className="h-4 w-40" />
          </td>
          <td className="hidden py-3 pr-3 sm:table-cell">
            <Skeleton className="h-4 w-8" />
          </td>
          <td className="py-3 pr-3">
            <Skeleton className="ml-auto h-5 w-7 rounded-full" />
          </td>
        </tr>
      ))}
    </>
  );
}

export function CandidateList({
  rows,
  outOfFilter,
  steps,
  selectedIds,
  activeRowId,
  now,
  caption,
  testId = 'candidate-list',
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  orderDiffers,
  onRefreshOrder,
  onToggleRow,
  onToggleAll,
  onOpen,
}: CandidateListProps) {
  const selectedHere = rows.filter((row) => selectedIds.has(row.id)).length;
  const allState: boolean | 'indeterminate' =
    rows.length > 0 && selectedHere === rows.length ? true : selectedHere > 0 ? 'indeterminate' : false;

  return (
    <div className="space-y-2">
      {orderDiffers && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onRefreshOrder}
            className="inline-flex items-center gap-1 rounded-sm text-xs text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Actualiser l'ordre
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table data-testid={testId} className="w-full table-fixed border-collapse text-sm" aria-busy={isLoading}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="w-10 py-2 pl-3 pr-1 font-normal">
                <Checkbox
                  checked={allState}
                  disabled={rows.length === 0}
                  onCheckedChange={(value) => onToggleAll(rows, value === true)}
                  aria-label="Tout sélectionner"
                />
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">Candidat</th>
              <th scope="col" className="hidden w-40 py-2 pr-3 font-medium sm:table-cell">Étape</th>
              <th scope="col" className="hidden w-60 py-2 pr-3 font-medium md:table-cell">Prochaine action</th>
              <th scope="col" className="hidden w-16 py-2 pr-3 font-medium sm:table-cell">Depuis</th>
              <th scope="col" className="w-14 py-2 pr-3 text-right font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              <LoadingRows />
            ) : (
              rows.map((row) => (
                <CandidateListRow
                  key={row.id}
                  row={row}
                  steps={steps}
                  selected={selectedIds.has(row.id)}
                  active={row.id === activeRowId}
                  dimmed={outOfFilter.has(row.id)}
                  now={now}
                  onToggle={onToggleRow}
                  onOpen={onOpen}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={onLoadMore} loading={isFetchingNextPage} disabled={isFetchingNextPage}>
            Afficher {PIPELINE_PAGE_SIZE} de plus
          </Button>
        </div>
      )}
    </div>
  );
}
