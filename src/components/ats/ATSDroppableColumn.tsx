import React, { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ATSCandidate } from '@/hooks/useATSData';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/plural';
import { ATSDraggableCard } from './ATSDraggableCard';

interface ATSDroppableColumnProps {
  id: string;
  stage: { key: string; label: string };
  /** Toutes les étapes, pour le menu « Déplacer vers… » des cartes. */
  stages: { key: string; label: string }[];
  candidates: ATSCandidate[];
  isOver: boolean;
  /** Une carte est en train d'être glissée : une colonne vide montre sa zone de dépôt. */
  dragActive?: boolean;
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
 * Colonne d'une étape, au style du kanban de la page mission (design simplifié,
 * lot Suite) : fond de carte sans bordure, en-tête discret, effectif écrit
 * seulement s'il n'est pas nul (le nom accessible garde le nombre). Une colonne
 * vide n'affiche rien au repos ; pendant un glisser, sa zone de dépôt. Survolée
 * pendant un glisser, elle prend un fond doux et un filet d'accent, sans grossir
 * ni projeter d'ombre (revue design E-23).
 */
export const ATSDroppableColumn: React.FC<ATSDroppableColumnProps> = ({
  id,
  stage,
  stages,
  candidates,
  isOver,
  dragActive = false,
  onCandidateClick,
  onJobClick,
  onMove,
  selectedIds,
  onToggleSelect,
}) => {
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
      aria-label={`Colonne ${stage.label}, ${plural(candidates.length, 'candidat')}`}
      className={cn(
        'flex w-[280px] shrink-0 flex-col gap-2 rounded-xl p-2.5 transition-colors duration-150',
        isOver ? 'bg-muted/60 ring-1 ring-inset ring-brand/50' : 'bg-card',
      )}
    >
      <header className="flex items-baseline justify-between gap-2 px-0.5 text-xs text-muted-foreground">
        <h2 className="truncate font-semibold">{stage.label}</h2>
        {candidates.length > 0 && <span className="shrink-0 tabular-nums" aria-hidden="true">{candidates.length}</span>}
      </header>

      <ul className="-mx-1 flex-1 space-y-2 px-1 md:max-h-[600px] md:overflow-y-auto">
        {visibleCandidates.length === 0 ? (
          dragActive && (
            <li
              className={cn(
                'rounded-lg border border-dashed px-3 py-6 text-center text-xs',
                isOver ? 'border-brand text-foreground' : 'border-border text-muted-foreground',
              )}
            >
              Déposer ici
            </li>
          )
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
        <footer className="flex gap-1.5">
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
