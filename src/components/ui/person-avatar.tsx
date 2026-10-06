/**
 * PersonAvatar : le visage d'une personne, sinon ses initiales
 * (docs/design/01-direction.md, § 6).
 *
 * - Avec `candidateId`, la copie privée de la photo passe d'abord (lot P,
 *   src/lib/candidatePhotos.ts), puis le lien LinkedIn (`src`), puis les initiales.
 * - Pas de photo, lien expiré ou image cassée : la source suivante, sinon les
 *   initiales sur fond neutre, jamais un trou. Un nouveau lien est retenté.
 * - Décoratif par défaut, le nom étant écrit à côté ; `alt` le rend lisible.
 * - Rond pour une personne, carré pour une organisation (MissionCompanyLogo).
 *
 * AvatarStack : quelques visages qui se chevauchent, puis « +N ». Le
 * chevauchement (6 px, plus l'anneau de 2 px) laisse lisibles les deux
 * initiales d'un visage sans photo dès 30 px.
 */

import * as React from 'react';
import { initialsOf } from '@/lib/initials';
import { useCandidatePhoto } from '@/lib/candidatePhotos';
import { cn } from '@/lib/utils';

export interface PersonAvatarProps {
  name?: string | null;
  /** Adresse de la photo LinkedIn ; absente, ce sont les initiales. */
  src?: string | null;
  /** Identifiant du candidat : sa copie privée, si elle existe, passe avant `src`. */
  candidateId?: string | null;
  /** Côté en px (32 par défaut). */
  size?: number;
  /** Nom accessible ; sans lui, l'avatar est décoratif. */
  alt?: string;
  className?: string;
}

export const PersonAvatar = React.memo(function PersonAvatar({
  name,
  src,
  candidateId,
  size = 32,
  alt,
  className,
}: PersonAvatarProps) {
  const copy = useCandidatePhoto(candidateId);
  // Les liens en échec sont mémorisés : la source suivante est essayée, un nouveau lien est retenté.
  const [failed, setFailed] = React.useState<readonly string[]>([]);
  const shown = [copy, src].find((url): url is string => !!url && !failed.includes(url)) ?? null;
  const style = { width: size, height: size };

  if (shown) {
    return (
      <img
        src={shown}
        alt={alt ?? ''}
        aria-hidden={alt ? undefined : true}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        // Pas de glisser natif de l'image : un léger mouvement sur la photo d'une ligne ou d'une carte ne l'arrache pas au clic.
        draggable={false}
        onError={() => setFailed((list) => (list.includes(shown) ? list : [...list.slice(-3), shown]))}
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
  people: Array<{ name?: string | null; src?: string | null; candidateId?: string | null }>;
  /** Nombre total de personnes, si la liste n'en donne qu'une partie. */
  total?: number;
  /** Visages montrés avant « +N » (3 par défaut). */
  max?: number;
  /** Côté de chaque visage en px (30 par défaut). */
  size?: number;
  /** Couleur de l'anneau qui sépare les visages : celle de la surface qui les porte (`ring-background` par défaut). */
  ringClassName?: string;
  className?: string;
}

/** « Julie Bonnet, Sarah Bonnet et 3 autres » : nom accessible d'une pile. */
function stackLabel(names: string[], rest: number): string {
  if (rest > 0) return `${names.join(', ')} et ${rest} ${rest > 1 ? 'autres' : 'autre'}`;
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

export function AvatarStack({ people, total, max = 3, size = 30, ringClassName = 'ring-background', className }: AvatarStackProps) {
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
          candidateId={person.candidateId}
          size={size}
          className={cn('ring-2', ringClassName, index > 0 && '-ml-1.5')}
        />
      ))}
      {rest > 0 && (
        <span
          aria-hidden="true"
          style={{ height: size, minWidth: size }}
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full bg-muted px-1.5 text-2xs font-semibold tabular-nums text-foreground-secondary ring-2',
            ringClassName,
            shown.length > 0 && '-ml-1.5',
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
