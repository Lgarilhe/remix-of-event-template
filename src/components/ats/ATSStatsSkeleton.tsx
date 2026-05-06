import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export const ATSStatsSkeleton: React.FC = () => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-card p-3 flex items-center gap-3"
        >
          <Skeleton className="h-7 w-7 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-12 rounded-full" />
            <Skeleton className="h-4 w-8 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
};
