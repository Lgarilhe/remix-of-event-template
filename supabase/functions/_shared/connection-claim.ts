/**
 * Claim of a connected account into the Konekt link tables, driven by a
 * `connection_attempts` row. ONE implementation shared by:
 *
 *  - `unipile-accounts` (native completion: the intent answers with an Account,
 *    or `connection_status` observes it);
 *  - `unipile-webhook` (hosted completion: `account.add` / `account.reconnect`
 *    carry `state` = the attempt id).
 *
 * The attempt row is the ONLY source of the member and the organisation. A
 * payload, a query string or an account name never names them (the v1 hosted
 * state encoded in the account name is gone).
 *
 * Entry point for the webhook receiver
 * ------------------------------------
 *   const outcome = await claimForAttempt(admin, { attemptId: state, account });
 *   switch (outcome.outcome) {
 *     case 'claimed':   // linked now (outcome.result), attempt marked completed
 *     case 'replayed':  // attempt already completed with this account: do nothing
 *     case 'refused':   // unknown, expired, cancelled, failed, mismatch: nothing written
 *     case 'failed':    // valid attempt, link refused (cross tenant, other member...):
 *                       // attempt marked failed; tell the member with outcome.notice
 *     case 'error':     // database problem: nothing decided, answer 5xx so the
 *                       // provider redelivers (the claim is idempotent)
 *   }
 *   `account` is `{ id, provider, name?, status?, is_locked? }` (a v2 `Account`, or the
 *   fields of the `account.add` payload plus `getAccount` when they are missing).
 *   For `refused` and `failed`, `insertClaimNotification(admin, ...)` posts the
 *   "Compte ... non rattaché" notification when the attempt is known
 *   (`outcome.attempt`); an unknown state has nobody to notify.
 *
 * What the claim does NOT do: it never calls the provider and never resumes
 * enrollments. The receiver resumes the enrollments paused by a disconnection
 * (`resumeEnrollmentsAfterReconnect`) on `account.add` / `account.reconnect`
 * whether the claim was done here (`replayed`) or by the receiver.
 *
 * Idempotence: claiming twice with the same attempt and the same account gives
 * the same rows. The first writer marks the attempt `completed` (conditional on
 * `status = 'pending'`); a late second caller reads `completed` with the same
 * account and returns `replayed` without touching the link tables.
 *
 * Pure parts (no I/O): `effectiveAttemptStatus`, `decideClaim`, `providerKind`,
 * `readableAccountName`, `claimFailureNotice`, `phoneFromName`.
 */

import { isV2AccountId, mapAccountStatus, normalizeEmail, type KonektAccountStatus } from './unipile/index.ts';
import { stopLinkedInAccountSending, type LinkedInSendingStopResult } from './linkedin-sending-stop.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionProvider = 'linkedin' | 'whatsapp' | 'google' | 'outlook' | 'imap';

export const CONNECTION_PROVIDERS: readonly ConnectionProvider[] = ['linkedin', 'whatsapp', 'google', 'outlook', 'imap'];

/** Pages the return page may send the member back to (stored as a name; the path lives in the front end). */
export const RETURN_TARGETS = ['onboarding'] as const;
export type ReturnTarget = typeof RETURN_TARGETS[number];

export type AttemptStatus = 'pending' | 'completed' | 'failed' | 'expired' | 'cancelled';

/** A `connection_attempts` row. */
export interface ConnectionAttemptRow {
  id: string;
  organization_id: string;
  user_id: string;
  provider: ConnectionProvider;
  purpose: 'link' | 'reconnect';
  reconnect_account_id: string | null;
  mode: 'hosted' | 'native';
  /** Where the return page sends the member afterwards (a name from a closed list, never a URL). */
  return_to?: ReturnTarget | null;
  status: AttemptStatus;
  intent_id: string | null;
  account_id: string | null;
  error_kind: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string;
}

export const ATTEMPT_COLUMNS =
  'id, organization_id, user_id, provider, purpose, reconnect_account_id, mode, return_to, status, intent_id, account_id, error_kind, created_at, completed_at, expires_at';

/** Lifetime of an attempt, also the expiry of a hosted link. */
export const ATTEMPT_TTL_MS = 30 * 60 * 1000;

/** The fields of a provider account the claim reads. */
export interface ClaimableAccount {
  id: string;
  provider: string;
  name?: string | null;
  status?: string | null;
  is_locked?: boolean | null;
}

/** Which link table an account goes to. */
export type ClaimKind = 'linkedin' | 'email' | 'whatsapp';

/** The slice of a supabase-js client the claim uses (a service-role client satisfies it). */
export interface ClaimAdmin {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a well-formed attempt id (the `state` of a callback is untrusted text). */
export function isAttemptId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Status of an attempt as the world must read it: a `pending` attempt past its
 * expiry is `expired` (the cleanup job only closes it later). An unreadable
 * expiry reads as expired: a doubt never keeps an attempt open.
 */
export function effectiveAttemptStatus(
  attempt: Pick<ConnectionAttemptRow, 'status' | 'expires_at'>,
  now: Date = new Date(),
): AttemptStatus {
  if (attempt.status !== 'pending') return attempt.status;
  const expiresMs = Date.parse(attempt.expires_at);
  return Number.isFinite(expiresMs) && expiresMs > now.getTime() ? 'pending' : 'expired';
}

/** Link table of a provider, or `null` for a provider Konekt does not link. */
export function providerKind(provider: unknown): ClaimKind | null {
  switch (provider) {
    case 'linkedin':
      return 'linkedin';
    case 'whatsapp':
      return 'whatsapp';
    case 'google':
    case 'outlook':
    case 'imap':
      return 'email';
    default:
      return null;
  }
}

export type ClaimRefusal =
  | 'unknown_attempt'
  | 'expired'
  | 'cancelled'
  | 'failed'
  | 'completed_other_account'
  | 'provider_mismatch'
  | 'account_mismatch'
  | 'invalid_account';

export type ClaimDecision =
  | { action: 'claim' }
  | { action: 'replay' }
  | { action: 'refuse'; reason: ClaimRefusal };

/**
 * What to do with an account announced for an attempt. No I/O.
 *  - no attempt: refuse;
 *  - `completed` with this account: replay (idempotent no-op); with another one: refuse;
 *  - `pending` and not expired: claim, if the provider matches the attempt and, for a
 *    reconnection, the account is the one to reconnect;
 *  - anything else: refuse.
 */
export function decideClaim(
  attempt: ConnectionAttemptRow | null,
  account: ClaimableAccount,
  now: Date = new Date(),
): ClaimDecision {
  if (!attempt) return { action: 'refuse', reason: 'unknown_attempt' };
  if (typeof account?.id !== 'string' || !isV2AccountId(account.id)) return { action: 'refuse', reason: 'invalid_account' };
  const status = effectiveAttemptStatus(attempt, now);
  if (status === 'completed') {
    return attempt.account_id === account.id ? { action: 'replay' } : { action: 'refuse', reason: 'completed_other_account' };
  }
  if (status === 'expired') return { action: 'refuse', reason: 'expired' };
  if (status === 'cancelled') return { action: 'refuse', reason: 'cancelled' };
  if (status === 'failed') return { action: 'refuse', reason: 'failed' };
  if (attempt.provider !== account.provider) return { action: 'refuse', reason: 'provider_mismatch' };
  if (attempt.purpose === 'reconnect' && attempt.reconnect_account_id !== account.id) {
    return { action: 'refuse', reason: 'account_mismatch' };
  }
  return { action: 'claim' };
}

const STATE_IN_NAME_RE = /(^|\|)\s*(user|org|providers|expires|reconnect)\s*:|hosted_sig/i;

/**
 * A name fit to show: the previous hosted flow stored its correlation state in the
 * account name (`user:<uuid>|org:<uuid>|...`). Such a name, an empty one, or one
 * that is only an opaque id, reads as `null` (the caller shows its own fallback).
 */
export function readableAccountName(name: unknown, maxLength = 200): string | null {
  if (typeof name !== 'string') return null;
  const text = name.trim().replace(/\s+/g, ' ');
  if (text === '' || STATE_IN_NAME_RE.test(text)) return null;
  return text.slice(0, maxLength);
}

/** International phone number (`+33612345678`) found in an account name, or `null`. */
export function phoneFromName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const text = name.trim().replace(/@(?:s\.whatsapp\.net|c\.us)$/, '').replace(/[\s().-]/g, '');
  const normalized = /^\d{8,15}$/.test(text) ? `+${text}` : text;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

const LEGACY_EMAIL_PROVIDER: Record<string, string> = { google: 'GOOGLE_OAUTH', outlook: 'OUTLOOK', imap: 'MAIL' };

/** Status stored at claim time: a fresh account that reports nothing is operational. */
export function statusAtClaim(account: Pick<ClaimableAccount, 'status' | 'is_locked'>): KonektAccountStatus {
  const hasStatus = typeof account.status === 'string' && account.status.trim() !== '';
  if (!hasStatus) return account.is_locked === true ? 'LOCKED' : 'OK';
  return mapAccountStatus(account.status, account.is_locked === true);
}

export type ClaimFailure = 'cross_tenant' | 'other_member' | 'revoked' | 'stop_failed' | 'unsupported' | 'database' | 'link_gone';

export interface ClaimNotice {
  title: string;
  body: string;
}

function channelLabel(provider: unknown): string {
  const kind = providerKind(provider);
  return kind === 'whatsapp' ? 'WhatsApp' : kind === 'email' ? 'e-mail' : 'LinkedIn';
}

/** Member-facing text of a refused link (no provider name, no internal id). */
export function claimFailureNotice(provider: unknown, reason: ClaimFailure | ClaimRefusal): ClaimNotice {
  const label = channelLabel(provider);
  const title = `Compte ${label} non rattaché`;
  switch (reason) {
    case 'cross_tenant':
      return { title, body: `Ce compte ${label} est déjà rattaché à un autre espace de travail.` };
    case 'other_member':
      return { title, body: `Ce compte ${label} est déjà rattaché à un autre membre de votre organisation.` };
    case 'revoked':
      return { title, body: `Ce compte ${label} a été retiré de Konekt. Connectez-le de nouveau pour le rattacher.` };
    case 'expired':
      return { title, body: `Le compte ${label} s'est connecté après l'expiration du lien. Recommencez la connexion depuis Paramètres > Mon compte.` };
    case 'cancelled':
      return { title, body: `Le compte ${label} s'est connecté après l'annulation de la connexion. Recommencez depuis Paramètres > Mon compte.` };
    default:
      return { title, body: `Le compte ${label} est connecté mais n'a pas pu être rattaché. Réessayez depuis Paramètres > Mon compte.` };
  }
}

// ---------------------------------------------------------------------------
// Claim (database writes)
// ---------------------------------------------------------------------------

export type ClaimResult =
  | {
    ok: true;
    kind: ClaimKind;
    accountId: string;
    status: KonektAccountStatus;
    /** LinkedIn only: the account that stopped sending because this one replaced it. */
    replacedAccountId: string | null;
    stopped: LinkedInSendingStopResult | null;
  }
  | { ok: false; kind: ClaimKind | null; reason: ClaimFailure };

function code(error: unknown): string | null {
  return (error as { code?: string } | null)?.code ?? null;
}

function failure(kind: ClaimKind | null, reason: ClaimFailure, error?: unknown, where = ''): ClaimResult {
  // Server log only: the reason code and the Postgres code, never a payload.
  console.error(`[connection-claim] ${where || kind || 'claim'} refused: ${reason}`, { pg: code(error) });
  return { ok: false, kind, reason };
}

interface ClaimInput {
  organizationId: string;
  userId: string;
  /** `reconnect`: update the existing link in place instead of linking the initiator. */
  purpose?: 'link' | 'reconnect';
  account: ClaimableAccount;
  now?: Date;
}

async function claimLinkedIn(admin: ClaimAdmin, input: ClaimInput, status: KonektAccountStatus): Promise<ClaimResult> {
  const { organizationId, userId, account } = input;
  const nowIso = (input.now ?? new Date()).toISOString();
  const name = readableAccountName(account.name);

  if (input.purpose === 'reconnect') {
    // The link belongs to its owner (an administrator may start the reconnection of a
    // colleague's account): update it in place, never re-link it to the initiator.
    const { data, error } = await admin.from('member_linkedin_accounts')
      .update({ account_status: status, last_checked_at: nowIso, failure_reason: null, ...(name ? { linkedin_account_name: name } : {}) })
      .eq('linkedin_account_id', account.id).eq('organization_id', organizationId).select('id');
    if (error) return failure('linkedin', 'database', error, 'linkedin reconnect update');
    if (Array.isArray(data) && data.length > 0) {
      return { ok: true, kind: 'linkedin', accountId: account.id, status, replacedAccountId: null, stopped: null };
    }
    // The link vanished since the reconnection started. The initiator may be an administrator
    // acting for a colleague: linking the account to the initiator would replace the
    // administrator's own link. Nothing is written; the member starts a new connection.
    return failure('linkedin', 'link_gone', undefined, 'linkedin reconnect: link not found');
  }

  // Ownership first, as claim_linkedin_account does: an account already linked to another
  // organisation (trigger, 42501) or member (unique, 23505) must not freeze the sequences
  // of the previous account of this member.
  const { data: owners, error: ownersError } = await admin.from('member_linkedin_accounts')
    .select('organization_id, user_id').eq('linkedin_account_id', account.id);
  if (ownersError) return failure('linkedin', 'database', ownersError, 'linkedin owners');
  const ownerRows = (owners ?? []) as Array<{ organization_id: string; user_id: string | null }>;
  if (ownerRows.some((r) => r.organization_id !== organizationId)) return failure('linkedin', 'cross_tenant');
  if (ownerRows.some((r) => r.user_id !== userId)) return failure('linkedin', 'other_member');

  const { data: current, error: currentError } = await admin.from('member_linkedin_accounts')
    .select('linkedin_account_id').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle();
  if (currentError) return failure('linkedin', 'database', currentError, 'linkedin current link');
  const previous = typeof current?.linkedin_account_id === 'string' ? current.linkedin_account_id : '';
  const changed = previous !== '' && previous !== account.id;
  let stopped: LinkedInSendingStopResult | null = null;
  if (changed) {
    try {
      stopped = await stopLinkedInAccountSending(admin as never, { organizationId, accountId: previous });
    } catch (stopError) {
      return failure('linkedin', 'stop_failed', stopError, 'linkedin previous account stop');
    }
  }

  const { error } = await admin.from('member_linkedin_accounts').upsert({
    user_id: userId,
    organization_id: organizationId,
    linkedin_account_id: account.id,
    linkedin_account_name: name ?? 'Compte LinkedIn',
    account_status: status,
    last_checked_at: nowIso,
    failure_reason: null,
    linked_by: userId,
    // A new account on the link restarts the LinkedIn ramp-up; the same account keeps its age.
    ...(changed ? { linked_at: nowIso } : {}),
  }, { onConflict: 'user_id,organization_id' });
  if (error) {
    const pg = code(error);
    if (pg === '42501') return failure('linkedin', 'cross_tenant', error, 'linkedin upsert');
    if (pg === '23505') return failure('linkedin', 'other_member', error, 'linkedin upsert');
    return failure('linkedin', 'database', error, 'linkedin upsert');
  }
  return { ok: true, kind: 'linkedin', accountId: account.id, status, replacedAccountId: changed ? previous : null, stopped };
}

/**
 * Removes the links of the same member in the same organisation that still hold an outdated
 * (not `acc_`) identifier for the same address or number: the account that was not carried
 * over to the new service, now replaced by the one just linked. Best effort, never fails a claim.
 */
async function dropOutdatedLinks(
  admin: ClaimAdmin,
  spec: { table: string; idColumn: string; matchColumn: string },
  organizationId: string,
  userId: string,
  matchValue: string | null | undefined,
): Promise<void> {
  const wanted = typeof matchValue === 'string' ? matchValue.trim().toLowerCase() : '';
  if (!wanted) return;
  try {
    const { data, error } = await admin.from(spec.table)
      .select(`id, ${spec.idColumn}, ${spec.matchColumn}`).eq('organization_id', organizationId).eq('user_id', userId);
    if (error) throw error;
    const stale = ((data ?? []) as Array<Record<string, unknown>>)
      .filter((r) => typeof r[spec.idColumn] === 'string' && !isV2AccountId(r[spec.idColumn] as string))
      .filter((r) => String(r[spec.matchColumn] ?? '').trim().toLowerCase() === wanted)
      .map((r) => String(r.id));
    if (stale.length === 0) return;
    const { error: deleteError } = await admin.from(spec.table).delete()
      .in('id', stale).eq('organization_id', organizationId).eq('user_id', userId);
    if (deleteError) throw deleteError;
  } catch (error) {
    console.warn(`[connection-claim] outdated ${spec.table} links not removed:`, code(error));
  }
}

async function claimEmail(admin: ClaimAdmin, input: ClaimInput, status: KonektAccountStatus): Promise<ClaimResult> {
  const { organizationId, userId, account } = input;
  const { data: rows, error: lookupError } = await admin.from('member_email_accounts')
    .select('id, organization_id, user_id').eq('email_account_id', account.id);
  if (lookupError) return failure('email', 'database', lookupError, 'email lookup');
  const known = (rows ?? []) as Array<{ id: string; organization_id: string; user_id: string | null }>;
  // The provider key is global: an account id linked to another organisation is never shared.
  if (known.some((r) => r.organization_id !== organizationId)) return failure('email', 'cross_tenant');
  const existing = known.find((r) => r.organization_id === organizationId) ?? null;
  // A reconnection updates the link in place; if it vanished meanwhile nothing is linked for
  // the initiator, who may be an administrator acting for a colleague.
  if (input.purpose === 'reconnect' && !existing) return failure('email', 'link_gone', undefined, 'email reconnect: link not found');
  const reconnecting = input.purpose === 'reconnect' && existing !== null;
  if (existing && !reconnecting && existing.user_id !== userId) return failure('email', 'other_member');

  const rawName = readableAccountName(account.name);
  const address = normalizeEmail(rawName) ?? rawName;
  const row: Record<string, unknown> = {
    account_status: status,
    ...(address ? { email_address: address } : {}),
    provider: LEGACY_EMAIL_PROVIDER[account.provider] ?? String(account.provider).toUpperCase(),
  };
  const result = existing
    ? await admin.from('member_email_accounts').update(row).eq('id', existing.id)
    : await admin.from('member_email_accounts').insert({
      ...row, organization_id: organizationId, user_id: userId, email_account_id: account.id, linked_by: userId,
    });
  if (result.error) {
    const pg = code(result.error);
    return failure('email', pg === '23505' ? 'other_member' : pg === '42501' ? 'cross_tenant' : 'database', result.error, 'email write');
  }
  // A new mailbox replaces the outdated link of the same address, instead of sitting next to it.
  if (input.purpose !== 'reconnect') {
    await dropOutdatedLinks(admin, { table: 'member_email_accounts', idColumn: 'email_account_id', matchColumn: 'email_address' }, organizationId, userId, address);
  }
  return { ok: true, kind: 'email', accountId: account.id, status, replacedAccountId: null, stopped: null };
}

async function claimWhatsApp(admin: ClaimAdmin, input: ClaimInput, status: KonektAccountStatus): Promise<ClaimResult> {
  const { organizationId, userId, account } = input;
  const { data: existing, error: lookupError } = await admin.from('member_whatsapp_accounts')
    .select('id, organization_id, user_id, account_status').eq('whatsapp_account_id', account.id).maybeSingle();
  if (lookupError) return failure('whatsapp', 'database', lookupError, 'whatsapp lookup');
  if (input.purpose === 'reconnect' && !existing) return failure('whatsapp', 'link_gone', undefined, 'whatsapp reconnect: link not found');
  const reconnecting = input.purpose === 'reconnect' && existing?.organization_id === organizationId;
  if (existing && existing.organization_id !== organizationId) return failure('whatsapp', 'cross_tenant');
  if (existing && !reconnecting && existing.user_id !== userId) return failure('whatsapp', 'other_member');
  // A revoked binding stays revoked: an old id is never claimed again (disconnect keeps a tombstone).
  if (existing?.account_status === 'DELETED') return failure('whatsapp', 'revoked');

  const name = readableAccountName(account.name);
  const phone = phoneFromName(account.name);
  // The number and the name are written only when the provider gave a readable one: a
  // reconnection under a name that is not a number must not erase the number already stored
  // (sending and capture refuse a WhatsApp link without it).
  const row = {
    account_status: status,
    ...(phone ? { phone_number: phone } : {}),
    ...(name ? { name } : {}),
    updated_at: (input.now ?? new Date()).toISOString(),
  };
  const result = existing
    ? await admin.from('member_whatsapp_accounts').update(row).eq('id', existing.id)
    : await admin.from('member_whatsapp_accounts').insert({
      ...row, organization_id: organizationId, user_id: userId, whatsapp_account_id: account.id,
    });
  if (result.error) {
    const pg = code(result.error);
    return failure('whatsapp', pg === '23505' ? 'other_member' : pg === '42501' ? 'revoked' : 'database', result.error, 'whatsapp write');
  }
  if (input.purpose !== 'reconnect') {
    await dropOutdatedLinks(admin, { table: 'member_whatsapp_accounts', idColumn: 'whatsapp_account_id', matchColumn: 'phone_number' }, organizationId, userId, phone);
  }
  return { ok: true, kind: 'whatsapp', accountId: account.id, status, replacedAccountId: null, stopped: null };
}

/**
 * Writes the link of an account for a member of an organisation. Does not look at
 * any attempt (see `claimForAttempt`). The caller proved who the member and the
 * organisation are.
 */
export async function claimAccount(admin: ClaimAdmin, input: ClaimInput): Promise<ClaimResult> {
  const kind = providerKind(input.account.provider);
  if (!kind || !isV2AccountId(input.account.id)) return failure(kind, 'unsupported', undefined, 'unsupported account');
  const status = statusAtClaim(input.account);
  if (kind === 'linkedin') return await claimLinkedIn(admin, input, status);
  if (kind === 'email') return await claimEmail(admin, input, status);
  return await claimWhatsApp(admin, input, status);
}

// ---------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------

/** Reads an attempt by id. `null` when it does not exist or the id is not a uuid. Throws on a database error. */
export async function loadAttempt(admin: ClaimAdmin, attemptId: unknown): Promise<ConnectionAttemptRow | null> {
  if (!isAttemptId(attemptId)) return null;
  const { data, error } = await admin.from('connection_attempts').select(ATTEMPT_COLUMNS).eq('id', attemptId).maybeSingle();
  if (error) throw new Error(`connection_attempts read failed (${code(error) ?? 'unknown'})`);
  return (data as ConnectionAttemptRow | null) ?? null;
}

/**
 * Closes a pending attempt. Conditional on `status = 'pending'`, so the first
 * writer wins. Returns whether this call closed it.
 */
export async function closeAttempt(
  admin: ClaimAdmin,
  attemptId: string,
  patch: { status: Exclude<AttemptStatus, 'pending'>; accountId?: string | null; errorKind?: string | null; now?: Date },
): Promise<boolean> {
  const { data, error } = await admin.from('connection_attempts')
    .update({
      status: patch.status,
      account_id: patch.accountId ?? null,
      error_kind: patch.errorKind ?? null,
      completed_at: (patch.now ?? new Date()).toISOString(),
      // The intent id is a handle to an open flow: it is dropped once the flow is over.
      intent_id: null,
    })
    .eq('id', attemptId).eq('status', 'pending').select('id');
  if (error) throw new Error(`connection_attempts update failed (${code(error) ?? 'unknown'})`);
  return Array.isArray(data) && data.length > 0;
}

export type AttemptClaimOutcome =
  | { outcome: 'claimed'; attempt: ConnectionAttemptRow; result: Extract<ClaimResult, { ok: true }> }
  | { outcome: 'replayed'; attempt: ConnectionAttemptRow }
  | { outcome: 'refused'; reason: ClaimRefusal; attempt: ConnectionAttemptRow | null; notice: ClaimNotice | null }
  | { outcome: 'failed'; reason: ClaimFailure; attempt: ConnectionAttemptRow; notice: ClaimNotice }
  | { outcome: 'error'; message: string };

/**
 * Claims `account` for the attempt `attemptId` (the `state`). See the header for the
 * outcomes. Never throws: a database problem is the `error` outcome.
 */
export async function claimForAttempt(
  admin: ClaimAdmin,
  input: { attemptId: unknown; account: ClaimableAccount; now?: Date },
): Promise<AttemptClaimOutcome> {
  const now = input.now ?? new Date();
  let attempt: ConnectionAttemptRow | null;
  try {
    attempt = await loadAttempt(admin, input.attemptId);
  } catch (error) {
    return { outcome: 'error', message: error instanceof Error ? error.message : 'attempt read failed' };
  }

  const decision = decideClaim(attempt, input.account, now);
  if (decision.action === 'replay') return { outcome: 'replayed', attempt: attempt! };
  if (decision.action === 'refuse') {
    try {
      // A late completion of an attempt that ran out: close it, so it is not left pending.
      if (attempt && decision.reason === 'expired' && attempt.status === 'pending') {
        await closeAttempt(admin, attempt.id, { status: 'expired', errorKind: 'attempt_expired', now });
      }
    } catch (error) {
      console.error('[connection-claim] could not close an expired attempt:', error instanceof Error ? error.message : error);
    }
    const notice = attempt ? claimFailureNotice(attempt.provider, decision.reason) : null;
    return { outcome: 'refused', reason: decision.reason, attempt, notice };
  }

  const open = { ...attempt! };

  // The attempt is closed BEFORE the link is written: the conditional update is the lock that
  // makes the first writer win. A caller that lost (a concurrent claim, a cancel, a second
  // attempt of the member) writes nothing.
  let won: boolean;
  try {
    won = await closeAttempt(admin, open.id, { status: 'completed', accountId: input.account.id, now });
  } catch (error) {
    return { outcome: 'error', message: error instanceof Error ? error.message : 'attempt update failed' };
  }
  if (!won) {
    let latest: ConnectionAttemptRow | null;
    try {
      latest = await loadAttempt(admin, open.id);
    } catch (error) {
      return { outcome: 'error', message: error instanceof Error ? error.message : 'attempt read failed' };
    }
    const again = decideClaim(latest, input.account, now);
    if (again.action === 'replay') return { outcome: 'replayed', attempt: latest! };
    // `claim` here means it is pending again (reopened by a failed writer): let the provider redeliver.
    if (again.action === 'claim') return { outcome: 'error', message: 'attempt claimed concurrently' };
    return { outcome: 'refused', reason: again.reason, attempt: latest, notice: latest ? claimFailureNotice(latest.provider, again.reason) : null };
  }

  let result: ClaimResult;
  try {
    result = await claimAccount(admin, {
      organizationId: open.organization_id,
      userId: open.user_id,
      purpose: open.purpose,
      account: input.account,
      now,
    });
  } catch (error) {
    await reopenAttempt(admin, open, input.account.id);
    return { outcome: 'error', message: error instanceof Error ? error.message : 'link write failed' };
  }

  if (!result.ok) {
    // A database problem is retryable (the provider redelivers): the attempt is reopened.
    // A refusal is final: the attempt ends as failed.
    if (result.reason === 'database') {
      await reopenAttempt(admin, open, input.account.id);
      return { outcome: 'error', message: 'link write failed' };
    }
    await failClaimedAttempt(admin, open.id, input.account.id, `claim_${result.reason}`, now);
    return { outcome: 'failed', reason: result.reason, attempt: open, notice: claimFailureNotice(open.provider, result.reason) };
  }
  return { outcome: 'claimed', attempt: { ...open, status: 'completed', account_id: input.account.id }, result };
}

/**
 * Puts an attempt this call completed back to `pending` after a failed link write, so the
 * provider's redelivery (or the member's retry) can claim again. Conditional on the state this
 * call left it in. Never throws.
 */
async function reopenAttempt(admin: ClaimAdmin, attempt: ConnectionAttemptRow, accountId: string): Promise<void> {
  try {
    const { error } = await admin.from('connection_attempts')
      .update({ status: 'pending', account_id: null, completed_at: null, error_kind: null, intent_id: attempt.intent_id })
      .eq('id', attempt.id).eq('status', 'completed').eq('account_id', accountId);
    if (error) throw error;
  } catch (error) {
    console.error('[connection-claim] could not reopen the attempt:', code(error) ?? (error instanceof Error ? error.message : 'unknown'));
  }
}

/** Marks an attempt this call completed as failed (the link was refused). Never throws. */
async function failClaimedAttempt(admin: ClaimAdmin, attemptId: string, accountId: string, errorKind: string, now: Date): Promise<void> {
  try {
    const { error } = await admin.from('connection_attempts')
      .update({ status: 'failed', error_kind: errorKind, account_id: null, completed_at: now.toISOString() })
      .eq('id', attemptId).eq('status', 'completed').eq('account_id', accountId);
    if (error) throw error;
  } catch (error) {
    console.error('[connection-claim] could not mark the attempt failed:', code(error) ?? (error instanceof Error ? error.message : 'unknown'));
  }
}

/**
 * Posts the "Compte ... non rattaché" notification. Never throws (a notification
 * is a courtesy, not a reason to fail a webhook).
 */
export async function insertClaimNotification(
  admin: ClaimAdmin,
  input: { userId: string; organizationId: string; notice: ClaimNotice; accountId?: string | null },
): Promise<void> {
  try {
    await admin.from('notifications').insert({
      user_id: input.userId,
      organization_id: input.organizationId,
      type: 'error',
      title: input.notice.title,
      body: input.notice.body,
      link: '/settings/account/connections',
      metadata: input.accountId ? { account_id: input.accountId } : {},
    });
  } catch (error) {
    console.warn('[connection-claim] notification insert failed:', error instanceof Error ? error.message : error);
  }
}
