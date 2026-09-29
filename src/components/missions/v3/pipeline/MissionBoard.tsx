// Refonte mission, lot 2 : vue « Par étape » (kanban) de la nouvelle page
// mission. Colonnes par étape générale : À trier, Retenu, Contacté, A répondu,
// une par étape d'entretien (ou En entretien), Embauché, puis Écarté à part.
// « Étape à choisir » seulement si besoin, sans dépôt (la base exige une étape).
//
// Glisser une carte = geste d'étape sur la ligne entière (group_ids), par
// useMissionStageActions. La carte ne change de colonne qu'après l'écriture ;
// rien n'est annoncé avant. L'ancien kanban (MissionPipeline.tsx) reste pour
// l'ancienne page.

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useKnownStagesVersion, useMissionBoardRows } from '@/hooks/useMissionCandidateRows';
import type { StageTarget } from '@/lib/candidateStage';
import { plural } from '@/lib/plural';
import { GENERAL_STAGE_LABEL, MISSION_STEP_MISSING_LABEL, isStale, stageAgeDays } from '@/lib/stageDisplay';
import { cn } from '@/lib/utils';
import {
  NO_STEP,
  moveOptions,
  type MissionCandidateRow,
  type MissionStageActions,
  type MissionStepRef,
} from '../types';
import { ScorePill, candidateName } from './CandidateListRow';
import { ListError } from './PipelineEmptyStates';
import { applyKnownStages } from './frozenOrder';

// Textes d'assistance du glisser, en français (ceux de la bibliothèque sont en anglais).
const SCREEN_READER: ScreenReaderInstructions = {
  draggable:
    "Entrée ouvre la fiche du candidat. Pour changer d'étape, glissez la carte avec la souris, ou utilisez « Déplacer vers » dans la fiche.",
};

function announcements(labelOf: (key: string | null) => string | null): Announcements {
  return {
    onDragStart: () => 'Carte saisie.',
    onDragOver: ({ over }) => {
      const label = labelOf(over ? String(over.id) : null);
      return label ? `Au-dessus de la colonne ${label}.` : undefined;
    },
    onDragEnd: ({ over }) => {
      const label = labelOf(over ? String(over.id) : null);
      return label ? `Carte lâchée sur la colonne ${label}.` : 'Carte lâchée hors des colonnes.';
    },
    onDragCancel: () => 'Déplacement annulé.',
  };
}

interface BoardColumn {
  key: string;
  label: string;
  /** Cible d'un dépôt ; null : colonne sans dépôt. */
  target: StageTarget | null;
  dot: string;
}

const DOT: Record<string, string> = {
  to_sort: 'bg-muted-foreground/50',
  retained: 'bg-brand',
  contacted: 'bg-info',
  replied: 'bg-info',
  interviewing: 'bg-brand',
  hired: 'bg-success',
  rejected: 'bg-danger',
  missing: 'bg-warning',
};

/** Colonne d'une ligne : étape générale, et étape d'entretien de la mission. */
export function boardColumnOf(
  row: Pick<MissionCandidateRow, 'stage' | 'processStepId'>,
  stepIds: ReadonlySet<string>,
): string {
  if (row.stage !== 'interviewing') return row.stage;
  if (row.processStepId && stepIds.has(row.processStepId)) return `interviewing:${row.processStepId}`;
  return stepIds.size > 0 ? `interviewing:${NO_STEP}` : 'interviewing';
}

function daysText(row: MissionCandidateRow, now: number): string | null {
  const days = stageAgeDays(
    { stage_entered_at: row.stageEnteredAt, updated_at: row.updatedAt, created_at: row.createdAt },
    now,
  );
  return days === null ? null : `Dans cette étape depuis ${days} j`;
}

const BoardCard = memo(function BoardCard({
  row,
  now,
  active,
  overlay,
}: {
  row: MissionCandidateRow;
  now: number;
  active?: boolean;
  overlay?: boolean;
}) {
  const since = daysText(row, now);
  const stale = isStale(
    {
      general_stage: row.stage,
      process_step_id: row.processStepId,
      stage_entered_at: row.stageEnteredAt,
      updated_at: row.updatedAt,
      created_at: row.createdAt,
    },
    now,
  );
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-2.5 text-left transition-shadow duration-150 ease-out',
        active ? 'border-brand ring-1 ring-brand' : 'border-border hover:border-border-strong',
        overlay && 'cursor-grabbing shadow-lg',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{candidateName(row)}</p>
          {row.headline && <p className="truncate text-xs text-muted-foreground">{row.headline}</p>}
        </div>
        <ScorePill score={row.score} title={row.recommendation} />
      </div>
      {since && (
        <p className={cn('mt-1.5 inline-flex items-center gap-1 text-2xs', stale ? 'font-medium text-warning' : 'text-muted-foreground')}>
          <Clock className="h-3 w-3" aria-hidden="true" />
          {since}
        </p>
      )}
    </div>
  );
});

function DraggableCard({
  row,
  now,
  active,
  canDrag,
  onOpen,
}: {
  row: MissionCandidateRow;
  now: number;
  active: boolean;
  canDrag: boolean;
  onOpen: (rowId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.id, disabled: !canDrag });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(row.id);
    }
  };
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-roledescription={canDrag ? 'carte déplaçable' : undefined}
      aria-label={`Ouvrir la fiche de ${candidateName(row)}`}
      data-testid="board-card"
      data-row-id={row.id}
      onClick={() => onOpen(row.id)}
      onKeyDown={onKeyDown}
      className={cn(
        'rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        canDrag ? 'cursor-grab' : 'cursor-pointer',
        isDragging && 'opacity-30',
      )}
    >
      <BoardCard row={row} now={now} active={active} />
    </div>
  );
}

function Column({
  column,
  rows,
  now,
  activeRowId,
  canDrag,
  onOpen,
  aside,
}: {
  column: BoardColumn;
  rows: MissionCandidateRow[];
  now: number;
  activeRowId: string | null;
  canDrag: boolean;
  onOpen: (rowId: string) => void;
  aside?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled: column.target === null || !canDrag });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.label}, ${plural(rows.length, 'candidat')}`}
      className={cn(
        'flex max-h-[calc(100dvh-300px)] min-h-[320px] w-[260px] shrink-0 flex-col rounded-xl bg-muted/30 transition-colors duration-150',
        aside && 'ml-2',
        isOver && 'bg-muted/60 ring-1 ring-inset ring-brand/50',
      )}
    >
      <header className="flex h-9 shrink-0 items-center gap-1.5 px-3">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', column.dot)} aria-hidden="true" />
        <h3 className="truncate text-xs font-semibold text-foreground">{column.label}</h3>
        <span className="text-xs tabular-nums text-muted-foreground">{rows.length.toLocaleString('fr-FR')}</span>
      </header>
      <div className="flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
        {rows.map((row) => (
          <DraggableCard key={row.id} row={row} now={now} active={row.id === activeRowId} canDrag={canDrag} onOpen={onOpen} />
        ))}
        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
            {isOver ? 'Déposer ici' : 'Aucun candidat'}
          </p>
        )}
      </div>
    </section>
  );
}

interface MissionBoardProps {
  projectId: string;
  steps: readonly MissionStepRef[];
  canMove: boolean;
  moveDisabledReason: string | null;
  actions: MissionStageActions;
  activeRowId: string | null;
  onOpen: (rowId: string) => void;
  onRowsChange: (rows: readonly MissionCandidateRow[]) => void;
}

export function MissionBoard({
  projectId,
  steps,
  canMove,
  moveDisabledReason,
  actions,
  activeRowId,
  onOpen,
  onRowsChange,
}: MissionBoardProps) {
  const query = useMissionBoardRows(projectId);
  const knownVersion = useKnownStagesVersion();
  const [dragged, setDragged] = useState<MissionCandidateRow | null>(null);
  const [now] = useState(() => Date.now());
  const dragHappened = useRef(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const stepIds = useMemo(() => new Set(steps.map((s) => s.id)), [steps]);
  const rows = useMemo(
    () => (query.data ? applyKnownStages(query.data.rows, query.dataUpdatedAt) : []),
    // knownVersion : relire dès qu'un geste est confirmé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data, query.dataUpdatedAt, knownVersion],
  );

  const byColumn = useMemo(() => {
    const out = new Map<string, MissionCandidateRow[]>();
    for (const row of rows) {
      const key = boardColumnOf(row, stepIds);
      const list = out.get(key);
      if (list) list.push(row);
      else out.set(key, [row]);
    }
    return out;
  }, [rows, stepIds]);

  const { columns, rejected } = useMemo(() => {
    const options = moveOptions(steps);
    const main: BoardColumn[] = options
      .filter((o) => o.target.stage !== 'rejected')
      .map((o) => ({
        key: o.key,
        label: o.label,
        target: o.target,
        dot: DOT[o.target.stage] ?? DOT.interviewing,
      }));
    const missingKey = `interviewing:${NO_STEP}`;
    if (steps.length > 0 && (byColumn.get(missingKey)?.length ?? 0) > 0) {
      const at = main.findIndex((c) => c.key === 'replied') + 1;
      main.splice(at, 0, { key: missingKey, label: MISSION_STEP_MISSING_LABEL, target: null, dot: DOT.missing });
    }
    return {
      columns: main,
      rejected: { key: 'rejected', label: GENERAL_STAGE_LABEL.rejected, target: { stage: 'rejected' as const }, dot: DOT.rejected },
    };
  }, [steps, byColumn]);

  const ordered = useMemo(
    () => [...columns, rejected].flatMap((c) => byColumn.get(c.key) ?? []),
    [columns, rejected, byColumn],
  );
  const notify = useRef(onRowsChange);
  notify.current = onRowsChange;
  useEffect(() => {
    notify.current(ordered);
  }, [ordered]);

  const open = (rowId: string) => {
    if (dragHappened.current) return;
    onOpen(rowId);
  };

  const onDragStart = (event: DragStartEvent) => {
    dragHappened.current = true;
    setDragged(rows.find((r) => r.id === event.active.id) ?? null);
  };

  const onDragEnd = async (event: DragEndEvent) => {
    setDragged(null);
    window.setTimeout(() => {
      dragHappened.current = false;
    }, 0);
    const row = rows.find((r) => r.id === event.active.id);
    const overKey = event.over ? String(event.over.id) : null;
    if (!row || !overKey || boardColumnOf(row, stepIds) === overKey) return;
    const column = [...columns, rejected].find((c) => c.key === overKey);
    if (!column?.target) return;
    await actions.move({
      rows: [row],
      target: column.target,
      verb: column.target.stage === 'rejected' ? 'écarté' : 'déplacé',
    });
  };

  if (query.isError && !query.data) return <ListError onRetry={() => void query.refetch()} />;

  if (query.isLoading) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-2" aria-busy="true" aria-label="Chargement du tableau par étape">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[320px] w-[260px] shrink-0 rounded-xl" />
        ))}
      </div>
    );
  }

  const canDrag = canMove && !actions.isMoving;
  const labelOf = (key: string | null) => (key ? [...columns, rejected].find((c) => c.key === key)?.label ?? null : null);

  return (
    <div className="space-y-2" data-testid="mission-board">
      {query.data?.limited && (
        <p className="text-xs text-muted-foreground">Affichage limité aux 2 000 premiers candidats. Utilisez la liste.</p>
      )}
      {!canMove && moveDisabledReason && <p className="text-xs text-muted-foreground">{moveDisabledReason}</p>}
      <DndContext
        sensors={sensors}
        collisionDetection={rectIntersection}
        accessibility={{ screenReaderInstructions: SCREEN_READER, announcements: announcements(labelOf) }}
        onDragStart={onDragStart}
        onDragEnd={(e) => void onDragEnd(e)}
        onDragCancel={() => setDragged(null)}
      >
        <div className="flex gap-2 overflow-x-auto pb-2">
          {columns.map((column) => (
            <Column
              key={column.key}
              column={column}
              rows={byColumn.get(column.key) ?? []}
              now={now}
              activeRowId={activeRowId}
              canDrag={canDrag}
              onOpen={open}
            />
          ))}
          <Column
            column={rejected}
            rows={byColumn.get(rejected.key) ?? []}
            now={now}
            activeRowId={activeRowId}
            canDrag={canDrag}
            onOpen={open}
            aside
          />
        </div>
        <DragOverlay dropAnimation={null}>{dragged ? <BoardCard row={dragged} now={now} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
