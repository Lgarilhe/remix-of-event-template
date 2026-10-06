import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { ATSCandidate } from '@/hooks/useATSData';
import { ATSCandidateCard } from './ATSCandidateCard';

interface ATSDraggableCardProps {
  candidate: ATSCandidate;
  columnId: string;
  onOpen: () => void;
  onJobClick?: (jobId: string) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  selectionMode?: boolean;
  stages: { key: string; label: string }[];
  onMove: (stageKey: string) => void;
}

/**
 * Carte déplaçable : toute la carte se glisse à la souris, le nom se saisit au
 * clavier (Espace). La carte n'ajoute pas d'arrêt de tabulation à celui du nom
 * (revue design E-22).
 */
export const ATSDraggableCard: React.FC<ATSDraggableCardProps> = ({ candidate, columnId, ...cardProps }) => {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: candidate.id,
    data: { type: 'card', candidate, columnId },
    attributes: { roleDescription: 'carte déplaçable' },
  });

  return (
    <ATSCandidateCard
      candidate={candidate}
      {...cardProps}
      drag={{ setNodeRef, setActivatorNodeRef, attributes, listeners }}
      isDragging={isDragging}
    />
  );
};
