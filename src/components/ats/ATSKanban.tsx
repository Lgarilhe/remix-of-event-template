import React from 'react';
import {
  type Active,
  type Announcements,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  type KeyboardCoordinateGetter,
  PointerSensor,
  type ScreenReaderInstructions,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import type { ATSCandidate } from '@/hooks/useATSData';
import { ATSCandidateCard } from './ATSCandidateCard';
import { ATSDroppableColumn } from './ATSDroppableColumn';

interface ATSKanbanProps {
  data: Record<string, ATSCandidate[]>;
  stages: { key: string; label: string }[];
  onStageChange: (candidateId: string, newStage: string) => void;
  onCandidateClick: (candidate: ATSCandidate) => void;
  onJobClick?: (jobId: string) => void;
  /** Si fournis, active le mode groupé (cases à cocher sur les cartes) */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

/**
 * Au clavier : Espace saisit la carte, les flèches gauche et droite la font
 * passer d'une colonne à l'autre, Espace ou Entrée la déposent, Échap annule.
 * Entrée seule, sur une carte au repos, ouvre la fiche (revue design E-22).
 */
const KEYBOARD_CODES = { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] };

const columnKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return undefined;
  event.preventDefault();
  const { active, droppableContainers, droppableRects, over } = context;
  const columns = droppableContainers
    .getEnabled()
    .filter((container) => container.data.current?.type === 'column')
    .map((container) => ({ id: container.id, rect: droppableRects.get(container.id) }))
    .filter((column): column is { id: typeof column.id; rect: NonNullable<typeof column.rect> } => !!column.rect)
    .sort((a, b) => a.rect.left - b.rect.left);
  const currentId = over?.id ?? active?.data.current?.columnId;
  const index = columns.findIndex((column) => column.id === currentId);
  const target = columns[index + (event.code === 'ArrowRight' ? 1 : -1)];
  if (index === -1 || !target) return undefined;
  // Sous l'en-tête de la colonne visée : la carte la recouvre presque entièrement.
  return { x: target.rect.left + 8, y: target.rect.top + 52 };
};

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "Entrée ouvre la fiche du candidat. Pour changer d'étape, appuyez sur Espace, choisissez la colonne avec les flèches gauche et droite, puis appuyez de nouveau sur Espace pour déposer la carte, ou sur Échap pour annuler.",
};

export const ATSKanban: React.FC<ATSKanbanProps> = ({
  data,
  stages,
  onStageChange,
  onCandidateClick,
  onJobClick,
  selectedIds,
  onToggleSelect,
}) => {
  const [activeCandidate, setActiveCandidate] = React.useState<ATSCandidate | null>(null);
  const [activeOverColumn, setActiveOverColumn] = React.useState<string | null>(null);

  // Après un déplacement au clavier (glisser ou menu « Déplacer vers… »), le
  // focus suit la carte dans sa nouvelle colonne au lieu de retomber sur la page.
  const pendingFocusId = React.useRef<string | null>(null);
  React.useEffect(() => {
    const id = pendingFocusId.current;
    if (!id) return;
    const activator = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"] [data-card-activator]`);
    if (activator) {
      pendingFocusId.current = null;
      activator.focus();
    }
  }, [data]);

  const moveFromMenu = (candidateId: string, stageKey: string) => {
    pendingFocusId.current = candidateId;
    onStageChange(candidateId, stageKey);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      keyboardCodes: KEYBOARD_CODES,
      coordinateGetter: columnKeyboardCoordinates,
    }),
  );

  // Annonces en français, avec le nom du candidat et le nom de la colonne.
  const leftOrigin = React.useRef(false);
  const announcements = React.useMemo<Announcements>(() => {
    const stageLabel = (id: unknown) => stages.find((stage) => stage.key === id)?.label ?? 'une colonne';
    const nameOf = (active: Active) =>
      (active.data.current?.candidate as ATSCandidate | undefined)?.name ?? 'Le candidat';
    const originOf = (active: Active) => active.data.current?.columnId as string | undefined;
    return {
      onDragStart: ({ active }) => {
        leftOrigin.current = false;
        return `${nameOf(active)} saisi, dans la colonne ${stageLabel(originOf(active))}.`;
      },
      onDragOver: ({ active, over }) => {
        // Au début du glisser, la carte est encore sur sa colonne : « saisi » suffit.
        if (over && over.id === originOf(active) && !leftOrigin.current) return undefined;
        leftOrigin.current = true;
        return over
          ? `${nameOf(active)} au-dessus de la colonne ${stageLabel(over.id)}.`
          : `${nameOf(active)} n'est au-dessus d'aucune colonne.`;
      },
      onDragEnd: ({ active, over }) => {
        if (!over) return `${nameOf(active)} relâché hors des colonnes : rien n'a changé.`;
        if (over.id === originOf(active)) return `${nameOf(active)} reste dans ${stageLabel(over.id)}.`;
        return `${nameOf(active)} déposé dans ${stageLabel(over.id)}.`;
      },
      onDragCancel: ({ active }) =>
        `Déplacement annulé : ${nameOf(active)} reste dans ${stageLabel(originOf(active))}.`,
    };
  }, [stages]);

  const findCandidateById = (id: string): ATSCandidate | null => {
    for (const stage of stages) {
      const candidate = data[stage.key]?.find(c => c.id === id);
      if (candidate) return candidate;
    }
    return null;
  };

  const findStageByCandiateId = (id: string): string | null => {
    for (const stage of stages) {
      const candidate = data[stage.key]?.find(c => c.id === id);
      if (candidate) return stage.key;
    }
    return null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const candidate = findCandidateById(event.active.id as string);
    setActiveCandidate(candidate);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setActiveOverColumn(null);
      return;
    }

    const columnId = over.data.current?.type === 'column'
      ? over.id as string
      : over.data.current?.columnId;
    setActiveOverColumn(columnId || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCandidate(null);
    setActiveOverColumn(null);

    if (!over) return;

    const activeId = active.id as string;
    const currentStage = findStageByCandiateId(activeId);

    let targetStageKey: string | null = null;

    if (over.data.current?.type === 'column') {
      targetStageKey = over.id as string;
    } else if (over.data.current?.columnId) {
      targetStageKey = over.data.current.columnId;
    }

    if (!targetStageKey || currentStage === targetStageKey) return;

    if (event.activatorEvent instanceof KeyboardEvent) pendingFocusId.current = activeId;
    onStageChange(activeId, targetStageKey);
  };

  const handleDragCancel = () => {
    setActiveCandidate(null);
    setActiveOverColumn(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      accessibility={{ announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <ScrollArea className="w-full">
        <div className="flex min-w-max items-start gap-3 pb-4">
          {stages.map(stage => (
            <ATSDroppableColumn
              key={stage.key}
              id={stage.key}
              stage={stage}
              stages={stages}
              candidates={data[stage.key] || []}
              isOver={activeOverColumn === stage.key}
              onCandidateClick={onCandidateClick}
              onJobClick={onJobClick}
              onMove={moveFromMenu}
              selectedIds={selectedIds}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <DragOverlay dropAnimation={null}>
        {activeCandidate ? <ATSCandidateCard candidate={activeCandidate} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
};
