import React, { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ATSCandidate } from '@/pages/ATS';
import { ATSDraggableCard } from './ATSDraggableCard';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface ATSDroppableColumnProps {
  id: string;
  stage: { key: string; label: string; color: string };
  candidates: ATSCandidate[];
  isOver: boolean;
  onCandidateClick: (candidate: ATSCandidate) => void;
}

const INITIAL_VISIBLE = 10;
const LOAD_MORE_COUNT = 10;

export const ATSDroppableColumn: React.FC<ATSDroppableColumnProps> = ({
  id,
  stage,
  candidates,
  isOver,
  onCandidateClick,
}) => {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const { setNodeRef } = useDroppable({
    id,
    data: {
      type: 'column',
      stageKey: id,
    },
  });

  const visibleCandidates = candidates.slice(0, visibleCount);
  const hasMore = candidates.length > visibleCount;
  const canCollapse = visibleCount > INITIAL_VISIBLE;

  const handleLoadMore = () => {
    setVisibleCount(prev => Math.min(prev + LOAD_MORE_COUNT, candidates.length));
  };

  const handleCollapse = () => {
    setVisibleCount(INITIAL_VISIBLE);
  };

  return (
    <div
      ref={setNodeRef}
      className={`
        w-[300px] flex-shrink-0 rounded-xl border-2 transition-all duration-200
        ${stage.color}
        ${isOver ? 'ring-2 ring-primary ring-offset-2 scale-[1.02]' : ''}
      `}
    >
      {/* Header */}
      <div className="p-3 border-b border-[#1A1A1A]/10 bg-white/50 rounded-t-xl">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-[#1A1A1A]">{stage.label}</h3>
          <span className="text-sm text-[#1A1A1A]/60 bg-white px-2 py-0.5 rounded-full">
            {candidates.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="p-2 space-y-2 min-h-[200px] max-h-[600px] overflow-y-auto">
        {visibleCandidates.length === 0 ? (
          <div className="text-center py-8 text-[#1A1A1A]/40 text-sm">
            Aucun candidat
          </div>
        ) : (
          visibleCandidates.map(candidate => (
            <ATSDraggableCard
              key={candidate.id}
              candidate={candidate}
              columnId={id}
              onClick={() => onCandidateClick(candidate)}
            />
          ))
        )}
      </div>

      {/* Load more / Collapse */}
      {(hasMore || canCollapse) && (
        <div className="p-2 border-t border-[#1A1A1A]/10 bg-white/50 rounded-b-xl">
          <div className="flex gap-2">
            {hasMore && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLoadMore}
                className="flex-1 text-xs"
              >
                <ChevronDown className="w-3 h-3 mr-1" />
                Voir plus ({candidates.length - visibleCount})
              </Button>
            )}
            {canCollapse && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCollapse}
                className="flex-1 text-xs"
              >
                <ChevronUp className="w-3 h-3 mr-1" />
                Réduire
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
