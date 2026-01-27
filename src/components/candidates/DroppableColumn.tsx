import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ShortlistEntry } from '@/pages/Candidates';
import { DraggableCandidateCard } from './DraggableCandidateCard';

interface PipelineStage {
  key: string;
  label: string;
  color: string;
}

interface DroppableColumnProps {
  id: string;
  stage: PipelineStage;
  entries: ShortlistEntry[];
  isOver?: boolean;
}

export const DroppableColumn: React.FC<DroppableColumnProps> = ({ id, stage, entries, isOver }) => {
  const { setNodeRef } = useDroppable({ 
    id,
    data: {
      type: 'column',
      stageKey: stage.key,
    }
  });

  return (
    <div
      ref={setNodeRef}
      className={`w-[300px] flex-shrink-0 rounded-lg border-2 ${stage.color} p-3 transition-all duration-200 ${
        isOver ? 'ring-2 ring-[#1A1A1A]/30 shadow-lg' : ''
      }`}
    >
      {/* Stage header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="font-semibold text-[#1A1A1A]">{stage.label}</h3>
        <span className="text-sm text-[#1A1A1A]/60 bg-white px-2 py-0.5 rounded-full border">
          {entries.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2 min-h-[100px]">
        {entries.length === 0 ? (
          <div className={`text-center py-8 text-[#1A1A1A]/40 text-sm border-2 border-dashed rounded-lg transition-colors ${
            isOver ? 'border-[#1A1A1A]/40 bg-white/70 text-[#1A1A1A]/60' : 'border-transparent'
          }`}>
            {isOver ? 'Déposer ici' : 'Aucun candidat'}
          </div>
        ) : (
          entries.map(entry => (
            <DraggableCandidateCard key={entry.id} entry={entry} columnId={id} />
          ))
        )}
      </div>
    </div>
  );
};
