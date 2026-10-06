/**
 * Appels « à rattacher » : ceux dont le numéro ne correspond à aucun candidat
 * de l'organisation, regroupés par numéro (un seul geste rattache tous les
 * appels d'un même numéro, puisque le rapprochement se fait à la lecture).
 *
 * Fonctions pures, sans importation à l'exécution : lues telles quelles par
 * les tests Node (tests/c1/telephonie-appels-a-rattacher.test.mjs).
 */
import type { PhoneCall } from './phoneCalls';

export interface UnattachedCallGroup {
  numberE164: string;
  /** Numéro mis en forme pour l'écran (« 06 12 34 56 78 »). */
  displayNumber: string;
  /** Nom que l'opérateur connaît pour ce numéro, s'il en a un. */
  contactName: string | null;
  /** Du plus récent au plus ancien. */
  calls: PhoneCall[];
  lastStartedAt: string | null;
}

/** +33612345678 → « 06 12 34 56 78 ». Un autre indicatif reste en E.164, sans deviner son découpage. */
export function formatPhoneNumber(e164: string): string {
  const fr = /^\+33(\d{9})$/.exec(e164);
  if (!fr) return e164;
  return `0${fr[1]}`.replace(/(\d{2})(?=\d)/g, '$1 ');
}

const time = (call: PhoneCall): number => (call.startedAt ? Date.parse(call.startedAt) : Number.NEGATIVE_INFINITY);

/**
 * Ne garde que les appels qui répondent au critère (ex. « mes appels ») : un
 * groupe sans appel restant disparaît, la date du dernier appel est recalculée.
 */
export function keepCalls(
  groups: ReadonlyArray<UnattachedCallGroup>,
  predicate: (call: PhoneCall) => boolean,
): UnattachedCallGroup[] {
  const kept: UnattachedCallGroup[] = [];
  for (const group of groups) {
    const calls = group.calls.filter(predicate);
    if (calls.length === 0) continue;
    kept.push({
      ...group,
      calls,
      contactName: calls.map((c) => c.contactName).find((n): n is string => !!n) ?? null,
      lastStartedAt: calls[0].startedAt,
    });
  }
  return kept.sort((a, b) => time(b.calls[0]) - time(a.calls[0]));
}

/**
 * `knownNumbers` : les numéros (E.164) enregistrés pour les candidats de
 * l'organisation. Un appel sans numéro exploitable (masqué, ambigu) n'est pas
 * listé : il n'y a rien à rattacher.
 */
export function groupUnattachedCalls(
  calls: ReadonlyArray<PhoneCall>,
  knownNumbers: ReadonlySet<string>,
): UnattachedCallGroup[] {
  const byNumber = new Map<string, PhoneCall[]>();
  for (const call of calls) {
    if (!call.numberE164 || knownNumbers.has(call.numberE164)) continue;
    const list = byNumber.get(call.numberE164);
    if (list) list.push(call);
    else byNumber.set(call.numberE164, [call]);
  }
  const groups: UnattachedCallGroup[] = [];
  for (const [numberE164, list] of byNumber) {
    const sorted = [...list].sort((a, b) => time(b) - time(a));
    groups.push({
      numberE164,
      displayNumber: formatPhoneNumber(numberE164),
      contactName: sorted.map((c) => c.contactName).find((n): n is string => !!n) ?? null,
      calls: sorted,
      lastStartedAt: sorted[0].startedAt,
    });
  }
  return groups.sort((a, b) => time(b.calls[0]) - time(a.calls[0]));
}
