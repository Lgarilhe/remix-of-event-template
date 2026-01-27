import React from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  DragOverEvent,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
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
  const [activeOverColumn, setActiveOverColumn] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveEntry(null);
    setActiveOverColumn(null);

    if (!over) return;

    const activeId = active.id as string;
    const currentStage = findStageByEntryId(activeId);

    // Get target stage - either directly from column or from card's columnId
    let targetStageKey: string | null = null;
    
    if (over.data.current?.type === 'column') {
      targetStageKey = over.id as string;
    } else if (over.data.current?.columnId) {
      targetStageKey = over.data.current.columnId;
    }

    if (!targetStageKey || currentStage === targetStageKey) return;

    const targetStage = stages.find(s => s.key === targetStageKey);
    if (!targetStage) return;

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
  };

  const handleDragCancel = () => {
    setActiveEntry(null);
    setActiveOverColumn(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4 min-w-max">
          {stages.map(stage => (
            <DroppableColumn
              key={stage.key}
              id={stage.key}
              stage={stage}
              entries={data[stage.key] || []}
              isOver={activeOverColumn === stage.key}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <DragOverlay dropAnimation={null}>
        {activeEntry ? (
          <div className="w-[280px] rotate-2 scale-105">
            <div className="bg-white rounded-lg border-2 border-[#1A1A1A]/20 p-3 shadow-xl">
              <h4 className="font-medium text-[#1A1A1A] truncate">
                {activeEntry.candidate?.name || activeEntry.name}
              </h4>
              {activeEntry.candidate?.expertise && activeEntry.candidate.expertise.length > 0 && (
                <p className="text-xs text-[#1A1A1A]/60 truncate">
                  {activeEntry.candidate.expertise.slice(0, 2).join(', ')}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
