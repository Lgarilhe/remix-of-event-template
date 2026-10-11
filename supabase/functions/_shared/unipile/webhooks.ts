/**
 * Webhooks of the provider API (area "webhooks"): endpoint management, delivery
 * log and replay, authentication of deliveries, and the flattening of the v2
 * event envelope into the flat shape the receiver's handlers read.
 *
 * Wire facts (see the webhooks digest)
 *  - Endpoints are managed at application level: `/webhooks/endpoints/` (list,
 *    create), `/webhooks/endpoints/{id}` (get, patch, delete),
 *    `/webhooks/conversations/` (delivery attempts, `endpoint_id` required),
 *    `POST /webhooks/events/{id}/replay` (202). Lists use `offset` + `limit`
 *    sent as strings and answer `{ data, has_more }`.
 *  - An endpoint cannot carry custom headers: the delivery is authenticated by a
 *    token in the URL (`?v2_token=`), compared in constant time. The URL of an
 *    endpoint, and `endpoint_url` of a delivery, therefore CONTAIN that token,
 *    and an endpoint carries a `secret`. Every function below returns the safe
 *    shape (`redactEndpoint`, `redactDelivery`: query string stripped, secret
 *    dropped), so nothing forwarded to a browser can leak either. A caller that
 *    wants to know whether the token of an endpoint is current cannot read it:
 *    it patches the URL instead.
 *  - `trigger_events` is a closed enum of 40 values (`KNOWN_TRIGGER_EVENTS`): a
 *    value outside it fails the whole creation. Konekt subscribes to a subset
 *    (`V2_TRIGGER_EVENTS`).
 *  - The envelope is `{ id: 'evt_...', type, created_at, account_id,
 *    account_name, account_provider, application_id, payload }`. A replay keeps
 *    the original `evt_` id, so deduplication is keyed on the RAW event type plus
 *    that id (`webhookDedupKey`), never on the aliased handler name.
 *
 * Only `message.new` was ever observed on a real delivery. The other payloads are
 * read defensively from the shapes of the spec objects; whatever a handler needs
 * and a payload lacks stays absent, never invented.
 *
 * Everything below the "Event envelope" heading is pure.
 */

import { UnipileError } from './errors.ts';
import { unipileDeleteJson, unipileJson, type TransportOptions } from './http.ts';
import { type EnvReader } from './config.ts';
import { inReplyToOf } from './email.ts';
import { assertV2AccountId } from './ids.ts';
import { collect, parsePage, type CollectResult, type Page } from './pagination.ts';
import { mapAccountStatus } from './status.ts';

// ---------------------------------------------------------------------------
// Event names
// ---------------------------------------------------------------------------

/**
 * Closed enum of `trigger_events` of the provider spec (40 values, "Unipile API"
 * snapshot of 2026-10-11). Removed upstream since the older snapshots:
 * `account.status.paused`, `message.read`, `relation.request.accept`.
 */
export const KNOWN_TRIGGER_EVENTS = [
  'account.status.disconnected',
  'account.status.running',
  'account.status.errored',
  'account.status.degraded',
  'account.status.partial',
  'account.locked',
  'account.unlocked',
  'account.add',
  'account.reconnect',
  'account.remove',
  'account.initial_sync.running',
  'account.initial_sync.failed',
  'account.initial_sync.completed',
  'message.new',
  'message.update',
  'message.delete',
  'message.receipt.read',
  'message.receipt.delivery',
  'message.reaction.new',
  'message.reaction.delete',
  'chat.delete',
  'chat.update',
  'email.new',
  'email.new.bounce',
  'email.delete',
  'email.draft.new',
  'email.draft.delete',
  'email.folder.create',
  'email.folder.update',
  'email.folder.delete',
  'calendar.create',
  'calendar.update',
  'calendar.delete',
  'calendar.event.new',
  'calendar.event.update',
  'calendar.event.delete',
  'tracking.open',
  'tracking.click',
  'relation.new',
  'follower.new',
] as const;

export type KnownTriggerEvent = typeof KNOWN_TRIGGER_EVENTS[number];

/**
 * Events Konekt subscribes to. Bounces and tracking events are NOT subscribed
 * while nothing handles them (bounces already arrive as inbound mail through
 * `email.new`). Every value must be in `KNOWN_TRIGGER_EVENTS`.
 */
export const V2_TRIGGER_EVENTS = [
  'message.new',
  'message.reaction.new',
  'message.receipt.read',
  'relation.new',
  'account.add',
  'account.reconnect',
  'account.remove',
  'account.status.running',
  'account.status.degraded',
  'account.status.partial',
  'account.status.disconnected',
  'account.status.errored',
  'account.locked',
  'account.unlocked',
  'account.initial_sync.completed',
  'account.initial_sync.failed',
  'email.new',
] as const;

const KNOWN_SET: ReadonlySet<string> = new Set(KNOWN_TRIGGER_EVENTS);

/**
 * Name of the receiver's handler for each subscribed event. `account.remove`
 * is NOT a recoverable disconnect: it has its own handler name
 * (`account_removed`: unlink and stop sending).
 */
export const EVENT_ALIASES: Readonly<Record<string, string>> = {
  'relation.new': 'new_relation',
  'message.new': 'new_message',
  'message.receipt.read': 'message_read',
  'message.reaction.new': 'message_reaction',
  'email.new': 'mail_received',
  'account.add': 'account_connected',
  'account.reconnect': 'account_connected',
  'account.remove': 'account_removed',
  'account.status.disconnected': 'account_disconnected',
  'account.status.errored': 'account_error',
  'account.status.running': 'account_status_updated',
  'account.status.degraded': 'account_status_updated',
  'account.status.partial': 'account_status_updated',
  'account.locked': 'account_locked',
  'account.unlocked': 'account_unlocked',
  'account.initial_sync.completed': 'account_sync_completed',
  'account.initial_sync.failed': 'account_sync_failed',
};

/** Status carried by the NAME of a status event (the event name wins over any `status` of the payload). */
export const STATUS_BY_EVENT: Readonly<Record<string, string>> = {
  'account.status.running': mapAccountStatus('running'),
  'account.status.degraded': mapAccountStatus('degraded'),
  'account.status.partial': mapAccountStatus('partial'),
};

/**
 * Konekt status of an `account.status.*` event once `is_locked` is taken into
 * account: a locked account is `LOCKED` whatever the event name says, as on the
 * `GET /accounts` path (`mapAccountStatus`). `null` for any other event.
 */
export function accountStatusOfEvent(v2Event: string, isLocked?: unknown): string | null {
  const byName = STATUS_BY_EVENT[v2Event];
  return byName === undefined ? null : mapAccountStatus(byName, isLocked);
}

/** Handler name of a v2 event, or the event name itself when it has no alias. */
export function handlerNameOf(v2Event: string): string {
  return EVENT_ALIASES[v2Event] ?? v2Event;
}

// ---------------------------------------------------------------------------
// Endpoint management
// ---------------------------------------------------------------------------

export interface WebhookEndpoint {
  readonly id: string;
  /** Without its query string: the delivery token is never returned (`redactEndpoint`). */
  readonly url: string;
  readonly enabled: boolean;
  readonly trigger_events: readonly string[];
  readonly description: string | null;
  /** Empty means every account of the application. */
  readonly account_ids: readonly string[];
  /** The provider sends a signing secret on every read; it is dropped (`redactEndpoint`). */
  readonly secret?: never;
  readonly [key: string]: unknown;
}

export interface WebhookDelivery {
  readonly id: string;
  readonly endpoint_id: string;
  readonly event_id: string;
  readonly event_type: string;
  /** False when this attempt is a retry. */
  readonly first_attempt: boolean;
  readonly created_at: string;
  /** Status our receiver answered. */
  readonly http_status: number | null;
  /** Without its query string: the delivery token is never returned (`redactDelivery`). */
  readonly endpoint_url: string;
  readonly response_body: string | null;
  readonly latency_ms: number | null;
  readonly response_time_ms: number | null;
}

export interface ListEndpointsParams {
  offset?: number;
  limit?: number;
}

export interface CreateEndpointInput {
  url: string;
  triggerEvents: readonly string[];
  /** Restricts the endpoint to these accounts. Omit for every account. */
  accountIds?: readonly string[];
  description?: string;
}

export interface PatchEndpointInput {
  /** Replaces the whole list. */
  triggerEvents?: readonly string[];
  accountIds?: readonly string[];
  url?: string;
  description?: string;
  enabled?: boolean;
}

function invalid(note: string): UnipileError {
  return new UnipileError('validation', { debug: { note } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function text(n: number | undefined): string | undefined {
  return n === undefined ? undefined : String(n);
}

function endpointId(id: string): string {
  if (typeof id !== 'string' || !/^we_[^\s/?#\\]+$/.test(id)) throw invalid('endpoint id must look like we_...');
  return id;
}

function eventId(id: string): string {
  if (typeof id !== 'string' || !/^evt_[^\s/?#\\]+$/.test(id)) throw invalid('event id must look like evt_...');
  return id;
}

function triggerEvents(events: readonly string[]): string[] {
  if (!Array.isArray(events) || events.length === 0) throw invalid('at least one trigger event is required');
  for (const event of events) {
    if (!KNOWN_SET.has(event)) throw invalid(`unknown trigger event: ${String(event)}`);
  }
  return [...new Set(events)];
}

// The URL carries the delivery token: https only, http just for a local test receiver.
const LOCAL_HTTP_RE = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;

function endpointUrl(url: string): string {
  if (typeof url !== 'string' || url.length === 0 || url.length > 255 || !(/^https:\/\//i.test(url) || LOCAL_HTTP_RE.test(url))) {
    throw invalid('url must be an https URL of at most 255 characters');
  }
  return url;
}

function endpointDescription(description: string): string {
  if (typeof description !== 'string' || description.length > 255) throw invalid('description must be at most 255 characters');
  return description;
}

function asEndpoint(value: unknown): WebhookEndpoint {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.url !== 'string') {
    throw new UnipileError('server', { code: 'invalid_endpoint', debug: { note: 'unreadable endpoint object', body: value } });
  }
  return value as unknown as WebhookEndpoint;
}

/** URL without its query string and fragment (the query carries the delivery token). */
export function redactWebhookUrl(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Endpoint without its delivery token (URL query) and without its signing secret. */
export function redactEndpoint(endpoint: WebhookEndpoint): WebhookEndpoint {
  const { secret: _secret, ...rest } = endpoint as WebhookEndpoint & { secret?: unknown };
  return { ...rest, url: redactWebhookUrl(endpoint.url) } as WebhookEndpoint;
}

/** Delivery attempt without the delivery token of its endpoint URL. */
export function redactDelivery(delivery: WebhookDelivery): WebhookDelivery {
  const url = (delivery as { endpoint_url?: unknown }).endpoint_url;
  return typeof url === 'string' ? { ...delivery, endpoint_url: redactWebhookUrl(url) } : delivery;
}

function redactedPage(page: Page<WebhookEndpoint>): Page<WebhookEndpoint> {
  return { ...page, items: page.items.map((item) => (isRecord(item) && typeof item.url === 'string' ? redactEndpoint(item) : item)) };
}

/** One page of endpoints (`GET /webhooks/endpoints/`). */
export async function listEndpoints(
  params: ListEndpointsParams = {},
  options: TransportOptions = {},
): Promise<Page<WebhookEndpoint>> {
  const body = await unipileJson(
    { path: '/webhooks/endpoints/', query: { offset: text(params.offset), limit: text(params.limit) } },
    options,
  );
  return redactedPage(parsePage<WebhookEndpoint>(body));
}

/** Every endpoint, following `has_more` (a single page can miss ours past 20 endpoints). */
export function listAllEndpoints(
  params: { limit?: number; maxItems?: number; maxPages?: number } = {},
  options: TransportOptions = {},
): Promise<CollectResult<WebhookEndpoint>> {
  const collected = collect<WebhookEndpoint>({
    mode: 'has_more',
    limit: params.limit,
    maxItems: params.maxItems,
    maxPages: params.maxPages,
    keyOf: (endpoint) => (isRecord(endpoint) && typeof endpoint.id === 'string' ? endpoint.id : null),
    fetchPage: (page) => unipileJson({ path: '/webhooks/endpoints/', query: page.query }, options),
  });
  return collected.then((result) => ({
    ...result,
    items: result.items.map((item) => (isRecord(item) && typeof item.url === 'string' ? redactEndpoint(item) : item)),
  }));
}

export async function getEndpoint(id: string, options: TransportOptions = {}): Promise<WebhookEndpoint> {
  return redactEndpoint(asEndpoint(await unipileJson({ path: `/webhooks/endpoints/${endpointId(id)}` }, options)));
}

/** `POST /webhooks/endpoints/`. Not retried: a second call would create a second endpoint. */
export async function createEndpoint(input: CreateEndpointInput, options: TransportOptions = {}): Promise<WebhookEndpoint> {
  const body: Record<string, unknown> = {
    trigger_events: triggerEvents(input.triggerEvents),
    url: endpointUrl(input.url),
  };
  if (input.accountIds !== undefined) body.account_ids = input.accountIds.map((id) => assertV2AccountId(id));
  if (input.description !== undefined) body.description = endpointDescription(input.description);
  return redactEndpoint(asEndpoint(await unipileJson({ method: 'POST', path: '/webhooks/endpoints/', body }, options)));
}

/**
 * `PATCH /webhooks/endpoints/{id}`: updates in place (keeps the id and the
 * secret, no gap in deliveries). At least one field is required.
 */
export async function patchEndpoint(id: string, input: PatchEndpointInput, options: TransportOptions = {}): Promise<WebhookEndpoint> {
  const body: Record<string, unknown> = {};
  if (input.triggerEvents !== undefined) body.trigger_events = triggerEvents(input.triggerEvents);
  if (input.accountIds !== undefined) body.account_ids = input.accountIds.map((acc) => assertV2AccountId(acc));
  if (input.url !== undefined) body.url = endpointUrl(input.url);
  if (input.description !== undefined) body.description = endpointDescription(input.description);
  if (input.enabled !== undefined) body.enabled = input.enabled;
  if (Object.keys(body).length === 0) throw invalid('patchEndpoint needs at least one field');
  return redactEndpoint(asEndpoint(await unipileJson({ method: 'PATCH', path: `/webhooks/endpoints/${endpointId(id)}`, body }, options)));
}

/** `DELETE /webhooks/endpoints/{id}`. Resolves to the `success` flag. */
export async function deleteEndpoint(id: string, options: TransportOptions = {}): Promise<boolean> {
  const body = await unipileDeleteJson({ path: `/webhooks/endpoints/${endpointId(id)}` }, options);
  return isRecord(body) && body.success === true;
}

/**
 * `GET /webhooks/conversations/`: delivery attempts of an endpoint, most recent
 * first. `endpoint_id` is required by the API.
 */
export async function listDeliveries(
  params: { endpointId: string; eventId?: string; accountId?: string; offset?: number; limit?: number },
  options: TransportOptions = {},
): Promise<Page<WebhookDelivery>> {
  const body = await unipileJson(
    {
      path: '/webhooks/conversations/',
      query: {
        endpoint_id: endpointId(params.endpointId),
        event_id: params.eventId === undefined ? undefined : eventId(params.eventId),
        account_id: params.accountId === undefined ? undefined : assertV2AccountId(params.accountId),
        offset: text(params.offset),
        limit: text(params.limit),
      },
    },
    options,
  );
  const page = parsePage<WebhookDelivery>(body);
  return { ...page, items: page.items.map((item) => (isRecord(item) ? redactDelivery(item) : item)) };
}

export interface EventReplay {
  eventId: string;
  endpointIds: string[];
}

/**
 * `POST /webhooks/events/{id}/replay` (202, asynchronous): queues a new delivery
 * of a stored event with its ORIGINAL id, so a receiver that deduplicates on the
 * event id ignores it unless its dedup row is removed first. `endpointId`
 * targets one original endpoint.
 */
export async function replayEvent(id: string, targetEndpointId?: string, options: TransportOptions = {}): Promise<EventReplay> {
  const body = await unipileJson(
    {
      method: 'POST',
      path: `/webhooks/events/${eventId(id)}/replay`,
      // A second replay only queues another delivery of the same evt_ id, which the receiver deduplicates.
      idempotent: true,
      query: { endpoint_id: targetEndpointId === undefined ? undefined : endpointId(targetEndpointId) },
    },
    options,
  );
  if (!isRecord(body) || typeof body.event_id !== 'string' || !Array.isArray(body.endpoint_ids)) {
    throw new UnipileError('server', { code: 'invalid_replay', debug: { note: 'unreadable replay answer', body } });
  }
  return { eventId: body.event_id, endpointIds: body.endpoint_ids.filter((e): e is string => typeof e === 'string') };
}

// ---------------------------------------------------------------------------
// Delivery authentication
// ---------------------------------------------------------------------------

/** Name of the query parameter that carries the delivery token. */
export const WEBHOOK_TOKEN_PARAM = 'v2_token';

const readEnv: EnvReader = (name) => {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
};

/**
 * Token of the delivery URL, derived from the legacy shared secret. The
 * endpoint creation accepts no header, so the token travels in the URL; it is a
 * keyed hash rather than the secret itself, which would otherwise show in
 * provider logs.
 */
export async function deriveWebhookToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('unipile-v2-webhook-endpoint'));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Expected token: the dedicated `UNIPILE_V2_WEBHOOK_TOKEN` (raw value) wins,
 * else a derivation of `UNIPILE_WEBHOOK_SECRET`. `null` when neither is set.
 */
export async function resolveWebhookToken(env: EnvReader = readEnv): Promise<string | null> {
  const dedicated = env('UNIPILE_V2_WEBHOOK_TOKEN');
  if (dedicated) return dedicated;
  const legacy = env('UNIPILE_WEBHOOK_SECRET');
  if (legacy) return await deriveWebhookToken(legacy);
  return null;
}

export type WebhookAuthResult =
  | { ok: true }
  | {
    ok: false;
    /** `not_configured`: the deployment has no token (a server fault); the others are the caller's fault. */
    reason: 'not_configured' | 'missing_token' | 'bad_token';
    /** HTTP status to answer. */
    status: 401 | 503;
  };

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Constant-time string equality (compares the SHA-256 digests, so lengths do not leak). */
async function sameToken(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

/**
 * Authenticates a delivery by its `?v2_token=` query parameter. Works with only
 * `UNIPILE_V2_WEBHOOK_TOKEN` set (no dependency on the legacy secret). Never
 * logs or returns the token.
 */
export async function verifyWebhookRequest(req: Request, env: EnvReader = readEnv): Promise<WebhookAuthResult> {
  const expected = await resolveWebhookToken(env);
  if (!expected) return { ok: false, reason: 'not_configured', status: 503 };
  let given: string | null = null;
  try {
    given = new URL(req.url).searchParams.get(WEBHOOK_TOKEN_PARAM);
  } catch {
    given = null;
  }
  if (!given) return { ok: false, reason: 'missing_token', status: 401 };
  return (await sameToken(given, expected)) ? { ok: true } : { ok: false, reason: 'bad_token', status: 401 };
}

// ---------------------------------------------------------------------------
// Event envelope (pure)
// ---------------------------------------------------------------------------

interface Attendee {
  identifier: string;
  email: string;
  display_name?: string;
}

/** `{ email, display_name }` entries as the legacy `{ identifier, display_name }` shape (both keys kept). */
function attendees(list: unknown): Attendee[] {
  if (!Array.isArray(list)) return [];
  const out: Attendee[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const email = str(entry.email) ?? str(entry.identifier);
    if (!email) continue;
    const attendee: Attendee = { identifier: email, email };
    const name = str(entry.display_name);
    if (name) attendee.display_name = name;
    out.push(attendee);
  }
  return out;
}

/** Copies payload keys that the flattening has not already set (the envelope keys win). */
function copyPayload(out: Record<string, unknown>, payload: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(payload)) if (!(key in out)) out[key] = value;
}

/**
 * Flattens a v2 envelope into the shape the receiver's handlers read. Returns
 * `null` when the body is not a v2 envelope (a body carrying `event`, or lacking
 * `type` or `payload`), so a body of the previous generation passes through
 * untouched.
 *
 * Common keys: `event` (the RAW v2 type, alias it with `handlerNameOf`),
 * `v2_event` (same, kept for deduplication), `account_id`, `account_type`
 * (provider), `event_id` (`evt_...`).
 *
 *  - `message.new`: `message_id`, `data.message` {id, chat_id, sender_id,
 *    is_sender, sender{id, name}, is_event, event_type, is_hidden, is_deleted,
 *    message_type}, `data.chat.id`. No sender or chat id at the
 *    root (it would be read as the previous generation's `message_received`).
 *  - `message.receipt.read`: `message_id`, `data.message` {id, chat_id}, `data.chat`.
 *  - `message.reaction.new`: same plus `data.reaction`, `data.reaction_reason`.
 *  - `relation.new`: `user_provider_id`, `user_full_name`,
 *    `user_public_identifier`, `user_profile_url`.
 *  - `account.add` / `account.reconnect`: `state`, `data` {name, account_type},
 *    `v1_account_id` when the payload carries `metadata.v1_account_id`.
 *  - `account.initial_sync.*`: `sync_status`, `data` {name, account_type}.
 *  - `email.new`: `email_id`, `message_id` (RFC), `thread_id`, `from_attendee`,
 *    `to_attendees`, `cc_attendees`, `bcc_attendees`, `in_reply_to` (from the
 *    headers), and the payload keys (`subject`, `body`, `body_plain`, `date`,
 *    `headers`...).
 *  - `account.status.running|degraded|partial`: the payload keys plus
 *    `account_status`, the Konekt status (`is_locked` wins, see `accountStatusOfEvent`).
 *  - anything else: the payload keys, flat, without overwriting the above.
 */
export function flattenEnvelope(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  if (raw.event || typeof raw.type !== 'string' || !isRecord(raw.payload)) return null;
  const type = raw.type;
  const p = raw.payload;
  const out: Record<string, unknown> = {
    event: type,
    v2_event: type,
    account_id: typeof raw.account_id === 'string' ? raw.account_id : '',
    account_type: typeof raw.account_provider === 'string' ? raw.account_provider : undefined,
    event_id: typeof raw.id === 'string' ? raw.id : undefined,
  };
  const accountData = { name: raw.account_name, account_type: raw.account_provider };

  switch (type) {
    case 'message.new': {
      const sender = isRecord(p.sender) ? p.sender : undefined;
      const senderId = p.sender_id ?? sender?.id;
      out.message_id = p.id;
      // « new_message » shape (data.message): is_sender is given, so the handler
      // does not need to read the participants of the conversation.
      out.data = {
        message: {
          id: p.id,
          chat_id: p.chat_id,
          sender_id: senderId,
          is_sender: p.is_sender,
          sender: { id: senderId, name: sender?.display_name },
          // A system row (missed call, pin...) or an invitation row is no written answer:
          // the reply paths filter on these with `isCandidateReplyCandidate`.
          is_event: typeof p.is_event === 'boolean' ? p.is_event : undefined,
          event_type: typeof p.event_type === 'number' ? p.event_type : undefined,
          is_hidden: typeof p.is_hidden === 'boolean' ? p.is_hidden : undefined,
          is_deleted: typeof p.is_deleted === 'boolean' ? p.is_deleted : undefined,
          message_type: isRecord(p.specifics) ? str(p.specifics.type) : undefined,
        },
        chat: { id: p.chat_id },
      };
      break;
    }
    case 'message.receipt.read': {
      const messageId = str(p.message_id) ?? str(p.id);
      const chatId = str(p.chat_id);
      out.message_id = messageId;
      out.data = { message: { id: messageId, chat_id: chatId }, chat: { id: chatId } };
      break;
    }
    case 'message.reaction.new': {
      const meta = isRecord(p.event_metadata) ? p.event_metadata : undefined;
      const sender = isRecord(p.sender) ? p.sender : undefined;
      const messageId = str(p.message_id) ?? str(meta?.message_id) ?? str(p.id);
      const chatId = str(p.chat_id);
      out.message_id = messageId;
      out.data = {
        message: {
          id: messageId,
          chat_id: chatId,
          sender_id: str(p.sender_id) ?? str(sender?.id),
          is_sender: typeof p.is_sender === 'boolean' ? p.is_sender : undefined,
        },
        chat: { id: chatId },
        reaction: str(p.reaction) ?? str(p.value) ?? str(meta?.reaction),
        reaction_reason: str(meta?.reason),
      };
      break;
    }
    case 'relation.new': {
      const user = isRecord(p.user) ? p.user : p;
      out.user_provider_id = user.id;
      out.user_full_name = user.display_name;
      out.user_public_identifier = user.public_identifier;
      out.user_profile_url = user.profile_url;
      break;
    }
    case 'account.add':
    case 'account.reconnect': {
      out.state = p.state ?? raw.state;
      out.data = accountData;
      const metadata = isRecord(p.metadata) ? p.metadata : undefined;
      const v1 = str(metadata?.v1_account_id);
      if (v1) out.v1_account_id = v1;
      break;
    }
    case 'account.initial_sync.running':
    case 'account.initial_sync.completed':
    case 'account.initial_sync.failed': {
      out.sync_status = type.slice('account.initial_sync.'.length);
      out.data = accountData;
      copyPayload(out, p);
      break;
    }
    case 'email.new': {
      out.email_id = p.id;
      const from = attendees(p.from);
      if (from.length > 0) out.from_attendee = from[0];
      out.to_attendees = attendees(p.to);
      out.cc_attendees = attendees(p.cc);
      out.bcc_attendees = attendees(p.bcc);
      const inReplyTo = inReplyToOf(p.headers);
      if (inReplyTo) out.in_reply_to = inReplyTo;
      if (str(p.thread_id)) out.thread_id = p.thread_id;
      copyPayload(out, p);
      break;
    }
    default:
      // Other events: payload content flat, without overwriting the envelope keys.
      copyPayload(out, p);
      // Status events: the status the event name and `is_locked` give together
      // (`status` stays the provider's own text).
      if (type in STATUS_BY_EVENT) out.account_status = accountStatusOfEvent(type, p.is_locked);
  }
  return out;
}

/**
 * Deduplication key of a flattened v2 event: the RAW type plus the `evt_` event
 * id. `null` when the event carries no `evt_` id (the caller falls back on its
 * own key). Never uses the aliased handler name, so `account.status.running`,
 * `degraded` and `partial`, which share one handler, stay distinct events.
 */
export function webhookDedupKey(flat: Record<string, unknown>): string | null {
  const id = flat.event_id;
  const type = flat.v2_event;
  if (typeof id !== 'string' || !id.startsWith('evt_') || typeof type !== 'string' || type === '') return null;
  return `unipile:v2:${type}:${id}`;
}
