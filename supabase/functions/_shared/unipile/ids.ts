/**
 * Identifiers of the provider API: accounts, messages, users, chats.
 *
 * Account ids are the hard part of the move. A v2 id looks like `acc_...`; a v1
 * id (stored in many Konekt columns) does not and is invalid in a v2 path, so
 * it is rejected at the boundary (`assertV2AccountId`). Migrated accounts carry
 * their old id in `metadata.v1_account_id`, which `buildAccountMap` indexes.
 *
 * Pure module: no network, no database.
 */

import { UnipileError } from './errors.ts';

// ---------------------------------------------------------------------------
// Account ids
// ---------------------------------------------------------------------------

// Letters, digits, `_` and `-` only: `%`, `.` and friends could smuggle an encoded
// separator (`%2F`) into a path that `accountPath` inserts as is.
const V2_ACCOUNT_ID_RE = /^acc_[A-Za-z0-9_-]+$/;

/** True for a v2 account id (`acc_` prefix, then letters, digits, `_` or `-`). */
export function isV2AccountId(value: unknown): value is string {
  return typeof value === 'string' && V2_ACCOUNT_ID_RE.test(value);
}

/**
 * Thrown for a value that is not a v2 account id. A string without the `acc_`
 * prefix is an outdated (v1) identifier: the account must be migrated or
 * reconnected. Its kind is `account_disconnected` so callers show the
 * reconnection path; a missing or non-string value is a `validation` error.
 */
export class OutdatedAccountIdError extends UnipileError {
  constructor(value: unknown) {
    const outdated = typeof value === 'string' && value.trim() !== '';
    super(outdated ? 'account_disconnected' : 'validation', {
      code: outdated ? 'outdated_account_id' : 'missing_account_id',
      debug: {
        code: outdated ? 'outdated_account_id' : 'missing_account_id',
        note: outdated
          ? `outdated account identifier (not an acc_ id): ${value}`
          : 'account identifier missing or not a string',
      },
    });
    this.name = 'OutdatedAccountIdError';
  }
}

/** Returns the id when it is a v2 account id, otherwise throws `OutdatedAccountIdError`. */
export function assertV2AccountId(value: unknown): string {
  if (!isV2AccountId(value)) throw new OutdatedAccountIdError(value);
  return value;
}

/** Index from outdated ids and mailbox addresses to v2 account ids. */
export interface AccountMap {
  /** `metadata.v1_account_id` to v2 id. */
  readonly byV1Id: ReadonlyMap<string, string>;
  /** Lowercased mailbox address to v2 id (email accounts only). */
  readonly byEmail: ReadonlyMap<string, string>;
  /** Every v2 id seen. */
  readonly v2Ids: ReadonlySet<string>;
  /** `v1_account_id` values claimed by two different v2 accounts: never resolved. */
  readonly ambiguousV1Ids: ReadonlySet<string>;
  /** Mailbox addresses claimed by two different v2 accounts: never resolved. */
  readonly ambiguousEmails: ReadonlySet<string>;
}

export interface AccountMapOptions {
  /** Extra mailbox address to v2 id pairs (for example read from `member_email_accounts`). */
  emailToV2?: Record<string, string> | ReadonlyMap<string, string>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const EMAIL_PROVIDERS = new Set(['google', 'outlook', 'imap']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercases and trims a mailbox address, or `null` when it does not look like one. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

/**
 * Builds the id map from the v2 account list (`GET /accounts`). Loaded once per
 * invocation. Accounts that are not objects or lack a v2 id are skipped.
 * Mailbox accounts (google, outlook, imap) are also indexed by their `name`
 * when it is an email address, which is how a v1 mailbox id is recovered when
 * the migration left no `v1_account_id`.
 *
 * The list comes from the global key (every tenant), so a key claimed by two
 * different accounts (a shared mailbox connected by two organisations, a
 * reconnect that left two accounts with one v1 id) is marked ambiguous and
 * resolves to nothing: the account must be reconnected. A resolved id is only
 * a candidate: the caller still proves it belongs to the organisation
 * (`assertAccountOwnedByOrg`) before any send or read.
 */
export function buildAccountMap(accounts: readonly unknown[], options: AccountMapOptions = {}): AccountMap {
  const byV1Id = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const v2Ids = new Set<string>();
  const ambiguousV1Ids = new Set<string>();
  const ambiguousEmails = new Set<string>();
  const claim = (index: Map<string, string>, ambiguous: Set<string>, key: string, id: string) => {
    const known = index.get(key);
    if (known !== undefined && known !== id) {
      index.delete(key);
      ambiguous.add(key);
    } else if (!ambiguous.has(key)) {
      index.set(key, id);
    }
  };
  for (const raw of accounts) {
    const account = asRecord(raw);
    if (!account || !isV2AccountId(account.id)) continue;
    v2Ids.add(account.id);
    const v1 = asRecord(account.metadata)?.v1_account_id;
    if (typeof v1 === 'string' && v1.trim() !== '') claim(byV1Id, ambiguousV1Ids, v1.trim(), account.id);
    if (typeof account.provider === 'string' && EMAIL_PROVIDERS.has(account.provider)) {
      const email = normalizeEmail(account.name);
      if (email) claim(byEmail, ambiguousEmails, email, account.id);
    }
  }
  const extra = options.emailToV2;
  if (extra) {
    const entries = extra instanceof Map ? [...extra.entries()] : Object.entries(extra);
    for (const [address, id] of entries) {
      const email = normalizeEmail(address);
      if (email && isV2AccountId(id)) {
        // An explicit pair (read for the organisation) settles an ambiguity of the global list.
        byEmail.set(email, id);
        ambiguousEmails.delete(email);
        v2Ids.add(id);
      }
    }
  }
  return { byV1Id, byEmail, v2Ids, ambiguousV1Ids, ambiguousEmails };
}

/**
 * Bridges a stored account id to its v2 id. Order: the value itself when it is
 * already a v2 id; the `v1_account_id` index; the mailbox address hint. Returns
 * `null` when none matches (the account is absent from v2 and must be
 * reconnected): never a guess.
 */
export function v1ToV2AccountId(
  storedId: unknown,
  map: AccountMap,
  hint: { email?: string | null } = {},
): string | null {
  if (typeof storedId !== 'string') return null;
  const id = storedId.trim();
  if (isV2AccountId(id)) return id;
  const byId = map.byV1Id.get(id);
  if (byId) return byId;
  const email = normalizeEmail(hint.email);
  if (email && !map.ambiguousEmails.has(email)) return map.byEmail.get(email) ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Builds `/{account_id}/seg1/seg2...` for account-scoped endpoints. The account
 * id is validated (`assertV2AccountId`) and every segment is URI-encoded and
 * must be non-empty, so an identifier can never inject a path separator.
 */
export function accountPath(accountId: string, ...segments: string[]): string {
  const account = assertV2AccountId(accountId);
  const parts = [account];
  for (const segment of segments) {
    if (typeof segment !== 'string' || segment === '') {
      throw new UnipileError('validation', { debug: { note: 'empty path segment' } });
    }
    parts.push(encodeURIComponent(segment));
  }
  return `/${parts.join('/')}`;
}

// ---------------------------------------------------------------------------
// Message ids
// ---------------------------------------------------------------------------

/**
 * All message ids of a send response. `message_id` is `null` (nothing sent),
 * a string, or an array of strings (a provider that sends attachments
 * separately). Non-string and empty entries are dropped, duplicates removed.
 */
export function normalizeMessageIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry === 'string' && entry.trim() !== '' && !out.includes(entry.trim())) out.push(entry.trim());
  }
  return out;
}

/** The primary message id (the first one), or `null` when no message was sent. */
export function normalizeMessageId(value: unknown): string | null {
  return normalizeMessageIds(value)[0] ?? null;
}

// ---------------------------------------------------------------------------
// User references
// ---------------------------------------------------------------------------

/** Where a user reference candidate comes from. */
export type UserRefKind = 'slug' | 'provider_id';

export interface UserRefInput {
  /** Provider id (`ACoAA...`, `AEMAA...`, or a `urn:li:...` form). */
  providerId?: string | null;
  /** Public identifier (vanity slug). */
  slug?: string | null;
  /** Profile URL (`linkedin.com/in/<slug>`, or a Sales Navigator lead URL). */
  profileUrl?: string | null;
}

export interface UserRef {
  /** Candidates for the `{user_id}` path segment, best first. At least one. */
  candidates: Array<{ kind: UserRefKind; value: string }>;
  /** The first candidate. */
  primary: string;
  slug: string | null;
  providerId: string | null;
}

export interface UserRefOptions {
  /**
   * Which form comes first. Default `slug`: whether v2 paths accept a slug is
   * not settled by the spec (contract test D1), so a slug is tried first because
   * it is what search results and profile URLs give, with the provider id as the
   * documented fallback. Pass `provider_id` for writes (relation request, follow)
   * where the spec says to use the provider id.
   */
  prefer?: UserRefKind;
}

const PROVIDER_ID_RE = /^(AC[owxyz][A-Za-z0-9_-]{6,}|AE[A-Za-z][A-Za-z0-9_-]{6,})$/;
const URN_RE = /^urn:li:(?:member|fsd_profile|fs_miniProfile|person):([A-Za-z0-9_-]+)$/;
const SAFE_REF_RE = /^[^\s/?#\\]+$/;

/** Provider id from a bare id or a URN, or `null`. */
function toProviderId(value: string): string | null {
  const v = value.trim();
  const urn = URN_RE.exec(v);
  if (urn) return urn[1];
  return PROVIDER_ID_RE.test(v) ? v : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Slug or provider id carried by a profile URL, or `null`. */
function fromProfileUrl(raw: string): { slug?: string; providerId?: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const head = parts[0]?.toLowerCase();
  if (head === 'in' && parts[1]) {
    const slug = safeDecode(parts[1]);
    const id = toProviderId(slug);
    return id ? { providerId: id } : SAFE_REF_RE.test(slug) ? { slug } : null;
  }
  if (head === 'sales' && (parts[1] === 'lead' || parts[1] === 'people') && parts[2]) {
    const id = toProviderId(safeDecode(parts[2]).split(',')[0]);
    return id ? { providerId: id } : null;
  }
  return null;
}

/**
 * Builds the reference to use as `{user_id}` of a user endpoint.
 *
 * Accepts a string (URL, provider id, URN or slug, recognised in this order) or
 * an object with the known pieces. Fallback order of the candidates:
 *  1. the slug: `slug`, else the slug extracted from `profileUrl`, else a bare
 *     string that is not an id or a URL;
 *  2. the provider id: `providerId`, else an id found in a URN, a Sales
 *     Navigator URL or a bare string shaped like one.
 * `prefer: 'provider_id'` reverses the two. Returns `null` when nothing usable
 * is present (company URLs, empty or malformed input).
 */
export function userRef(input: string | UserRefInput | null | undefined, options: UserRefOptions = {}): UserRef | null {
  const pieces: UserRefInput = typeof input === 'string' ? classifyBare(input) : { ...(input ?? {}) };
  let slug = typeof pieces.slug === 'string' ? safeDecode(pieces.slug.trim()) : null;
  let providerId = typeof pieces.providerId === 'string' ? toProviderId(pieces.providerId) : null;
  if (slug !== null) {
    // A slug field holding a provider id is a provider id; an unsafe slug is dropped.
    const asId = toProviderId(slug);
    if (asId) {
      providerId = providerId || asId;
      slug = null;
    } else if (!SAFE_REF_RE.test(slug)) {
      slug = null;
    }
  }
  if (typeof pieces.profileUrl === 'string' && pieces.profileUrl.trim() !== '') {
    const fromUrl = fromProfileUrl(pieces.profileUrl);
    if (fromUrl) {
      slug = slug || fromUrl.slug || null;
      providerId = providerId || fromUrl.providerId || null;
    }
  }
  const slugCandidate = slug ? { kind: 'slug' as const, value: slug } : null;
  const idCandidate = providerId ? { kind: 'provider_id' as const, value: providerId } : null;
  const ordered = options.prefer === 'provider_id' ? [idCandidate, slugCandidate] : [slugCandidate, idCandidate];
  const candidates = ordered.filter((c): c is { kind: UserRefKind; value: string } => c !== null);
  if (candidates.length === 0) return null;
  return { candidates, primary: candidates[0].value, slug, providerId };
}

function classifyBare(raw: string): UserRefInput {
  const value = raw.trim();
  if (value === '') return {};
  if (/linkedin\.com/i.test(value) || /^https?:\/\//i.test(value)) return { profileUrl: value };
  if (toProviderId(value)) return { providerId: value };
  return { slug: value };
}

// ---------------------------------------------------------------------------
// Chat references
// ---------------------------------------------------------------------------

/**
 * A chat has no account id of its own in v2: the pair must always travel
 * together (and be stored together, as `mission_conversations` does).
 */
export interface ChatRef {
  accountId: string;
  chatId: string;
}

/** Validates and pairs an account id with a chat id. Throws on an outdated account id or an unusable chat id. */
export function chatRef(accountId: string, chatId: unknown): ChatRef {
  const account = assertV2AccountId(accountId);
  if (typeof chatId !== 'string' || chatId.trim() === '' || /[\s/?#\\]/.test(chatId.trim())) {
    throw new UnipileError('validation', { code: 'invalid_chat_id', debug: { note: 'chat identifier missing or malformed' } });
  }
  return { accountId: account, chatId: chatId.trim() };
}

/** `/{account}/chats/{chat}/...rest` for a chat reference. */
export function chatPath(ref: ChatRef, ...rest: string[]): string {
  return accountPath(ref.accountId, 'chats', ref.chatId, ...rest);
}
