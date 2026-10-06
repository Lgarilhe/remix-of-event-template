// Puce de la zone Filtres de la nouvelle page mission (filtres rapides, « À l'écoute ») : même langage que les
// puces d'état du Sourcing et que la barre d'étapes du Pipeline. Sans cadre ; fond neutre quand elle est active ;
// 32 px de haut, cible de 44 px sur téléphone par la zone d'appui étendue.
import { cn } from '@/lib/utils';

export const quickChipV3 = (active: boolean) => cn(
  'relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm transition-colors duration-150 ease-out',
  'before:absolute before:inset-x-0 before:-inset-y-1.5 sm:before:hidden',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
  active ? 'bg-muted font-semibold text-foreground' : 'text-foreground-secondary hover:bg-accent hover:text-foreground',
);
