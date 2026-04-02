import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

const SkeletonCard: React.FC = () => (
  <div className="bg-background border border-border p-3 space-y-2">
    <div className="flex items-start gap-2">
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-3/4 rounded-none" />
        <Skeleton className="h-3 w-1/2 rounded-none" />
      </div>
    </div>
    <div className="flex gap-1.5">
      <Skeleton className="h-5 w-16 rounded-none" />
      <Skeleton className="h-5 w-12 rounded-none" />
    </div>
  </div>
);

const SkeletonColumn: React.FC<{ cardCount: number }> = ({ cardCount }) => (
  <div className="w-[280px] flex-shrink-0 border border-border">
    <div className="p-3 border-b border-border bg-accent/50">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24 rounded-none" />
        <Skeleton className="h-5 w-8 rounded-none" />
      </div>
    </div>
    <div className="p-2 space-y-2 min-h-[200px]">
      {Array.from({ length: cardCount }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  </div>
);

export const ATSKanbanSkeleton: React.FC = () => {
  const cardCounts = [3, 2, 1, 4, 2, 1, 0, 1, 1];

  return (
    <ScrollArea className="w-full">
      <div className="flex gap-0 pb-4 min-w-max">
        {cardCounts.map((count, index) => (
          <SkeletonColumn key={index} cardCount={count} />
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
};