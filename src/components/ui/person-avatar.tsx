/**
 * PersonAvatar : le visage d'une personne, sinon ses initiales
 * (docs/design/01-direction.md, § 6).
 *
 * - La photo vient de LinkedIn (profile_picture_url) ou de sa copie Konekt.
 * - Pas de photo, lien expiré ou image cassée : initiales sur fond neutre,
 *   jamais un trou. Un nouveau lien est retenté.
 * - Décoratif par défaut, le nom étant écrit à côté ; `alt` le rend lisible.
 * - Rond pour une personne, carré pour une organisation (MissionCompanyLogo).
 *
 * AvatarStack : quelques visages qui se chevauchent, puis « +N ».
 */

import * as React from 'react';
import { initialsOf } from '@/lib/initials';
import { cn } from '@/lib/utils';

export interface PersonAvatarProps {
  name?: string | null;
  /** Adresse de la photo ; absente, ce sont les initiales. */
  src?: string | null;
  /** Côté en px (32 par défaut). */
  size?: number;
  /** Nom accessible ; sans lui, l'avatar est décoratif. */
  alt?: string;
  className?: string;
}

export const PersonAvatar = React.memo(function PersonAvatar({
  name,
  src,
  size = 32,
  alt,
  className,
}: PersonAvatarProps) {
  // Le lien en échec est mémorisé : un autre lien est retenté sans effet de bord.
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const style = { width: size, height: size };

  if (src && src !== failedSrc) {
    return (
      <img
        src={src}
        alt={alt ?? ''}
        aria-hidden={alt ? undefined : true}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(src)}
        style={style}
        className={cn('shrink-0 rounded-full bg-muted object-cover ring-1 ring-border', className)}
      />
    );
  }

  return (
    <span
      {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
      style={style}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full bg-muted font-semibold text-foreground-secondary ring-1 ring-border',
        size >= 56 ? 'text-lg' : size >= 40 ? 'text-sm' : 'text-2xs',
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
});

export interface AvatarStackProps {
  people: Array<{ name?: string | null; src?: string | null }>;
  /** Nombre total de personnes, si la liste n'en donne qu'une partie. */
  total?: number;
  /** Visages montrés avant « +N » (3 par défaut). */
  max?: number;
  /** Côté de chaque visage en px (28 par défaut). */
  size?: number;
  className?: string;
}

/** « Julie Bonnet, Sarah Bonnet et 3 autres » : nom accessible d'une pile. */
function stackLabel(names: string[], rest: number): string {
  if (rest > 0) return `${names.join(', ')} et ${rest} ${rest > 1 ? 'autres' : 'autre'}`;
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

export function AvatarStack({ people, total, max = 3, size = 28, className }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const rest = Math.max(0, (total ?? people.length) - shown.length);
  if (shown.length === 0 && rest === 0) return null;
  const names = shown.map((p) => p.name?.trim()).filter((n): n is string => Boolean(n));

  return (
    <span role="img" aria-label={stackLabel(names, rest)} className={cn('flex items-center', className)}>
      {shown.map((person, index) => (
        <PersonAvatar
          key={`${person.name ?? ''}-${index}`}
          name={person.name}
          src={person.src}
          size={size}
          className={cn('ring-2 ring-background', index > 0 && '-ml-2')}
        />
      ))}
      {rest > 0 && (
        <span
          aria-hidden="true"
          style={{ height: size, minWidth: size }}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-2xs font-semibold tabular-nums text-foreground-secondary ring-2 ring-background',
            shown.length > 0 && '-ml-2',
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
