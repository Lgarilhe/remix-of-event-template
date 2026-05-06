/**
 * CandidateAvatar — photo de candidat avec fallback initiales coloré.
 *
 * - Si avatarUrl fourni : <img> avec onError automatique → bascule sur initiales
 * - Sinon : tile rounded-full avec initiales 1-2 lettres sur palette
 *   deterministe (toujours la même couleur pour un nom donné)
 *
 * Pattern V2 dashboard : rounded-full (rond, c'est une personne, pas une
 * société — distingue visuellement candidats vs missions), ring subtil.
 */

import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

interface CandidateAvatarProps {
  name: string;
  avatarUrl?: string | null;
  /** Taille en px. Default 32. */
  size?: number;
  className?: string;
}

const getInitials = (name: string): string => {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
};

// Palette deterministe — même couleur pour un nom donné, tons subtils flat
const TILE_PALETTE = [
  { bg: 'bg-blue-500/15', text: 'text-blue-700 dark:text-blue-300' },
  { bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300' },
  { bg: 'bg-violet-500/15', text: 'text-violet-700 dark:text-violet-300' },
  { bg: 'bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300' },
  { bg: 'bg-rose-500/15', text: 'text-rose-700 dark:text-rose-300' },
  { bg: 'bg-cyan-500/15', text: 'text-cyan-700 dark:text-cyan-300' },
  { bg: 'bg-indigo-500/15', text: 'text-indigo-700 dark:text-indigo-300' },
  { bg: 'bg-pink-500/15', text: 'text-pink-700 dark:text-pink-300' },
];

const tileColorFor = (name: string) => {
  const sum = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return TILE_PALETTE[sum % TILE_PALETTE.length];
};

export const CandidateAvatar: React.FC<CandidateAvatarProps> = ({
  name,
  avatarUrl,
  size = 32,
  className,
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  const palette = useMemo(() => tileColorFor(name || '?'), [name]);
  const initials = useMemo(() => getInitials(name), [name]);

  const sizeStyle = { width: `${size}px`, height: `${size}px` };
  const fontSize = size >= 40 ? 'text-sm' : size >= 32 ? 'text-xs' : 'text-[10px]';

  if (!avatarUrl || imgFailed) {
    return (
      <div
        className={cn(
          'rounded-full flex items-center justify-center font-display font-bold tracking-tight ring-1 ring-border shrink-0',
          palette.bg,
          palette.text,
          fontSize,
          className,
        )}
        style={sizeStyle}
        aria-hidden="true"
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      src={avatarUrl}
      alt={name}
      style={sizeStyle}
      className={cn(
        'rounded-full object-cover ring-1 ring-border shrink-0 bg-muted',
        className,
      )}
      onError={() => setImgFailed(true)}
    />
  );
};
