/**
 * CandidateAvatar — avatar candidat par taille nommée (I3 — unification des vues).
 *
 * Rendu commun : PersonAvatar (src/components/ui/person-avatar.tsx). La photo
 * si elle charge, sinon les initiales, y compris quand le lien est cassé ou a
 * expiré (l'ancien rendu masquait l'image et laissait un trou).
 * Tailles : xs 24, sm 32, md 40, lg 48, xl 64 px.
 */

import React from 'react';
import { PersonAvatar } from '@/components/ui/person-avatar';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_PX: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 40, lg: 48, xl: 64 };

export interface CandidateAvatarProps {
  /** Nom complet (utilisé pour les initiales) */
  name?: string | null;
  /** URL photo de profil */
  imageUrl?: string | null;
  /** Taille standard */
  size?: AvatarSize;
  /** Override classes (ex. rounded-md au lieu de rounded-full) */
  className?: string;
  /** Forcer un alt custom (sinon "Photo de {name}") */
  alt?: string;
}

export const CandidateAvatar = React.memo(function CandidateAvatar({
  name,
  imageUrl,
  size = 'sm',
  className,
  alt,
}: CandidateAvatarProps) {
  return (
    <PersonAvatar
      name={name}
      src={imageUrl}
      size={SIZE_PX[size]}
      alt={alt || (name ? `Photo de ${name}` : 'Photo de profil')}
      className={className}
    />
  );
});
