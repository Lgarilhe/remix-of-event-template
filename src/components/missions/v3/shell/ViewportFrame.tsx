// Refonte mission, lots 1 et 2 : cadre pleine hauteur de la nouvelle page.
//
// La page remplit la fenêtre SOUS ce qui la précède dans la mise en page
// (en-tête téléphone, bandeaux d'essai ou de crédits), sans la dépasser : le
// bas de la coquille (barre d'actions collée en bas) reste toujours visible,
// et seule la zone de contenu défile. Hauteur = 100dvh moins la position du
// haut du cadre, relue au redimensionnement et quand un bandeau change de
// taille. Mesure sur le <main> et les éléments qui précèdent le cadre, pas sur
// le cadre lui-même (l'animation d'entrée de la page le décale de quelques
// pixels).
import { forwardRef, useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** Distance entre le haut du document et le haut du cadre, hors transformations. */
function topOf(el: HTMLElement): number {
  const main = el.closest('main');
  if (!main) return Math.max(0, el.getBoundingClientRect().top + window.scrollY);
  let top = main.getBoundingClientRect().top + window.scrollY;
  for (const child of Array.from(main.children)) {
    if (child.contains(el)) break;
    top += (child as HTMLElement).offsetHeight;
  }
  return Math.max(0, top);
}

/** Éléments dont la taille décale le cadre : ceux qui le précèdent dans le <main>. */
function precedingBlocks(el: HTMLElement): Element[] {
  const main = el.closest('main');
  if (!main) return [];
  const out: Element[] = [];
  for (const child of Array.from(main.children)) {
    if (child.contains(el)) break;
    out.push(child);
  }
  return out;
}

export const ViewportFrame = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function ViewportFrame(
  { className, style, ...rest },
  forwarded,
) {
  const inner = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const apply = () => {
      el.style.height = `calc(100dvh - ${topOf(el)}px)`;
    };
    apply();
    window.addEventListener('resize', apply);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    for (const block of precedingBlocks(el)) observer?.observe(block);
    return () => {
      window.removeEventListener('resize', apply);
      observer?.disconnect();
    };
  }, []);

  return (
    <div
      ref={(node) => {
        inner.current = node;
        if (typeof forwarded === 'function') forwarded(node);
        else if (forwarded) forwarded.current = node;
      }}
      className={cn('h-[100dvh]', className)}
      style={style}
      {...rest}
    />
  );
});
