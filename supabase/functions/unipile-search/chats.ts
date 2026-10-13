/**
 * Actions de messagerie en lecture de unipile-search : `get_chats`,
 * `get_messages`, `mark_as_read` et `sync_chat_history`.
 *
 * Un chat n'a plus d'identifiant de compte ni de dossier chez le prestataire : le
 * compte est toujours celui de la requête (déjà rattaché à l'organisation) et la
 * boîte d'origine d'un chat vient de la liste des boîtes du compte (`GET inboxes`).
 * Les listes de chats et de messages restent rendues dans la forme que lit la
 * messagerie (`Chat`, `Message` de useMessagesInbox) par les normaliseurs
 * partagés ; le curseur par dossier de l'interface devient un curseur par boîte
 * (`cursors`, `null` = boîte épuisée, `'__has_more__'` en bout de réponse).
 */

import {
  chatRef,
  describeForLog,
  getChat,
  getChatForUser,
  listChats,
  listMessages,
  markRead,
  toKonektChat,
  toKonektMessage,
  UnipileError,
  type ChatLookupEntry,
  type KonektChat,
  type Page,
} from '../_shared/unipile/index.ts';
import { accountInboxes, inboxKindOf, type Licence } from './licence.ts';
import { failureOf, failureParts, failureResponse, json, UnipileInputError } from './responses.ts';

const OFFSET_PREFIX = 'offset:';
const UNAVAILABLE_MESSAGE = 'Les conversations LinkedIn sont temporairement indisponibles.';

/** Lit un curseur de l'interface : `offset:<n>` pour une liste à décalage, sinon le curseur du prestataire. */
export function readPageCursor(value: unknown): { cursor?: string; offset?: number } {
  if (typeof value !== 'string' || value === '') return {};
  const match = /^offset:(\d{1,9})$/.exec(value);
  return match ? { offset: Number(match[1]) } : { cursor: value };
}

/**
 * Curseur de la page suivante d'une liste à deux modes (curseur ou décalage), `null`
 * en fin de liste. Sans signal de suite (`next_cursor`, `has_more`, `total_count`),
 * la liste est finie : une page pleine n'est pas une preuve.
 */
export function nextPageCursor(page: Page<unknown>, startOffset: number): string | null {
  if (page.nextCursor !== null) return page.nextCursor;
  if (page.items.length === 0) return null;
  const after = startOffset + page.items.length;
  if (page.hasMore === true) return `${OFFSET_PREFIX}${after}`;
  if (page.totalCount !== null && after < page.totalCount) return `${OFFSET_PREFIX}${after}`;
  return null;
}

function chatIdOf(accountId: string, value: unknown): string {
  try {
    return chatRef(accountId, String(value)).chatId;
  } catch (error) {
    if (error instanceof UnipileError && error.code === 'invalid_chat_id') throw new UnipileInputError('chat_id invalide');
    throw error;
  }
}

const stamp = (chat: { timestamp: string | null }): number => Date.parse(chat.timestamp ?? '') || 0;

// ---------------------------------------------------------------------------
// get_chats
// ---------------------------------------------------------------------------

/**
 * Conversations d'un candidat. Aucune conversation (liste vide du prestataire) est
 * une absence normale ; une vraie panne n'est jamais rendue comme un historique
 * vide. La recherche par personne ne se pagine plus : un curseur reçu rend la fin
 * de liste.
 */
async function handleCandidateChats(accountId: string, attendeeId: string, cursor: unknown): Promise<Response> {
  if (cursor) return json({ success: true, chats: [], cursor: null });
  try {
    // Le prestataire rend une liste vide quand il n'y a rien : c'est l'absence normale. Un refus (introuvable compris) reste une panne.
    const entries: ChatLookupEntry[] = await getChatForUser(accountId, attendeeId);
    const chats: KonektChat[] = [];
    for (const entry of entries.slice(0, 10)) {
      try {
        chats.push(toKonektChat(await getChat(accountId, entry.chat_id), { accountId }));
      } catch (error) {
        // Une conversation supprimée entre les deux lectures n'est plus une conversation ; le reste est une panne.
        if (!(error instanceof UnipileError) || error.kind !== 'not_found') throw error;
      }
    }
    chats.sort((a, b) => stamp(b) - stamp(a));
    return json({ success: true, chats, cursor: null });
  } catch (error) {
    // Statut 200 comme avant : l'appelant lit `success`, une panne n'est pas un historique vide.
    const { body } = failureParts(error, 'get_chats');
    return json({ ...body, chats: [] }, 200);
  }
}

interface InboxSource {
  key: string;
  inboxId?: string;
  kind?: Licence;
}

interface SourceResult {
  source: InboxSource;
  chats: KonektChat[];
  cursor: string | null;
  /** `null` : boîte déjà épuisée, non demandée. */
  succeeded: boolean | null;
}

export async function handleGetChats(accountId: string, params: Record<string, unknown>): Promise<Response> {
  const { attendee_provider_id, limit = 100, cursor, cursors } = params;
  if (attendee_provider_id) return await handleCandidateChats(accountId, String(attendee_provider_id), cursor);

  const requestedCursors: Record<string, string | null> = cursors && typeof cursors === 'object' && !Array.isArray(cursors)
    ? cursors as Record<string, string | null>
    : {};
  const pageSize = Math.min(Math.max(Math.floor(Number(limit)) || 100, 1), 125);

  // Toutes les boîtes que le compte expose, sans en écarter aucune : le prestataire ne dit pas laquelle sert quelle licence.
  let sources: InboxSource[];
  try {
    const inboxes = await accountInboxes(accountId);
    sources = inboxes.length > 0
      ? inboxes.map((inbox) => ({ key: inbox.id, inboxId: inbox.id, kind: inboxKindOf(inbox) }))
      : [{ key: 'ALL' }];
  } catch (error) {
    console.warn(`[unipile-search] get_chats: boîtes illisibles, lecture globale (${describeForLog(error)})`);
    sources = [{ key: 'ALL' }];
  }

  const readSource = async (source: InboxSource): Promise<SourceResult> => {
    const own = Object.prototype.hasOwnProperty.call(requestedCursors, source.key);
    if (own && requestedCursors[source.key] === null) return { source, chats: [], cursor: null, succeeded: null };
    const start = readPageCursor(requestedCursors[source.key]);
    try {
      const page = await listChats(accountId, { inboxId: source.inboxId, limit: pageSize, ...start });
      return {
        source,
        chats: page.items.map((chat) => toKonektChat(chat, { accountId, inboxKind: source.kind })),
        cursor: nextPageCursor(page, start.offset ?? 0),
        succeeded: true,
      };
    } catch (error) {
      console.error(`[unipile-search] get_chats: boîte ${source.key} illisible: ${describeForLog(error)}`);
      // Comme avant : une boîte en échec est traitée comme épuisée, les autres restent servies.
      return { source, chats: [], cursor: null, succeeded: false };
    }
  };
  const results = await Promise.all(sources.map(readSource));

  const requested = results.filter((r) => r.succeeded !== null);
  if (requested.length > 0 && !requested.some((r) => r.succeeded)) {
    return json({ success: false, error: UNAVAILABLE_MESSAGE, errorType: failureOf('server').errorType }, 502);
  }

  const nextCursors: Record<string, string | null> = {};
  for (const r of results) nextCursors[r.source.key] = r.cursor;
  const hasMore = Object.values(nextCursors).some((c) => c !== null);

  const byId = new Map<string, KonektChat>();
  for (const r of results) for (const chat of r.chats) if (chat.id && !byId.has(chat.id)) byId.set(chat.id, chat);
  const chats = [...byId.values()].sort((a, b) => stamp(b) - stamp(a));

  // Lecture légère de l'assistant : identité de l'interlocuteur seulement, sans le reste du chat.
  if (params.raw) {
    const capped = chats.slice(0, Math.min(Number(limit) || 40, 60));
    const out = capped.map((chat) => ({
      id: chat.id,
      attendee_provider_id: chat.attendee_provider_id,
      name: chat.name,
      timestamp: chat.timestamp,
      folder: chat.folder,
      unread_count: chat.unread_count,
      attendees: chat.attendees.map((a) => ({
        name: a.name,
        provider_id: a.provider_id ?? chat.attendee_provider_id,
        id: a.id,
        is_self: a.is_self ? 1 : 0,
      })),
    }));
    return json({ success: true, chats: out, cursors: nextCursors, cursor: hasMore ? '__has_more__' : null });
  }

  return json({ success: true, chats, cursors: nextCursors, cursor: hasMore ? '__has_more__' : null });
}

// ---------------------------------------------------------------------------
// get_messages, mark_as_read, sync_chat_history
// ---------------------------------------------------------------------------

export async function handleGetMessages(accountId: string, params: Record<string, unknown>): Promise<Response> {
  const { chat_id, limit = 50, cursor } = params;
  if (!chat_id) return json({ success: false, error: 'Chat ID requis' }, 400);
  const chatId = chatIdOf(accountId, chat_id);
  const start = readPageCursor(cursor);
  try {
    const page = await listMessages(accountId, chatId, {
      limit: Math.min(Math.max(Math.floor(Number(limit)) || 50, 1), 100),
      ...start,
    });
    return json({
      success: true,
      messages: page.items.map((m) => toKonektMessage(m, { accountId, chatId })),
      cursor: nextPageCursor(page, start.offset ?? 0),
    });
  } catch (error) {
    return failureResponse(error, 'get_messages', {}, { messages: [] });
  }
}

export async function handleMarkAsRead(accountId: string, params: Record<string, unknown>): Promise<Response> {
  const { chat_id } = params;
  if (!chat_id) return json({ success: false, error: 'Chat ID requis' }, 400);
  const chatId = chatIdOf(accountId, chat_id);
  try {
    await markRead(accountId, chatId, true);
    return json({ success: true });
  } catch (error) {
    return failureResponse(error, 'mark_as_read');
  }
}

/**
 * Le prestataire n'a plus de resynchronisation d'historique : l'historique d'un
 * chat est lu à la demande. L'action reste pour la messagerie, qui relit les
 * messages dès `SYNC_DONE` ; elle vérifie seulement que la conversation existe
 * encore sur ce compte (`CHAT_DELETED` sinon).
 */
export async function handleSyncChatHistory(accountId: string, params: Record<string, unknown>): Promise<Response> {
  const { chat_id } = params;
  if (!chat_id) return json({ success: false, error: 'chat_id is required' }, 400);
  const chatId = chatIdOf(accountId, chat_id);
  try {
    await getChat(accountId, chatId);
    return json({ success: true, status: 'SYNC_DONE', chat_id: chatId });
  } catch (error) {
    if (error instanceof UnipileError && error.kind === 'not_found') {
      return json({ success: true, status: 'CHAT_DELETED', chat_id: chatId });
    }
    return failureResponse(error, 'sync_chat_history');
  }
}
