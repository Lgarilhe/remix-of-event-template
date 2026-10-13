/**
 * Chat, message and email normalisers.
 *
 * They emit the legacy shapes read by the inbox hooks
 * (`src/hooks/useMessagesInbox.ts`: `Chat`, `Message`, `ChatAttendee`), by the
 * assistant reads (`agent-tools-reads.ts`, `agent-tools-email.ts`) and by
 * `candidate-actions/incoming.ts` and `transport.ts` (`from_attendee.identifier`,
 * `to_attendees`, `body_plain`, `thread_id`, `is_sender`, `chat.type === 0`...).
 *
 * Differences that the callers must know about (v2 has no equivalent):
 *  - a chat or a message carries no account id: pass it as `context.accountId`
 *    and it is copied to `account_id`;
 *  - there is no attendee entity: the other participant of a 1:1 chat is the
 *    `user` of the chat; `attendees[0].id` and `provider_id` are that user's id;
 *  - the inbox ("folder") of a chat is not in the chat: pass `context.inboxKind`
 *    (the licence of the inbox it was listed from) to get the legacy `folder`.
 *
 * Pure and total: never throws, a missing field is `null`, a list the provider
 * did not send is `[]` for attendees/attachments (the legacy code iterates them).
 */

import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  asStringArray,
  readListEnvelope,
  type Rec,
  toLegacyNetworkDistance,
} from './profile.ts';

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export interface KonektAttachment {
  id: string | null;
  /** Provider type kept as is: `img`, `video`, `audio`, `file`, `shared_content`, `contact_card`. */
  type: string | null;
  mimetype: string | null;
  /** Only the `file` variant has a name. `name` is the same value (the email readers use that key). */
  filename: string | null;
  name: string | null;
  size: number | null;
  url: string | null;
  url_expires_at: string | null;
  is_inline: boolean | null;
  is_unavailable: boolean | null;
  content_id: string | null;
}

export function toKonektAttachment(raw: unknown): KonektAttachment | null {
  const item = asRecord(raw);
  if (!item) return null;
  const filename = asString(item.filename);
  return {
    id: asString(item.id),
    type: asString(item.type),
    mimetype: asString(item.mimetype),
    filename,
    name: filename,
    size: asNumber(item.file_size),
    url: asString(item.url),
    url_expires_at: asString(item.url_expires_at),
    is_inline: asBoolean(item.is_inline),
    is_unavailable: asBoolean(item.is_unavailable),
    content_id: asString(item.content_id),
  };
}

function toAttachments(value: unknown): KonektAttachment[] {
  return (asArray(value) ?? []).map(toKonektAttachment).filter((a): a is KonektAttachment => a !== null);
}

// ---------------------------------------------------------------------------
// Users and attendees
// ---------------------------------------------------------------------------

/** Legacy chat attendee (`ChatAttendee` of the inbox hook, plus `is_self`). */
export interface KonektAttendee {
  /** The user id: v2 has no attendee entity. */
  id: string | null;
  provider_id: string | null;
  attendee_provider_id: string | null;
  name: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  public_identifier: string | null;
  profile_url: string | null;
  profile_picture_url: string | null;
  picture_url: string | null;
  headline: string | null;
  occupation: string | null;
  network_distance: string | null;
  specifics: { occupation: string | null; network_distance: string | null };
  is_self: boolean;
}

function toAttendee(rawUser: unknown, isSelf: boolean): KonektAttendee | null {
  const user = asRecord(rawUser);
  if (!user) return null;
  const specifics = asRecord(user.specifics) ?? {};
  const id = asString(user.id);
  const picture = asString(user.public_picture_url);
  const distance = toLegacyNetworkDistance(specifics.network_distance);
  const headline = asString(user.description);
  return {
    id,
    provider_id: id,
    attendee_provider_id: id,
    name: asString(user.display_name),
    display_name: asString(user.display_name),
    first_name: asString(user.first_name),
    last_name: asString(user.last_name),
    public_identifier: asString(user.public_identifier),
    profile_url: asString(user.profile_url),
    profile_picture_url: picture,
    picture_url: picture,
    headline,
    occupation: headline,
    network_distance: distance,
    specifics: { occupation: headline, network_distance: distance },
    is_self: isSelf,
  };
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export interface MessageContext {
  /** The account the message was read through (v2 messages carry none). */
  accountId?: string | null;
  /** The chat it was read from, when the payload has no `chat_id`. */
  chatId?: string | null;
}

export interface KonektReaction {
  value: string;
  reaction: string;
  sender_id: string | null;
  is_sender: boolean | null;
}

export interface KonektMessage {
  id: string | null;
  /** Same as `id`: the readers pick `provider_id || message_id || id`. */
  provider_id: string | null;
  message_id: string | null;
  chat_id: string | null;
  account_id: string | null;
  text: string | null;
  sender_id: string | null;
  sender: { name: string | null; attendee_id: string | null } | null;
  timestamp: string | null;
  is_sender: boolean | null;
  /** The message was seen (`is_seen`). */
  read: boolean | null;
  /** 1 when seen, 0 otherwise (legacy numeric flag). */
  seen: number | null;
  delivered: boolean | null;
  is_deleted: boolean | null;
  is_edited: boolean | null;
  /** A system row (missed call, pin, participant change, reaction...), not something a person wrote. */
  is_event: boolean | null;
  /** `event_type` (0 to 17) of a system row. */
  event_type: number | null;
  /** The message is hidden by the provider. */
  is_hidden: boolean | null;
  reactions: KonektReaction[];
  attachments: KonektAttachment[];
  /** `specifics.subject`, set on InMails. */
  subject: string | null;
  /** `specifics.type`: `MESSAGE`, `EMAIL`, `INVITATION`, `INMAIL`, `INMAIL_DECLINE`, `INMAIL_REPLY`, `INMAIL_ACCEPT`. */
  message_type: string | null;
}

const MAX_REACTIONS_PER_VALUE = 50;

/** `specifics.type` values that are lifecycle rows, not a written answer. */
const NOT_A_REPLY_TYPES = new Set(['INVITATION', 'INMAIL_DECLINE', 'INMAIL_ACCEPT']);

/**
 * True when an inbound row may be a person's written answer: not ours, not a
 * system row (`is_event`: missed call, pin, participant change...), not hidden,
 * not deleted, and not an invitation or InMail lifecycle row. Every reply path
 * (sequence stop, stage move, analysis) must filter with it, the message list
 * does not. Works on a `toKonektMessage` result and on the `data.message` of a
 * flattened `message.new`.
 */
export function isCandidateReplyCandidate(
  message: {
    is_sender?: boolean | null;
    is_event?: boolean | null;
    is_hidden?: boolean | null;
    is_deleted?: boolean | null;
    message_type?: string | null;
  } | null | undefined,
): boolean {
  if (!message) return false;
  if (message.is_sender === true) return false;
  if (message.is_event === true || message.is_hidden === true || message.is_deleted === true) return false;
  return !NOT_A_REPLY_TYPES.has((message.message_type ?? '').toUpperCase());
}

/**
 * v2 `Message` to the legacy message.
 *
 *  id, provider_id, message_id <- id | chat_id <- chat_id (else context.chatId) | account_id <- context.accountId
 *  text <- text | sender_id <- sender_id | sender <- { name: sender.display_name, attendee_id: sender.id }
 *  timestamp <- timestamp | is_sender <- is_sender
 *  read <- is_seen | seen <- is_seen as 1/0 | delivered <- is_delivered
 *  is_deleted <- is_deleted | is_edited <- is_edited | is_event, event_type, is_hidden <- same names
 *  reactions <- reactions_counter ({ reaction, count } expanded to one entry per reaction, at most 50 per value)
 *  attachments <- attachments | subject <- specifics.subject | message_type <- specifics.type
 */
export function toKonektMessage(input: unknown, context: MessageContext = {}): KonektMessage {
  const raw = asRecord(input) ?? {};
  const id = asString(raw.id);
  const specifics = asRecord(raw.specifics) ?? {};
  const sender = asRecord(raw.sender);
  const seen = asBoolean(raw.is_seen);
  const reactions: KonektReaction[] = [];
  for (const entry of asArray(raw.reactions_counter) ?? []) {
    const item = asRecord(entry);
    const value = asString(item?.reaction);
    const count = asNumber(item?.count) ?? 0;
    if (!value) continue;
    for (let i = 0; i < Math.min(Math.max(Math.floor(count), 0), MAX_REACTIONS_PER_VALUE); i++) {
      reactions.push({ value, reaction: value, sender_id: null, is_sender: null });
    }
  }
  return {
    id,
    provider_id: id,
    message_id: id,
    chat_id: asString(raw.chat_id) ?? asString(context.chatId),
    account_id: asString(context.accountId),
    text: asString(raw.text),
    sender_id: asString(raw.sender_id),
    sender: sender ? { name: asString(sender.display_name), attendee_id: asString(sender.id) } : null,
    timestamp: asString(raw.timestamp),
    is_sender: asBoolean(raw.is_sender),
    read: seen,
    seen: seen === null ? null : seen ? 1 : 0,
    delivered: asBoolean(raw.is_delivered),
    is_deleted: asBoolean(raw.is_deleted),
    is_edited: asBoolean(raw.is_edited),
    is_event: asBoolean(raw.is_event),
    event_type: asNumber(raw.event_type),
    is_hidden: asBoolean(raw.is_hidden),
    reactions,
    attachments: toAttachments(raw.attachments),
    subject: asString(specifics.subject),
    message_type: asString(specifics.type),
  };
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type InboxKind = 'classic' | 'recruiter' | 'sales_navigator';

export interface ChatContext {
  /** Required in practice: v2 chats carry no account id. */
  accountId?: string | null;
  /** The licence of the inbox the chat was listed from, to build the legacy `folder`. */
  inboxKind?: InboxKind | null;
}

/** Legacy folder names (the front end tests them for "recruiter", "classic", "sales", "navigator"). */
export const LEGACY_FOLDER_BY_INBOX: Readonly<Record<InboxKind, string>> = {
  classic: 'INBOX_LINKEDIN_CLASSIC',
  recruiter: 'INBOX_LINKEDIN_RECRUITER',
  sales_navigator: 'INBOX_LINKEDIN_SALES_NAVIGATOR',
};

export interface KonektLastMessage {
  text: string | null;
  sender_id: string | null;
  timestamp: string | null;
  is_sender: boolean | null;
  /** `specifics.type` when the last message is a full message, else `null`. */
  message_type: string | null;
  /** `sender_display_name` of a preview (a full message carries a `sender` instead). */
  sender_name: string | null;
  /** True for a `MessagePreview`: no sender id, timestamp or type, so no InMail marker. */
  is_preview: boolean;
}

export interface KonektChat {
  id: string | null;
  account_id: string | null;
  /** Legacy upper-case provider type (`LINKEDIN`, `WHATSAPP`...), from `provider`. */
  account_type: string | null;
  name: string | null;
  /** `description` ("description / subject" of the chat), used as the InMail subject. */
  subject: string | null;
  /** Last activity: `last_message_timestamp`, else the last message, `updated_at`, `created_at`. */
  timestamp: string | null;
  /** The number of unread messages; `-1` (marked unread by hand) becomes 1. */
  unread_count: number;
  unread: number;
  attendees: KonektAttendee[];
  attendee_provider_id: string | null;
  folder: string[];
  /** `inmail` when the last message is an InMail, else `null`. */
  content_type: string | null;
  is_inmail: boolean;
  /**
   * True when the list gave a `MessagePreview` as last message: it carries no
   * type, so `is_inmail` false means "unknown", not "not an InMail". Read the
   * message (`getMessage`) when the InMail marker matters.
   */
  inmail_unknown: boolean;
  /** Legacy numeric type: 0 one to one, 1 group, 2 channel. */
  type: number | null;
  is_group: boolean | null;
  is_readonly: boolean | null;
  is_archived: boolean | null;
  last_message: KonektLastMessage | null;
}

function legacyChatType(raw: Rec): number | null {
  const type = asString(raw.type);
  if (type === '1to1' || raw.is_1to1 === true) return 0;
  if (type === 'group' || raw.is_group === true) return 1;
  if (type === 'channel' || raw.is_channel === true) return 2;
  return null;
}

function toLastMessage(value: unknown, fallbackTimestamp: string | null): KonektLastMessage | null {
  const item = asRecord(value);
  if (!item) return null;
  const specifics = asRecord(item.specifics) ?? {};
  const sender = asRecord(item.sender);
  return {
    text: asString(item.text),
    sender_id: asString(item.sender_id),
    timestamp: asString(item.timestamp) ?? fallbackTimestamp,
    is_sender: asBoolean(item.is_sender),
    message_type: asString(specifics.type),
    sender_name: asString(item.sender_display_name) ?? asString(sender?.display_name),
    is_preview: item.object === 'MessagePreview',
  };
}

/**
 * v2 `Chat` to the legacy chat.
 *
 *  id <- id | account_id <- context.accountId | account_type <- provider (upper case)
 *  name <- name | subject <- description
 *  timestamp <- last_message_timestamp | last_message.timestamp | updated_at | created_at
 *  unread_count, unread <- unread_count (-1 becomes 1, a missing count is 0)
 *  attendees <- [user] for a one to one chat, participants[].user for a group
 *  attendee_provider_id <- user_id | user.id | the first participant that is not the account owner
 *  folder <- [LEGACY_FOLDER_BY_INBOX[context.inboxKind]], else folders[]
 *  content_type, is_inmail <- last_message.specifics.type starting with INMAIL (inmail_unknown when the last message is a MessagePreview)
 *  type <- type (1to1 = 0, group = 1, channel = 2) | is_group, is_readonly, is_archived <- same names
 *  last_message <- last_message { text, sender_id, timestamp, is_sender, message_type, sender_name <- sender_display_name }
 */
export function toKonektChat(input: unknown, context: ChatContext = {}): KonektChat {
  const raw = asRecord(input) ?? {};
  const type = legacyChatType(raw);
  const user = asRecord(raw.user);
  const participants = asArray(raw.participants) ?? [];

  const attendees: KonektAttendee[] = [];
  if (type === 1 && participants.length > 0) {
    for (const entry of participants) {
      const participant = asRecord(entry);
      const attendee = participant ? toAttendee(participant.user, participant.is_self === true) : null;
      if (attendee) attendees.push(attendee);
    }
  } else {
    const attendee = toAttendee(user, false);
    if (attendee) attendees.push(attendee);
  }
  const attendeeProviderId = asString(raw.user_id) ?? asString(user?.id) ?? attendees.find((a) => !a.is_self)?.id ?? null;

  const lastTimestamp = asString(raw.last_message_timestamp);
  const lastMessage = toLastMessage(raw.last_message, lastTimestamp);
  const inmail = (lastMessage?.message_type ?? '').toUpperCase().startsWith('INMAIL');
  const unreadRaw = asNumber(raw.unread_count) ?? 0;
  const unread = unreadRaw < 0 ? 1 : unreadRaw;
  const provider = asString(raw.provider)?.toUpperCase() ?? null;
  const folders = context.inboxKind ? [LEGACY_FOLDER_BY_INBOX[context.inboxKind]] : (asStringArray(raw.folders) ?? []);

  return {
    id: asString(raw.id),
    account_id: asString(context.accountId),
    account_type: provider,
    name: asString(raw.name),
    subject: asString(raw.description),
    timestamp: lastTimestamp ?? lastMessage?.timestamp ?? asString(raw.updated_at) ?? asString(raw.created_at),
    unread_count: unread,
    unread,
    attendees,
    attendee_provider_id: attendeeProviderId,
    folder: folders,
    content_type: inmail ? 'inmail' : null,
    is_inmail: inmail,
    inmail_unknown: lastMessage?.is_preview === true,
    type,
    is_group: asBoolean(raw.is_group),
    is_readonly: asBoolean(raw.is_readonly),
    is_archived: asBoolean(raw.is_archived),
    last_message: lastMessage,
  };
}

/** One match of `GET /users/{id}/chat`, as `{ id, chat_id, inbox_id, has_history }` (`id` is what the legacy chat list used). */
export interface KonektChatLookupEntry {
  id: string;
  chat_id: string;
  inbox_id: string | null;
  has_history: boolean | null;
}

/** v2 `{ object: 'ChatLookup', data: [{ chat_id, inbox_id?, has_history? }] }` to a list. Entries without a chat id are dropped. */
export function toKonektChatLookup(input: unknown): KonektChatLookupEntry[] {
  const raw = asRecord(input);
  const out: KonektChatLookupEntry[] = [];
  for (const entry of asArray(raw?.data) ?? []) {
    const item = asRecord(entry);
    const chatId = asString(item?.chat_id);
    if (!item || !chatId) continue;
    out.push({ id: chatId, chat_id: chatId, inbox_id: asString(item.inbox_id), has_history: asBoolean(item.has_history) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export interface EmailContext {
  /** The mailbox account the email was read through (v2 emails carry none). */
  accountId?: string | null;
  /** The mailbox address, to set `is_sender` (the email is ours when it is the sender). */
  accountEmail?: string | null;
}

/** Legacy attendee of an email: `identifier` is the address. */
export interface KonektEmailAttendee {
  display_name: string | null;
  identifier: string;
}

function toEmailAttendee(raw: unknown): KonektEmailAttendee | null {
  const item = asRecord(raw);
  const identifier = asString(item?.email) ?? asString(item?.identifier);
  if (!item || !identifier) return null;
  return { display_name: asString(item.display_name) ?? asString(item.name), identifier };
}

function toEmailAttendees(value: unknown): KonektEmailAttendee[] {
  return (asArray(value) ?? []).map(toEmailAttendee).filter((a): a is KonektEmailAttendee => a !== null);
}

export interface KonektEmail {
  /** The provider's email id: the id to use in requests. */
  id: string | null;
  /** Same as `id`, on purpose: the readers pick `provider_id || message_id || id`, so the stored id is always `id` (never the RFC header). */
  provider_id: string | null;
  /** The RFC `Message-ID` header, which is NOT the id to use in requests. */
  message_id: string | null;
  account_id: string | null;
  /** The provider thread id; `null` when the provider gave none (some IMAP mails). */
  thread_id: string | null;
  /** `thread_id`, else the first id of `References`, `In-Reply-To`, `Message-ID`: a stable key to group mails, NOT usable as a thread id in requests. */
  thread_key: string | null;
  subject: string | null;
  /** HTML body when available, else plain text (`body`). */
  body: string | null;
  body_plain: string | null;
  snippet: string | null;
  /** ISO date the mail was sent. */
  date: string | null;
  from_attendee: KonektEmailAttendee | null;
  to_attendees: KonektEmailAttendee[];
  cc_attendees: KonektEmailAttendee[];
  bcc_attendees: KonektEmailAttendee[];
  reply_to_attendees: KonektEmailAttendee[];
  /** The `In-Reply-To` header, else the last id of `References` (as the webhook path does). */
  in_reply_to: string | null;
  /** Ids of the `References` header (angle brackets removed). */
  references: string[];
  has_attachments: boolean;
  attachments: KonektAttachment[];
  folders: string[];
  is_unread: boolean | null;
  /** `true` when the sender is `context.accountEmail`, `false` when it is someone else, `null` when unknown. */
  is_sender: boolean | null;
  /** All headers as sent (`{ name, value }`), for bounce and auto-reply detection. */
  headers: Array<{ name: string; value: string }>;
}

function parseHeaders(value: unknown): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const entry of asArray(value) ?? []) {
    const item = asRecord(entry);
    const name = asString(item?.name);
    if (!item || !name) continue;
    out.push({ name, value: typeof item.value === 'string' ? item.value : '' });
  }
  return out;
}

function headerValue(headers: Array<{ name: string; value: string }>, name: string): string | null {
  const wanted = name.toLowerCase();
  return asString(headers.find((h) => h.name.toLowerCase() === wanted)?.value);
}

function messageIdsOf(value: string | null): string[] {
  if (!value) return [];
  const bracketed = [...value.matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]);
  if (bracketed.length > 0) return bracketed;
  return value.split(/\s+/).filter((token) => token !== '');
}

/**
 * v2 `Email` to the legacy email.
 *
 *  id, provider_id <- id | message_id <- message_id (RFC header) | account_id <- context.accountId
 *  thread_id <- thread_id | thread_key <- thread_id, else References[0], In-Reply-To[0], message_id
 *  subject, body, body_plain, snippet, date <- same names
 *  from_attendee <- from[0] | to_attendees, cc_attendees, bcc_attendees, reply_to_attendees <- to, cc, bcc, reply_to
 *  (an attendee is `{ display_name, identifier }`, `identifier` <- email)
 *  in_reply_to <- header In-Reply-To, else the last id of References | references <- header References
 *  attachments, has_attachments <- attachments | folders <- folders | is_unread <- is_unread
 *  is_sender <- from[0].email compared with context.accountEmail | headers <- headers
 */
export function toKonektEmail(input: unknown, context: EmailContext = {}): KonektEmail {
  const raw = asRecord(input) ?? {};
  const headers = parseHeaders(raw.headers);
  const from = toEmailAttendees(raw.from)[0] ?? null;
  const inReplyTo = headerValue(headers, 'in-reply-to');
  const references = messageIdsOf(headerValue(headers, 'references'));
  // Same rule as the webhook path (`inReplyToOf`): a reply that carries only
  // References is still a reply. Kept local: email.ts imports this module's siblings.
  const referenceTokens = headerValue(headers, 'references')?.match(/<[^<>\s]+>|[^\s<>]+/g) ?? [];
  const answers = inReplyTo?.trim() || (referenceTokens.length > 0 ? referenceTokens[referenceTokens.length - 1] : null);
  const messageId = asString(raw.message_id);
  const threadId = asString(raw.thread_id);
  const attachments = toAttachments(raw.attachments);
  const own = asString(context.accountEmail)?.toLowerCase();
  return {
    id: asString(raw.id),
    provider_id: asString(raw.id),
    message_id: messageId,
    account_id: asString(context.accountId),
    thread_id: threadId,
    thread_key: threadId ?? references[0] ?? messageIdsOf(inReplyTo)[0] ?? messageId,
    subject: asString(raw.subject),
    body: asString(raw.body),
    body_plain: asString(raw.body_plain),
    snippet: asString(raw.snippet),
    date: asString(raw.date),
    from_attendee: from,
    to_attendees: toEmailAttendees(raw.to),
    cc_attendees: toEmailAttendees(raw.cc),
    bcc_attendees: toEmailAttendees(raw.bcc),
    reply_to_attendees: toEmailAttendees(raw.reply_to),
    in_reply_to: answers,
    references,
    has_attachments: attachments.length > 0,
    attachments,
    folders: asStringArray(raw.folders) ?? [],
    is_unread: asBoolean(raw.is_unread),
    is_sender: own && from ? from.identifier.toLowerCase() === own : null,
    headers,
  };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export interface KonektPage<T> {
  items: T[];
  /** `next_cursor`, or `null` at the end of the list. */
  cursor: string | null;
  /** `total_count` when the provider sent one. */
  total: number | null;
}

/**
 * Maps a v2 list envelope (`{ data, total_count?, next_cursor? }`, a thread's `{ emails }`,
 * or the parsed page of `pagination.ts`) with one of the item mappers above. The legacy readers looked at
 * `items` and `cursor`: this is that shape, with the new names read.
 */
export function toKonektPage<T>(input: unknown, mapItem: (raw: unknown) => T): KonektPage<T> {
  const { items, nextCursor, total } = readListEnvelope(input);
  return { items: items.map(mapItem), cursor: nextCursor, total };
}
