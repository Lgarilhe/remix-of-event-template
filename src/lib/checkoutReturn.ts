/**
 * Retour d'un paiement : ?checkout=success|cancel&kind=pack|subscription.
 *
 * kind est posé par create-checkout-session et désigne le seul écran qui lit le
 * retour : AICreditsSettings pour un pack de crédits, BillingSettings pour un
 * abonnement. Sans lui, les deux écrans lisaient le même ?checkout= et seul
 * l'onglet d'arrivée les départageait (un changement d'onglet suffisait à
 * annoncer « Vos crédits arrivent » pour un abonnement).
 */

/** Type d'achat d'un retour de paiement. */
export type CheckoutKind = 'pack' | 'subscription';

export interface CheckoutReturn {
  status: 'success' | 'cancel';
  kind: CheckoutKind;
}

/**
 * Lit le retour de paiement des paramètres d'URL, ou null s'il n'y en a pas.
 * Un kind inconnu, ou un retour sans kind ni onglet reconnu, n'est attribué à
 * personne : mieux vaut aucun message qu'un faux message.
 */
export function readCheckoutReturn(params: URLSearchParams): CheckoutReturn | null {
  const status = params.get('checkout');
  if (status !== 'success' && status !== 'cancel') return null;
  const kind = params.get('kind');
  if (kind === 'pack' || kind === 'subscription') return { status, kind };
  if (kind !== null) return null;
  // Repli ajouté le 2026-09-23 : une session de paiement ouverte avant l'ajout
  // de kind revient sans lui, et l'onglet le remplace (credits → pack,
  // billing → subscription). Ces sessions expirent 24 h après leur création ;
  // le repli ne coûte que ces lignes et peut être retiré ensuite.
  const tab = params.get('tab');
  if (tab === 'credits') return { status, kind: 'pack' };
  if (tab === 'billing') return { status, kind: 'subscription' };
  return null;
}

/** Copie des paramètres sans le retour de paiement (checkout et kind). */
export function withoutCheckoutReturn(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('checkout');
  next.delete('kind');
  return next;
}
