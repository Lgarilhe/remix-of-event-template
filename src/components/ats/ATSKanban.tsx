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
import { ATSCandidate } from '@/pages/ATS';
import { ATSCandidateCard } from './ATSCandidateCard';
import { ATSDroppableColumn } from './ATSDroppableColumn';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface ATSKanbanProps {
  data: Record<string, ATSCandidate[]>;
  stages: { key: string; label: string; color: string }[];
  onStageChange: (candidateId: string, newStage: string) => void;
  onCandidateClick: (candidate: ATSCandidate) => void;
}

export const ATSKanban: React.FC<ATSKanbanProps> = ({ 
  data, 
  stages, 
  onStageChange, 
  onCandidateClick 
}) => {
  const [activeCandidate, setActiveCandidate] = React.useState<ATSCandidate | null>(null);
  const [activeOverColumn, setActiveOverColumn] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

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
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <ScrollArea className="w-full">
        <div className="flex gap-4 pb-4 min-w-max">
          {stages.map(stage => (
            <ATSDroppableColumn
              key={stage.key}
              id={stage.key}
              stage={stage}
              candidates={data[stage.key] || []}
              isOver={activeOverColumn === stage.key}
              onCandidateClick={onCandidateClick}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <DragOverlay dropAnimation={null}>
        {activeCandidate ? (
          <div className="w-[280px] opacity-90">
            <ATSCandidateCard 
              candidate={activeCandidate} 
              isDragging 
              onClick={() => {}}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};
