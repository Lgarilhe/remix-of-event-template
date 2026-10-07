/**
 * Phrase de la ligne « À faire » de la messagerie : depuis quand la conversation
 * attend. Les jours s'accordent par la fonction de pluriel partagée (D-71).
 */

import { plural } from './plural';
import type { ThreadState } from './inboxThreadState';

const businessDays = (days: number) => plural(days, 'jour ouvré', 'jours ouvrés');

export function threadWaitingSentence(state: ThreadState, days: number | null): string | null {
  if (state === 'to_reply') {
    return days && days > 0
      ? `Le candidat attend votre réponse depuis ${businessDays(days)}.`
      : 'Le candidat attend votre réponse.';
  }
  if (state === 'to_follow_up') {
    return days !== null ? `Sans réponse depuis ${businessDays(days)}.` : 'Sans réponse du candidat.';
  }
  return null;
}
