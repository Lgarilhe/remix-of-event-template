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
  /** Set d'ids candidats sélectionnés (bulk mode). Undefined = pas de checkbox */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
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
  selectedIds,
  onToggleSelect,
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
        w-[280px] flex-shrink-0 border bg-background transition-all duration-200
        ${isOver
          ? 'border-foreground border-2 shadow-lg scale-[1.02] bg-muted/30'
          : 'border-border'}
      `}
      role="region"
      aria-label={`Colonne ${stage.label}, ${candidates.length} candidat${candidates.length > 1 ? 's' : ''}`}
    >
      {/* Header — sticky pour garder le label visible en scroll vertical (Opus B3) */}
      <div className={`sticky top-0 z-10 p-3 border-b transition-colors ${isOver ? 'border-foreground bg-foreground/5 backdrop-blur-sm' : 'border-border bg-accent/80 backdrop-blur-sm'}`}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-foreground text-xs uppercase tracking-wider truncate">{stage.label}</h3>
          <span className="text-xs text-foreground bg-foreground/10 px-2 py-0.5 font-bold tabular-nums shrink-0">
            {candidates.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="p-2 space-y-2 min-h-[200px] max-h-[600px] overflow-y-auto">
        {visibleCandidates.length === 0 ? (
          <div className={`text-center py-8 text-xs uppercase tracking-wider transition-all border-2 border-dashed rounded-none ${
            isOver
              ? 'text-foreground border-foreground bg-foreground/5 font-bold'
              : 'text-muted-foreground border-border/50'
          }`}>
            {isOver ? '⬇️ Déposer ici' : 'Aucun candidat'}
          </div>
        ) : (
          visibleCandidates.map(candidate => (
            <ATSDraggableCard
              key={candidate.id}
              candidate={candidate}
              columnId={id}
              onClick={() => onCandidateClick(candidate)}
              onJobClick={onJobClick}
              selected={selectedIds?.has(candidate.id)}
              onToggleSelect={onToggleSelect ? () => onToggleSelect(candidate.id) : undefined}
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