import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { AnimatedOrb } from './AnimatedOrb';

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
  variant?: 'default' | 'search' | 'sequences';
  messages?: string[];
  rows?: number;
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
        <AnimatedOrb size={24} speed={4} />
        <span
          className={cn(
            'text-[11px] text-muted-foreground tracking-wider transition-opacity duration-300 ease-out',
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
      {/* Animated eye orb as spinner */}
      <div className="relative mb-5">
        <AnimatedOrb size={48} speed={5} />
        {/* Pulsing ring around the orb */}
        <div className="absolute inset-[-6px] rounded-full border border-brutal-accent/20 animate-[pulse_2.5s_ease-in-out_infinite]" />
      </div>

      {/* Rotating text */}
      <p
        className={cn(
          'text-[11px] text-muted-foreground/70 uppercase tracking-[0.14em] font-medium transition-opacity duration-300 ease-out mb-8',
          fade ? 'opacity-100' : 'opacity-0'
        )}
      >
        {pool[msgIndex]}
      </p>

      {/* Skeleton rows with staggered entrance + gradient shimmer */}
      <div className="w-full max-w-md space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-11 border border-foreground/[0.06] bg-muted/40 relative overflow-hidden animate-fade-in"
            style={{
              animationDelay: `${i * 120}ms`,
              animationFillMode: 'backwards',
            }}
          >
            {/* Gradient shimmer sweep */}
            <div
              className="absolute inset-0 animate-[shimmer_2s_ease-in-out_infinite]"
              style={{
                animationDelay: `${i * 250}ms`,
                background:
                  'linear-gradient(90deg, transparent 0%, hsl(var(--brutal-accent) / 0.04) 40%, hsl(var(--brutal-accent) / 0.08) 50%, hsl(var(--brutal-accent) / 0.04) 60%, transparent 100%)',
              }}
            />
            {/* Faux content blocks */}
            <div className="flex items-center gap-3 px-4 h-full">
              <div
                className="w-7 h-7 bg-foreground/[0.04] shrink-0"
                style={{ animationDelay: `${i * 100}ms` }}
              />
              <div className="flex-1 space-y-1.5">
                <div
                  className="h-2 bg-foreground/[0.06]"
                  style={{ width: `${60 + (i % 3) * 15}%` }}
                />
                <div
                  className="h-1.5 bg-foreground/[0.04]"
                  style={{ width: `${35 + (i % 2) * 20}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
