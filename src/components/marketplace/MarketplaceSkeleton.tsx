/**
 * Squelettes des listes de la marketplace : la forme du contenu qui arrive,
 * à la place des carrés qui tournaient (F-29).
 */

import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export const CardsSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
    <span className="sr-only" role="status">Chargement des missions</span>
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="space-y-3 rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-12 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-8 w-full rounded-lg" />
      </div>
    ))}
  </div>
);

export const RowsSkeleton: React.FC<{ count?: number; label?: string }> = ({ count = 3, label = 'Chargement' }) => (
  <div className="divide-y divide-border rounded-xl border border-border bg-card" aria-busy="true">
    <span className="sr-only" role="status">{label}</span>
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="flex items-center gap-4 p-4">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
    ))}
  </div>
);
