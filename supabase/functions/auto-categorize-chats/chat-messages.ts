/**
 * Derniers messages d'une conversation LinkedIn, pour classer la conversation.
 *
 * Le service ne porte pas le compte dans la conversation : la lecture reçoit le
 * compte de la conversation (envoyé par le navigateur, vérifié par l'appelant
 * contre l'organisation). Une lecture en échec rend une liste vide, et la
 * conversation retombe sur son dernier message (repli déterministe).
 */

import {
  describeForLog,
  isCandidateReplyCandidate,
  listMessages,
  toKonektMessage,
} from '../_shared/unipile/index.ts';

export interface CategorizeMessage {
  text: string;
  is_sender: boolean;
}

const MAX_TEXT_CHARS = 300;
/** Messages gardés par conversation. */
export const DEFAULT_MESSAGES = 6;

/**
 * Messages du service (du plus récent au plus ancien) vers des messages courts
 * dans l'ordre chronologique. Écarte les lignes qui ne sont pas un texte écrit :
 * événements, messages masqués ou supprimés et, côté candidat, invitations et
 * étapes d'un InMail (refus, acceptation) : sans cela, une invitation du candidat
 * ferait passer « sans réponse » en « a répondu ». Les textes vides sont écartés.
 * Garde au plus `max` messages, les plus récents.
 */
export function toCategorizeMessages(
  items: readonly unknown[],
  context: { accountId: string; chatId: string },
  max = DEFAULT_MESSAGES,
): CategorizeMessage[] {
  const out: CategorizeMessage[] = [];
  for (const raw of items) {
    if (out.length >= max) break;
    if (!raw || typeof raw !== 'object') continue;
    const message = toKonektMessage(raw, context);
    const written = message.is_sender === true
      ? message.is_event !== true && message.is_hidden !== true && message.is_deleted !== true
      : isCandidateReplyCandidate(message);
    if (!written) continue;
    const text = (message.text ?? '').trim().slice(0, MAX_TEXT_CHARS);
    if (text.length === 0) continue;
    out.push({ text, is_sender: message.is_sender === true });
  }
  return out.reverse();
}

/**
 * `limit` messages écrits au plus. Le service rend les lignes avant le filtre
 * (événements, masqués, invitations) : on en demande le double pour que ces
 * lignes n'amincissent pas la fenêtre, sans quoi une conversation dont les
 * dernières lignes sont des événements perdrait ses vrais messages.
 */
export async function fetchChatMessages(accountId: string, chatId: string, limit = DEFAULT_MESSAGES): Promise<CategorizeMessage[]> {
  try {
    const page = await listMessages(accountId, chatId, { limit: limit * 2 });
    return toCategorizeMessages(page.items, { accountId, chatId }, limit);
  } catch (error) {
    console.warn('[auto-categorize-chats] messages unreadable:', describeForLog(error));
    return [];
  }
}
