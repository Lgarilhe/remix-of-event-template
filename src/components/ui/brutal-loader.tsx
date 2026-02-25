import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

const LOADING_MESSAGES = [
  'Chargement en cours…',
  'On prépare tout ça…',
  'Patience, ça arrive…',
  'Encore un instant…',
  'Presque prêt…',
];

const SEARCH_MESSAGES = [
  'Recherche en cours…',
  'On fouille LinkedIn…',
  'Analyse des profils…',
  'Tri des résultats…',
  'Scoring des candidats…',
];

const SEQUENCE_MESSAGES = [
  'Chargement des séquences…',
  'Récupération des données…',
  'Synchronisation en cours…',
  'Mise à jour des statuts…',
];

const MESSAGE_SETS: Record<string, string[]> = {
  default: LOADING_MESSAGES,
  search: SEARCH_MESSAGES,
  sequences: SEQUENCE_MESSAGES,
};

interface BrutalLoaderProps {
  className?: string;
  /** Pick a set of rotating messages: 'default' | 'search' | 'sequences' */
  variant?: 'default' | 'search' | 'sequences';
  /** Override the rotating messages */
  messages?: string[];
  /** Number of skeleton rows to show */
  rows?: number;
  /** Compact mode — smaller */
  compact?: boolean;
}

export const BrutalLoader: React.FC<BrutalLoaderProps> = ({
  className,
  variant = 'default',
  messages,
  rows = 3,
  compact = false,
}) => {
  const [msgIndex, setMsgIndex] = useState(0);
  const [fade, setFade] = useState(true);
  const pool = messages || MESSAGE_SETS[variant] || LOADING_MESSAGES;

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setMsgIndex((prev) => (prev + 1) % pool.length);
        setFade(true);
      }, 200);
    }, 2400);
    return () => clearInterval(interval);
  }, [pool.length]);

  if (compact) {
    return (
      <div className={cn('flex items-center gap-3 py-4', className)}>
        <div className="relative h-5 w-5">
          <div className="absolute inset-0 border-2 border-foreground border-t-transparent animate-spin" />
        </div>
        <span
          className={cn(
            'text-xs text-muted-foreground uppercase tracking-wider transition-opacity duration-200',
            fade ? 'opacity-100' : 'opacity-0'
          )}
        >
          {pool[msgIndex]}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col items-center justify-center py-12', className)}>
      {/* Animated square spinner */}
      <div className="relative mb-6">
        <div className="h-12 w-12 border-2 border-foreground relative">
          {/* Scanning line */}
          <div className="absolute inset-x-0 h-[2px] bg-brutal-accent animate-[scan_1.5s_ease-in-out_infinite]" />
          {/* Corner accents */}
          <div className="absolute -top-1 -left-1 w-2 h-2 bg-foreground" />
          <div className="absolute -top-1 -right-1 w-2 h-2 bg-foreground" />
          <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-foreground" />
          <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-foreground" />
        </div>
      </div>

      {/* Rotating text */}
      <p
        className={cn(
          'text-xs text-muted-foreground uppercase tracking-[0.15em] font-medium transition-opacity duration-200 mb-8',
          fade ? 'opacity-100' : 'opacity-0'
        )}
      >
        {pool[msgIndex]}
      </p>

      {/* Skeleton rows */}
      <div className="w-full max-w-md space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-10 border border-foreground/10 bg-muted relative overflow-hidden"
            style={{ animationDelay: `${i * 150}ms` }}
          >
            <div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/[0.04] to-transparent animate-[shimmer_1.8s_infinite]"
              style={{ animationDelay: `${i * 200}ms` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
