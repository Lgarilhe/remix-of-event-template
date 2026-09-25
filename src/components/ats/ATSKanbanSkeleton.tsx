import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

/** Carte à trois lignes : nom et score, poste, signal daté (voir `ATSCandidateCard`). */
const SkeletonCard: React.FC = () => (
  <div className="space-y-2 rounded-lg border border-border bg-card p-3">
    <div className="flex items-center gap-2">
      <Skeleton className="h-4 flex-1 rounded-sm" />
      <Skeleton className="h-5 w-8 rounded-full" />
    </div>
    <Skeleton className="h-3 w-2/3 rounded-sm" />
    <Skeleton className="h-3 w-1/2 rounded-sm" />
  </div>
);

const SkeletonColumn: React.FC<{ cardCount: number }> = ({ cardCount }) => (
  <div className="flex w-[280px] shrink-0 flex-col rounded-xl border border-border bg-card">
    <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
      <Skeleton className="h-4 w-24 rounded-sm" />
      <Skeleton className="h-3 w-4 rounded-sm" />
    </div>
    <div className="space-y-2 p-2">
      {cardCount === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-6" />
      ) : (
        Array.from({ length: cardCount }).map((_, i) => <SkeletonCard key={i} />)
      )}
    </div>
  </div>
);

/** Une colonne par étape : dix pour le pipeline global, six pour la shortlist client. */
const CARD_COUNTS = [3, 2, 1, 3, 2, 1, 0, 1, 1, 0];

export const ATSKanbanSkeleton: React.FC<{ columns?: number }> = ({ columns = 10 }) => {
  return (
    <div role="status" aria-label="Chargement des colonnes">
      <ScrollArea className="w-full">
        <div className="flex min-w-max items-start gap-3 pb-4">
          {Array.from({ length: columns }).map((_, index) => (
            <SkeletonColumn key={index} cardCount={CARD_COUNTS[index % CARD_COUNTS.length]} />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
};
