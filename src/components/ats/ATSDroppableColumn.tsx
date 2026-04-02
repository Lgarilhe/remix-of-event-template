import React, { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ATSCandidate } from '@/pages/ATS';
import { ATSDraggableCard } from './ATSDraggableCard';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface ATSDroppableColumnProps {
  id: string;
  stage: { key: string; label: string; color: string };
  candidates: ATSCandidate[];
  isOver: boolean;
  onCandidateClick: (candidate: ATSCandidate) => void;
  onJobClick?: (jobId: string) => void;
}

const INITIAL_VISIBLE = 10;
const LOAD_MORE_COUNT = 10;

export const ATSDroppableColumn: React.FC<ATSDroppableColumnProps> = ({
  id,
  stage,
  candidates,
  isOver,
  onCandidateClick,
  onJobClick,
}) => {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const { setNodeRef } = useDroppable({
    id,
    data: { type: 'column', stageKey: id },
  });

  const visibleCandidates = candidates.slice(0, visibleCount);
  const hasMore = candidates.length > visibleCount;
  const canCollapse = visibleCount > INITIAL_VISIBLE;

  return (
    <div
      ref={setNodeRef}
      className={`
        w-[280px] flex-shrink-0 border border-border bg-background transition-all duration-200
        ${isOver ? 'border-border shadow-md scale-[1.01]' : ''}
      `}
    >
      {/* Header */}
      <div className="p-3 border-b border-border bg-accent/50">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-foreground text-[12px] uppercase tracking-wider">{stage.label}</h3>
          <span className="text-xs text-foreground bg-foreground/10 px-2 py-0.5 font-bold">
            {candidates.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="p-2 space-y-2 min-h-[200px] max-h-[600px] overflow-y-auto">
        {visibleCandidates.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs uppercase tracking-wider">
            Aucun candidat
          </div>
        ) : (
          visibleCandidates.map(candidate => (
            <ATSDraggableCard
              key={candidate.id}
              candidate={candidate}
              columnId={id}
              onClick={() => onCandidateClick(candidate)}
              onJobClick={onJobClick}
            />
          ))
        )}
      </div>

      {/* Load more / Collapse */}
      {(hasMore || canCollapse) && (
        <div className="p-2 border-t border-border bg-accent/50">
          <div className="flex gap-0">
            {hasMore && (
              <button
                onClick={() => setVisibleCount(prev => Math.min(prev + LOAD_MORE_COUNT, candidates.length))}
                className="flex-1 flex items-center justify-center gap-1 h-[28px] text-xs font-medium uppercase tracking-wider text-foreground border border-border hover:bg-accent transition-colors"
              >
                <ChevronDown className="w-3 h-3" />
                Voir plus ({candidates.length - visibleCount})
              </button>
            )}
            {canCollapse && (
              <button
                onClick={() => setVisibleCount(INITIAL_VISIBLE)}
                className={`flex-1 flex items-center justify-center gap-1 h-[28px] text-xs font-medium uppercase tracking-wider text-foreground border border-border hover:bg-accent transition-colors ${hasMore ? 'border-l-0' : ''}`}
              >
                <ChevronUp className="w-3 h-3" />
                Réduire
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};