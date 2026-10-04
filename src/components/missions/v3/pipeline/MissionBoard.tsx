// Refonte mission, lot 2 : vue « Par étape » (kanban) de la nouvelle page
// mission. Colonnes Retenus, Contactés, A répondu, une par étape d'entretien
// (ou En entretien), Embauché. Ni À trier (le tri reste dans la section À trier
// de la liste), ni Écartés (derrière la puce Écartés) : la colonne Écarté
// n'apparaît que pendant un glisser, comme zone de dépôt. « Étape à choisir »
// seulement si besoin, sans dépôt (la base exige une étape).
//
// Glisser une carte = geste d'étape sur la ligne entière (group_ids), par
// useMissionStageActions. La carte ne change de colonne qu'après l'écriture ;
// rien n'est annoncé avant. L'ancien kanban (MissionPipeline.tsx) reste pour
// l'ancienne page.
//
// Taux de passage (lot 2) : sous l'en-tête des colonnes Contacté, A répondu,
// première étape d'entretien et Embauché, la part des candidats de l'étape
// d'avant qui l'ont atteinte, sur les cumuls « au total » de
// get_mission_stage_counts (jalons datés), avec le calcul écrit.
//
// Prochaine action des cartes (lot 3) : la règle de la section 4.3
// (rowNextAction), sur des signaux construits une fois par mission.

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
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { MissionStageCounts } from '@/hooks/useMissionStageCounts';
import { useKnownStagesVersion, useMissionBoardRows } from '@/hooks/useMissionCandidateRows';
import type { StageTarget } from '@/lib/candidateStage';
import { plural } from '@/lib/plural';
import { buildRowSignals, rowNextAction, type RowSignals } from '@/lib/missionNextAction';
import { GENERAL_STAGE_LABEL, MISSION_STEP_MISSING_LABEL } from '@/lib/stageDisplay';
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
}

/** Libellés des colonnes générales, au pluriel comme les puces de la barre d'étapes. */
const COLUMN_LABEL: Record<string, string> = { retained: 'Retenus', contacted: 'Contactés' };

/** Étapes sans colonne : À trier (section de la liste) et Écarté (zone de dépôt pendant un glisser). */
const HIDDEN_STAGES = new Set(['to_sort', 'rejected']);

export interface BoardPassRate {
  percent: number;
  /** Texte court sous l'en-tête. */
  text: string;
  /** Calcul écrit en clair. */
  detail: string;
}

/**
 * Taux de passage des colonnes du kanban, sur les cumuls : Contacté sur
 * Retenu, A répondu sur Contacté, première étape d'entretien (ou En
 * entretien) sur A répondu, Embauché sur les entretiens. Aucun taux sans
 * dénominateur, ni au-delà de 100 %.
 */
export function boardPassRates(
  counts: Pick<MissionStageCounts, 'everRetained' | 'everContacted' | 'everReplied' | 'everInterviewed' | 'everHired'> | null,
  steps: readonly MissionStepRef[],
): Map<string, BoardPassRate> {
  const out = new Map<string, BoardPassRate>();
  if (!counts) return out;
  const first = [...steps].sort((a, b) => a.step_order - b.step_order)[0];
  const interviewKey = first ? `interviewing:${first.id}` : 'interviewing';
  const add = (key: string, n: number, d: number, from: string, detail: string) => {
    if (!(d > 0) || n > d) return;
    out.set(key, { percent: Math.round((100 * n) / d), text: `${Math.round((100 * n) / d)} % ${from}`, detail });
  };
  const { everRetained, everContacted, everReplied, everInterviewed, everHired } = counts;
  add('contacted', everContacted, everRetained, 'des retenus',
    `${plural(everContacted, 'contacté')} sur ${plural(everRetained, 'retenu')}, au total.`);
  add('replied', everReplied, everContacted, 'des contactés',
    `${plural(everReplied, 'réponse')} sur ${plural(everContacted, 'contacté')}, au total.`);
  add(interviewKey, everInterviewed, everReplied, 'des réponses',
    `${plural(everInterviewed, 'candidat reçu', 'candidats reçus')} en entretien sur ${plural(everReplied, 'réponse')}, au total.`);
  add('hired', everHired, everInterviewed, 'des entretiens',
    `${plural(everHired, 'embauché')} sur ${plural(everInterviewed, 'candidat reçu', 'candidats reçus')} en entretien, au total.`);
  return out;
}

/** Colonne d'une ligne : étape générale, et étape d'entretien de la mission. */
export function boardColumnOf(
  row: Pick<MissionCandidateRow, 'stage' | 'processStepId'>,
  stepIds: ReadonlySet<string>,
): string {
  if (row.stage !== 'interviewing') return row.stage;
  if (row.processStepId && stepIds.has(row.processStepId)) return `interviewing:${row.processStepId}`;
  return stepIds.size > 0 ? `interviewing:${NO_STEP}` : 'interviewing';
}

const BoardCard = memo(function BoardCard({
  row,
  signals,
  active,
  overlay,
}: {
  row: MissionCandidateRow;
  signals: RowSignals;
  active?: boolean;
  overlay?: boolean;
}) {
  const next = rowNextAction(row, signals);
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border bg-muted p-2.5 text-left text-sm transition-colors duration-150 ease-out',
        active ? 'border-brand ring-1 ring-brand' : 'border-border hover:border-border-strong',
        overlay && 'cursor-grabbing shadow-lg',
      )}
    >
      <div className="flex items-baseline justify-between gap-1.5">
        <p className="min-w-0 truncate font-medium text-foreground">{candidateName(row)}</p>
        <ScorePill score={row.score} title={row.recommendation} />
      </div>
      {/* Une vraie action, sinon l'ancienneté d'un candidat qui n'avance plus ; jamais « Aucune action depuis 0 j ». */}
      {next.rank !== null && next.text ? (
        <p className={cn('truncate text-sm', next.rank === '3' ? 'text-warning' : 'text-foreground-secondary')}>{next.text}</p>
      ) : (
        next.stale &&
        next.days !== null && (
          <p className="truncate text-sm text-warning">
            {`depuis\u00a0${next.days}\u00a0j`}
            <span className="sr-only">, sans mouvement</span>
          </p>
        )
      )}
    </div>
  );
});

function DraggableCard({
  row,
  signals,
  active,
  canDrag,
  onOpen,
}: {
  row: MissionCandidateRow;
  signals: RowSignals;
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
      <BoardCard row={row} signals={signals} active={active} />
    </div>
  );
}

function Column({
  column,
  rows,
  signals,
  activeRowId,
  canDrag,
  onOpen,
  aside,
  rate,
}: {
  column: BoardColumn;
  rows: MissionCandidateRow[];
  signals: RowSignals;
  activeRowId: string | null;
  canDrag: boolean;
  onOpen: (rowId: string) => void;
  aside?: boolean;
  rate?: BoardPassRate;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled: column.target === null || !canDrag });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.label}, ${plural(rows.length, 'candidat')}`}
      className={cn(
        'flex max-h-[calc(100dvh-300px)] min-h-[120px] w-[190px] shrink-0 flex-col gap-2 rounded-[10px] bg-card p-2.5 transition-colors duration-150',
        aside && 'ml-2 border border-dashed border-border-strong',
        isOver && 'bg-muted/60 ring-1 ring-inset ring-brand/50',
      )}
    >
      <header className="shrink-0">
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <h3 className="truncate font-semibold">{column.label}</h3>
          <span className="tabular-nums">{rows.length.toLocaleString('fr-FR')}</span>
        </div>
        {rate && (
          <p className="truncate text-2xs text-muted-foreground" title={rate.detail}>
            <span aria-hidden="true">{rate.text}</span>
            <span className="sr-only">{`Taux de passage : ${rate.percent} %. ${rate.detail}`}</span>
          </p>
        )}
      </header>
      <div className="-mx-1 flex-1 space-y-2 overflow-y-auto overscroll-contain px-1">
        {rows.map((row) => (
          <DraggableCard key={row.id} row={row} signals={signals} active={row.id === activeRowId} canDrag={canDrag} onOpen={onOpen} />
        ))}
        {rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
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
  /** Étapes d'entretien en cours de lecture : squelette, aucun dépôt possible. */
  stepsLoading?: boolean;
  stepsFailed?: boolean;
  onRetrySteps?: () => void;
  /** Effectifs et cumuls de la mission, pour les taux de passage. */
  counts?: MissionStageCounts | null;
  /** Réponses, reports et interlocuteur de la mission : la prochaine action des cartes (règle de la section 4.3). */
  signals?: RowSignals;
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
  stepsLoading = false,
  stepsFailed = false,
  onRetrySteps,
  counts = null,
  signals: signalsProp,
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
  // Sans signaux fournis : texte de repos seulement, jamais de « Répondre » inventé.
  const [bareSignals] = useState(() =>
    buildRowSignals({ now: Date.now(), attention: null, snoozed: null, interlocutor: null, orgType: null }),
  );
  const signals = signalsProp ?? bareSignals;
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
      .filter((o) => !HIDDEN_STAGES.has(o.target.stage))
      .map((o) => ({ key: o.key, label: COLUMN_LABEL[o.key] ?? o.label, target: o.target }));
    const missingKey = `interviewing:${NO_STEP}`;
    if (steps.length > 0 && (byColumn.get(missingKey)?.length ?? 0) > 0) {
      const at = main.findIndex((c) => c.key === 'replied') + 1;
      main.splice(at, 0, { key: missingKey, label: MISSION_STEP_MISSING_LABEL, target: null });
    }
    return {
      columns: main,
      rejected: { key: 'rejected', label: GENERAL_STAGE_LABEL.rejected, target: { stage: 'rejected' as const } },
    };
  }, [steps, byColumn]);

  // Cartes affichées, dans l'ordre des colonnes (flèches de la fiche).
  const ordered = useMemo(() => columns.flatMap((c) => byColumn.get(c.key) ?? []), [columns, byColumn]);
  const rates = useMemo(() => boardPassRates(counts, steps), [counts, steps]);
  // Publié seulement quand la liste des lignes change (jamais sur une simple
  // nouvelle référence) : pas de rendu en boucle avec l'écran parent.
  const notify = useRef(onRowsChange);
  notify.current = onRowsChange;
  const orderedKey = ordered.map((r) => `${r.id}:${r.stage}:${r.processStepId ?? ""}`).join(',');
  const lastNotified = useRef<string | null>(null);
  useEffect(() => {
    if (lastNotified.current === orderedKey) return;
    lastNotified.current = orderedKey;
    notify.current(ordered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedKey]);

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

  if (stepsFailed) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-3">
        <p className="text-sm text-muted-foreground">Les étapes d'entretien n'ont pas pu être lues : le tableau par étape attend.</p>
        {onRetrySteps && (
          <Button variant="outline" size="xs" onClick={onRetrySteps}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Réessayer
          </Button>
        )}
      </div>
    );
  }

  if (query.isLoading || stepsLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2" aria-busy="true" aria-label="Chargement du tableau par étape">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[160px] w-[190px] shrink-0 rounded-[10px]" />
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
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          {columns.map((column) => (
            <Column
              key={column.key}
              column={column}
              rows={byColumn.get(column.key) ?? []}
              signals={signals}
              activeRowId={activeRowId}
              canDrag={canDrag}
              onOpen={open}
              rate={rates.get(column.key)}
            />
          ))}
          {/* Écarté : zone de dépôt seulement pendant un glisser, sans ses cartes. */}
          {dragged !== null && (
            <Column column={rejected} rows={[]} signals={signals} activeRowId={activeRowId} canDrag={canDrag} onOpen={open} aside />
          )}
        </div>
        <DragOverlay dropAnimation={null}>{dragged ? <BoardCard row={dragged} signals={signals} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
