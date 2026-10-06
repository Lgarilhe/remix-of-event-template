/**
 * Onglets de la barre latérale (lots 5 et 6) : identifiants, libellés, page
 * ouverte par un second clic, clé de stockage et navigation au clavier.
 *
 * Module pur, sans import : chargé tel quel par les tests (tests/ux).
 */

export type SidebarTabId = 'todo' | 'missions' | 'assistant';

/** Ordre d'affichage. `page` : cible du second clic sur l'onglet actif (D2). */
export const SIDEBAR_TABS = [
  { id: 'todo', label: 'À traiter', page: null },
  { id: 'missions', label: 'Missions', page: '/missions' },
  { id: 'assistant', label: 'Assistant', page: '/agents' },
] as const;

export type SidebarTab = (typeof SIDEBAR_TABS)[number];

/** Onglet mémorisé (D36) : lu et écrit sous try/catch par useSidebarTab. */
export const SIDEBAR_TAB_STORAGE_KEY = 'konekt:nav:tab';

/** Valeur stockée → onglet ; absente ou inconnue : À traiter (onglet par défaut, D2). */
export function parseSidebarTab(raw: string | null): SidebarTabId {
  for (const tab of SIDEBAR_TABS) {
    if (tab.id === raw) return tab.id;
  }
  return 'todo';
}

/**
 * Index de l'onglet visé par une touche du tablist, ou null si la touche ne
 * déplace rien. Flèches circulaires (droite et bas : suivant ; gauche et haut :
 * précédent), Début : premier, Fin : dernier.
 */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
