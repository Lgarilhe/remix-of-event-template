/**
 * CandidateAvatar — photo de candidat, ou initiales sur fond neutre.
 *
 * Rendu commun : PersonAvatar (src/components/ui/person-avatar.tsx), qui
 * revient aux initiales si l'image ne charge pas. Pas de couleur par nom : une
 * teinte ne porte aucune information ici et concurrencerait les statuts
 * (docs/design/01-direction.md, § 2).
 *
 * Rond pour une personne, carré (MissionCompanyLogo) pour une organisation.
 */

import React from 'react';
import { PersonAvatar } from '@/components/ui/person-avatar';

interface CandidateAvatarProps {
  name: string;
  avatarUrl?: string | null;
  /** Taille en px. Default 32. */
  size?: number;
  className?: string;
}

export const CandidateAvatar: React.FC<CandidateAvatarProps> = ({
  name,
  avatarUrl,
  size = 32,
  className,
}) => <PersonAvatar name={name} src={avatarUrl} size={size} className={className} />;
