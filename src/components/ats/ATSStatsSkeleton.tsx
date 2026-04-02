import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export const ATSStatsSkeleton: React.FC = () => {
  return (
    <div className="flex flex-wrap gap-0 mb-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`flex items-center gap-2 px-3 py-2 border border-border bg-background ${i > 0 ? '-ml-px' : ''}`}
        >
          <Skeleton className="h-3.5 w-3.5 rounded-lg" />
          <Skeleton className="h-4 w-8 rounded-lg" />
          <Skeleton className="h-2.5 w-12 rounded-lg hidden sm:block" />
        </div>
      ))}
    </div>
  );
};
