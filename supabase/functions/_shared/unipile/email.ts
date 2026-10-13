/**
 * E-mail of the provider API (area "email-calendar"): send, list, read, threads.
 *
 * Wire facts (see the email-calendar digest)
 *  - Every path is `/{account_id}/emails...`; the send endpoint is
 *    `POST /{acc}/emails/send`.
 *  - Recipients are `{ email, display_name? }`. The previous generation's
 *    `identifier` does not exist: only `email` and `display_name` are ever
 *    copied from the input, so a stray key cannot reach the wire.
 *  - The send body is `additionalProperties: false`: `html` (not `body`),
 *    `plain_text`, `reply_to_message_id` for threading (`reply_to` is the
 *    Reply-To header), `tracking_options { opens, clicks, label,
 *    custom_domain }` which requires `html`.
 *  - A send answers `{ object: 'EmailSent', id, message_id? }` and follows the
 *    send outcome contract of `messaging.ts` (`sent` | `uncertain` | `refused`),
 *    never retried.
 *  - Lists answer `{ data, total_count?, next_cursor? }`. There is no filter by
 *    thread or folder on the global list (use `folderId` or `getThread`) and no
 *    "list threads" endpoint; a thread is read by id.
 *  - An `Email` has no direction flag and no `in_reply_to`: the reply linkage is
 *    in `headers[]` (`headerValue`, `inReplyToOf`) and in `thread_id`.
 */

import { UnipileError } from './errors.ts';
import { unipileJson, type TransportOptions } from './http.ts';
import { accountPath } from './ids.ts';
import { performSend, type SendResult } from './messaging.ts';
import { parsePage, type Page } from './pagination.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailAddress {
  email: string;
  display_name?: string;
}

export interface EmailHeader {
  readonly name: string;
  readonly value: string;
}

/** A v2 `Email`, minimal. */
export interface Email {
  /** Provider id, the one to use in requests. */
  readonly id: string;
  /** RFC 5322 Message-ID header. */
  readonly message_id?: string;
  readonly thread_id?: string;
  readonly subject?: string;
  readonly from?: readonly EmailAddress[];
  readonly to?: readonly EmailAddress[];
  readonly cc?: readonly EmailAddress[];
  readonly bcc?: readonly EmailAddress[];
  readonly reply_to?: readonly EmailAddress[];
  /** ISO 8601 UTC. */
  readonly date?: string;
  readonly body?: string;
  readonly body_plain?: string;
  readonly snippet?: string;
  readonly headers?: readonly EmailHeader[];
  readonly attachments?: ReadonlyArray<{ readonly id: string; readonly type?: string; readonly filename?: string; readonly [key: string]: unknown }>;
  readonly folders?: readonly string[];
  readonly is_unread?: boolean;
  readonly [key: string]: unknown;
}

export interface EmailThread {
  readonly id: string;
  readonly emails: readonly Email[];
}

export interface EmailFile {
  /** Base64 content. */
  content: string;
  contentType: string;
  filename: string;
  /** Makes the file an inline attachment referenced from the HTML by `cid:<contentId>` (no angle brackets). */
  contentId?: string;
}

export interface EmailTracking {
  opens?: boolean;
  clicks?: boolean;
  /** Echoed in the tracking events: use Konekt's own execution id. */
  label?: string;
  customDomain?: string;
}

export interface SendEmailInput {
  accountId: string;
  to: readonly EmailAddress[];
  cc?: readonly EmailAddress[];
  bcc?: readonly EmailAddress[];
  /** One sender among those of `email-senders`; omit for the primary address. */
  from?: EmailAddress;
  subject?: string;
  html?: string;
  plainText?: string;
  /** Reply-To header (not for threading). */
  replyTo?: readonly EmailAddress[];
  /** Message being replied to (Gmail, Outlook: provider id; IMAP: RFC 5322 Message-ID). */
  replyToMessageId?: string;
  attachments?: readonly EmailFile[];
  /** Each header overrides any header of the same name. */
  customHeaders?: ReadonlyArray<{ name: string; value: string }>;
  tracking?: EmailTracking;
}

export type EmailSendOutcome = SendResult<{ emailId: string; messageId: string | null }>;

export interface ListEmailsParams {
  /** Full-text search in subject and body (approximate on some providers). */
  q?: string;
  /** Skips bodies and attachments for speed. */
  metaOnly?: boolean;
  to?: string;
  from?: string;
  /** At least one of these addresses appears in from, to, cc or bcc. */
  anyEmail?: string | readonly string[];
  hasAttachment?: boolean;
  isStarred?: boolean;
  isUnread?: boolean;
  /** Exclusive bounds on the send date. */
  before?: Date | string;
  after?: Date | string;
  excludeFolder?: string | readonly string[];
  /** Lists the emails of one folder instead of all of them. */
  folderId?: string;
  cursor?: string;
  offset?: number;
  limit?: number;
}

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

function commaList(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : value.join(',');
}

/** Recipient copied to the wire shape: only `email` and `display_name`. */
/** A value that ends up in a mail header must not carry a line break (header injection). */
function singleLine(value: string, name: string): string {
  if (/[\r\n\u0000]/.test(value)) throw invalid(`${name} must not contain a line break`);
  return value;
}

/** Header field name: RFC 7230 token characters only. */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function address(value: EmailAddress, name: string): EmailAddress {
  if (!isRecord(value)) throw invalid(`${name} must be an object`);
  const email = nonEmpty(value.email, `${name}.email`).trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw invalid(`${name}.email is not an address`);
  return typeof value.display_name === 'string' && value.display_name !== ''
    ? { email, display_name: singleLine(value.display_name, `${name}.display_name`) }
    : { email };
}

function addresses(list: readonly EmailAddress[], name: string): EmailAddress[] {
  if (!Array.isArray(list)) throw invalid(`${name} must be a list`);
  return list.map((entry, i) => address(entry, `${name}[${i}]`));
}

// ---------------------------------------------------------------------------
// Headers (pure, used by the webhook flattening and the normalisers)
// ---------------------------------------------------------------------------

/**
 * First value of a header, matched case-insensitively. Accepts the v2 list of
 * `{ name, value }` and, defensively, a plain object. `null` when absent.
 */
export function headerValue(headers: unknown, name: string): string | null {
  const wanted = name.toLowerCase();
  if (Array.isArray(headers)) {
    for (const header of headers) {
      if (isRecord(header) && typeof header.name === 'string' && header.name.toLowerCase() === wanted) {
        return typeof header.value === 'string' ? header.value : null;
      }
    }
    return null;
  }
  if (isRecord(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === wanted) return typeof value === 'string' ? value : null;
    }
  }
  return null;
}

/**
 * Message-ID of the mail this one answers: the `In-Reply-To` header, else the
 * last id of `References`. `null` when the mail answers nothing.
 */
export function inReplyToOf(headers: unknown): string | null {
  const direct = headerValue(headers, 'In-Reply-To')?.trim();
  if (direct) return direct;
  const references = headerValue(headers, 'References')?.match(/<[^<>\s]+>|[^\s<>]+/g);
  return references && references.length > 0 ? references[references.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

/** Builds the `POST /emails/send` body (exported for tests). Throws a `validation` error on bad input. */
export function buildSendEmailBody(input: SendEmailInput): Record<string, unknown> {
  const to = addresses(input.to, 'to');
  if (to.length === 0) throw invalid('at least one recipient is required');
  const body: Record<string, unknown> = { to };
  if (input.cc !== undefined) body.cc = addresses(input.cc, 'cc');
  if (input.bcc !== undefined) body.bcc = addresses(input.bcc, 'bcc');
  if (input.from !== undefined) body.from = address(input.from, 'from');
  if (input.subject !== undefined) body.subject = typeof input.subject === 'string' ? singleLine(input.subject, 'subject') : input.subject;
  if (input.html !== undefined) body.html = input.html;
  if (input.plainText !== undefined) body.plain_text = input.plainText;
  if (input.replyTo !== undefined) body.reply_to = addresses(input.replyTo, 'replyTo');
  if (input.replyToMessageId !== undefined) body.reply_to_message_id = singleLine(nonEmpty(input.replyToMessageId, 'replyToMessageId'), 'replyToMessageId');
  if (input.attachments !== undefined) {
    body.attachments = input.attachments.map((file) => {
      const out: Record<string, unknown> = {
        content: nonEmpty(file.content, 'attachment.content'),
        content_type: nonEmpty(file.contentType, 'attachment.contentType'),
        filename: singleLine(nonEmpty(file.filename, 'attachment.filename'), 'attachment.filename'),
      };
      if (file.contentId !== undefined) out.content_id = nonEmpty(file.contentId, 'attachment.contentId');
      return out;
    });
  }
  if (input.customHeaders !== undefined) {
    body.custom_headers = input.customHeaders.map((h) => {
      const name = nonEmpty(h.name, 'header.name');
      if (!HEADER_NAME_RE.test(name)) throw invalid('header.name must be a valid header field name');
      if (typeof h.value !== 'string' && typeof h.value !== 'number' && typeof h.value !== 'boolean') {
        throw invalid('header.value must be a string');
      }
      return { name, value: singleLine(String(h.value), 'header.value') };
    });
  }
  if (input.tracking !== undefined) {
    const t = input.tracking;
    if ((t.opens === true || t.clicks === true) && (typeof input.html !== 'string' || input.html === '')) {
      throw invalid('tracking requires an html body');
    }
    const options: Record<string, unknown> = {};
    if (t.opens !== undefined) options.opens = t.opens;
    if (t.clicks !== undefined) options.clicks = t.clicks;
    if (t.label !== undefined) options.label = t.label;
    if (t.customDomain !== undefined) options.custom_domain = t.customDomain;
    if (Object.keys(options).length > 0) body.tracking_options = options;
  }
  return body;
}

/**
 * `POST /{acc}/emails/send`. Never retried: a timeout or a 5xx is `uncertain`,
 * and a success whose answer has no `id` is `uncertain` too.
 */
export async function sendEmail(input: SendEmailInput, options: TransportOptions = {}): Promise<EmailSendOutcome> {
  const body = buildSendEmailBody(input);
  return await performSend(
    { method: 'POST', path: accountPath(input.accountId, 'emails', 'send'), body, heavy: true },
    (data) => {
      if (!isRecord(data) || typeof data.id !== 'string' || data.id === '') {
        return { ok: false, note: 'sent email answer has no id' };
      }
      return {
        ok: true,
        value: { emailId: data.id, messageId: typeof data.message_id === 'string' && data.message_id !== '' ? data.message_id : null },
      };
    },
    options,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One page of emails, newest first (`GET /{acc}/emails`, or the folder variant). */
export async function listEmails(
  accountId: string,
  params: ListEmailsParams = {},
  options: TransportOptions = {},
): Promise<Page<Email>> {
  const path = params.folderId === undefined
    ? accountPath(accountId, 'emails')
    : accountPath(accountId, 'folders', params.folderId, 'emails');
  const body = await unipileJson(
    {
      path,
      query: {
        q: params.q,
        meta_only: params.metaOnly,
        to: params.to,
        from: params.from,
        any_email: commaList(params.anyEmail),
        has_attachment: params.hasAttachment,
        is_starred: params.isStarred,
        is_unread: params.isUnread,
        before: iso(params.before, 'before'),
        after: iso(params.after, 'after'),
        exclude_folder: commaList(params.excludeFolder),
        cursor: params.cursor,
        offset: params.offset,
        limit: params.limit,
      },
    },
    options,
  );
  return parsePage<Email>(body);
}

export async function getEmail(
  accountId: string,
  emailId: string,
  params: { metaOnly?: boolean } = {},
  options: TransportOptions = {},
): Promise<Email> {
  const body = await unipileJson(
    { path: accountPath(accountId, 'emails', emailId), query: { meta_only: params.metaOnly } },
    options,
  );
  if (!isRecord(body) || typeof body.id !== 'string') {
    throw new UnipileError('server', { code: 'invalid_email', debug: { note: 'unreadable email object', body } });
  }
  return body as unknown as Email;
}

/**
 * `GET /{acc}/threads/{thread}`: the emails of a conversation sorted by date,
 * with no pagination. On IMAP the thread may be reconstructed from headers and
 * be incomplete.
 */
export async function getThread(
  accountId: string,
  threadId: string,
  params: { metaOnly?: boolean } = {},
  options: TransportOptions = {},
): Promise<EmailThread> {
  const body = await unipileJson(
    { path: accountPath(accountId, 'threads', threadId), query: { meta_only: params.metaOnly } },
    options,
  );
  if (!isRecord(body) || typeof body.id !== 'string' || !Array.isArray(body.emails)) {
    throw new UnipileError('server', { code: 'invalid_thread', debug: { note: 'unreadable thread object', body } });
  }
  return body as unknown as EmailThread;
}
