/**
 * Chats and messages of the provider API (area "messaging").
 *
 * Wire facts (see the messaging digest)
 *  - Every path is `/{account_id}/...`. A chat has NO account id of its own in
 *    v2: the pair (account, chat) always travels together (`chatRef`).
 *  - Lists answer `{ data, total_count?, next_cursor? }`; both `cursor` and
 *    `offset` exist depending on the provider (pagination mode `auto`).
 *  - Starting a chat: `POST /{acc}/chats/send`, or the inbox variant
 *    `POST /{acc}/inboxes/{inbox}/chats/send` when `inboxId` is given. The body
 *    field is `users_ids` (a plain string for a 1to1 chat). Which inbox belongs
 *    to which LinkedIn licence is not documented, so the caller chooses it
 *    explicitly (`listInboxes`): the client never guesses an inbox.
 *  - An InMail exists ONLY at chat creation, through
 *    `specifics.linkedin.{classic.inmail | recruiter{subject,signature} |
 *    sales_navigator{subject}}` chosen by licence.
 *  - A send answers `{ message_id: string | string[] | null }`.
 *
 * Send outcome contract (at-most-once, nothing is ever retried): `sent` carries
 * the normalised message id; `uncertain` means the message may or may not have
 * left (timeout, 5xx, unreadable or incomplete answer): record NOTHING as sent;
 * `refused` carries an `ErrorKind` (the provider said nothing was done).
 * Malformed input and a missing API key throw instead (programming errors).
 */

import { UnipileError, type ErrorKind } from './errors.ts';
import { unipileFetch, unipileJson, type TransportOptions, type UnipileRequest } from './http.ts';
import {
  accountPath,
  chatPath,
  chatRef,
  normalizeMessageIds,
  userRef,
  type UserRefInput,
} from './ids.ts';
import { collect, DEFAULT_MAX_ITEMS, HARD_MAX_ITEMS, parsePage, type CollectResult, type Page } from './pagination.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LinkedInLicence = 'classic' | 'recruiter' | 'sales_navigator';

/** Person as embedded in chats and messages. */
export interface ChatUser {
  readonly id: string;
  readonly display_name?: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly public_identifier?: string;
  readonly profile_url?: string;
  readonly [key: string]: unknown;
}

export interface Chat {
  readonly id: string;
  readonly name?: string;
  /** `1to1` | `group` | `channel` (a string, not the numeric type of the previous generation). */
  readonly type: string;
  readonly is_1to1?: boolean;
  readonly is_group?: boolean;
  /** The other participant of a 1to1 chat. */
  readonly user_id?: string;
  readonly user?: ChatUser;
  readonly unread_count?: number;
  readonly last_message_timestamp?: string;
  readonly is_archived?: boolean;
  readonly is_readonly?: boolean;
  readonly folders?: readonly string[];
  readonly provider?: string;
  readonly [key: string]: unknown;
}

export interface Message {
  readonly id: string;
  readonly chat_id: string;
  readonly sender_id: string;
  readonly text?: string;
  readonly timestamp: string;
  readonly is_sender: boolean;
  readonly is_seen?: boolean;
  readonly is_deleted?: boolean;
  readonly is_event?: boolean;
  readonly sender?: ChatUser;
  readonly attachments?: readonly unknown[];
  /** `type`: MESSAGE | EMAIL | INVITATION | INMAIL | INMAIL_DECLINE | INMAIL_REPLY | INMAIL_ACCEPT. */
  readonly specifics?: { readonly type?: string; readonly subject?: string; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface Inbox {
  readonly id: string;
  readonly description?: string;
  readonly disabled: boolean;
}

/** One match of `GET /users/{user_id}/chat` (a person can have a chat per inbox). */
export interface ChatLookupEntry {
  readonly chat_id: string;
  readonly inbox_id?: string;
  readonly has_history?: boolean;
}

/** A file attached to an outgoing message (base64 content). */
export interface OutgoingFile {
  content: string;
  contentType: string;
  filename: string;
  /** `file` for a document (the provider default `native` may turn it into a picture or a voice note). */
  sendMode?: 'file' | 'native';
}

export type InmailSpec =
  | { licence: 'classic' }
  | { licence: 'recruiter'; subject: string; signature: string }
  | { licence: 'sales_navigator'; subject: string };

export interface StartChatInput {
  accountId: string;
  /** Provider id of the person (a slug or profile URL is also accepted and tried second). */
  user: string | UserRefInput;
  text: string;
  /** Inbox variant of the endpoint, when the account has inboxes. */
  inboxId?: string;
  /** Present: the chat is started with an InMail of this licence. Absent: a regular message. */
  inmail?: InmailSpec;
  attachments?: readonly OutgoingFile[];
}

export interface SendMessageInput {
  accountId: string;
  chatId: string;
  text: string;
  /** Message to reply to. */
  quoteId?: string;
  attachments?: readonly OutgoingFile[];
}

/** Result of a send, generic over what a success carries. */
export type SendResult<T extends object> =
  | ({ outcome: 'sent' } & T)
  | { outcome: 'uncertain'; error: UnipileError }
  | { outcome: 'refused'; kind: ErrorKind; error: UnipileError };

export interface SentMessage {
  /** First provider message id, `null` when none came back (a chat started without text). */
  messageId: string | null;
  /** Every id (a provider may send attachments as separate messages). */
  messageIds: string[];
  /** Set by `startChat`. */
  chatId: string | null;
}

export type SendOutcome = SendResult<SentMessage>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function invalid(note: string): UnipileError {
  return new UnipileError('validation', { debug: { note } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${name} must be a non-empty string`);
  return value;
}

function iso(value: Date | string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid(`${name} is not a valid date`);
  return date.toISOString();
}

function outgoingFiles(files: readonly OutgoingFile[]): Array<Record<string, unknown>> {
  return files.map((file) => {
    const out: Record<string, unknown> = {
      content: nonEmpty(file.content, 'attachment.content'),
      content_type: nonEmpty(file.contentType, 'attachment.contentType'),
      filename: nonEmpty(file.filename, 'attachment.filename'),
    };
    if (file.sendMode !== undefined) out.send_mode = file.sendMode;
    return out;
  });
}

function inmailSpecifics(inmail: InmailSpec): Record<string, unknown> {
  switch (inmail.licence) {
    case 'classic':
      return { linkedin: { classic: { inmail: true } } };
    case 'recruiter':
      return {
        linkedin: {
          recruiter: { subject: nonEmpty(inmail.subject, 'subject'), signature: nonEmpty(inmail.signature, 'signature') },
        },
      };
    case 'sales_navigator':
      return { linkedin: { sales_navigator: { subject: nonEmpty(inmail.subject, 'subject') } } };
    default:
      throw invalid('unknown InMail licence');
  }
}

type SendReader<T extends object> = (data: unknown) => { ok: true; value: T } | { ok: false; note: string };

/**
 * Runs a non-idempotent request and folds the transport result into a
 * `SendResult`. Used by every send of the client (messages, relation requests,
 * e-mails). A success whose answer cannot be read is `uncertain`, never `sent`.
 */
export async function performSend<T extends object>(
  request: UnipileRequest,
  read: SendReader<T>,
  options: TransportOptions = {},
): Promise<SendResult<T>> {
  const result = await unipileFetch({ ...request, method: request.method ?? 'POST', retry: false }, options);
  if (result.outcome !== 'ok') {
    return result.outcome === 'uncertain'
      ? { outcome: 'uncertain', error: result.error }
      : { outcome: 'refused', kind: result.error.kind, error: result.error };
  }
  const parsed = read(result.data);
  if (parsed.ok) return { outcome: 'sent', ...parsed.value };
  return {
    outcome: 'uncertain',
    error: new UnipileError('uncertain', {
      status: result.status,
      code: 'unreadable_send_answer',
      debug: { method: request.method ?? 'POST', path: request.path, body: result.data, note: parsed.note },
    }),
  };
}

/**
 * Tries the candidates of a user reference in order (provider id first, then
 * slug). Only a refusal that proves nothing was done (`not_found`,
 * `validation`) moves to the next candidate; `sent`, `uncertain` and every other
 * refusal end the loop. When all candidates are refused, the first refusal is
 * returned.
 */
export async function sendToUser<T extends object>(
  user: string | UserRefInput,
  run: (userId: string) => Promise<SendResult<T>>,
): Promise<SendResult<T>> {
  const ref = userRef(user, { prefer: 'provider_id' });
  if (!ref) throw invalid('no usable user reference');
  let firstRefusal: SendResult<T> | null = null;
  for (const candidate of ref.candidates) {
    const result = await run(candidate.value);
    if (result.outcome !== 'refused') return result;
    firstRefusal ??= result;
    if (result.kind !== 'not_found' && result.kind !== 'validation') return result;
  }
  return firstRefusal as SendResult<T>;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** `GET /{acc}/inboxes`: the inboxes of an account (providers without the concept are undocumented). */
export async function listInboxes(accountId: string, options: TransportOptions = {}): Promise<Inbox[]> {
  const body = await unipileJson({ path: accountPath(accountId, 'inboxes') }, options);
  return parsePage<Inbox>(body).items;
}

export interface ListChatsParams {
  /** List the chats of one inbox instead of all of them. */
  inboxId?: string;
  type?: '1to1' | 'group' | 'channel';
  isUnread?: boolean;
  isArchived?: boolean;
  /** Exclusive bounds. */
  before?: Date | string;
  after?: Date | string;
  cursor?: string;
  offset?: number;
  limit?: number;
}

function chatsPath(accountId: string, inboxId: string | undefined): string {
  return inboxId === undefined ? accountPath(accountId, 'chats') : accountPath(accountId, 'inboxes', inboxId, 'chats');
}

function chatsFilters(params: ListChatsParams): Record<string, string | number | boolean | undefined> {
  return {
    type: params.type,
    is_unread: params.isUnread,
    is_archived: params.isArchived,
    before: iso(params.before, 'before'),
    after: iso(params.after, 'after'),
  };
}

/** One page of chats (`GET /{acc}/chats`, or the inbox variant when `inboxId` is set), newest first. */
export async function listChats(
  accountId: string,
  params: ListChatsParams = {},
  options: TransportOptions = {},
): Promise<Page<Chat>> {
  const body = await unipileJson(
    {
      path: chatsPath(accountId, params.inboxId),
      query: { ...chatsFilters(params), cursor: params.cursor, offset: params.offset, limit: params.limit },
    },
    options,
  );
  return parsePage<Chat>(body);
}

const TRY_NEXT_KINDS: readonly ErrorKind[] = ['validation', 'not_found'];

/**
 * Every chat within the pagination caps. When the account exposes inboxes, each
 * enabled inbox is read and the result is deduplicated by chat id and sorted
 * newest first (the inbox layout is not documented per licence, so none is
 * skipped); otherwise `GET /{acc}/chats` is read.
 *
 * `maxItems` caps the MERGED result (the newest chats are kept) and `deadlineMs`
 * the wall-clock time of each inbox read. A merged result of several inboxes has
 * no single resume point: `nextCursor` and `nextOffset` are null then. To resume,
 * read one inbox (`inboxId`, with `startCursor` or `startOffset` from its own
 * previous run): that result carries its resume point.
 */
export async function collectChats(
  accountId: string,
  params: Omit<ListChatsParams, 'cursor' | 'offset'> & {
    maxItems?: number;
    maxPages?: number;
    deadlineMs?: number;
    startCursor?: string;
    startOffset?: number;
  } = {},
  options: TransportOptions = {},
): Promise<CollectResult<Chat>> {
  let inboxIds: Array<string | undefined>;
  if (params.inboxId !== undefined) {
    inboxIds = [params.inboxId];
  } else {
    let inboxes: Inbox[] = [];
    try {
      inboxes = await listInboxes(accountId, options);
    } catch (error) {
      if (!(error instanceof UnipileError) || !TRY_NEXT_KINDS.includes(error.kind)) throw error;
    }
    const enabled = inboxes.filter((inbox) => inbox && typeof inbox.id === 'string' && inbox.disabled !== true);
    inboxIds = enabled.length > 0 ? enabled.map((inbox) => inbox.id) : [undefined];
  }

  const byId = new Map<string, Chat>();
  let pages = 0;
  let truncated = false;
  let single: CollectResult<Chat> | null = null;
  for (const inboxId of inboxIds) {
    const result = await collect<Chat>({
      mode: 'auto',
      limit: params.limit,
      maxItems: params.maxItems,
      maxPages: params.maxPages,
      deadlineMs: params.deadlineMs,
      startCursor: params.startCursor,
      startOffset: params.startOffset,
      keyOf: (chat) => (isRecord(chat) && typeof chat.id === 'string' ? chat.id : null),
      fetchPage: (page) =>
        unipileJson({ path: chatsPath(accountId, inboxId), query: { ...chatsFilters(params), ...page.query } }, options),
    });
    pages += result.pages;
    truncated ||= result.truncated;
    if (inboxIds.length === 1) single = result;
    for (const chat of result.items) if (chat && typeof chat.id === 'string' && !byId.has(chat.id)) byId.set(chat.id, chat);
  }
  let items = [...byId.values()];
  if (inboxIds.length > 1) {
    const stamp = (chat: Chat) => Date.parse(chat.last_message_timestamp ?? '') || 0;
    items.sort((a, b) => stamp(b) - stamp(a));
    // The cap is on the merged list, not on each inbox.
    const cap = Math.min(Math.max(Math.floor(params.maxItems ?? DEFAULT_MAX_ITEMS), 1), HARD_MAX_ITEMS);
    if (items.length > cap) {
      items = items.slice(0, cap);
      truncated = true;
    }
  }
  return {
    items,
    pages,
    truncated,
    totalCount: single?.totalCount ?? null,
    nextCursor: single?.nextCursor ?? null,
    nextOffset: single?.nextOffset ?? null,
  };
}

export async function getChat(accountId: string, chatId: string, options: TransportOptions = {}): Promise<Chat> {
  const body = await unipileJson({ path: chatPath(chatRef(accountId, chatId)) }, options);
  if (!isRecord(body) || typeof body.id !== 'string') {
    throw new UnipileError('server', { code: 'invalid_chat', debug: { note: 'unreadable chat object', body } });
  }
  return body as unknown as Chat;
}

/**
 * `GET /{acc}/users/{user_id}/chat`: the existing 1to1 chats with a person (one
 * per inbox at most). Identifiers only, read the chat with `getChat`. The
 * candidates of the user reference are tried in order until one gives matches.
 */
export async function getChatForUser(
  accountId: string,
  user: string | UserRefInput,
  options: TransportOptions = {},
): Promise<ChatLookupEntry[]> {
  const ref = userRef(user, { prefer: 'provider_id' });
  if (!ref) throw invalid('no usable user reference');
  let lastError: UnipileError | null = null;
  let answered = false;
  for (const candidate of ref.candidates) {
    try {
      const body = await unipileJson({ path: accountPath(accountId, 'users', candidate.value, 'chat') }, options);
      answered = true;
      const entries = parsePage<ChatLookupEntry>(body).items.filter((e) => isRecord(e) && typeof e.chat_id === 'string');
      if (entries.length > 0) return entries;
    } catch (error) {
      if (!(error instanceof UnipileError) || !TRY_NEXT_KINDS.includes(error.kind)) throw error;
      lastError = error;
    }
  }
  // Every form of the reference was refused: that is an error, not "no chat".
  if (!answered && lastError) throw lastError;
  return [];
}

/** `PATCH /{acc}/chats/{chat}` with `read_status`: marks the whole chat read (or unread). */
export async function markRead(
  accountId: string,
  chatId: string,
  read = true,
  options: TransportOptions = {},
): Promise<Chat> {
  const body = await unipileJson(
    { method: 'PATCH', path: chatPath(chatRef(accountId, chatId)), body: { read_status: read } },
    options,
  );
  return body as Chat;
}

export interface ListMessagesParams {
  /** Only messages sent by this person. */
  userId?: string;
  /** Exclusive bounds. */
  before?: Date | string;
  after?: Date | string;
  cursor?: string;
  offset?: number;
  limit?: number;
}

/** One page of messages of a chat, newest first. */
export async function listMessages(
  accountId: string,
  chatId: string,
  params: ListMessagesParams = {},
  options: TransportOptions = {},
): Promise<Page<Message>> {
  const body = await unipileJson(
    {
      path: chatPath(chatRef(accountId, chatId), 'messages'),
      query: {
        user_id: params.userId,
        before: iso(params.before, 'before'),
        after: iso(params.after, 'after'),
        cursor: params.cursor,
        offset: params.offset,
        limit: params.limit,
      },
    },
    options,
  );
  return parsePage<Message>(body);
}

export async function getMessage(
  accountId: string,
  chatId: string,
  messageId: string,
  options: TransportOptions = {},
): Promise<Message> {
  const body = await unipileJson({ path: chatPath(chatRef(accountId, chatId), 'messages', nonEmpty(messageId, 'messageId')) }, options);
  if (!isRecord(body) || typeof body.id !== 'string') {
    throw new UnipileError('server', { code: 'invalid_message', debug: { note: 'unreadable message object', body } });
  }
  return body as unknown as Message;
}

// ---------------------------------------------------------------------------
// Sends
// ---------------------------------------------------------------------------

function readSent(expectMessage: boolean, expectChat: boolean): SendReader<SentMessage> {
  return (data) => {
    if (!isRecord(data) || !('message_id' in data)) return { ok: false, note: 'answer has no message_id' };
    const messageIds = normalizeMessageIds(data.message_id);
    const chatId = typeof data.chat_id === 'string' && data.chat_id !== '' ? data.chat_id : null;
    if (expectChat && chatId === null) return { ok: false, note: 'answer has no chat_id' };
    if (expectMessage && messageIds.length === 0) return { ok: false, note: 'no message id although a message was sent' };
    return { ok: true, value: { messageId: messageIds[0] ?? null, messageIds, chatId } };
  };
}

/**
 * `POST /{acc}/chats/send` (or the inbox variant): starts a 1to1 chat by
 * sending the first message, as an InMail when `inmail` is given. A refusal for
 * an unknown user moves on to the next form of the reference (provider id, then
 * slug).
 */
export async function startChat(input: StartChatInput, options: TransportOptions = {}): Promise<SendOutcome> {
  if (typeof input.text !== 'string') throw invalid('text must be a string');
  const files = input.attachments ? outgoingFiles(input.attachments) : [];
  const path = input.inboxId === undefined
    ? accountPath(input.accountId, 'chats', 'send')
    : accountPath(input.accountId, 'inboxes', input.inboxId, 'chats', 'send');
  const specifics = input.inmail ? inmailSpecifics(input.inmail) : undefined;
  const expectMessage = input.text.trim() !== '' || files.length > 0;
  return await sendToUser(input.user, (userId) => {
    const body: Record<string, unknown> = { text: input.text, users_ids: userId };
    if (files.length > 0) body.attachments = files;
    if (specifics) body.specifics = specifics;
    return performSend({ method: 'POST', path, body, heavy: true }, readSent(expectMessage, true), options);
  });
}

/** `POST /{acc}/chats/{chat}/messages/send`: a message in an existing chat. */
export async function sendMessage(input: SendMessageInput, options: TransportOptions = {}): Promise<SendOutcome> {
  if (typeof input.text !== 'string') throw invalid('text must be a string');
  const files = input.attachments ? outgoingFiles(input.attachments) : [];
  const body: Record<string, unknown> = { text: input.text };
  if (input.quoteId !== undefined) body.quote_id = nonEmpty(input.quoteId, 'quoteId');
  if (files.length > 0) body.attachments = files;
  const expectMessage = input.text.trim() !== '' || files.length > 0;
  return await performSend(
    { method: 'POST', path: chatPath(chatRef(input.accountId, input.chatId), 'messages', 'send'), body, heavy: true },
    readSent(expectMessage, false),
    options,
  );
}
