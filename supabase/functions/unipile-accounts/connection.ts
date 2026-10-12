/**
 * Connection actions of `unipile-accounts` (backend half of the connection contract):
 *
 *   connection_capabilities, connection_start, connection_checkpoint,
 *   connection_resend, connection_status, connection_cancel
 *
 * plus the thin legacy wrappers (hosted_auth_link, connect_cookie,
 * connect_credentials, solve_checkpoint) that go through the same code.
 *
 * Rules
 *  - The identity of a connection is its `connection_attempts` row (user, organisation,
 *    provider, mode). Its uuid is the `state` sent to the provider. The browser never
 *    supplies a redirect URL, a user or an organisation: the redirect URI is built here
 *    from the APP_URL secret.
 *  - One pending attempt per (member, provider): a new start cancels the previous one.
 *  - Native credentials (password, cookie, premium cookie, mailbox password) are used
 *    for the single provider call that needs them. They are never logged, never stored
 *    (not in the attempt row, not in a notification) and never put in a response.
 *  - A provider failure becomes a French Konekt message and an `error_code` (the error
 *    kind of the shared client). The provider's own text is never returned.
 *  - Native mode is behind the CONNECTION_NATIVE_ENABLED === "1" secret; off, the
 *    answer is `feature_disabled`. Hosted mode is the default and the fallback; it needs a
 *    white-label domain (UNIPILE_HOSTED_DOMAIN), otherwise it answers `config` (the provider's
 *    own host would show its name), unless CONNECTION_ALLOW_VENDOR_HOSTED_LINK === "1" (tests).
 *  - The claim of a finished connection (native) is `claimForAttempt` of
 *    `_shared/connection-claim.ts`, the same code the webhook receiver runs for the
 *    hosted flow. Whichever runs second finds the attempt completed and does nothing.
 *
 * Every action answers with `ConnectionFailure` (rendered as `{ success: false,
 * error, error_code }`) for an expected refusal; ownership refusals are `HttpError`
 * (403) from `ownership.ts`.
 *
 * Responses (HTTP 200 unless an `HttpError` says otherwise)
 *   connection_capabilities -> { success, hosted: { available, white_label },
 *     native: { linkedin, whatsapp, imap, oauth }, products: { recruiter_exclusive_with_sales_navigator } }
 *   connection_start { provider, mode?, reconnect_account_id?, country?, timezone?, return_to?, linkedin?, whatsapp?, imap? }
 *     -> { success, attempt_id, mode, next }
 *   connection_checkpoint { attempt_id, code?, challenge?, waiting_step? } -> { success, next }
 *   connection_resend { attempt_id, challenge? } -> { success, next? }
 *   connection_status { attempt_id, waiting_step? } -> { success, status, provider, mode,
 *     account?: { id, name, status }, next?, error_code?, error?, return_to? }
 *   `return_to` ('onboarding') is set when `connection_start` was given it (or an old client's
 *   redirect URL pointed at /onboarding): the return page sends the member there afterwards.
 *   connection_cancel { attempt_id } -> { success: true }
 *   `next` is one of { kind: 'redirect', url } | { kind: 'qrcode', qrcode } |
 *     { kind: 'checkpoint', type, channel?, platform?, code?, challenges?, contracts?, products?, captcha? } |
 *     { kind: 'pending' } | { kind: 'done', account: { id, provider, name, status } }.
 *   `waiting_step` (QR_CODE | IN_APP_VALIDATION | LOADING) is the one addition to the contract: the
 *   browser names the step it is showing when nothing is to be typed, which lets the server poll the
 *   provider for it (connection_status) without ever sending an empty code to a step that expects one.
 *   `timezone` (IANA name) is forwarded to the provider at connection time (LinkedIn scheduled actions).
 *   error_code is an error kind of the shared client (auth, validation, rate_limited, server, ...) or one of
 *   feature_disabled, attempt_not_found, attempt_expired, attempt_closed, already_linked_org,
 *   already_linked_member, revoked, wrong_account, config, forbidden.
 */

import {
  type AuthIntentInput,
  type AuthStep,
  buildAuthIntentBody,
  buildHostedLinkBody,
  DEFAULT_LINKEDIN_PRODUCTS,
  errorKindOf,
  type ErrorKind,
  hostedDomain,
  isUnipileConfigured,
  isUnipileError,
  isV2AccountId,
  parseAuthStep,
  requestCheckpoint,
  resendCheckpoint,
  submitCheckpoint,
  unipileJson,
  userSafeMessage,
} from '../_shared/unipile/index.ts';
import {
  ATTEMPT_COLUMNS,
  ATTEMPT_TTL_MS,
  claimFailureNotice,
  claimForAttempt,
  closeAttempt,
  type ConnectionAttemptRow,
  type ConnectionProvider,
  effectiveAttemptStatus,
  loadAttempt,
  providerKind,
} from '../_shared/connection-claim.ts';
import {
  buildRedirectUri,
  connectionErrorMessage,
  type ConnectionNext,
  displayAccountName,
  hostedLinkAllowed,
  intentIdOf,
  isExpectedHostedLink,
  nextFromAuthStep,
  ownedKindForProvider,
  parseStartRequest,
  parseWaitingStep,
  returnTargetFromUrl,
  type StartRequest,
} from './connection-steps.ts';
import { assertAccountInOrg, assertCanManageAccount, HttpError } from './ownership.ts';

/** An expected refusal. Rendered as HTTP 200 `{ success: false, error, error_code }`. */
export class ConnectionFailure extends Error {
  errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.errorCode = errorCode;
  }
}

export interface ConnectionContext {
  // deno-lint-ignore no-explicit-any
  admin: any;
  organizationId: string;
  userId: string;
}

export const NATIVE_FLAG = 'CONNECTION_NATIVE_ENABLED';

const NATIVE_DISABLED_MESSAGE = "La connexion directe n'est pas disponible. Utilisez la connexion standard.";
const ATTEMPT_NOT_FOUND = 'Cette connexion est introuvable. Recommencez la connexion.';
const ATTEMPT_EXPIRED = 'Ce lien de connexion a expiré. Recommencez.';
const GENERIC_FAILURE = "La connexion n'a pas abouti. Réessayez. Si le problème continue, écrivez-nous.";

function vendorHostedEnv(): string | undefined {
  try {
    return Deno.env.get('CONNECTION_ALLOW_VENDOR_HOSTED_LINK');
  } catch {
    return undefined;
  }
}

/** Native screens are on only when the server flag is exactly "1". */
export function nativeEnabled(): boolean {
  try {
    return Deno.env.get(NATIVE_FLAG) === '1';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export function connectionCapabilities() {
  const native = nativeEnabled();
  let domain: string | null = null;
  try {
    domain = hostedDomain();
  } catch {
    domain = null;
  }
  return {
    success: true,
    // A hosted link on the provider's own host is refused (see `hostedLinkAllowed`), so it is not offered.
    hosted: { available: isUnipileConfigured() && hostedLinkAllowed(domain, vendorHostedEnv()), white_label: domain !== null },
    native: { linkedin: native, whatsapp: native, imap: native, oauth: native },
    products: { recruiter_exclusive_with_sales_navigator: true },
  };
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/**
 * Per-member brake on the connection actions. The credential-carrying ones (start,
 * checkpoint, resend) fail CLOSED: when the counter cannot be read, they are refused,
 * since this limit is the only brake on password and code guessing.
 */
export async function rateLimit(
  ctx: ConnectionContext,
  action: string,
  max: number,
  options: { failClosed?: boolean } = {},
): Promise<void> {
  const { data: allowed, error } = await ctx.admin.rpc('check_rate_limit', {
    p_user_id: ctx.userId, p_action: action, p_max_requests: max, p_window_seconds: 60,
  });
  if (allowed === false) throw new ConnectionFailure('rate_limited', userSafeMessage('rate_limited'));
  if (options.failClosed !== false && (error || typeof allowed !== 'boolean')) {
    console.error('[unipile-accounts] rate limit unreadable, refused:', action, (error as { code?: string } | null)?.code ?? 'no answer');
    throw new ConnectionFailure('server', userSafeMessage('server'));
  }
}

async function readAttempt(ctx: ConnectionContext, attemptId: unknown): Promise<ConnectionAttemptRow> {
  let attempt: ConnectionAttemptRow | null;
  try {
    attempt = await loadAttempt(ctx.admin, attemptId);
  } catch (error) {
    console.error('[unipile-accounts] attempt read failed:', error instanceof Error ? error.message : error);
    throw new HttpError(500, 'Impossible de lire cette connexion pour le moment');
  }
  // Another member's attempt, or another organisation's, reads as missing.
  if (!attempt || attempt.user_id !== ctx.userId || attempt.organization_id !== ctx.organizationId) {
    throw new ConnectionFailure('attempt_not_found', ATTEMPT_NOT_FOUND);
  }
  return attempt;
}

async function closeSafely(
  ctx: ConnectionContext,
  attemptId: string,
  status: 'failed' | 'expired' | 'cancelled',
  errorKind: string | null,
): Promise<void> {
  try {
    await closeAttempt(ctx.admin, attemptId, { status, errorKind });
  } catch (error) {
    console.error('[unipile-accounts] could not close the attempt:', error instanceof Error ? error.message : error);
  }
}

/** A pending attempt that ran out is closed as expired, then refused. */
async function assertOpen(ctx: ConnectionContext, attempt: ConnectionAttemptRow): Promise<void> {
  const state = effectiveAttemptStatus(attempt);
  if (state === 'pending') return;
  if (state === 'expired') {
    if (attempt.status === 'pending') await closeSafely(ctx, attempt.id, 'expired', 'attempt_expired');
    throw new ConnectionFailure('attempt_expired', ATTEMPT_EXPIRED);
  }
  throw new ConnectionFailure(
    'attempt_closed',
    state === 'completed' ? 'Cette connexion est déjà terminée.' : 'Cette connexion est terminée. Recommencez.',
  );
}

async function setIntent(ctx: ConnectionContext, attemptId: string, intentId: string | null): Promise<void> {
  if (!intentId) return;
  const { error } = await ctx.admin.from('connection_attempts')
    .update({ intent_id: intentId }).eq('id', attemptId).eq('status', 'pending');
  if (error) console.error('[unipile-accounts] could not store the intent id:', error.code ?? 'unknown');
}

// ---------------------------------------------------------------------------
// Provider calls (credentials-carrying bodies are never logged)
// ---------------------------------------------------------------------------

/** `POST /auth/intent` with extra config the shared builder does not carry yet (country of the proxy). */
async function postIntent(input: AuthIntentInput, extraConfig: Record<string, unknown> | null): Promise<AuthStep> {
  const body = buildAuthIntentBody(input);
  if (extraConfig) body.config = { ...(typeof body.config === 'object' && body.config ? body.config : {}), ...extraConfig };
  return parseAuthStep(await unipileJson({ method: 'POST', path: '/auth/intent', body, heavy: true }));
}

function buildIntentInput(req: StartRequest, attempt: ConnectionAttemptRow, redirectUri: string): AuthIntentInput {
  const tail = {
    state: attempt.id,
    ...(attempt.purpose === 'reconnect' && attempt.reconnect_account_id ? { accountId: attempt.reconnect_account_id } : {}),
  };
  switch (req.provider) {
    case 'linkedin': {
      const lk = req.linkedin!;
      const products = lk.products ?? (attempt.purpose === 'reconnect' ? undefined : [...DEFAULT_LINKEDIN_PRODUCTS]);
      const common = {
        provider: 'linkedin' as const,
        ...(req.timezone ? { userTimezone: req.timezone } : {}),
        ...(products ? { products } : {}),
        // `allow_product_selection` stays at the provider default (false): true makes every
        // authenticated connection answer a CONSENT_SCREEN checkpoint, whose answer is not
        // specified and which no Konekt screen can complete. Products are auto-selected.
        ...tail,
      };
      return lk.method === 'cookie'
        ? {
          ...common,
          credentials: {
            accessToken: lk.accessToken!,
            ...(lk.premiumAccessToken ? { premiumAccessToken: lk.premiumAccessToken } : {}),
            userAgent: lk.userAgent!,
          },
        }
        : {
          ...common,
          credentials: { username: lk.username!, password: lk.password!, ...(lk.userAgent ? { userAgent: lk.userAgent } : {}) },
        };
    }
    case 'whatsapp': {
      const wa = req.whatsapp!;
      return {
        provider: 'whatsapp',
        credentials: wa.method === 'pairing' ? { phoneNumber: wa.phoneNumber! } : { qrcode: true },
        ...tail,
      };
    }
    case 'imap': {
      const im = req.imap!;
      return {
        provider: 'imap',
        credentials: im.imap && im.smtp
          ? {
            imap: { user: im.user, password: im.password, ...im.imap },
            smtp: { user: im.user, password: im.password, ...im.smtp },
          }
          : { user: im.user, password: im.password },
        ...tail,
      };
    }
    case 'google':
    case 'outlook':
      return { provider: req.provider, oauthCallbackRedirectUri: redirectUri, ...tail };
  }
}

/**
 * `POST /auth/link`. The shared builder gives the LinkedIn products and the white-label
 * domain; the WhatsApp methods, the country options and the initial-sync wait are added
 * to its `config` here (the builder carries `config.linkedin` only).
 */
async function createHostedLinkFor(req: StartRequest, attempt: ConnectionAttemptRow, redirectUri: string): Promise<string> {
  let domain: string | null = null;
  try {
    domain = hostedDomain();
  } catch {
    domain = null;
  }
  // Before any provider call: a link on the provider's own host would show its name to the member.
  if (!hostedLinkAllowed(domain, vendorHostedEnv())) {
    console.error('[unipile-accounts] hosted connection refused: no white-label domain is configured');
    throw new ConnectionFailure('config', userSafeMessage('config'));
  }
  const reconnecting = attempt.purpose === 'reconnect' && attempt.reconnect_account_id !== null;
  const body = buildHostedLinkBody({
    redirectUri,
    expiresOn: attempt.expires_at,
    ...(reconnecting ? { accountId: attempt.reconnect_account_id! } : { providers: [req.provider] }),
    state: attempt.id,
    ...(req.provider === 'linkedin'
      ? {
        linkedin: {
          products: req.linkedin?.products ?? [...DEFAULT_LINKEDIN_PRODUCTS],
          allowProductSelection: true,
          allowMethods: ['credentials', 'cookies'] as const,
        },
      }
      : {}),
  });
  const config: Record<string, unknown> = { ...(typeof body.config === 'object' && body.config ? body.config as Record<string, unknown> : {}) };
  if (req.provider === 'linkedin') {
    const linkedin = { ...(config.linkedin as Record<string, unknown>) };
    // A reconnection keeps the products already allowed unless the member asked for others.
    if (reconnecting && !req.linkedin?.products) delete linkedin.products;
    if (req.country) linkedin.auto_proxy_config = { country: req.country };
    config.linkedin = linkedin;
    config.global = { allow_user_country_override: true };
  }
  if (req.provider === 'whatsapp') {
    config.whatsapp = { allow_methods: ['qr', 'pairing'] };
    config.global = { wait_initial_sync: true };
  }
  if (Object.keys(config).length > 0) body.config = config;

  const response = await unipileJson<{ link?: unknown }>({ method: 'POST', path: '/auth/link', body, idempotent: true });
  const link = response?.link;
  if (!isExpectedHostedLink(link, domain)) {
    console.error('[unipile-accounts] hosted link refused: host does not match the configured domain');
    throw new ConnectionFailure('server', userSafeMessage('server'));
  }
  return link as string;
}

// ---------------------------------------------------------------------------
// Completion and steps
// ---------------------------------------------------------------------------

const CLAIM_FAILURE_CODE: Record<string, string> = {
  cross_tenant: 'already_linked_org',
  other_member: 'already_linked_member',
  revoked: 'revoked',
  stop_failed: 'server',
  unsupported: 'validation',
  database: 'server',
};

const REFUSAL_CODE: Record<string, string> = {
  unknown_attempt: 'attempt_not_found',
  expired: 'attempt_expired',
  cancelled: 'attempt_closed',
  failed: 'attempt_closed',
  completed_other_account: 'attempt_closed',
  provider_mismatch: 'wrong_account',
  account_mismatch: 'wrong_account',
  invalid_account: 'wrong_account',
};

/** Links the account the provider returned. Throws `ConnectionFailure` when it cannot. */
async function completeWithAccount(ctx: ConnectionContext, attempt: ConnectionAttemptRow, step: Extract<AuthStep, { kind: 'account' }>): Promise<ConnectionNext> {
  const account = step.account;
  const outcome = await claimForAttempt(ctx.admin, {
    attemptId: attempt.id,
    account: { id: account.id, provider: account.provider, name: account.name, status: account.status, is_locked: account.is_locked },
  });
  switch (outcome.outcome) {
    case 'claimed':
    case 'replayed':
      return nextFromAuthStep(step);
    case 'failed':
      throw new ConnectionFailure(CLAIM_FAILURE_CODE[outcome.reason] ?? 'server', outcome.notice.body);
    case 'refused':
      throw new ConnectionFailure(REFUSAL_CODE[outcome.reason] ?? 'attempt_closed', outcome.notice?.body ?? GENERIC_FAILURE);
    case 'error':
      console.error('[unipile-accounts] claim could not be completed:', outcome.message);
      throw new ConnectionFailure('server', "Le compte est connecté mais n'a pas pu être rattaché. Réessayez dans un instant.");
  }
}

/** Applies an auth step to the attempt: completes it for an account, stores the intent id otherwise. */
async function settleStep(ctx: ConnectionContext, attempt: ConnectionAttemptRow, step: AuthStep): Promise<ConnectionNext> {
  if (step.kind === 'account') return await completeWithAccount(ctx, attempt, step);
  let next: ConnectionNext;
  try {
    next = nextFromAuthStep(step);
  } catch {
    await closeSafely(ctx, attempt.id, 'failed', 'server');
    throw new ConnectionFailure('server', userSafeMessage('server'));
  }
  const intentId = intentIdOf(step);
  if (intentId && intentId !== attempt.intent_id) await setIntent(ctx, attempt.id, intentId);
  return next;
}

/** Turns a provider failure of a step into a `ConnectionFailure`, closing the attempt when it can no longer go on. */
async function failFromProvider(ctx: ConnectionContext, attempt: ConnectionAttemptRow, error: unknown, phase: 'start' | 'checkpoint'): Promise<never> {
  if (error instanceof ConnectionFailure) {
    // A refusal raised while starting (for example a hosted link outside the configured
    // domain) ends the attempt; one raised later already closed it where it was decided.
    if (phase === 'start') await closeSafely(ctx, attempt.id, 'failed', error.errorCode);
    throw error;
  }
  if (error instanceof HttpError) throw error;
  const kind: ErrorKind = errorKindOf(error);
  if (isUnipileError(error)) console.error(`[unipile-accounts] connection ${phase} failed (${attempt.provider}, ${attempt.mode}):`, error.message, error.kind, error.status);
  else console.error(`[unipile-accounts] connection ${phase} failed:`, error instanceof Error ? error.name : 'unknown');
  if (phase === 'start') {
    await closeSafely(ctx, attempt.id, 'failed', kind);
  } else if (kind === 'not_found') {
    // The intent is gone at the provider: nothing left to answer.
    await closeSafely(ctx, attempt.id, 'expired', 'attempt_expired');
    throw new ConnectionFailure('attempt_expired', connectionErrorMessage('not_found', 'checkpoint'));
  } else if (kind === 'config' || kind === 'auth') {
    await closeSafely(ctx, attempt.id, 'failed', kind);
  }
  // A refused code, a rate limit or a network problem leaves the attempt open for another try.
  throw new ConnectionFailure(kind, connectionErrorMessage(kind, phase));
}

// ---------------------------------------------------------------------------
// connection_start
// ---------------------------------------------------------------------------

export interface StartedConnection {
  attempt: ConnectionAttemptRow;
  next: ConnectionNext;
}

async function resolveReconnect(ctx: ConnectionContext, req: StartRequest): Promise<{ purpose: 'link' | 'reconnect'; accountId: string | null }> {
  if (!req.reconnectAccountId) return { purpose: 'link', accountId: null };
  // Existing account only: it must be linked in this organisation, of the right kind, and managed by the caller.
  const ownership = await assertAccountInOrg(ctx.admin, ctx.organizationId, ctx.userId, req.reconnectAccountId);
  if (ownership.kind !== ownedKindForProvider(req.provider)) {
    throw new ConnectionFailure('validation', 'Ce compte ne correspond pas à cette connexion.');
  }
  await assertCanManageAccount(ctx.admin, ctx.organizationId, ctx.userId, ownership);
  if (isV2AccountId(req.reconnectAccountId)) return { purpose: 'reconnect', accountId: req.reconnectAccountId };
  // A link that still holds an outdated identifier (account not carried over) cannot be
  // refreshed in place: the member connects again and the new account replaces the link. The
  // new account is bound to whoever starts the attempt, so only the owner of the link may do it
  // (an administrator would otherwise replace their own link instead of the colleague's).
  if (ownership.userId !== ctx.userId) {
    throw new ConnectionFailure('forbidden', 'Ce compte doit être reconnecté par son propriétaire, depuis son propre accès.');
  }
  return { purpose: 'link', accountId: null };
}

async function createAttempt(ctx: ConnectionContext, req: StartRequest, purpose: 'link' | 'reconnect', reconnectId: string | null): Promise<ConnectionAttemptRow> {
  const row = {
    organization_id: ctx.organizationId,
    user_id: ctx.userId,
    provider: req.provider,
    purpose,
    reconnect_account_id: reconnectId,
    mode: req.mode,
    return_to: req.returnTo,
    expires_at: new Date(Date.now() + ATTEMPT_TTL_MS).toISOString(),
  };
  for (let tryNumber = 0; tryNumber < 2; tryNumber++) {
    // One pending attempt per member and per channel: the previous one is cancelled.
    const { error: cancelError } = await ctx.admin.from('connection_attempts')
      .update({ status: 'cancelled', completed_at: new Date().toISOString(), intent_id: null })
      .eq('user_id', ctx.userId).eq('provider', req.provider).eq('status', 'pending');
    if (cancelError) throw new HttpError(500, 'Impossible de démarrer la connexion pour le moment');
    const { data, error } = await ctx.admin.from('connection_attempts').insert(row).select(ATTEMPT_COLUMNS).single();
    if (!error && data) return data as ConnectionAttemptRow;
    // A concurrent start took the slot between the cancel and the insert: cancel again, once.
    if (error?.code !== '23505') {
      console.error('[unipile-accounts] attempt insert failed:', error?.code ?? 'unknown');
      break;
    }
  }
  throw new HttpError(500, 'Impossible de démarrer la connexion pour le moment');
}

/**
 * Starts a connection. `params` is the request body (without `action` and
 * `organization_id`). Returns the attempt and the first step.
 */
export async function startConnection(ctx: ConnectionContext, params: Record<string, unknown>): Promise<StartedConnection> {
  const parsed = parseStartRequest(params);
  if (!parsed.ok) throw new ConnectionFailure(parsed.error_code, parsed.error);
  const req = parsed.value;
  if (req.mode === 'native' && !nativeEnabled()) throw new ConnectionFailure('feature_disabled', NATIVE_DISABLED_MESSAGE);

  await rateLimit(ctx, 'connection_start', 10);
  const { purpose, accountId } = await resolveReconnect(ctx, req);
  const attempt = await createAttempt(ctx, req, purpose, accountId);
  const redirectUri = buildRedirectUri(Deno.env.get('APP_URL'));

  try {
    if (req.mode === 'hosted') {
      const url = await createHostedLinkFor(req, attempt, redirectUri);
      return { attempt, next: { kind: 'redirect', url } };
    }
    const extraConfig = req.provider === 'linkedin' && req.country ? { auto_proxy_config: { country: req.country } } : null;
    const step = await postIntent(buildIntentInput(req, attempt, redirectUri), extraConfig);
    return { attempt, next: await settleStep(ctx, attempt, step) };
  } catch (error) {
    return await failFromProvider(ctx, attempt, error, 'start');
  }
}

// ---------------------------------------------------------------------------
// connection_checkpoint, connection_resend
// ---------------------------------------------------------------------------

function assertNativeFlow(attempt: ConnectionAttemptRow): string {
  if (attempt.mode !== 'native' || !attempt.intent_id) {
    throw new ConnectionFailure('attempt_closed', 'Cette connexion ne demande pas de vérification.');
  }
  return attempt.intent_id;
}

/** Answers the current checkpoint of a native connection (a typed code, a waiting step, or a challenge choice). */
export async function checkpointConnection(ctx: ConnectionContext, params: Record<string, unknown>): Promise<ConnectionNext> {
  await rateLimit(ctx, 'connection_checkpoint', 10);
  const attempt = await readAttempt(ctx, params.attempt_id);
  await assertOpen(ctx, attempt);
  const intentId = assertNativeFlow(attempt);

  const challenge = typeof params.challenge === 'string' && params.challenge.trim() !== '' ? params.challenge.trim().slice(0, 100) : null;
  const waiting = parseWaitingStep(params.waiting_step);
  const code = typeof params.code === 'string' ? params.code.trim() : '';
  if (!challenge && !waiting && (code === '' || code.length > 128)) {
    throw new ConnectionFailure('validation', 'Saisissez le code reçu.');
  }
  try {
    const step = challenge
      ? await requestCheckpoint({ intentId, challenge })
      : await submitCheckpoint({ intentId, code, ...(waiting ? { checkpointType: waiting } : {}) });
    return await settleStep(ctx, attempt, step as AuthStep);
  } catch (error) {
    return await failFromProvider(ctx, attempt, error, 'checkpoint');
  }
}

/** Resends the code or notification of the current checkpoint, or switches the method when `challenge` is given. */
export async function resendConnection(ctx: ConnectionContext, params: Record<string, unknown>): Promise<{ next: ConnectionNext | null }> {
  await rateLimit(ctx, 'connection_resend', 6);
  const attempt = await readAttempt(ctx, params.attempt_id);
  await assertOpen(ctx, attempt);
  const intentId = assertNativeFlow(attempt);
  const challenge = typeof params.challenge === 'string' && params.challenge.trim() !== '' ? params.challenge.trim().slice(0, 100) : null;
  try {
    if (challenge) {
      const step = await requestCheckpoint({ intentId, challenge });
      return { next: await settleStep(ctx, attempt, step as AuthStep) };
    }
    await resendCheckpoint({ intentId });
    return { next: null };
  } catch (error) {
    return await failFromProvider(ctx, attempt, error, 'checkpoint');
  }
}

// ---------------------------------------------------------------------------
// connection_status, connection_cancel
// ---------------------------------------------------------------------------

interface LinkedAccountView {
  id: string;
  name: string;
  status: string;
}

async function readLinkedAccount(ctx: ConnectionContext, attempt: ConnectionAttemptRow): Promise<LinkedAccountView | null> {
  if (!attempt.account_id) return null;
  const kind = providerKind(attempt.provider);
  const spec = kind === 'linkedin'
    ? { table: 'member_linkedin_accounts', id: 'linkedin_account_id', name: 'linkedin_account_name' }
    : kind === 'whatsapp'
    ? { table: 'member_whatsapp_accounts', id: 'whatsapp_account_id', name: 'name' }
    : { table: 'member_email_accounts', id: 'email_account_id', name: 'email_address' };
  const { data } = await ctx.admin.from(spec.table)
    .select(`${spec.name}, account_status`)
    .eq(spec.id, attempt.account_id).eq('organization_id', ctx.organizationId).maybeSingle();
  const row = data as Record<string, unknown> | null;
  return {
    id: attempt.account_id,
    name: displayAccountName(row?.[spec.name], attempt.provider),
    status: typeof row?.account_status === 'string' ? row.account_status : 'OK',
  };
}

/** French text of the reason an attempt failed (the stored `error_kind`; never provider text). */
export function attemptFailureMessage(provider: ConnectionProvider, errorKind: string | null): string {
  if (!errorKind) return GENERIC_FAILURE;
  if (errorKind === 'attempt_expired') return ATTEMPT_EXPIRED;
  if (errorKind.startsWith('claim_')) return claimFailureNotice(provider, errorKind.slice(6) as never).body;
  const kinds: ErrorKind[] = ['auth', 'forbidden', 'not_found', 'rate_limited', 'validation', 'account_disconnected', 'account_degraded', 'provider_limit', 'uncertain', 'server', 'network', 'config'];
  return (kinds as string[]).includes(errorKind) ? connectionErrorMessage(errorKind as ErrorKind, 'start') : GENERIC_FAILURE;
}

/** Failures that say nothing about the attempt itself: the poll is simply tried again. */
const TRANSIENT_POLL_KINDS: readonly ErrorKind[] = ['network', 'server', 'rate_limited', 'uncertain'];

function isTransientPollError(error: unknown): boolean {
  return isUnipileError(error) && TRANSIENT_POLL_KINDS.includes(errorKindOf(error));
}

/**
 * State of an attempt. Only the attempt id is read from the request (the return
 * page query string is never trusted); ownership is checked against the caller.
 * A pending native attempt whose waiting step the browser names (`waiting_step`) is
 * polled at the provider, which is how a scanned QR code or a validated phone
 * notification completes.
 */
export async function connectionStatus(ctx: ConnectionContext, params: Record<string, unknown>) {
  let attempt = await readAttempt(ctx, params.attempt_id);
  let state = effectiveAttemptStatus(attempt);
  if (state === 'expired' && attempt.status === 'pending') {
    await closeSafely(ctx, attempt.id, 'expired', 'attempt_expired');
    attempt = { ...attempt, status: 'expired', error_kind: 'attempt_expired' };
  }

  let next: ConnectionNext | null = null;
  const waiting = parseWaitingStep(params.waiting_step);
  if (state === 'pending' && attempt.mode === 'native' && attempt.intent_id && waiting) {
    await rateLimit(ctx, 'connection_status_poll', 60, { failClosed: false });
    try {
      next = await settleStep(ctx, attempt, await submitCheckpoint({ intentId: attempt.intent_id, checkpointType: waiting }));
      if (next.kind === 'done') {
        const fresh = await loadAttempt(ctx.admin, attempt.id).catch(() => null);
        if (fresh) attempt = fresh;
        state = effectiveAttemptStatus(attempt);
      }
    } catch (error) {
      if (error instanceof ConnectionFailure || error instanceof HttpError) throw error;
      if (isTransientPollError(error)) {
        // A blip while polling a waiting step (network, server, rate limit): the attempt is still
        // pending. Answer its state and let the next poll try again.
        console.warn('[unipile-accounts] connection poll could not reach the provider:', errorKindOf(error));
      } else {
        await failFromProvider(ctx, attempt, error, 'checkpoint');
      }
    }
  }

  const response: Record<string, unknown> = { success: true, status: state, provider: attempt.provider, mode: attempt.mode };
  // Closed list set at the start by the server: the return page maps it to a path.
  if (attempt.return_to) response.return_to = attempt.return_to;
  if (state === 'completed') {
    const account = await readLinkedAccount(ctx, attempt);
    if (account) response.account = account;
  }
  if (state === 'failed' || state === 'expired') {
    response.error_code = attempt.error_kind ?? (state === 'expired' ? 'attempt_expired' : 'unknown');
    response.error = state === 'expired' ? ATTEMPT_EXPIRED : attemptFailureMessage(attempt.provider, attempt.error_kind);
  }
  if (next && next.kind !== 'done') response.next = next;
  return response;
}

/** Cancels an attempt. Idempotent: a finished attempt stays as it is. */
export async function cancelConnection(ctx: ConnectionContext, params: Record<string, unknown>): Promise<void> {
  const attempt = await readAttempt(ctx, params.attempt_id);
  if (attempt.status === 'pending') await closeSafely(ctx, attempt.id, 'cancelled', null);
}

// ---------------------------------------------------------------------------
// Legacy wrappers
// ---------------------------------------------------------------------------

const HOSTED_PROVIDERS: Record<string, ConnectionProvider> = {
  linkedin: 'linkedin', whatsapp: 'whatsapp', google: 'google', outlook: 'outlook', imap: 'imap',
};

/** `hosted_auth_link`: a hosted connection; answers `{ success, url }`. The redirect URLs sent by old clients are ignored. */
export async function legacyHostedLink(ctx: ConnectionContext, params: Record<string, unknown>): Promise<string> {
  const requested = Array.isArray(params.providers) && params.providers.length > 0 ? params.providers : ['LINKEDIN'];
  const providers = requested.map((p) => HOSTED_PROVIDERS[String(p).trim().toLowerCase()]);
  if (providers.length !== 1 || !providers[0]) {
    throw new HttpError(400, requested.some((p) => String(p).trim().toLowerCase() === 'whatsapp')
      ? 'La connexion WhatsApp doit être ouverte séparément'
      : 'Choisissez un seul compte à connecter');
  }
  const { next } = await startConnection(ctx, {
    provider: providers[0],
    mode: 'hosted',
    // The old client sends the page it wants to come back to; only a name from the closed list
    // survives (the redirect URL itself is still built by the server).
    return_to: returnTargetFromUrl(params.success_redirect_url) ?? returnTargetFromUrl(params.failure_redirect_url) ?? undefined,
    reconnect_account_id: typeof params.reconnect_account_id === 'string' && params.reconnect_account_id ? params.reconnect_account_id : undefined,
  });
  if (next.kind !== 'redirect') throw new ConnectionFailure('server', userSafeMessage('server'));
  return next.url;
}

function legacyNativeResponse(started: { attemptId: string; next: ConnectionNext }): Record<string, unknown> {
  const { attemptId, next } = started;
  if (next.kind === 'done') {
    return { success: true, object: 'Account', account_id: next.account.id, name: next.account.name, attempt_id: attemptId };
  }
  // A step still open: the legacy handle of a pending account is the attempt id.
  const type = next.kind === 'checkpoint' ? next.type : next.kind === 'pending' ? 'LOADING' : 'QR_CODE';
  return { success: true, object: 'Checkpoint', account_id: attemptId, attempt_id: attemptId, checkpoint: { type } };
}

/** `connect_cookie` / `connect_credentials`: a native LinkedIn connection in the legacy response shape. */
export async function legacyNativeLinkedIn(
  ctx: ConnectionContext,
  method: 'cookie' | 'credentials',
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!nativeEnabled()) throw new ConnectionFailure('feature_disabled', NATIVE_DISABLED_MESSAGE);
  const linkedin = method === 'cookie'
    ? { method, access_token: params.access_token, premium_access_token: params.premium_token, user_agent: params.user_agent }
    : { method, username: params.username, password: params.password, premium_access_token: params.premium_token, user_agent: params.user_agent };
  const started = await startConnection(ctx, {
    provider: 'linkedin',
    mode: 'native',
    reconnect_account_id: typeof params.reconnect_account_id === 'string' && params.reconnect_account_id ? params.reconnect_account_id : undefined,
    country: params.country,
    linkedin,
  });
  return legacyNativeResponse({ attemptId: started.attempt.id, next: started.next });
}

/** `solve_checkpoint`: `account_id` is the handle returned by the legacy start (the attempt id). */
export async function legacySolveCheckpoint(ctx: ConnectionContext, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!nativeEnabled()) throw new ConnectionFailure('feature_disabled', NATIVE_DISABLED_MESSAGE);
  const attemptId = typeof params.account_id === 'string' ? params.account_id : '';
  const next = await checkpointConnection(ctx, { attempt_id: attemptId, code: params.code });
  return legacyNativeResponse({ attemptId, next });
}

