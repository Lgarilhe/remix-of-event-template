/**
 * Comparaison de deux chaînes à temps constant (anti timing attack sur un
 * secret ou une signature). Une comparaison `===` s'arrête au premier octet
 * différent : la durée de la réponse renseigne sur la longueur du préfixe
 * correct. Utilisée par unipile-webhook, calendly-webhook et
 * process-scheduled-actions.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
