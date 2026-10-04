// Refonte mission, lot 2 : tableau des candidats de la nouvelle page mission
// (liste en cours, liste filtrée par étape, section À trier). Pages de 50,
// ordre figé pour la session (frozenOrder.ts), sélection partagée.
//
// Colonnes selon la place réelle du tableau (barre latérale et fiche ouvertes
// comprises), pas selon la largeur de l'écran : le nom du candidat garde
// toujours au moins 180 px. Par ordre de priorité : Étape, Prochaine action,
// Depuis. Sans la colonne Étape, l'étape passe sous le nom.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { RowSignals } from '@/lib/missionNextAction';
import { useKnownStagesVersion, useMissionCandidateRows } from '@/hooks/useMissionCandidateRows';
import {
  PIPELINE_PAGE_SIZE,
  rowMatchesFilter,
  stageFilterKey,
  type MissionCandidateRow,
  type MissionStepRef,
  type StageFilter,
} from '../types';
import { CandidateListRow, type CandidateListColumns } from './CandidateListRow';
import { applyKnownStages, arrangeFrozen, frozenOrderKey, resetFrozenOrder, type ArrangedRows } from './frozenOrder';

const NO_ROWS: ArrangedRows<MissionCandidateRow> = { rows: [], outOfFilter: new Set(), orderDiffers: false };

/**
 * Largeurs (px, grille de la maquette 2,2fr / 1fr / 1,6fr / 56 / 44 à 1 440 px) :
 * case 40, note 48, étape 192, prochaine action 304, depuis 56 ; nom 180 au moins.
 */
const FIXED_WIDTH = 40 + 48;
const NAME_MIN = 180;
const STAGE_WIDTH = 192;
const NEXT_WIDTH = 304;
const SINCE_WIDTH = 56;

/** Colonnes affichables dans `width` px de tableau. */
export function listColumnsFor(width: number): CandidateListColumns {
  const stage = width >= FIXED_WIDTH + NAME_MIN + STAGE_WIDTH;
  const next = stage && width >= FIXED_WIDTH + NAME_MIN + STAGE_WIDTH + NEXT_WIDTH;
  const since = next && width >= FIXED_WIDTH + NAME_MIN + STAGE_WIDTH + NEXT_WIDTH + SINCE_WIDTH;
  return { stage, next, since };
}

/** Section À trier : ni étape, ni prochaine action, ni ancienneté. */
const COMPACT_COLUMNS: CandidateListColumns = { stage: false, next: false, since: false };

function sameColumns(a: CandidateListColumns, b: CandidateListColumns): boolean {
  return a.stage === b.stage && a.next === b.next && a.since === b.since;
}

/** Colonnes du tableau selon la largeur mesurée de son cadre (avant peinture, puis à chaque changement). */
function useListColumns(ref: RefObject<HTMLElement>): CandidateListColumns {
  const [columns, setColumns] = useState<CandidateListColumns>(() => listColumnsFor(0));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      const next = listColumnsFor(el.clientWidth);
      setColumns((prev) => (sameColumns(prev, next) ? prev : next));
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return columns;
}

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
    const fetched = applyKnownStages(query.data.pages.flatMap((page) => page.rows), query.dataUpdatedAt);
    const current = filterRef.current;
    return arrangeFrozen(key, fetched, (row) => rowMatchesFilter(row, current), undefined, undefined, query.dataUpdatedAt);
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
  /** Signaux de la colonne « Prochaine action » ; absents : texte de repos seulement (section À trier, sans cette colonne). */
  signals?: RowSignals;
  /** Nom du tableau (lecteurs d'écran). */
  caption: string;
  /** compact : section À trier, sans cadre ni en-tête visible, colonnes réduites au nom et à la note. */
  variant?: 'default' | 'compact';
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

function LoadingRows({ columns, compact }: { columns: CandidateListColumns; compact: boolean }) {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <tr key={i} className={compact ? 'border-t border-border/50' : 'border-b border-border/50'} aria-hidden="true">
          <td className="w-10 py-2 pl-2 pr-1">
            <Skeleton className="h-4 w-4" />
          </td>
          <td className="h-[50px] py-2 pr-3">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="mt-1.5 h-3 w-56 max-w-full" />
          </td>
          {columns.stage && (
            <td className="py-2 pr-3">
              <Skeleton className="h-5 w-24 rounded-md" />
            </td>
          )}
          {columns.next && (
            <td className="py-2 pr-3">
              <Skeleton className="h-4 w-40" />
            </td>
          )}
          {columns.since && (
            <td className="py-2 pr-3">
              <Skeleton className="ml-auto h-4 w-8" />
            </td>
          )}
          <td className="py-2 pr-2">
            <Skeleton className="ml-auto h-4 w-6" />
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
  signals,
  caption,
  testId = 'candidate-list',
  variant = 'default',
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
  const frameRef = useRef<HTMLDivElement>(null);
  const measured = useListColumns(frameRef);
  const compact = variant === 'compact';
  const columns = compact ? COMPACT_COLUMNS : measured;
  // Liste étroite (téléphone) : lignes à deux lignes, sans en-tête visible, filet en haut.
  const narrow = !compact && !columns.stage;
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
      {/* Hors À trier, bord à bord sous sm (gouttière de la page) : ne dépend que de la fenêtre, pas des colonnes mesurées. */}
      <div ref={frameRef} className={cn('overflow-x-auto', !compact && '-mx-3 sm:mx-0', narrow && 'border-t border-border')}>
        <table data-testid={testId} className="w-full table-fixed border-collapse text-sm" aria-busy={isLoading}>
          <caption className="sr-only">{caption}</caption>
          {/* Largeurs fixées ici : avec table-fixed, un en-tête masqué (sr-only) ne les donne plus et les colonnes se partagent la place à parts égales. */}
          <colgroup>
            <col className="w-10" />
            <col />
            {columns.stage && <col className="w-48" />}
            {columns.next && <col className="w-[19rem]" />}
            {columns.since && <col className="w-14" />}
            <col className="w-12" />
          </colgroup>
          {/* compact ou étroite : en-tête pour les lecteurs d'écran ; « Tout sélectionner » le montre au focus clavier. */}
          <thead className={cn((compact || narrow) && 'sr-only focus-within:not-sr-only')}>
            <tr className="h-[34px] border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className={cn('w-10 pr-1 font-normal', compact ? 'pl-2' : 'pl-3 sm:pl-2')}>
                <Checkbox
                  checked={allState}
                  disabled={rows.length === 0}
                  onCheckedChange={(value) => onToggleAll(rows, value === true)}
                  aria-label={`Tout sélectionner : ${caption}`}
                />
              </th>
              <th scope="col" className="min-w-[180px] pr-3 font-normal">Candidat</th>
              {columns.stage && <th scope="col" className="w-48 pr-3 font-normal">Étape</th>}
              {columns.next && <th scope="col" className="w-[19rem] pr-3 font-normal">Prochaine action</th>}
              {columns.since && <th scope="col" className="w-14 pr-3 text-right font-normal">Depuis</th>}
              <th scope="col" className={cn('w-12 text-right font-normal', compact ? 'pr-2' : 'pr-3 sm:pr-2')}>Note</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              <LoadingRows columns={columns} compact={compact} />
            ) : (
              rows.map((row) => (
                <CandidateListRow
                  key={row.id}
                  row={row}
                  steps={steps}
                  selected={selectedIds.has(row.id)}
                  active={row.id === activeRowId}
                  dimmed={outOfFilter.has(row.id)}
                  columns={columns}
                  variant={variant}
                  now={now}
                  signals={signals}
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
