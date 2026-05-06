/**
 * MissionCompanyLogo — affiche le logo de la société cliente d'une mission.
 *
 * Cascade :
 * 1. Logo passé en prop (si déjà résolu côté backend)
 * 2. Clearbit (`logo.clearbit.com/{slug}.com`) — fonctionne pour ~80% des
 *    sociétés grâce au matching domain
 * 3. Google Favicons (taille 128px) — fallback large couverture
 * 4. Tile avec initiales (1-2 lettres) sur bg neutre
 *
 * Format V2 dashboard : carré arrondi (rounded-xl) 40-48px avec ring subtil
 * et ombre douce. Plus visuel qu'un simple favicon.
 */

import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

interface MissionCompanyLogoProps {
  /** Nom de la société cliente (utilisé pour le slug + initiales fallback). */
  company: string | null;
  /** Logo URL si déjà connu (Brandfetch, etc.). Optionnel. */
  logoUrl?: string | null;
  /** Taille en px. Default 40. */
  size?: number;
  className?: string;
}

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

const getInitials = (name: string): string => {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
};

/**
 * Couleur de tile dérivée du nom (palette deterministe — toujours la même
 * couleur pour une société donnée). Tons neutres pour rester flat.
 */
const TILE_PALETTE = [
  { bg: 'bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400' },
  { bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400' },
  { bg: 'bg-violet-500/10', text: 'text-violet-600 dark:text-violet-400' },
  { bg: 'bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400' },
  { bg: 'bg-rose-500/10', text: 'text-rose-600 dark:text-rose-400' },
  { bg: 'bg-cyan-500/10', text: 'text-cyan-600 dark:text-cyan-400' },
  { bg: 'bg-indigo-500/10', text: 'text-indigo-600 dark:text-indigo-400' },
  { bg: 'bg-pink-500/10', text: 'text-pink-600 dark:text-pink-400' },
];

const tileColorFor = (name: string) => {
  const sum = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return TILE_PALETTE[sum % TILE_PALETTE.length];
};

export const MissionCompanyLogo: React.FC<MissionCompanyLogoProps> = ({
  company,
  logoUrl,
  size = 40,
  className,
}) => {
  const [fallbackIndex, setFallbackIndex] = useState(0);

  const sources = useMemo(() => {
    if (!company) return [logoUrl].filter(Boolean) as string[];
    const slug = slugify(company);
    return [
      logoUrl,
      slug ? `https://logo.clearbit.com/${slug}.com` : null,
      slug ? `https://logo.clearbit.com/${slug}.fr` : null,
      slug ? `https://www.google.com/s2/favicons?domain=${slug}.com&sz=128` : null,
    ].filter(Boolean) as string[];
  }, [company, logoUrl]);

  const palette = useMemo(() => tileColorFor(company || '?'), [company]);
  const initials = useMemo(() => (company ? getInitials(company) : '?'), [company]);

  const sizeStyle = { width: `${size}px`, height: `${size}px` };
  const fontSize = size >= 48 ? 'text-base' : size >= 36 ? 'text-sm' : 'text-xs';

  // Pas de source dispo → tile initiales coloré
  if (!sources[fallbackIndex]) {
    return (
      <div
        className={cn(
          'rounded-xl flex items-center justify-center font-display font-bold tracking-tight ring-1 ring-border shrink-0',
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
      src={sources[fallbackIndex]}
      alt={company ? `${company} logo` : ''}
      style={sizeStyle}
      className={cn(
        'rounded-xl object-contain bg-white ring-1 ring-border shrink-0',
        className,
      )}
      onError={() => setFallbackIndex((i) => i + 1)}
    />
  );
};
