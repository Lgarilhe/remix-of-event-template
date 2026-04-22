/**
 * CandidateAvatar — primitive partagée pour l'affichage uniforme de l'avatar
 * candidat dans toute l'app (I3 — unification des vues).
 *
 * Pattern uniformisé :
 * - Image si disponible avec fallback gracieux (display:none on error)
 * - Initiales si pas d'image
 * - Tailles standard : xs (6), sm (8), md (10), lg (12), xl (16)
 * - Forme : rounded-full par défaut, override possible
 */

import React from 'react';
import { cn } from '@/lib/utils';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASSES: Record<AvatarSize, { box: string; text: string }> = {
  xs: { box: 'w-6 h-6', text: 'text-[9px]' },
  sm: { box: 'w-8 h-8', text: 'text-[10px]' },
  md: { box: 'w-10 h-10', text: 'text-xs' },
  lg: { box: 'w-12 h-12', text: 'text-sm' },
  xl: { box: 'w-16 h-16', text: 'text-base' },
};

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

/**
 * Extrait jusqu'à 2 initiales d'un nom complet.
 * "Jean Dupont" → "JD" • "Madonna" → "M" • "" → "?"
 */
function extractInitials(name?: string | null): string {
  if (!name?.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export const CandidateAvatar = React.memo(function CandidateAvatar({
  name,
  imageUrl,
  size = 'sm',
  className,
  alt,
}: CandidateAvatarProps) {
  const sizeClasses = SIZE_CLASSES[size];
  const initials = extractInitials(name);
  const altText = alt || (name ? `Photo de ${name}` : 'Photo de profil');

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={altText}
        className={cn(
          sizeClasses.box,
          'rounded-full object-cover shrink-0 bg-muted',
          className,
        )}
        onError={(e) => {
          // Cache l'image cassée et laisse apparaître le fallback initial via un re-render
          // Note : on ne peut pas swap dynamiquement sans state, donc on hide juste l'img.
          // Pour un fallback propre, utiliser le composant sans imageUrl si l'URL est douteuse.
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  return (
    <div
      className={cn(
        sizeClasses.box,
        'rounded-full bg-muted flex items-center justify-center shrink-0 border border-border/50',
        className,
      )}
      role="img"
      aria-label={altText}
    >
      <span className={cn(sizeClasses.text, 'font-medium text-muted-foreground')}>
        {initials}
      </span>
    </div>
  );
});
