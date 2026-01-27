import React from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ShortlistEntry } from '@/pages/Candidates';
import { DraggableCandidateCard } from './DraggableCandidateCard';
import { DroppableColumn } from './DroppableColumn';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
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

export const CandidatePipeline: React.FC<CandidatePipelineProps> = ({ data, stages, onStageChange }) => {
  const [activeEntry, setActiveEntry] = React.useState<ShortlistEntry | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

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

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const entry = findEntryById(active.id as string);
    setActiveEntry(entry);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveEntry(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    // Check if dropped on a column
    const targetStage = stages.find(s => s.key === overId);
    const currentStage = findStageByEntryId(activeId);

    if (targetStage && currentStage !== targetStage.key) {
      // Move to new stage
      try {
        // Optimistic update
        onStageChange?.(activeId, targetStage.key);

        // Update in Notion
        const response = await supabase.functions.invoke('update-candidate-stage', {
          body: {
            shortlistId: activeId,
            newStage: targetStage.key,
          },
        });

        if (response.error || !response.data?.success) {
          throw new Error(response.data?.error || 'Failed to update stage');
        }

        toast.success(`Candidat déplacé vers "${targetStage.label}"`);
      } catch (error) {
        console.error('Error updating stage:', error);
        toast.error('Erreur lors de la mise à jour');
        // Revert optimistic update
        if (currentStage) {
          onStageChange?.(activeId, currentStage);
        }
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4 min-w-max">
          {stages.map(stage => (
            <DroppableColumn
              key={stage.key}
              id={stage.key}
              stage={stage}
              entries={data[stage.key] || []}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <DragOverlay>
        {activeEntry ? (
          <div className="w-[280px] opacity-95">
            <DraggableCandidateCard entry={activeEntry} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
