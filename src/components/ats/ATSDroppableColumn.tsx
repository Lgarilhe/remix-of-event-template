import React, { useId, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ATSCandidate } from '@/hooks/useATSData';
import { cn } from '@/lib/utils';
import { ATSDraggableCard } from './ATSDraggableCard';

interface ATSDroppableColumnProps {
  id: string;
  stage: { key: string; label: string };
  /** Toutes les étapes, pour le menu « Déplacer vers… » des cartes. */
  stages: { key: string; label: string }[];
  candidates: ATSCandidate[];
  isOver: boolean;
  onCandidateClick: (candidate: ATSCandidate) => void;
  onJobClick?: (jobId: string) => void;
  onMove: (candidateId: string, stageKey: string) => void;
  /** Candidats cochés (actions groupées). Absent : pas de case de sélection. */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

const INITIAL_VISIBLE = 10;
const LOAD_MORE_COUNT = 10;

/**
 * Colonne d'une étape. Survolée pendant un glisser, elle prend le fond `muted`
 * et un filet d'accent, sans grossir ni projeter d'ombre (revue design E-23).
 */
export const ATSDroppableColumn: React.FC<ATSDroppableColumnProps> = ({
  id,
  stage,
  stages,
  candidates,
  isOver,
  onCandidateClick,
  onJobClick,
  onMove,
  selectedIds,
  onToggleSelect,
}) => {
  const headingId = useId();
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const { setNodeRef } = useDroppable({
    id,
    data: { type: 'column', stageKey: id },
  });

  const visibleCandidates = candidates.slice(0, visibleCount);
  const remaining = candidates.length - visibleCount;
  const canCollapse = visibleCount > INITIAL_VISIBLE;
  const selectionMode = (selectedIds?.size ?? 0) > 0;

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        'flex w-[280px] shrink-0 flex-col rounded-xl border transition-colors duration-150',
        isOver ? 'border-brand bg-muted' : 'border-border bg-card',
      )}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <h2 id={headingId} className="truncate text-sm font-semibold text-foreground">
          {stage.label}
        </h2>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {candidates.length}
          <span className="sr-only"> candidat{candidates.length > 1 ? 's' : ''}</span>
        </span>
      </header>

      <ul className="flex-1 space-y-2 p-2 md:max-h-[600px] md:overflow-y-auto">
        {visibleCandidates.length === 0 ? (
          <li
            className={cn(
              'rounded-lg border border-dashed px-3 py-6 text-center text-xs',
              isOver ? 'border-brand text-foreground' : 'border-border text-muted-foreground',
            )}
          >
            {isOver ? 'Déposer ici' : 'Aucun candidat'}
          </li>
        ) : (
          visibleCandidates.map((candidate) => (
            <li key={candidate.id}>
              <ATSDraggableCard
                candidate={candidate}
                columnId={id}
                onOpen={() => onCandidateClick(candidate)}
                onJobClick={onJobClick}
                selected={selectedIds?.has(candidate.id)}
                onToggleSelect={onToggleSelect ? () => onToggleSelect(candidate.id) : undefined}
                selectionMode={selectionMode}
                stages={stages}
                onMove={(stageKey) => onMove(candidate.id, stageKey)}
              />
            </li>
          ))
        )}
      </ul>

      {(remaining > 0 || canCollapse) && (
        <footer className="flex gap-1.5 border-t border-border p-2">
          {remaining > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="flex-1"
              onClick={() => setVisibleCount((prev) => Math.min(prev + LOAD_MORE_COUNT, candidates.length))}
            >
              <ChevronDown aria-hidden="true" />
              Voir plus ({remaining})
            </Button>
          )}
          {canCollapse && (
            <Button type="button" variant="ghost" size="xs" className="flex-1" onClick={() => setVisibleCount(INITIAL_VISIBLE)}>
              <ChevronUp aria-hidden="true" />
              Réduire
            </Button>
          )}
        </footer>
      )}
    </section>
  );
};
