import React, { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ShortlistEntry } from '@/types/shortlist';
import { DraggableCandidateCard } from './DraggableCandidateCard';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

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

  const handleCollapse = () => {
    setDisplayLimit(INITIAL_DISPLAY_LIMIT);
  };

  return (
    <div
      ref={setNodeRef}
      className={`w-[300px] flex-shrink-0 border border-border p-3 transition-all duration-200 bg-background ${
        isOver ? 'ring-2 ring-foreground/30 shadow-lg bg-muted/20' : ''
      }`}
    >
      {/* Stage header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="font-semibold text-foreground uppercase tracking-wide text-sm">{stage.label}</h3>
        <span className="text-sm text-foreground font-bold bg-muted px-2 py-0.5 border border-border">
          {entries.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2 min-h-[100px]">
        {entries.length === 0 ? (
          <div className={`text-center py-8 text-muted-foreground text-sm border-2 border-dashed transition-colors ${
            isOver ? 'border-border bg-muted/30 text-foreground' : 'border-border'
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
                className="w-full text-muted-foreground hover:text-foreground hover:bg-muted/50 gap-1"
              >
                <ChevronDown className="w-4 h-4" />
                Voir {Math.min(remainingCount, LOAD_MORE_INCREMENT)} de plus ({remainingCount} restants)
              </Button>
            )}
            
            {displayLimit > INITIAL_DISPLAY_LIMIT && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCollapse}
                className="w-full text-muted-foreground hover:text-foreground hover:bg-muted/50 gap-1"
              >
                <ChevronUp className="w-4 h-4" />
                Réduire
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
