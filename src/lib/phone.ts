/**
 * Numéros de téléphone en E.164 (+33612345678), clé du rapprochement entre un
 * appel et les coordonnées d'un candidat.
 *
 * Conservateur par choix : un numéro ambigu rend null et ne se rapproche de
 * personne. Un faux rapprochement attribue l'appel d'un inconnu à un candidat,
 * ce qui est pire qu'un appel non rattaché.
 *
 * Règles :
 *   - « + » devant : international, on garde les chiffres ;
 *   - « 00 » devant : international ;
 *   - 10 chiffres commençant par 0 : France (0612345678 → +33612345678) ;
 *   - 11 chiffres commençant par 33, sans « + » : France ;
 *   - « (0) » français ignoré (+33 (0)6 12 34 56 78) ;
 *   - une extension (« poste 12 », « ext. 3 », « x45 ») en fin de saisie est retirée ;
 *   - tout le reste (9 chiffres sans zéro, numéro étranger sans préfixe) : null.
 * Aucune importation : le fichier est relu tel quel par les tests Node.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;

  s = s.replace(/\s*(?:poste|ext\.?|x)\s*\d+\s*$/i, '');
  const international = s.startsWith('+');
  s = s.replace(/\(0\)/g, '');
  let digits = s.replace(/\D/g, '');
  if (!digits) return null;

  if (!international) {
    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    } else if (digits.length === 10 && digits.startsWith('0')) {
      digits = '33' + digits.slice(1);
    } else if (digits.length === 11 && digits.startsWith('33')) {
      // déjà au format national complet, sans « + »
    } else {
      return null;
    }
  }

  // « +330612345678 » : le 0 du national n'a rien à faire derrière +33.
  if (digits.startsWith('330') && digits.length === 12) digits = '33' + digits.slice(3);

  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith('0')) return null;
  // France : le numéro national fait 9 chiffres, jamais plus ni moins.
  if (digits.startsWith('33') && digits.length !== 11) return null;

  return '+' + digits;
}
