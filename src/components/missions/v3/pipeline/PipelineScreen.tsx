// Refonte mission, lot 2 : écran Pipeline de la nouvelle page mission
// (conception 4.1 et 4.2, lot 2 de la section 13). De haut en bas : barre
// d'étapes « En ce moment », ligne d'outils, Bilan, liste des candidats en
// cours (ou kanban « Par étape »), section À trier repliée, barre d'actions
// groupées. Données : mission_candidate_rows et get_mission_stage_counts ;
// gestes par useMissionStageActions. Pas de carte « Maintenant » (lot 3).
// Signature figée : export function PipelineScreen(), sans props.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useMissionProcess } from '@/hooks/useMissionProcess';
import { useMissionStageActions } from '@/hooks/useMissionStageActions';
import { useMissionStageCounts, type MissionStageCounts } from '@/hooks/useMissionStageCounts';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { V3_PARAM } from '@/lib/missionBeta';
import { invalidateStageReaders } from '@/lib/stageDisplay';
import { useMissionV3 } from '../MissionV3Context';
import {
  parseStageFilter,
  sameStageFilter,
  stageFilterParam,
  type MissionCandidateRow,
  type MissionStepRef,
  type PipelineViewMode,
  type StageFilter,
  type StageMoveSummary,
} from '../types';
import { BilanCard } from './BilanCard';
import { BulkActionBar } from './BulkActionBar';
import { CandidateList, useFrozenCandidateRows } from './CandidateList';
import { MissionBoard } from './MissionBoard';
import {
  EmptyFilter,
  ListError,
  MissionStartCards,
  NothingInProgress,
  NothingInProgressToSort,
  PipelineLoading,
} from './PipelineEmptyStates';
import { PipelineToolbar } from './PipelineToolbar';
import { StageBar } from './StageBar';
import { ToSortSection } from './ToSortSection';

const EMPTY_ROWS: readonly MissionCandidateRow[] = [];

function totalInMission(c: MissionStageCounts): number {
  return c.toSort + c.retained + c.contacted + c.replied + c.interviewing + c.hired + c.rejected;
}

function inProgress(c: MissionStageCounts): number {
  return c.retained + c.contacted + c.replied + c.interviewing + c.hired;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function PipelineScreen(): JSX.Element | null {
  const ctx = useMissionV3();
  const { project, location } = ctx;
  const [, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const countsQuery = useMissionStageCounts([project.id]);
  const counts = countsQuery.data?.[project.id] ?? null;
  const countsError = countsQuery.isError || (countsQuery.isSuccess && counts === null);
  const retryCounts = useCallback(() => void countsQuery.refetch(), [countsQuery]);

  const { steps: processSteps } = useMissionProcess(project.id);
  const steps = useMemo<MissionStepRef[]>(
    () => processSteps.map((s) => ({ id: s.id, name: s.name, step_order: s.step_order })),
    [processSteps],
  );

  const filter = parseStageFilter(location.stage);
  const filterParam = filter ? stageFilterParam(filter) : null;
  const view: PipelineViewMode = location.view;
  const actions = useMissionStageActions(project.id);
  const [now] = useState(() => Date.now());

  // Paramètres de l'écran, par remplacement. Le marqueur d'historique d'un
  // panneau ouvert tombe : sa fermeture retire alors le panneau par
  // remplacement et garde le filtre choisi entre-temps.
  const setParams = useCallback(
    (values: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [name, value] of Object.entries(values)) {
            if (value === null) next.delete(name);
            else next.set(name, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // ------------------------------------------------------------ sélection
  const [selection, setSelection] = useState<Map<string, MissionCandidateRow>>(() => new Map());
  const clearSelection = useCallback(() => setSelection(new Map()), []);
  const toggleRow = useCallback((row: MissionCandidateRow, checked: boolean) => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (checked) next.set(row.id, row);
      else next.delete(row.id);
      return next;
    });
  }, []);
  const toggleAll = useCallback((rows: readonly MissionCandidateRow[], checked: boolean) => {
    setSelection((prev) => {
      const next = new Map(prev);
      for (const row of rows) {
        if (checked) next.set(row.id, row);
        else next.delete(row.id);
      }
      return next;
    });
  }, []);
  useEffect(() => {
    clearSelection();
  }, [filterParam, view, clearSelection]);
  const selectedIds = useMemo(() => new Set(selection.keys()), [selection]);
  const selectedRows = useMemo(() => [...selection.values()], [selection]);

  const onMoved = useCallback(
    (summary: StageMoveSummary) => {
      if (summary.changed > 0) clearSelection();
    },
    [clearSelection],
  );
  const onContacted = useCallback(() => {
    void invalidateStageReaders(queryClient);
    clearSelection();
  }, [queryClient, clearSelection]);

  // ------------------------------------------------ ordre publié (fiche)
  const [mainRows, setMainRows] = useState<readonly MissionCandidateRow[]>(EMPTY_ROWS);
  const [toSortRows, setToSortRows] = useState<readonly MissionCandidateRow[]>(EMPTY_ROWS);
  const [boardRows, setBoardRows] = useState<readonly MissionCandidateRow[]>(EMPTY_ROWS);
  const [toSortOpen, setToSortOpen] = useState(false);
  const toSortRef = useRef<HTMLElement>(null);

  const visibleKey = useMemo(() => {
    const rows = view === 'etapes' ? boardRows : [...mainRows, ...(toSortOpen ? toSortRows : EMPTY_ROWS)];
    return [...new Set(rows.map((r) => r.id))].join(',');
  }, [view, boardRows, mainRows, toSortRows, toSortOpen]);
  const publish = useRef(ctx.setVisibleRowIds);
  publish.current = ctx.setVisibleRowIds;
  useEffect(() => {
    publish.current(visibleKey ? visibleKey.split(',') : []);
  }, [visibleKey]);

  // ------------------------------------------------------------ gestes
  const onToggleStage = useCallback(
    (next: StageFilter) => {
      if (sameStageFilter(filter, next)) setParams({ [V3_PARAM.stage]: null });
      else setParams({ [V3_PARAM.stage]: stageFilterParam(next), [V3_PARAM.view]: null });
    },
    [filter, setParams],
  );

  const openToSort = useCallback(() => {
    setToSortOpen(true);
    window.requestAnimationFrame(() => {
      toSortRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
  }, []);

  const activeRowId = location.panel === 'fiche' ? location.candidateRowId : null;
  const goToSourcing = useCallback(() => ctx.goToScreen('sourcing'), [ctx]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pt-1">
      <StageBar
        counts={counts}
        isLoading={countsQuery.isLoading}
        isError={countsError}
        onRetry={retryCounts}
        steps={steps}
        activeFilter={filter}
        onToggle={onToggleStage}
      />

      <PipelineToolbar
        unopened={counts ? counts.unopened : null}
        onOpenSourcing={goToSourcing}
        view={view}
        onViewChange={(next) => setParams({ [V3_PARAM.view]: next === 'etapes' ? 'etapes' : null })}
        bilanOpen={location.bilan}
        onToggleBilan={() => ctx.setBilanOpen(!location.bilan)}
        onOpenContact={ctx.openContactPanel}
      />

      {location.bilan && (
        <BilanCard
          counts={counts}
          isLoading={countsQuery.isLoading}
          isError={countsError}
          onRetry={retryCounts}
          onClose={() => ctx.setBilanOpen(false)}
        />
      )}

      {view === 'etapes' ? (
        <div className="pb-6">
          <MissionBoard
            projectId={project.id}
            steps={steps}
            canMove={ctx.canMoveCandidates}
            moveDisabledReason={ctx.moveDisabledReason}
            actions={actions}
            activeRowId={activeRowId}
            onOpen={(rowId) => ctx.openCandidate(rowId)}
            onRowsChange={setBoardRows}
          />
        </div>
      ) : (
        <>
          <PipelineListView
            project={project}
            filter={filter}
            counts={counts}
            countsLoading={countsQuery.isLoading}
            steps={steps}
            selectedIds={selectedIds}
            activeRowId={activeRowId}
            now={now}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            onOpen={ctx.openCandidate}
            onRowsChange={setMainRows}
            onResetFilter={() => setParams({ [V3_PARAM.stage]: null })}
            onSortAll={openToSort}
            onOpenSourcing={goToSourcing}
            onDescribe={() => ctx.goToScreen('cadrage', { section: 'poste' })}
            onOpenContact={ctx.openContactPanel}
          />

          {filter === null && (toSortOpen || (counts ? counts.toSort > 0 : countsError)) && (
            <ToSortSection
              ref={toSortRef}
              projectId={project.id}
              count={counts ? counts.toSort : null}
              open={toSortOpen}
              onOpenChange={(open) => {
                setToSortOpen(open);
                if (!open) setToSortRows(EMPTY_ROWS);
              }}
              steps={steps}
              selectedIds={selectedIds}
              activeRowId={activeRowId}
              now={now}
              onToggleRow={toggleRow}
              onToggleAll={toggleAll}
              onOpen={(rowId) => ctx.openCandidate(rowId)}
              onRowsChange={setToSortRows}
            />
          )}

          <div className="pb-4" aria-hidden="true" />
          <BulkActionBar
            rows={selectedRows}
            steps={steps}
            project={project}
            canMove={ctx.canMoveCandidates}
            moveDisabledReason={ctx.moveDisabledReason}
            actions={actions}
            onMoved={onMoved}
            onContacted={onContacted}
            onClear={clearSelection}
          />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------ liste

interface PipelineListViewProps {
  project: SourcingProject;
  filter: StageFilter | null;
  counts: MissionStageCounts | null;
  countsLoading: boolean;
  steps: readonly MissionStepRef[];
  selectedIds: ReadonlySet<string>;
  activeRowId: string | null;
  now: number;
  onToggleRow: (row: MissionCandidateRow, checked: boolean) => void;
  onToggleAll: (rows: readonly MissionCandidateRow[], checked: boolean) => void;
  onOpen: (rowId: string) => void;
  onRowsChange: (rows: readonly MissionCandidateRow[]) => void;
  onResetFilter: () => void;
  onSortAll: () => void;
  onOpenSourcing: () => void;
  onDescribe: () => void;
  onOpenContact: () => void;
}

function PipelineListView({
  project,
  filter,
  counts,
  countsLoading,
  steps,
  selectedIds,
  activeRowId,
  now,
  onToggleRow,
  onToggleAll,
  onOpen,
  onRowsChange,
  onResetFilter,
  onSortAll,
  onOpenSourcing,
  onDescribe,
  onOpenContact,
}: PipelineListViewProps) {
  const list = useFrozenCandidateRows(project.id, filter, onRowsChange);
  const open = useCallback((rowId: string) => onOpen(rowId), [onOpen]);

  if (list.isError && list.rows.length === 0) return <ListError onRetry={() => void list.refetch()} />;

  const empty = !list.isLoading && list.rows.length === 0;
  if (empty) {
    if (filter !== null) return <EmptyFilter onReset={onResetFilter} />;
    if (countsLoading && !counts) return <PipelineLoading />;
    if (counts && totalInMission(counts) === 0 && counts.unopened === 0) {
      return (
        <MissionStartCards project={project} onDescribe={onDescribe} onSearch={onOpenSourcing} onContact={onOpenContact} />
      );
    }
    if (counts && inProgress(counts) === 0 && counts.toSort > 0) {
      return <NothingInProgressToSort count={counts.toSort} onSort={onSortAll} />;
    }
    return <NothingInProgress unopened={counts ? counts.unopened : null} onOpenSourcing={onOpenSourcing} />;
  }

  return (
    <CandidateList
      caption={filter === null ? 'Candidats en cours' : 'Candidats à cette étape'}
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
      onOpen={open}
    />
  );
}

