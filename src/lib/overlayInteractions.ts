/**
 * Les toasts vivent hors des dialogues. Quand un dialogue modal est ouvert,
 * un clic sur l'action d'un toast (« Annuler ») compte comme un clic à
 * l'extérieur et fermerait le dialogue au lieu d'agir (revue design G-10).
 * Les contenus de Dialog et de Sheet ignorent donc ces interactions.
 */
export function isToastTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-sonner-toaster]') !== null;
}

/**
 * Échap dans une liste de suggestions ouverte ferme la liste, pas le dialogue
 * qui la contient (revue design A-46). Radix écoute Échap avant le champ : le
 * dialogue ignore donc cette touche quand le champ porte
 * `data-suggestions-open="true"` (posé par CandidateAutocomplete). On ne se fie
 * pas à `aria-expanded` : les champs cmdk, dont la palette, le portent toujours.
 */
export function isInsideExpandedCombobox(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-suggestions-open="true"]') !== null;
}
