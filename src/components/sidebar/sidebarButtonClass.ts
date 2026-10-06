/**
 * Classes ajoutées au `Button` du kit quand il est posé dans la barre latérale
 * (lot 12, A-53). Le kit garde la hauteur, l'appui et le focus clavier ; ces
 * classes reprennent le survol et l'anneau de la barre, ceux de SidebarRow
 * (anneau plein, sans décalage). Chaque appelant pose sa cible de 44 px sur
 * téléphone (min-h-11, puis la taille compacte à partir de md).
 *
 * Hors des .tsx des composants, pour ne pas ajouter d'avertissement
 * react-refresh/only-export-components.
 */

/** Anneau de focus de la barre, pour un bouton du kit qui garde son propre survol (principal). */
export const SIDEBAR_FOCUS_CLASS = 'focus-visible:ring-sidebar-ring focus-visible:ring-offset-0';

/** Bouton fantôme de la barre : survol et anneau de la barre. */
export const SIDEBAR_GHOST_CLASS =
  'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-sidebar-ring focus-visible:ring-offset-0';
