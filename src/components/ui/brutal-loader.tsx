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

/**
 * Brutal square spinner — refonte 2026-05-13.
 *
 * Avant : 3 carrés imbriqués rotatifs avec inner filled `skalr-gradient-bg`
 * (magenta/rose). Ne matchait plus le design Konekt monochrome actuel.
 *
 * Après : track statique + arc rotatif + inner carré qui pulse, tout en
 * foreground (monochrome). Brutaliste mais épuré, aligné avec le reste de
 * l'UI 2026 (SCORE CTA réservé aux moments AI explicites).
 */
function BrutalSpinner({ size = 44 }: { size?: number }) {
  const s = size;
  const inner = s * 0.32;
  return (
    <div className="relative" style={{ width: s, height: s }}>
      {/* Track statique — donne le repère carré */}
      <div className="absolute inset-0 border border-foreground/15" />
      {/* Arc rotatif — moitié de la bordure visible, animation continue */}
      <div
        className="absolute inset-0 border-2 border-transparent border-t-foreground border-r-foreground animate-[spin_1s_linear_infinite]"
      />
      {/* Inner carré qui pulse — point focal */}
      <div
        className="absolute bg-foreground animate-pulse"
        style={{
          width: inner, height: inner,
          top: (s - inner) / 2, left: (s - inner) / 2,
          animationDuration: '1.6s',
        }}
      />
    </div>
  );
}

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
        <BrutalSpinner size={20} />
        <span
          className={cn(
            'text-xs text-muted-foreground tracking-wider transition-opacity duration-300 ease-out',
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
      {/* Spinner */}
      <div className="mb-5">
        <BrutalSpinner size={44} />
      </div>

      {/* Rotating text */}
      <p
        className={cn(
          'text-xs text-muted-foreground/70 uppercase tracking-wider font-medium transition-opacity duration-300 ease-out mb-8',
          fade ? 'opacity-100' : 'opacity-0'
        )}
      >
        {pool[msgIndex]}
      </p>

      {/* Skeleton rows */}
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
            <div
              className="absolute inset-0 animate-[shimmer_2s_ease-in-out_infinite]"
              style={{
                animationDelay: `${i * 250}ms`,
                background:
                  'linear-gradient(90deg, transparent 0%, hsl(var(--primary) / 0.04) 40%, hsl(var(--primary) / 0.08) 50%, hsl(var(--primary) / 0.04) 60%, transparent 100%)',
              }}
            />
            <div className="flex items-center gap-3 px-4 h-full">
              <div className="w-7 h-7 bg-foreground/[0.04] shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2 bg-foreground/[0.06]" style={{ width: `${60 + (i % 3) * 15}%` }} />
                <div className="h-1.5 bg-foreground/[0.04]" style={{ width: `${35 + (i % 2) * 20}%` }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
