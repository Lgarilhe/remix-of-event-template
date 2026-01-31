import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ATSCandidate } from '@/pages/ATS';
import { ATSCandidateCard } from './ATSCandidateCard';

interface ATSDraggableCardProps {
  candidate: ATSCandidate;
  columnId: string;
  onClick: () => void;
}

export const ATSDraggableCard: React.FC<ATSDraggableCardProps> = ({
  candidate,
  columnId,
  onClick,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: candidate.id,
    data: {
      type: 'card',
      candidate,
      columnId,
    },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={isDragging ? 'opacity-50' : ''}
    >
      <ATSCandidateCard
        candidate={candidate}
        isDragging={isDragging}
        onClick={onClick}
      />
    </div>
  );
};
