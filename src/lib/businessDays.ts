/**
 * Jours ouvrés (D27) : fenêtre glissante qui saute samedi et dimanche, sans
 * jours fériés, dans le fuseau du navigateur. Sert aux réponses de candidats,
 * aux actions proposées par l'assistant et au bandeau d'approbation (D28).
 *
 * Module pur, sans import : chargé tel quel par les tests (tests/ux).
 */

/**
 * Instant situé `n` jours ouvrés avant `now`, à la même heure locale.
 * Exemples : lundi 10 h → mercredi précédent 10 h ; samedi 10 h → mercredi 10 h.
 * Le calcul passe par setDate : un changement d'heure entre les deux dates ne
 * décale pas l'heure locale.
 */
export function businessDaysCutoff(now: Date, n: number): Date {
  const d = new Date(now.getTime());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) left -= 1;
  }
  return d;
}

/** Vrai si la date ISO tombe dans les `n` derniers jours ouvrés (bornes comprises). */
export function isWithinBusinessDays(iso: string, now: Date, n: number): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= businessDaysCutoff(now, n).getTime();
}
