/**
 * Garde commune des raccourcis clavier d'une lettre (G D, J/K de l'agenda…).
 * Un raccourci ne se déclenche pas quand la personne tape du texte, parcourt
 * un menu, une liste ou une grille, ou quand un dialogue est ouvert : la
 * touche appartient alors au composant qui a le focus (revue design A-48).
 */

const BLOCKING_ROLES =
  '[role="menu"], [role="listbox"], [role="combobox"], [role="grid"], [role="dialog"], [role="alertdialog"]';

export function isTypingOrInMenu(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  if (el.closest('input, textarea, select, [contenteditable="true"]')) return true;
  return !!el.closest(BLOCKING_ROLES);
}

/** Palette, tiroir de l'assistant, fenêtre de confirmation : tout dialogue Radix ouvert. */
export function hasOpenDialog(): boolean {
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
}

/** Vrai si la touche doit être laissée au navigateur ou au composant focalisé. */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || isTypingOrInMenu(e.target) || hasOpenDialog();
}
