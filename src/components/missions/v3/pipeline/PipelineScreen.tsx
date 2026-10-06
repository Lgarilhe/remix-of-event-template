// Refonte mission, lots 2 et 3 : écran Pipeline de la nouvelle page mission
// (conception 4.1 et 4.2). De haut en bas : carte « Maintenant » et ligne
// « Ensuite » (lot 3, dans leur propre SectionErrorBoundary), barre d'étapes
// « En ce moment », ligne d'outils, Bilan, liste des candidats en cours (ou
// kanban « Par étape »), section À trier repliée, barre d'actions groupées.
// Données : mission_candidate_rows et get_mission_stage_counts ; gestes par
// useMissionStageActions. Les boutons de la carte sont des intentions de la
// règle (src/lib/missionNextAction.ts) que runIntent traduit en gestes de
// l'écran. Signature figée : export function PipelineScreen(), sans props.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { useMissionCandidateRows } from '@/hooks/useMissionCandidateRows';
import { useMissionRowSignals } from '@/hooks/useMissionNow';
import { useMissionProcess } from '@/hooks/useMissionProcess';
import { useMissionStageActions } from '@/hooks/useMissionStageActions';
import { useMissionStageCounts, type MissionStageCounts } from '@/hooks/useMissionStageCounts';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { V3_PARAM } from '@/lib/missionBeta';
import type { ActionIntent, RowSignals } from '@/lib/missionNextAction';
import { SETTINGS_PATHS } from '@/lib/settingsRoutes';
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
import { BulkActionBar, selectionText } from './BulkActionBar';
import { CandidateList, useFrozenCandidateRows } from './CandidateList';
import { MissionBoard } from './MissionBoard';
import { NowCard } from './NowCard';
import {
  EmptyFilter,
  ListError,
  MissionStartCards,
  NothingInProgress,
  NothingInProgressToSort,
  PipelineLoading,
} from './PipelineEmptyStates';
import { rememberPanelTab } from '../panels/panelTabMemory';
import { PipelineToolbar } from './PipelineToolbar';
import { StageBar } from './StageBar';
import { ToSortSection } from './ToSortSection';

const EMPTY_ROWS: readonly MissionCandidateRow[] = [];

const RETAINED_FILTER: StageFilter = { stage: 'retained', stepId: null };
/** « Contacter les N » sélectionne les retenus par pages de 50, jusqu'à ce plafond (dit à l'écran quand il coupe). */
const RETAINED_SELECTION_MAX = 400;

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

  const { steps: processSteps, loadingSteps, stepsError, refetchSteps } = useMissionProcess(project.id);
  // Clé primitive : useMissionProcess rend un tableau neuf à chaque rendu tant
  // que les étapes ne sont pas lues ; sans elle, le kanban relancerait le rendu
  // de l'écran en boucle.
  const stepsKey = processSteps.map((s) => `${s.id}\u0000${s.name}\u0000${s.step_order}`).join('\u0001');
  const steps = useMemo<MissionStepRef[]>(
    () => processSteps.map((s) => ({ id: s.id, name: s.name, step_order: s.step_order })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stepsKey],
  );
  const stepsFailed = stepsError && !loadingSteps && steps.length === 0;
  const retrySteps = useCallback(() => void refetchSteps(), [refetchSteps]);

  const filter = parseStageFilter(location.stage);
  const filterParam = filter ? stageFilterParam(filter) : null;
  const view: PipelineViewMode = location.view;
  const actions = useMissionStageActions(project.id);
  const [now] = useState(() => Date.now());
  const navigate = useNavigate();
  const rowSignals = useMissionRowSignals(project);

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
  // Note visible sous la barre d'outils : plafond ou échec de « Contacter les N » (vidée avec la sélection).
  const [selectionNote, setSelectionNote] = useState<string | null>(null);
  const clearSelection = useCallback(() => {
    setSelection(new Map());
    setSelectionNote(null);
  }, []);
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

  // La barre d'actions disparaît avec la sélection : le focus qu'elle avait
  // (ou qu'une fenêtre de confirmation lui a rendu) passe au début de la liste,
  // jamais sur la page entière.
  const listStartRef = useRef<HTMLSpanElement>(null);
  const clearSelectionKeepingFocus = useCallback(() => {
    const active = document.activeElement;
    const inBar = active instanceof HTMLElement && !!active.closest('[data-bulk-bar]');
    if (inBar || active === document.body || active === null) listStartRef.current?.focus({ preventScroll: true });
    clearSelection();
  }, [clearSelection]);

  const onMoved = useCallback(
    (summary: StageMoveSummary) => {
      if (summary.changed > 0) clearSelectionKeepingFocus();
    },
    [clearSelectionKeepingFocus],
  );
  const onContacted = useCallback(() => {
    void invalidateStageReaders(queryClient);
    clearSelectionKeepingFocus();
  }, [queryClient, clearSelectionKeepingFocus]);

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

  // Ouvrir À trier : la section n'existe que dans la liste sans filtre. On
  // efface donc la vue et l'étape d'abord, puis on défile dès qu'elle est posée.
  const [sortRequest, setSortRequest] = useState(0);
  const handledSort = useRef(0);
  const openToSort = useCallback(() => {
    setToSortOpen(true);
    setParams({ [V3_PARAM.stage]: null, [V3_PARAM.view]: null });
    setSortRequest((n) => n + 1);
  }, [setParams]);
  useEffect(() => {
    if (sortRequest === handledSort.current || filterParam !== null || view !== 'liste') return;
    handledSort.current = sortRequest;
    const frame = window.requestAnimationFrame(() => {
      toSortRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sortRequest, filterParam, view]);

  // « Contacter les N » (rang 7) : liste filtrée sur Retenu, retenus cochés, puis
  // le focus va au « Contacter » de la barre d'actions, qui est le geste qui
  // inscrit la sélection (le panneau de contact ne reçoit aucune sélection). La
  // sélection est posée après le changement de filtre, qui la vide. Les retenus
  // ne sont lus qu'à la demande, jusqu'à RETAINED_SELECTION_MAX.
  const [contactRequest, setContactRequest] = useState(false);
  const [focusContact, setFocusContact] = useState(false);
  const retainedQuery = useMissionCandidateRows(project.id, RETAINED_FILTER, {
    enabled: contactRequest && counts !== null && counts.retained > 0,
  });
  const contactRetained = useCallback(() => {
    setParams({ [V3_PARAM.stage]: 'retained', [V3_PARAM.view]: null });
    setSelectionNote(null);
    setContactRequest(true);
  }, [setParams]);
  const { isPending: retainedPending, isError: retainedError, hasNextPage: retainedMore, isFetchingNextPage: retainedFetching, fetchStatus: retainedFetchStatus } = retainedQuery;
  const { fetchNextPage: fetchMoreRetained } = retainedQuery;
  const retainedPages = retainedQuery.data?.pages;
  const retainedTotal = counts ? counts.retained : 0;
  const countsKnown = counts !== null;
  useEffect(() => {
    if (!contactRequest || filterParam !== 'retained' || view !== 'liste') return;
    // Plus aucun retenu (un geste entre-temps) : rien à cocher, la demande tombe.
    if (countsKnown && retainedTotal === 0) {
      setContactRequest(false);
      return;
    }
    // Hors ligne, la lecture reste en attente : on le dit au lieu d'attendre sans fin.
    if (retainedPending && retainedFetchStatus === 'paused') {
      setContactRequest(false);
      setSelectionNote('Hors ligne : les retenus ne peuvent pas être lus pour l\'instant.');
      return;
    }
    if (retainedPending) return;
    const rows = retainedPages?.flatMap((page) => page.rows) ?? [];
    if (!retainedError && retainedMore && rows.length < RETAINED_SELECTION_MAX) {
      if (!retainedFetching) void fetchMoreRetained();
      return;
    }
    setContactRequest(false);
    if (retainedError && rows.length === 0) {
      setSelectionNote('Les retenus n\'ont pas pu être lus. Réessayez.');
      return;
    }
    const picked = rows.slice(0, RETAINED_SELECTION_MAX);
    setSelection(new Map(picked.map((row) => [row.id, row] as const)));
    setSelectionNote(
      retainedTotal > picked.length
        ? `${picked.length.toLocaleString('fr-FR')} retenus sur ${retainedTotal.toLocaleString('fr-FR')} sont cochés : une sélection groupée est limitée à ${RETAINED_SELECTION_MAX.toLocaleString('fr-FR')}.`
        : null,
    );
    setFocusContact(picked.length > 0);
  }, [contactRequest, filterParam, view, retainedPending, retainedFetchStatus, retainedError, retainedMore, retainedFetching, retainedPages, retainedTotal, countsKnown, fetchMoreRetained]);
  // La barre d'actions apparaît avec la sélection : le focus va à « Contacter », sans ouvrir de panneau.
  // « Contacter » est grisé tant que le compte LinkedIn n'est pas lu : on attend qu'il s'active
  // (au plus 4 s), au lieu d'abandonner à la première image.
  useEffect(() => {
    if (!focusContact || selection.size === 0) return;
    const findContact = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[data-bulk-bar] button')).find(
        (b) => !b.disabled && b.textContent?.trim().startsWith('Contacter'),
      );
    let finished = false;
    const observer = new MutationObserver(() => attempt());
    const timer = window.setTimeout(() => finish(), 4000);
    const finish = () => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      window.clearTimeout(timer);
      setFocusContact(false);
    };
    const attempt = () => {
      const button = findContact();
      if (!button) return;
      button.focus();
      finish();
    };
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
    const frame = window.requestAnimationFrame(attempt);
    return () => {
      window.cancelAnimationFrame(frame);
      finished = true;
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [focusContact, selection.size]);

  const activeRowId = location.panel === 'fiche' ? location.candidateRowId : null;
  const goToSourcing = useCallback(() => ctx.goToScreen('sourcing'), [ctx]);

  // Intention d'un bouton de la carte vers le geste existant de l'écran.
  const runIntent = useCallback(
    (intent: ActionIntent) => {
      switch (intent.type) {
        case 'open_row':
          // « Répondre » ouvre la fiche sur Échanges : l'onglet se choisit avant l'ouverture.
          if (intent.tab === 'echanges') rememberPanelTab('echanges');
          ctx.openCandidate(intent.rowId);
          break;
        case 'open_conversation':
          navigate(`/inbox?chatId=${encodeURIComponent(intent.chatId)}`);
          break;
        case 'contact_retained':
          contactRetained();
          break;
        case 'open_to_sort':
          openToSort();
          break;
        case 'filter_stage':
          setParams({ [V3_PARAM.stage]: intent.stage, [V3_PARAM.view]: null });
          break;
        case 'open_sourcing':
          ctx.goToScreen('sourcing');
          break;
        case 'open_cadrage':
          ctx.goToScreen('cadrage', { section: intent.section });
          break;
        case 'open_linkedin_connections':
          navigate(SETTINGS_PATHS.connections);
          break;
        case 'open_org_settings':
          navigate(SETTINGS_PATHS.general);
          break;
        case 'mailto':
          window.location.assign(intent.href);
          break;
      }
    },
    [ctx, navigate, contactRetained, openToSort, setParams],
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pt-1">
      {/* Zone annoncée présente dès l'arrivée : la première case cochée est lue. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {selection.size > 0 ? selectionText(selection.size) : ''}
      </p>
      <SectionErrorBoundary fallbackTitle="La carte « Maintenant » n'a pas pu s'afficher">
        <NowCard project={project} isOwnMission={ctx.isOwnMission} onIntent={runIntent} />
      </SectionErrorBoundary>

      <StageBar
        counts={counts}
        isLoading={countsQuery.isLoading}
        isError={countsError}
        onRetry={retryCounts}
        steps={steps}
        stepsLoading={loadingSteps}
        stepsFailed={stepsFailed}
        onRetrySteps={retrySteps}
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
        />
      )}

      {selectionNote && (
        <p role="status" className="text-xs text-muted-foreground">
          {selectionNote}
        </p>
      )}

      {view === 'etapes' ? (
        <div className="pb-6">
          <MissionBoard
            projectId={project.id}
            steps={steps}
            stepsLoading={loadingSteps}
            stepsFailed={stepsFailed}
            onRetrySteps={retrySteps}
            counts={counts}
            signals={rowSignals}
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
          <span ref={listStartRef} tabIndex={-1} className="sr-only">
            Liste des candidats
          </span>
          <PipelineListView
            project={project}
            filter={filter}
            counts={counts}
            countsLoading={countsQuery.isLoading}
            steps={steps}
            signals={rowSignals}
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

          {/* Place pour la barre d'actions flottante : elle ne couvre jamais la dernière ligne. */}
          <div className={selectedRows.length > 0 ? 'pb-28' : 'pb-4'} aria-hidden="true" />
          <BulkActionBar
            rows={selectedRows}
            steps={steps}
            project={project}
            canMove={ctx.canMoveCandidates}
            moveDisabledReason={ctx.moveDisabledReason}
            actions={actions}
            onMoved={onMoved}
            onContacted={onContacted}
            onClear={clearSelectionKeepingFocus}
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
  signals: RowSignals;
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
  signals,
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
      signals={signals}
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

