/**
 * MissionCompanyLogo — logo de la société cliente d'une mission.
 *
 * Affiche le logo seulement s'il est connu (URL enregistrée, passée en prop),
 * sinon les initiales de la société sur un carré neutre. Le logo n'est jamais
 * deviné en interrogeant un service tiers depuis le navigateur : ce serait
 * envoyer le nom des clients du cabinet à ce service (revue design A-27).
 *
 * Carré pour une organisation, rond (CandidateAvatar) pour une personne.
 */

import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

interface MissionCompanyLogoProps {
  /** Nom de la société cliente (initiales de repli). */
  company: string | null;
  /** Logo enregistré, s'il existe. */
  logoUrl?: string | null;
  /** Taille en px. Default 40. */
  size?: number;
  className?: string;
}

const getInitials = (name: string): string => {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
};

export const MissionCompanyLogo: React.FC<MissionCompanyLogoProps> = ({
  company,
  logoUrl,
  size = 40,
  className,
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const initials = useMemo(() => (company ? getInitials(company) : '?'), [company]);

  const sizeStyle = { width: `${size}px`, height: `${size}px` };
  const fontSize = size >= 48 ? 'text-base' : size >= 32 ? 'text-xs' : 'text-3xs';
  const rounded = size >= 32 ? 'rounded-lg' : 'rounded-md';
  // Sous 20 px, deux lettres ne tiennent pas : le carré seul suffit.
  const showInitials = size >= 20;

  if (!logoUrl || imgFailed) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center bg-muted font-semibold text-foreground-secondary ring-1 ring-border',
          rounded,
          fontSize,
          className,
        )}
        style={sizeStyle}
        aria-hidden="true"
      >
        {showInitials && initials}
      </div>
    );
  }

  return (
    <img
      src={logoUrl}
      alt=""
      aria-hidden="true"
      style={sizeStyle}
      className={cn('shrink-0 bg-card object-contain ring-1 ring-border', rounded, className)}
      onError={() => setImgFailed(true)}
    />
  );
};
