import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

const SKELETON_STAGES = [
  { key: 'Nouveau', color: 'bg-slate-100 border-slate-300' },
  { key: 'Contacté', color: 'bg-blue-50 border-blue-300' },
  { key: 'Répondu', color: 'bg-cyan-50 border-cyan-300' },
  { key: 'Pressenti', color: 'bg-gray-100 border-gray-300' },
  { key: 'CV envoyé', color: 'bg-indigo-50 border-indigo-300' },
  { key: 'ITW en cours', color: 'bg-yellow-50 border-yellow-300' },
  { key: 'Offre', color: 'bg-purple-50 border-purple-300' },
  { key: 'Gagné', color: 'bg-green-50 border-green-300' },
  { key: 'Perdu', color: 'bg-red-50 border-red-300' },
];

const SkeletonCard: React.FC = () => (
  <div className="bg-white rounded-lg border border-[#1A1A1A]/10 p-3 space-y-2">
    <div className="flex items-start gap-2">
      <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
    <div className="flex gap-1.5">
      <Skeleton className="h-5 w-16 rounded-full" />
      <Skeleton className="h-5 w-12 rounded-full" />
    </div>
  </div>
);

const SkeletonColumn: React.FC<{ stage: { key: string; color: string }; cardCount: number }> = ({ 
  stage, 
  cardCount 
}) => (
  <div className={`w-[300px] flex-shrink-0 rounded-xl border-2 ${stage.color}`}>
    {/* Header */}
    <div className="p-3 border-b border-[#1A1A1A]/10 bg-white/50 rounded-t-xl">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-8 rounded-full" />
      </div>
    </div>

    {/* Cards */}
    <div className="p-2 space-y-2 min-h-[200px]">
      {Array.from({ length: cardCount }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  </div>
);

export const ATSKanbanSkeleton: React.FC = () => {
  // Varying card counts for a more realistic feel
  const cardCounts = [3, 2, 1, 4, 2, 1, 0, 1, 1];

  return (
    <ScrollArea className="w-full">
      <div className="flex gap-4 pb-4 min-w-max">
        {SKELETON_STAGES.map((stage, index) => (
          <SkeletonColumn 
            key={stage.key} 
            stage={stage} 
            cardCount={cardCounts[index] || 0} 
          />
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
};
