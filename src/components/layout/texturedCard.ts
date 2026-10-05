/**
 * texturedCard : classes d'une carte texturée (styles `.konekt-card-tex` de src/index.css).
 *
 * Dégradé et grain fixes. `teal` pour une action à faire, `warm` quand quelque
 * chose bloque. La carte porte ses propres couleurs de texte (claires dans les
 * deux thèmes) : le contenu s'écrit avec les classes habituelles
 * (`text-foreground`, `text-muted-foreground`, `Button variant="primary"`).
 *
 * Décision du propriétaire du 05/10/2026 (docs/design/01-direction.md, § 7) :
 * réservée à la carte de bienvenue de l'accueil, à la chose à faire maintenant
 * (carte « Maintenant ») et au blocage des envois. Les noms de classe sont
 * écrits en entier pour que Tailwind les garde.
 */

import { cn } from '@/lib/utils';

export type TexturedCardTone = 'teal' | 'warm';

export function texturedCard(tone: TexturedCardTone, className?: string): string {
  return cn('konekt-card-tex', tone === 'warm' ? 'konekt-card-tex--warm' : 'konekt-card-tex--teal', className);
}
