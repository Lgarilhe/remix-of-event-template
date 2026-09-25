import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Même grille que `ATSStats` : trois tuiles sous 1280 px, six au-delà. */
export const ATSStatsSkeleton: React.FC = () => {
  return (
    <div className="mb-4 grid grid-cols-3 gap-3 xl:grid-cols-6" role="status" aria-label="Chargement des indicateurs">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex-col gap-1.5 rounded-xl border border-border bg-card p-4',
            i === 2 || i >= 4 ? 'hidden xl:flex' : 'flex',
          )}
        >
          <Skeleton className="h-4 w-16 rounded-sm" />
          <Skeleton className="h-8 w-10" />
        </div>
      ))}
    </div>
  );
};
