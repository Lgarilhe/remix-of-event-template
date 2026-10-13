/**
 * Lectures de la conversation LinkedIn pour l'analyse d'une réponse : les
 * derniers messages et le candidat (interlocuteur) de la conversation.
 *
 * Le service ne porte pas le compte dans la conversation : chaque lecture reçoit
 * le compte (format courant, relié à l'organisation, vérifié par l'appelant).
 * Une lecture en échec rend une liste vide ou un objet vide, comme avant : le
 * rattrapage et l'analyse n'ont alors rien à faire.
 */

import {
  describeForLog,
  getChat,
  isCandidateReplyCandidate,
  listMessages,
  toKonektChat,
  toKonektMessage,
} from '../_shared/unipile/index.ts';

/** Messages écrits gardés pour l'analyse (les plus récents). */
export const MESSAGES_READ_LIMIT = 15;
/**
 * Lignes demandées au service : le filtre des lignes qui ne sont pas des messages
 * (événements, masqués, supprimés, invitations) passe après la page, il ne doit
 * pas amincir la fenêtre d'analyse sous `MESSAGES_READ_LIMIT`.
 */
export const MESSAGES_RAW_LIMIT = MESSAGES_READ_LIMIT * 2;

export interface AnalysisMessage {
  text: string;
  is_sender: boolean;
  timestamp?: string;
}

export interface ChatDetails {
  attendeeName?: string;
  attendeeHeadline?: string;
  attendeeProfileUrl?: string;
  attendeeProviderId?: string;
}

/**
 * Messages du service (du plus récent au plus ancien) vers les messages de
 * l'analyse, du plus ancien au plus récent. Les lignes qui ne sont pas des
 * messages écrits sont écartées : événements (appel manqué, épingle...),
 * messages masqués ou supprimés, et, côté candidat, les invitations et les
 * étapes d'un InMail (refus, acceptation) qui ne sont pas une réponse. Garde
 * au plus `max` messages écrits, les plus récents.
 */
export function toAnalysisMessages(
  items: readonly unknown[],
  context: { accountId: string; chatId: string },
  max = MESSAGES_READ_LIMIT,
): AnalysisMessage[] {
  const out: AnalysisMessage[] = [];
  for (const raw of items) {
    if (out.length >= max) break;
    if (!raw || typeof raw !== 'object') continue;
    const message = toKonektMessage(raw, context);
    const written = message.is_sender === true
      ? message.is_event !== true && message.is_hidden !== true && message.is_deleted !== true
      : isCandidateReplyCandidate(message);
    if (!written) continue;
    out.push({
      text: message.text ?? '',
      is_sender: message.is_sender === true,
      timestamp: message.timestamp ?? undefined,
    });
  }
  return out.reverse();
}

/**
 * Interlocuteur d'une conversation : l'autre personne d'un échange à deux, le
 * premier participant qui n'est pas le compte pour un groupe. Le nom manquant
 * devient « Inconnu » quand un interlocuteur existe.
 */
export function toChatDetails(raw: unknown, accountId: string): ChatDetails {
  const chat = toKonektChat(raw, { accountId });
  // Conversation à deux : l'identifiant LinkedIn du candidat est aussi porté par
  // la conversation (le navigateur n'envoie en sender_id que l'identifiant de
  // l'interlocuteur chez le service).
  const chatAttendeeProviderId = chat.attendee_provider_id ?? undefined;
  const candidate = chat.attendees.find((a) => !a.is_self);
  if (!candidate) return chatAttendeeProviderId ? { attendeeProviderId: chatAttendeeProviderId } : {};
  return {
    attendeeName: candidate.display_name || candidate.name || 'Inconnu',
    attendeeHeadline: candidate.headline ?? undefined,
    attendeeProfileUrl: candidate.profile_url ?? undefined,
    attendeeProviderId: candidate.provider_id ?? chatAttendeeProviderId,
  };
}

export async function fetchChatMessages(accountId: string, chatId: string): Promise<AnalysisMessage[]> {
  try {
    const page = await listMessages(accountId, chatId, { limit: MESSAGES_RAW_LIMIT });
    return toAnalysisMessages(page.items, { accountId, chatId });
  } catch (error) {
    console.error('[auto-analyze] Failed to fetch messages:', describeForLog(error));
    return [];
  }
}

export async function fetchChatDetails(accountId: string, chatId: string): Promise<ChatDetails> {
  try {
    return toChatDetails(await getChat(accountId, chatId), accountId);
  } catch (error) {
    console.error('[auto-analyze] Failed to fetch chat:', describeForLog(error));
    return {};
  }
}
