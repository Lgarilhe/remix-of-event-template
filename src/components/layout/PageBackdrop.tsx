/**
 * PageBackdrop : fond décoratif du haut de l'accueil et de la recherche hors mission.
 *
 * Trois taches de dégradé qui dérivent lentement et un grain fixe, fondus vers
 * le fond de page sur 28 rem (styles `.konekt-backdrop` de src/index.css).
 * Décision du propriétaire du 05/10/2026 : exception à « pas de fonds animés »
 * de docs/design/01-direction.md, limitée à ces deux écrans.
 *
 * À placer en premier enfant d'un conteneur `relative`, avant le contenu : il
 * ne reçoit aucun clic et n'est pas lu par les lecteurs d'écran. Mouvement
 * réduit : les taches restent à leur place de départ (règle globale de index.css).
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface PageBackdropProps {
  className?: string;
}

export const PageBackdrop: React.FC<PageBackdropProps> = React.memo(({ className }) => (
  <div aria-hidden="true" className={cn('konekt-backdrop', className)}>
    <span className="konekt-backdrop__blob konekt-backdrop__blob--a" />
    <span className="konekt-backdrop__blob konekt-backdrop__blob--b" />
    <span className="konekt-backdrop__blob konekt-backdrop__blob--c" />
  </div>
));

PageBackdrop.displayName = 'PageBackdrop';
