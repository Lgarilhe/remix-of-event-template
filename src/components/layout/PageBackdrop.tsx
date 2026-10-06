/**
 * PageBackdrop : fond décoratif du haut de l'accueil, de la recherche hors mission et des écrans de sourcing.
 *
 * Trois taches de dégradé qui dérivent (13 à 21 s l'aller, assez pour se voir) et un grain fixe, fondus vers
 * le fond de page sur 28 rem (styles `.konekt-backdrop` de src/index.css).
 * Décision du propriétaire du 05/10/2026 : exception à « pas de fonds animés »
 * de docs/design/01-direction.md, limitée à ces écrans.
 *
 * `follow` : les taches se penchent vers le curseur (souris seulement : rien au
 * toucher, rien avec le mouvement réduit). Rien n'est éclairci, les taches ne
 * font que se déplacer dans la plage déjà mesurée pour le contraste du texte.
 *
 * À placer en premier enfant d'un conteneur `relative`, avant le contenu : il
 * ne reçoit aucun clic et n'est pas lu par les lecteurs d'écran. Mouvement
 * réduit : les taches restent à leur place de départ (règle globale de index.css).
 */

import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface PageBackdropProps {
  className?: string;
  /** Les taches se penchent vers le curseur. Défaut : non. */
  follow?: boolean;
  /** Dans un conteneur à marges : les bords se fondent aussi sur les côtés, sans coupure nette. Défaut : non. */
  contained?: boolean;
}

export const PageBackdrop: React.FC<PageBackdropProps> = React.memo(({ className, follow = false, contained = false }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!follow || !el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let x = 0;
    let y = 0;
    const apply = () => {
      frame = 0;
      el.style.setProperty('--konekt-mx', x.toFixed(3));
      el.style.setProperty('--konekt-my', y.toFixed(3));
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      // Position du curseur dans la fenêtre, de -1 (gauche, haut) à 1 (droite, bas).
      x = (e.clientX / window.innerWidth) * 2 - 1;
      y = (e.clientY / window.innerHeight) * 2 - 1;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [follow]);

  return (
    <div ref={ref} aria-hidden="true" className={cn('konekt-backdrop', follow && 'konekt-backdrop--follow', contained && 'konekt-backdrop--contained', className)}>
      <span className="konekt-backdrop__blob konekt-backdrop__blob--a" />
      <span className="konekt-backdrop__blob konekt-backdrop__blob--b" />
      <span className="konekt-backdrop__blob konekt-backdrop__blob--c" />
    </div>
  );
});

PageBackdrop.displayName = 'PageBackdrop';
