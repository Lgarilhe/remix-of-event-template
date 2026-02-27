import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export const ATSStatsSkeleton: React.FC = () => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-0 mb-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={`bg-background border border-foreground p-4 space-y-2 ${i > 0 ? 'border-l-0' : ''}`}
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-none" />
            <div className="space-y-1.5">
              <Skeleton className="h-6 w-10 rounded-none" />
              <Skeleton className="h-3 w-16 rounded-none" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};