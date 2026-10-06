/**
 * Rend une zone inerte (attribut inert : ni clic, ni saisie, ni focus) tant
 * que `active` est vrai, par exemple pendant un enregistrement : rien de ce
 * qui serait tapé alors ne peut être remplacé sans bruit par la version
 * enregistrée. Le champ qui avait le focus le reprend ensuite, s'il est
 * toujours affiché (même élément, ou même identifiant).
 */
import { useEffect, useRef, type RefObject } from 'react';

export function useInertWhile(ref: RefObject<HTMLElement>, active: boolean): void {
  const focused = useRef<{ element: HTMLElement; id: string } | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !active) return;
    const current = document.activeElement;
    focused.current = current instanceof HTMLElement && node.contains(current) ? { element: current, id: current.id } : null;
    node.setAttribute('inert', '');
    return () => {
      node.removeAttribute('inert');
      const previous = focused.current;
      focused.current = null;
      if (!previous) return;
      const target = previous.element.isConnected ? previous.element : previous.id ? document.getElementById(previous.id) : null;
      if (target && node.contains(target)) target.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
