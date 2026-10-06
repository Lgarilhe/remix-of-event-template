// Refonte mission, écran Cadrage : classes et aide de focus partagées par les
// sections (design simplifié, 04/10/2026). Séparé de SectionHeader.tsx : un
// fichier de composant n'exporte que des composants (react-refresh).
import { useCallback, useRef } from 'react';

/** Section de l'écran : un filet fin au-dessus, de l'espace de part et d'autre. */
export const SECTION_CLASS = 'flex scroll-mt-4 flex-col gap-5 border-t border-border pt-8';

/** Cible de 44 px sur téléphone. */
export const TOUCH = 'max-sm:min-h-11';

/** Hauteur d'un champ de saisie ou d'un menu : 44 px sur téléphone (cible tactile). */
export const TOUCH_FIELD = 'max-sm:h-11';

/**
 * Rendre le focus à qui a ouvert une confirmation. La fenêtre de confirmation
 * est contrôlée (sans déclencheur), donc, une fois fermée, le focus tombait sur
 * la page : avec des contrôles invisibles hors survol, il fallait retraverser
 * tout l'écran. `remember` se lit au clic qui ouvre ; `restore` à la fermeture
 * (annulation, Échap, ou suppression faite : `fallback` prend alors le relais si
 * l'élément n'existe plus).
 */
export function useReturnFocus() {
  const opener = useRef<HTMLElement | null>(null);
  const remember = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, []);
  /** La suppression est faite : le focus ne revient pas à l'élément qui l'a ouverte. */
  const forget = useCallback(() => {
    opener.current = null;
  }, []);
  const restore = useCallback((fallback?: () => HTMLElement | null | undefined) => {
    // Après la fermeture de la fenêtre (son piège à focus rend la main au tour suivant).
    window.requestAnimationFrame(() => {
      const el = opener.current;
      opener.current = null;
      (el && el.isConnected ? el : fallback?.())?.focus();
    });
  }, []);
  return { remember, forget, restore };
}

/**
 * Ce qui n'apparaît qu'au survol de la ligne (classe `group`), au focus clavier
 * dans la ligne, ou sur écran tactile : l'opacité seule change, jamais le
 * display, pour que le contrôle reste atteignable au clavier et au toucher.
 */
export const REVEAL_ON_ROW =
  'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none';
