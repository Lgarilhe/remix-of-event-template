import React, { useId, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ShortlistEntry } from '@/types/shortlist';
import { DraggableCandidateCard } from './DraggableCandidateCard';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PipelineStage {
  key: string;
  label: string;
}

interface DroppableColumnProps {
  id: string;
  stage: PipelineStage;
  /** Toutes les étapes, pour le menu « Déplacer vers… » des cartes. */
  stages: PipelineStage[];
  entries: ShortlistEntry[];
  isOver?: boolean;
  onMove: (entryId: string, stageKey: string) => void;
}

const INITIAL_DISPLAY_LIMIT = 10;
const LOAD_MORE_INCREMENT = 10;

/** Colonne d'une étape de la shortlist client, au registre des colonnes du pipeline global (revue design E-28). */
export const DroppableColumn: React.FC<DroppableColumnProps> = ({ id, stage, stages, entries, isOver, onMove }) => {
  const headingId = useId();
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
        <h2 id={headingId} className="truncate text-sm font-semibold text-foreground">{stage.label}</h2>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {entries.length}
          <span className="sr-only"> candidature{entries.length > 1 ? 's' : ''}</span>
        </span>
      </header>

      <ul className="flex-1 space-y-2 p-2 md:max-h-[600px] md:overflow-y-auto">
        {entries.length === 0 ? (
          <li
            className={cn(
              'rounded-lg border border-dashed px-3 py-6 text-center text-xs',
              isOver ? 'border-brand text-foreground' : 'border-border text-muted-foreground',
            )}
          >
            {isOver ? 'Déposer ici' : 'Aucun candidat'}
          </li>
        ) : (
          visibleEntries.map(entry => (
            <li key={entry.id}>
              <DraggableCandidateCard
                entry={entry}
                columnId={id}
                stages={stages}
                onMove={(stageKey) => onMove(entry.id, stageKey)}
              />
            </li>
          ))
        )}
      </ul>

      {(remainingCount > 0 || displayLimit > INITIAL_DISPLAY_LIMIT) && (
        <footer className="flex gap-1.5 border-t border-border p-2">
          {remainingCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="flex-1"
              onClick={() => setDisplayLimit(prev => prev + LOAD_MORE_INCREMENT)}
            >
              <ChevronDown aria-hidden="true" />
              Voir plus ({remainingCount})
            </Button>
          )}
          {displayLimit > INITIAL_DISPLAY_LIMIT && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="flex-1"
              onClick={() => setDisplayLimit(INITIAL_DISPLAY_LIMIT)}
            >
              <ChevronUp aria-hidden="true" />
              Réduire
            </Button>
          )}
        </footer>
      )}
    </section>
  );
};
