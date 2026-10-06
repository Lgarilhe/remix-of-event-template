/**
 * Bande d'en-tête de la zone principale, sur téléphone seulement (lot 12, A-01).
 *
 * Sur ordinateur, la bande de 48 px ne portait plus que le bouton de la barre :
 * elle est masquée par md:hidden (sans attendre la mesure de l'écran, donc sans
 * saut au premier rendu), et le bouton « Afficher ou masquer la navigation »
 * passe dans l'en-tête de la barre latérale (AppSidebar), Ctrl B compris.
 *
 * Sur téléphone (D37), la barre est cachée dans la feuille : ce bouton est la
 * seule porte vers la navigation. Cible de 44 px (A-03). Il porte le chiffre
 * d'À traiter, en accent comme l'onglet (A-21). Mêmes clés que la barre (aucune
 * requête en plus) ; le chiffre est lu par aria-describedby, le nom du bouton
 * ne change pas (lot 8).
 */
import { useId } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useTodoSignal } from '@/hooks/sidebar/useTodoSignal';
import { badgeLabel } from '@/lib/sidebarSignals';

function todoDescription(count: number): string {
  if (count === 1) return '1 élément à traiter';
  if (count > 9) return 'Plus de 9 éléments à traiter';
  return `${count} éléments à traiter`;
}

function MobileMenuTrigger() {
  const { count } = useTodoSignal();
  const descriptionId = useId();
  const show = count !== null && count > 0;

  return (
    <span className="relative inline-flex">
      {/* Le kit rend l'icône et le nom « Afficher ou masquer la navigation ». */}
      <SidebarTrigger
        className="min-h-11 min-w-11 text-muted-foreground hover:text-foreground"
        aria-describedby={show ? descriptionId : undefined}
      />
      {show && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-3xs font-semibold tabular-nums text-brand-foreground"
          >
            {badgeLabel(count)}
          </span>
          <span id={descriptionId} className="sr-only">
            {todoDescription(count)}
          </span>
        </>
      )}
    </span>
  );
}

export function AppHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-2 md:hidden">
      <MobileMenuTrigger />
    </header>
  );
}
