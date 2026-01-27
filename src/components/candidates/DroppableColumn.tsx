import React, { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ShortlistEntry } from '@/pages/Candidates';
import { DraggableCandidateCard } from './DraggableCandidateCard';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';

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

const INITIAL_DISPLAY_LIMIT = 10;
const LOAD_MORE_INCREMENT = 10;

export const DroppableColumn: React.FC<DroppableColumnProps> = ({ id, stage, entries, isOver }) => {
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT);
  
  const { setNodeRef } = useDroppable({ 
    id,
    data: {
      type: 'column',
      stageKey: stage.key,
    }
  });

  const visibleEntries = entries.slice(0, displayLimit);
  const remainingCount = entries.length - displayLimit;

  const handleLoadMore = () => {
    setDisplayLimit(prev => prev + LOAD_MORE_INCREMENT);
  };

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
          <>
            {visibleEntries.map(entry => (
              <DraggableCandidateCard key={entry.id} entry={entry} columnId={id} />
            ))}
            
            {remainingCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLoadMore}
                className="w-full text-[#1A1A1A]/60 hover:text-[#1A1A1A] hover:bg-white/50 gap-1"
              >
                <ChevronDown className="w-4 h-4" />
                Voir {Math.min(remainingCount, LOAD_MORE_INCREMENT)} de plus ({remainingCount} restants)
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
