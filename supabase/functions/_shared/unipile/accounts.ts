/**
 * Accounts and connection flows of the provider API (area "accounts-auth").
 *
 *  - `GET|PATCH|DELETE /accounts/...` : list, read, update, remove.
 *  - `POST /auth/link` : hosted wizard link (new account, or reconnection).
 *  - `POST /auth/intent`, `/auth/checkpoint`, `/auth/checkpoint/request`,
 *    `/auth/checkpoint/resend` : native connection (credentials, QR code,
 *    OAuth redirect) and its checkpoints.
 *
 * Wire facts (see the accounts-auth digest)
 *  - Lists use `offset` + `limit` sent as STRINGS and answer
 *    `{ object, data, has_more }` (pagination mode `has_more`).
 *  - The trailing slash of `/accounts/` is part of the path.
 *  - A hosted link body has no `name`, no `notify_url`: the only correlation
 *    channel is `state`, echoed in the redirect and in the `account.add` /
 *    `account.reconnect` webhook payload.
 *  - `config.linkedin.products` is ALWAYS explicit when a LinkedIn link or
 *    intent is created, and never contains `company` unless the caller asks for
 *    it (the provider default would enable all four products).
 *  - `resendCheckpoint` answers 204 with no body.
 *
 * Responses are typed minimally (only what Konekt reads); everything else stays
 * `unknown`. Nothing here writes to the database.
 */

import { hostedDomain, type EnvReader } from './config.ts';
import { UnipileError } from './errors.ts';
import { unipileDeleteJson, unipileJson, unipileVoid, type TransportOptions } from './http.ts';
import { assertV2AccountId } from './ids.ts';
import { collect, parsePage, type CollectResult, type Page } from './pagination.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AccountProvider =
  | 'mock'
  | 'whatsapp'
  | 'linkedin'
  | 'google'
  | 'outlook'
  | 'imap'
  | 'telegram'
  | 'instagram';

/** Raw status word of the provider (map it with `mapAccountStatus`). */
export type ProviderAccountStatus = 'running' | 'errored' | 'disconnected' | 'degraded' | 'partial';

/** A v2 `Account`, minimal. */
export interface V2Account {
  readonly object?: string;
  readonly id: string;
  readonly user_id?: string;
  /** Display name or public identifier (mailbox address, phone number...). */
  readonly name?: string;
  readonly created_at?: string;
  readonly provider: string;
  readonly status: string;
  readonly is_locked: boolean;
  readonly metadata?: {
    /** Identifier of the account in the previous API generation, when migrated. */
    readonly v1_account_id?: string;
    readonly products_connection_status?: Record<string, string>;
    readonly custom_data?: Record<string, string>;
    readonly [key: string]: unknown;
  };
  readonly initial_sync?: { readonly status: string; readonly started_at?: string };
  readonly [key: string]: unknown;
}

export interface ListAccountsParams {
  provider?: AccountProvider;
  status?: ProviderAccountStatus;
  /** Matches `name` or `id`. */
  search?: string;
  /** A scope id, or the literal `none` for accounts without a scope. */
  accountScopeId?: string;
  offset?: number;
  limit?: number;
}

export type LinkedInProduct = 'classic' | 'recruiter' | 'sales_navigator' | 'company';

/** Products enabled by default: `company` is never part of it. */
export const DEFAULT_LINKEDIN_PRODUCTS: readonly LinkedInProduct[] = ['classic', 'recruiter', 'sales_navigator'];

const LINKEDIN_PRODUCTS: readonly LinkedInProduct[] = ['classic', 'recruiter', 'sales_navigator', 'company'];

export type HostedProviders =
  | '*'
  | '*:MESSAGING'
  | '*:EMAILS'
  | '*:CALENDAR'
  | '*:SOCIAL'
  | AccountProvider
  | readonly AccountProvider[];

export interface HostedLinkInput {
  /** Single return URL for both outcomes (success: `account_id`, `provider`, `state`; failure: `error_title`). */
  redirectUri: string;
  /** Expiry of the link. A `Date` is serialised to ISO 8601 UTC. */
  expiresOn: Date | string;
  /** New account: which providers the wizard offers. Exclusive with `accountId`. */
  providers?: HostedProviders;
  /** Reconnection of an existing account. Exclusive with `providers`. */
  accountId?: string;
  /** Echoed in the redirect and in the `account.add` / `account.reconnect` payload. */
  state?: string;
  accountScopeId?: string;
  /**
   * LinkedIn options. Sent as `config.linkedin` whenever the link can create a
   * LinkedIn account (explicit provider or wildcard) or when this is given.
   * `products` defaults to `DEFAULT_LINKEDIN_PRODUCTS` (no `company`). On a
   * reconnection without this option, nothing is sent and the provider keeps
   * the products already enabled.
   */
  linkedin?: {
    products?: readonly LinkedInProduct[];
    allowProductSelection?: boolean;
    allowMethods?: readonly ('credentials' | 'cookies')[];
  };
  /** TEST SEAM: environment reader for the white-label domain. */
  env?: EnvReader;
}

export interface HostedLink {
  link: string;
}

/** Checkpoint of a native connection. `type` is one of the documented values, other keys depend on it. */
export interface AuthCheckpoint {
  readonly type: string;
  /** OTP, OTP_OR_IN_APP_VALIDATION : EMAIL | SMS | WHATSAPP. */
  readonly channel?: string;
  /** 2FA : SMS | APP | WHATSAPP. */
  readonly platform?: string;
  /** PAIRING_CODE. */
  readonly code?: string;
  /** CAPTCHA. */
  readonly public_key?: string | null;
  readonly data?: string | null;
  /** CONTRACT_SELECTION. */
  readonly contracts?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** CONSENT_SCREEN. */
  readonly products?: ReadonlyArray<{ readonly id: string; readonly display_name: string }>;
  /** CHALLENGE_SELECTION. */
  readonly challenges?: ReadonlyArray<{ readonly id: string; readonly label: string; readonly description?: string }>;
}

/** Answer of an intent or a checkpoint call, switched on the provider `object`. */
export type AuthStep =
  | { kind: 'checkpoint'; intentId: string; checkpoint: AuthCheckpoint }
  | { kind: 'qrcode'; intentId: string; qrcode: string }
  | { kind: 'oauth_url'; url: string }
  | { kind: 'account'; account: V2Account };

export interface ImapServer {
  user: string;
  password: string;
  host: string;
  port: number;
  encryption?: 'tls' | 'ssl' | 'starttls' | 'default';
}

export type AuthIntentInput =
  & (
    | {
      provider: 'linkedin';
      credentials:
        | { username: string; password: string; userAgent?: string }
        | { accessToken: string; premiumAccessToken?: string; userAgent: string };
      userTimezone?: string;
      /** Defaults to `DEFAULT_LINKEDIN_PRODUCTS`. */
      products?: readonly LinkedInProduct[];
      allowProductSelection?: boolean;
    }
    | {
      provider: 'imap';
      credentials: { user: string; password: string } | { imap: ImapServer; smtp: ImapServer };
      initialSyncEnable?: boolean;
    }
    | {
      provider: 'whatsapp';
      /** `{ qrcode: true }` or a pairing by phone number (digits only, international, no `+`). */
      credentials: { qrcode: true } | { phoneNumber: string };
    }
    | { provider: 'mock' }
    | {
      provider: 'google' | 'outlook';
      oauthCallbackRedirectUri: string;
      loginHint?: string;
      oauthScope?: readonly string[];
    }
  )
  & {
    accountScopeId?: string;
    state?: string;
    /** Account to re-authenticate (the provider must match). */
    accountId?: string;
  };

export interface UpdateAccountInput {
  /** REPLACES `metadata.custom_data` as a whole (send the entire map). */
  metadata?: Record<string, string>;
  /** `null` removes the proxy. Restarts the account. */
  proxy?: { host: string; port: number; username?: string; password?: string; protocol?: 'https' | 'http' | 'socks5' | 'socks4' } | null;
  autoProxyCountry?: string;
  allowCountryFallback?: boolean;
  /** Permanent, requires a service key. */
  accountScopeId?: string;
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

/** Drops `undefined` entries (JSON would drop them anyway; this keeps bodies exact in tests). */
function defined(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined));
}

function accountUrl(accountId: string): string {
  return `/accounts/${encodeURIComponent(assertV2AccountId(accountId))}`;
}

function text(n: number | undefined): string | undefined {
  return n === undefined ? undefined : String(n);
}

function isoDate(value: Date | string, name: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid(`${name} is not a valid date`);
  return date.toISOString();
}

function httpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid(`${name} is not a valid URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid(`${name} must be an http(s) URL`);
  return value;
}

function productsOf(products: readonly LinkedInProduct[] | undefined): LinkedInProduct[] {
  const list = [...new Set(products ?? DEFAULT_LINKEDIN_PRODUCTS)];
  if (list.length === 0) throw invalid('at least one LinkedIn product is required');
  for (const product of list) {
    if (!LINKEDIN_PRODUCTS.includes(product)) throw invalid(`unknown LinkedIn product: ${String(product)}`);
  }
  return list;
}

function asAccount(value: unknown): V2Account {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.provider !== 'string') {
    throw new UnipileError('server', { code: 'invalid_account', debug: { note: 'unreadable account object', body: value } });
  }
  return value as unknown as V2Account;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

function listQuery(params: ListAccountsParams): Record<string, string | undefined> {
  return {
    account_scope_id: params.accountScopeId,
    status: params.status,
    provider: params.provider,
    search: params.search,
    offset: text(params.offset),
    limit: text(params.limit),
  };
}

/** One page of accounts (`GET /accounts/`), sorted by name by the provider. */
export async function listAccounts(
  params: ListAccountsParams = {},
  options: TransportOptions = {},
): Promise<Page<V2Account>> {
  const body = await unipileJson({ path: '/accounts/', query: listQuery(params) }, options);
  return parsePage<V2Account>(body);
}

/** Every account, following `has_more` within the pagination caps. */
export function listAllAccounts(
  params: Omit<ListAccountsParams, 'offset'> & { maxItems?: number; maxPages?: number } = {},
  options: TransportOptions = {},
): Promise<CollectResult<V2Account>> {
  return collect<V2Account>({
    mode: 'has_more',
    limit: params.limit,
    maxItems: params.maxItems,
    maxPages: params.maxPages,
    keyOf: (account) => (isRecord(account) && typeof account.id === 'string' ? account.id : null),
    fetchPage: (page) =>
      unipileJson({ path: '/accounts/', query: { ...listQuery(params), offset: undefined, limit: undefined, ...page.query } }, options),
  });
}

export async function getAccount(accountId: string, options: TransportOptions = {}): Promise<V2Account> {
  return asAccount(await unipileJson({ path: accountUrl(accountId) }, options));
}

/** `PATCH /accounts/{id}`. At least one field is required. */
export async function updateAccount(
  accountId: string,
  input: UpdateAccountInput,
  options: TransportOptions = {},
): Promise<V2Account> {
  if (input.metadata !== undefined) {
    for (const [key, value] of Object.entries(input.metadata)) {
      if (typeof value !== 'string') throw invalid(`metadata value of ${key} must be a string`);
    }
  }
  const body = defined({
    account_scope_id: input.accountScopeId,
    metadata: input.metadata,
    auto_proxy_country: input.autoProxyCountry,
    allow_country_fallback: input.allowCountryFallback,
    proxy: input.proxy,
  });
  if (Object.keys(body).length === 0) throw invalid('updateAccount needs at least one field');
  return asAccount(await unipileJson({ method: 'PATCH', path: accountUrl(accountId), body }, options));
}

/** `DELETE /accounts/{id}`: irreversible. Resolves to the `success` flag of the provider. */
export async function deleteAccount(accountId: string, options: TransportOptions = {}): Promise<boolean> {
  const body = await unipileDeleteJson({ path: accountUrl(accountId) }, options);
  return isRecord(body) && body.success === true;
}

// ---------------------------------------------------------------------------
// Hosted link
// ---------------------------------------------------------------------------

function includesLinkedIn(providers: HostedProviders | undefined): boolean {
  if (providers === undefined) return false;
  if (typeof providers === 'string') return providers === 'linkedin' || providers.startsWith('*');
  return providers.includes('linkedin');
}

/** Builds the `POST /auth/link` body (exported for tests and for callers that log it). */
export function buildHostedLinkBody(input: HostedLinkInput): Record<string, unknown> {
  const hasProviders = input.providers !== undefined;
  const hasAccount = input.accountId !== undefined;
  if (hasProviders === hasAccount) throw invalid('exactly one of providers and accountId is required');
  if (Array.isArray(input.providers) && input.providers.length === 0) throw invalid('providers must not be empty');

  let config: Record<string, unknown> | undefined;
  if (input.linkedin !== undefined || includesLinkedIn(input.providers)) {
    const linkedin = input.linkedin ?? {};
    config = {
      linkedin: defined({
        products: productsOf(linkedin.products),
        allow_product_selection: linkedin.allowProductSelection,
        allow_methods: linkedin.allowMethods ? [...linkedin.allowMethods] : undefined,
      }),
    };
  }

  const domain = hostedDomain(input.env);
  return defined({
    expires_on: isoDate(input.expiresOn, 'expiresOn'),
    redirect_uri: httpUrl(input.redirectUri, 'redirectUri'),
    ...(hasAccount ? { account_id: assertV2AccountId(input.accountId) } : { providers: input.providers }),
    state: input.state,
    account_scope_id: input.accountScopeId,
    domain: domain ?? undefined,
    config,
  });
}

/**
 * `POST /auth/link`. Always sends the white-label `domain` when
 * `UNIPILE_HOSTED_DOMAIN` is set. A duplicate link is harmless, so the call may
 * be retried.
 */
export async function createHostedLink(input: HostedLinkInput, options: TransportOptions = {}): Promise<HostedLink> {
  const body = buildHostedLinkBody(input);
  const response = await unipileJson({ method: 'POST', path: '/auth/link', body, idempotent: true }, options);
  if (!isRecord(response) || typeof response.link !== 'string' || response.link === '') {
    throw new UnipileError('server', { code: 'invalid_link_response', debug: { note: 'no link in the answer', body: response } });
  }
  return { link: response.link };
}

// ---------------------------------------------------------------------------
// Native connection (intent and checkpoints)
// ---------------------------------------------------------------------------

/** Reads the 4-way answer of intent and checkpoint calls. Anything else is an error, never a guess. */
export function parseAuthStep(data: unknown): AuthStep {
  if (isRecord(data)) {
    switch (data.object) {
      case 'AuthenticationCheckpoint':
        if (typeof data.intent_id === 'string' && isRecord(data.checkpoint) && typeof data.checkpoint.type === 'string') {
          return { kind: 'checkpoint', intentId: data.intent_id, checkpoint: data.checkpoint as unknown as AuthCheckpoint };
        }
        break;
      case 'AuthenticationQrCode':
        if (typeof data.intent_id === 'string' && typeof data.qrcode === 'string') {
          return { kind: 'qrcode', intentId: data.intent_id, qrcode: data.qrcode };
        }
        break;
      case 'OauthUrl':
        if (typeof data.url === 'string' && data.url !== '') return { kind: 'oauth_url', url: data.url };
        break;
      case 'Account':
        return { kind: 'account', account: asAccount(data) };
    }
  }
  throw new UnipileError('server', { code: 'invalid_auth_step', debug: { note: 'unreadable connection step', body: data } });
}

function imapServer(server: ImapServer, name: string): Record<string, unknown> {
  return defined({
    user: nonEmpty(server.user, `${name}.user`),
    password: nonEmpty(server.password, `${name}.password`),
    host: nonEmpty(server.host, `${name}.host`),
    port: server.port,
    encryption: server.encryption,
  });
}

/** Builds the `POST /auth/intent` body. */
export function buildAuthIntentBody(input: AuthIntentInput): Record<string, unknown> {
  const tail = defined({
    account_scope_id: input.accountScopeId,
    state: input.state,
    account_id: input.accountId === undefined ? undefined : assertV2AccountId(input.accountId),
  });
  switch (input.provider) {
    case 'linkedin': {
      const c = input.credentials;
      const credentials = 'accessToken' in c
        ? defined({
          access_token: nonEmpty(c.accessToken, 'accessToken'),
          premium_access_token: c.premiumAccessToken,
          user_agent: nonEmpty(c.userAgent, 'userAgent'),
        })
        : defined({
          username: nonEmpty(c.username, 'username'),
          password: nonEmpty(c.password, 'password'),
          user_agent: c.userAgent,
        });
      // A reconnection (accountId set) without explicit products keeps the products already
      // allowed: the field is omitted, not reset to the default list.
      const keepProducts = input.accountId !== undefined && input.products === undefined;
      const config = defined({
        products: keepProducts ? undefined : productsOf(input.products),
        allow_product_selection: input.allowProductSelection,
      });
      return {
        provider: 'linkedin',
        credentials,
        ...defined({ user_timezone: input.userTimezone }),
        ...(Object.keys(config).length > 0 ? { config } : {}),
        ...tail,
      };
    }
    case 'imap': {
      const c = input.credentials;
      const credentials = 'imap' in c
        ? { imap: imapServer(c.imap, 'imap'), smtp: imapServer(c.smtp, 'smtp') }
        : { user: nonEmpty(c.user, 'user'), password: nonEmpty(c.password, 'password') };
      const config = input.initialSyncEnable === undefined ? undefined : { initial_sync_enable: input.initialSyncEnable };
      return { provider: 'imap', credentials, ...defined({ config }), ...tail };
    }
    case 'whatsapp': {
      const c = input.credentials;
      if ('qrcode' in c) return { provider: 'whatsapp', credentials: { qrcode: true }, ...tail };
      if (!/^\d{6,15}$/.test(c.phoneNumber)) throw invalid('phoneNumber must be digits only, international format without +');
      return { provider: 'whatsapp', credentials: { phone_number: c.phoneNumber }, ...tail };
    }
    case 'mock':
      return { provider: 'mock', credentials: {}, ...tail };
    case 'google':
    case 'outlook': {
      const config = input.oauthScope === undefined ? undefined : { oauth_scope: [...input.oauthScope] };
      return {
        provider: input.provider,
        oauth_callback_redirect_uri: httpUrl(input.oauthCallbackRedirectUri, 'oauthCallbackRedirectUri'),
        ...defined({ login_hint: input.loginHint, config }),
        ...tail,
      };
    }
  }
}

/** `POST /auth/intent`: starts a native connection. Not retried (a credentials attempt is not repeatable). */
export async function createAuthIntent(input: AuthIntentInput, options: TransportOptions = {}): Promise<AuthStep> {
  const body = buildAuthIntentBody(input);
  return parseAuthStep(await unipileJson({ method: 'POST', path: '/auth/intent', body, heavy: true }, options));
}

/** Steps that wait for the member to act elsewhere (phone notification, QR scan, background login): no code to type. */
export type WaitingCheckpoint = 'IN_APP_VALIDATION' | 'LOADING' | 'QR_CODE';

const WAITING_CHECKPOINTS: ReadonlySet<string> = new Set<WaitingCheckpoint>(['IN_APP_VALIDATION', 'LOADING', 'QR_CODE']);

/**
 * `POST /auth/checkpoint`: solves the current checkpoint with the code the
 * member typed. For a waiting step (`checkpointType`: IN_APP_VALIDATION, LOADING,
 * or QR_CODE for a QR step) there is no code: the call polls the step and sends
 * an empty `code`. Any other step needs a non-empty code.
 */
export async function submitCheckpoint(
  input: { intentId: string; code?: string; checkpointType?: string },
  options: TransportOptions = {},
): Promise<AuthStep> {
  const waiting = input.checkpointType !== undefined && WAITING_CHECKPOINTS.has(input.checkpointType);
  const code = waiting ? (input.code ?? '') : nonEmpty(input.code, 'code');
  const body = { code, intent_id: nonEmpty(input.intentId, 'intentId') };
  return parseAuthStep(await unipileJson({ method: 'POST', path: '/auth/checkpoint', body, heavy: true }, options));
}

/** `POST /auth/checkpoint/request`: asks for another kind of checkpoint (`challenge` comes from CHALLENGE_SELECTION). */
export async function requestCheckpoint(
  input: { intentId: string; challenge?: string },
  options: TransportOptions = {},
): Promise<AuthStep> {
  const body = defined({ intent_id: nonEmpty(input.intentId, 'intentId'), challenge: input.challenge });
  return parseAuthStep(await unipileJson({ method: 'POST', path: '/auth/checkpoint/request', body }, options));
}

/** `POST /auth/checkpoint/resend`: resends the notification or code of the current checkpoint (204, no body). */
export async function resendCheckpoint(input: { intentId: string }, options: TransportOptions = {}): Promise<void> {
  await unipileVoid({ method: 'POST', path: '/auth/checkpoint/resend', body: { intent_id: nonEmpty(input.intentId, 'intentId') } }, options);
}
