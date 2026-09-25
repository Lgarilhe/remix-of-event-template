/**
 * Colonnes de la shortlist client (données Notion) dans /pipeline. Même
 * registre que les colonnes du pipeline global : glisser à la souris, au
 * clavier (Espace, flèches, Espace), menu « Déplacer vers… » sur chaque carte,
 * annonces en français (revue design E-22, E-28).
 */
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
import { ShortlistEntry } from '@/types/shortlist';
import { DroppableColumn } from './DroppableColumn';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

interface PipelineStage {
  key: string;
  label: string;
  color: string;
}

interface CandidatePipelineProps {
  data: Record<string, ShortlistEntry[]>;
  stages: PipelineStage[];
  onStageChange?: (entryId: string, newStage: string) => void;
}

const KEYBOARD_CODES = { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] };

/** Au clavier, les flèches gauche et droite font passer la carte d'une colonne à l'autre. */
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
  return { x: target.rect.left + 8, y: target.rect.top + 52 };
};

const SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "Entrée affiche les coordonnées du candidat. Pour changer d'étape, appuyez sur Espace, choisissez la colonne avec les flèches gauche et droite, puis appuyez de nouveau sur Espace pour déposer la carte, ou sur Échap pour annuler.",
};

const entryName = (entry: ShortlistEntry | null | undefined) => entry?.candidate?.name || entry?.name || 'Le candidat';

export const CandidatePipeline: React.FC<CandidatePipelineProps> = ({ data, stages, onStageChange }) => {
  const [activeEntry, setActiveEntry] = React.useState<ShortlistEntry | null>(null);
  const [activeOverColumn, setActiveOverColumn] = React.useState<string | null>(null);

  // Après un déplacement au clavier (glisser ou menu), le focus suit la carte dans sa nouvelle colonne.
  const pendingFocusId = React.useRef<string | null>(null);
  React.useEffect(() => {
    const id = pendingFocusId.current;
    if (!id) return;
    const activator = document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(id)}"] [data-card-activator]`);
    if (activator) {
      pendingFocusId.current = null;
      activator.focus();
    }
  }, [data]);

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

  const leftOrigin = React.useRef(false);
  const announcements = React.useMemo<Announcements>(() => {
    const stageLabel = (id: unknown) => stages.find((stage) => stage.key === id)?.label ?? 'une colonne';
    const nameOf = (active: Active) => entryName(active.data.current?.entry as ShortlistEntry | undefined);
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

  const findEntryById = (id: string): ShortlistEntry | null => {
    for (const stage of stages) {
      const entry = data[stage.key]?.find(e => e.id === id);
      if (entry) return entry;
    }
    return null;
  };

  const findStageByEntryId = (id: string): string | null => {
    for (const stage of stages) {
      const entry = data[stage.key]?.find(e => e.id === id);
      if (entry) return stage.key;
    }
    return null;
  };

  /** Déplace une candidature (glisser ou menu) : affichage immédiat, puis écriture dans Notion. */
  const moveEntry = async (entryId: string, targetStageKey: string, keepFocus = false) => {
    const currentStage = findStageByEntryId(entryId);
    if (currentStage === targetStageKey) return;

    const targetStage = stages.find(s => s.key === targetStageKey);
    if (!targetStage) return;
    const name = entryName(findEntryById(entryId));
    if (keepFocus) pendingFocusId.current = entryId;

    try {
      // Optimistic update
      onStageChange?.(entryId, targetStage.key);

      // Update in Notion
      const response = await invokeEdgeFunction('update-candidate-stage', {
        shortlistId: entryId,
        newStage: targetStage.key,
      });

      if (response.error || !response.data?.success) {
        throw new Error(response.data?.error || 'Étape non enregistrée');
      }

      toast.success(`${name} est maintenant à l'étape «\u00a0${targetStage.label}\u00a0»`);
    } catch (error) {
      console.error('Error updating stage:', error);
      toast.error(`Le déplacement de ${name} n'a pas été enregistré. Réessayez.`);
      // Revert optimistic update
      if (currentStage) {
        onStageChange?.(entryId, currentStage);
      }
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const entry = findEntryById(active.id as string);
    setActiveEntry(entry);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setActiveOverColumn(null);
      return;
    }

    // Check if over a column directly
    const columnId = over.data.current?.type === 'column' ? over.id as string : over.data.current?.columnId;
    setActiveOverColumn(columnId || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveEntry(null);
    setActiveOverColumn(null);

    if (!over) return;

    // Get target stage - either directly from column or from card's columnId
    let targetStageKey: string | null = null;

    if (over.data.current?.type === 'column') {
      targetStageKey = over.id as string;
    } else if (over.data.current?.columnId) {
      targetStageKey = over.data.current.columnId;
    }

    if (!targetStageKey) return;
    void moveEntry(active.id as string, targetStageKey, event.activatorEvent instanceof KeyboardEvent);
  };

  const handleDragCancel = () => {
    setActiveEntry(null);
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
            <DroppableColumn
              key={stage.key}
              id={stage.key}
              stage={stage}
              stages={stages}
              entries={data[stage.key] || []}
              isOver={activeOverColumn === stage.key}
              onMove={(entryId, stageKey) => void moveEntry(entryId, stageKey, true)}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <DragOverlay dropAnimation={null}>
        {activeEntry ? (
          <div className="w-[264px] rounded-lg border border-border-strong bg-card p-3 shadow-lg">
            <p className="truncate text-sm font-medium text-foreground">{entryName(activeEntry)}</p>
            {activeEntry.positions && activeEntry.positions.length > 0 && (
              <p className="mt-0.5 truncate text-xs text-foreground-secondary">{activeEntry.positions[0].name}</p>
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
