// Refonte mission, lots 1 et 2 : requête média lue en direct (panneau plein
// écran sous lg, traité comme une fenêtre modale).
import { useCallback, useSyncExternalStore } from 'react';

/** Point de rupture sous lequel le panneau de droite couvre tout l'écran (lg de Tailwind). */
export const PANEL_FULLSCREEN_QUERY = '(max-width: 1023px)';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = () => (typeof window !== 'undefined' && !!window.matchMedia ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
