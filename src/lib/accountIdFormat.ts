/**
 * Format de l'identifiant d'un compte relié (LinkedIn, messagerie, WhatsApp).
 *
 * Un identifiant actuel commence par « acc_ » (même règle que le serveur : module des
 * identifiants de comptes de supabase/functions/_shared). Un compte relié avant le changement
 * de service garde un identifiant d'un ancien format tant que la bascule ne l'a pas
 * converti : sa session peut être saine, mais la connexion doit être refaite.
 *
 * Module pur, sans import : testé par tests/ux/connexion-etats-comptes.test.mjs.
 */

const CURRENT_ACCOUNT_ID = /^acc_[A-Za-z0-9_-]+$/;

/** Vrai pour un identifiant au format actuel. */
export function isCurrentAccountId(value: unknown): value is string {
  return typeof value === 'string' && CURRENT_ACCOUNT_ID.test(value);
}

/** Vrai pour un identifiant gardé dans un ancien format (une valeur absente ou vide n'en est pas un). */
export function hasOutdatedAccountId(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '' && !isCurrentAccountId(value);
}
