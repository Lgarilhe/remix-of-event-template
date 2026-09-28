/**
 * CandidateAvatar — photo de candidat, ou initiales sur fond neutre.
 *
 * - Si avatarUrl fourni : <img>, avec bascule sur les initiales si l'image
 *   ne charge pas.
 * - Sinon : initiales sur un rond neutre. Pas de couleur par nom : une teinte
 *   ne porte aucune information ici et concurrencerait les statuts
 *   (docs/design/01-direction.md, § 2).
 *
 * Rond pour une personne, carré (MissionCompanyLogo) pour une organisation.
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

export const CandidateAvatar: React.FC<CandidateAvatarProps> = ({
  name,
  avatarUrl,
  size = 32,
  className,
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  const initials = useMemo(() => getInitials(name), [name]);

  const sizeStyle = { width: `${size}px`, height: `${size}px` };
  const fontSize = size >= 40 ? 'text-sm' : size >= 28 ? 'text-2xs' : 'text-3xs';

  if (!avatarUrl || imgFailed) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-foreground-secondary ring-1 ring-border',
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
      alt=""
      aria-hidden="true"
      style={sizeStyle}
      className={cn('shrink-0 rounded-full bg-muted object-cover ring-1 ring-border', className)}
      onError={() => setImgFailed(true)}
    />
  );
};
