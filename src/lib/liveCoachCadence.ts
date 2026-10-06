/**
 * Cadence des suggestions de l'assistant d'entretien en direct.
 *
 * Le recruteur lit les suggestions en parlant : un sujet qui change toutes les
 * dix secondes ne se lit pas. Trois règles, dites ici une seule fois :
 *  - une analyse seulement quand assez de texte neuf s'est accumulé ET qu'un
 *    délai minimal s'est écoulé depuis la précédente (une pause de la voix ne
 *    déclenche plus rien à elle seule) ;
 *  - un sujet affiché reste lisible au moins TOPIC_HOLD_MS, une nouvelle
 *    suggestion attend la suivante analyse au lieu de le remplacer ;
 *  - au plus MAX_DIG_DEEPER points à creuser à l'écran, les plus récents.
 */

/** Délai minimal entre deux analyses. */
export const COACH_MIN_INTERVAL_MS = 25_000;

/** Texte neuf minimal (environ huit secondes de parole) pour justifier une analyse. */
export const COACH_MIN_NEW_CHARS = 120;

/** Durée minimale d'affichage d'un sujet suggéré. */
export const TOPIC_HOLD_MS = 45_000;

/** Points à creuser gardés à l'écran : les plus récents. */
export const MAX_DIG_DEEPER = 3;

export function shouldAnalyze({ now, lastCallAt, pendingChars }: { now: number; lastCallAt: number; pendingChars: number }): boolean {
  return pendingChars >= COACH_MIN_NEW_CHARS && now - lastCallAt >= COACH_MIN_INTERVAL_MS;
}

/** Début de l'intitulé, sans ponctuation ni casse : deux formulations d'un même sujet ne changent rien à l'écran. */
export function normalizeTopic(topic: string): string {
  return topic.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').toLowerCase().trim().slice(0, 20);
}

/** Le sujet reçu remplace-t-il celui affiché ? Un sujet identique, ou affiché depuis moins de TOPIC_HOLD_MS, reste en place. */
export function shouldShowTopic(
  current: { topic: string } | null,
  incoming: { topic: string },
  shownAt: number,
  now: number,
): boolean {
  if (!current) return true;
  if (normalizeTopic(current.topic) === normalizeTopic(incoming.topic)) return false;
  return now - shownAt >= TOPIC_HOLD_MS;
}

/** Ajoute les points à creuser nouveaux (sans doublon de signal) et garde les plus récents. */
export function mergeDigDeeper<T extends { signal: string }>(previous: T[], incoming: T[]): T[] {
  const known = new Set(previous.map((item) => item.signal));
  return [...previous, ...incoming.filter((item) => !known.has(item.signal))].slice(-MAX_DIG_DEEPER);
}
