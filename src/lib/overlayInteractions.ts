/**
 * Les toasts vivent hors des dialogues. Quand un dialogue modal est ouvert,
 * un clic sur l'action d'un toast (« Annuler ») compte comme un clic à
 * l'extérieur et fermerait le dialogue au lieu d'agir (revue design G-10).
 * Les contenus de Dialog et de Sheet ignorent donc ces interactions.
 */
export function isToastTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-sonner-toaster]') !== null;
}
