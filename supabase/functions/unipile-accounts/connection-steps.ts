/**
 * Pure rules of the connection actions of `unipile-accounts` (no I/O, no database,
 * no provider call), so they can be unit-tested (`connection-steps.test.ts`).
 *
 *  - `nextFromAuthStep`: the answer of an auth intent / checkpoint call as the
 *    `next` step of the Konekt contract (redirect, qrcode, checkpoint, pending, done).
 *  - `parseStartRequest`: validation of the body of `connection_start`.
 *  - error wording: French text per error kind, never the provider text.
 *  - redirect and hosted-link rules: the redirect URI is built by the server,
 *    the hosted link must come from the configured white-label host.
 *
 * Credentials (password, cookie, premium cookie) are only carried inside the value
 * returned by `parseStartRequest`; no function here logs, copies or returns them
 * into a response.
 */

import {
  type AuthStep,
  type ErrorKind,
  type LinkedInProduct,
  mapAccountStatus,
  userSafeMessage,
} from '../_shared/unipile/index.ts';
import {
  CONNECTION_PROVIDERS,
  type ConnectionProvider,
  readableAccountName,
  RETURN_TARGETS,
  type ReturnTarget,
} from '../_shared/connection-claim.ts';

// ---------------------------------------------------------------------------
// Next step
// ---------------------------------------------------------------------------

export interface NextCheckpoint {
  kind: 'checkpoint';
  /** The provider checkpoint type, verbatim (upper case). */
  type: string;
  channel?: string;
  platform?: string;
  /** PAIRING_CODE: the code to type in the phone app. */
  code?: string;
  challenges?: Array<{ id: string; label: string; description?: string }>;
  contracts?: Array<{ id: string; name: string }>;
  products?: Array<{ id: string; display_name: string }>;
  captcha?: { public_key: string | null; data: string | null };
}

export type ConnectionNext =
  | { kind: 'redirect'; url: string }
  | { kind: 'qrcode'; qrcode: string }
  | NextCheckpoint
  | { kind: 'pending' }
  | { kind: 'done'; account: { id: string; provider: string; name: string; status: string } };

/** Removes the provider name from a label that is shown to a member. */
export function scrubVendor(text: string): string {
  return text.replace(/unipile/gi, '').replace(/\s{2,}/g, ' ').trim();
}

const DEFAULT_ACCOUNT_NAME: Record<string, string> = {
  linkedin: 'Compte LinkedIn',
  whatsapp: 'Compte WhatsApp',
  google: 'Messagerie Gmail',
  outlook: 'Messagerie Outlook',
  imap: 'Messagerie',
};

/** Account name fit to show: never the encoded state of the previous hosted flow, never empty. */
export function displayAccountName(name: unknown, provider: string): string {
  return readableAccountName(name) ?? DEFAULT_ACCOUNT_NAME[provider] ?? 'Compte';
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** True for an https URL without credentials (a browser may be sent there). */
export function isSafeRedirectUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Converts the 4-way answer of an intent or checkpoint call to the `next` step.
 * `LOADING` (the login continues in the background) is `pending`; every other
 * checkpoint type is passed on verbatim, with only the fields the member needs.
 * An OAuth URL that is not https is an error, never a redirect.
 */
export function nextFromAuthStep(step: AuthStep): ConnectionNext {
  switch (step.kind) {
    case 'account':
      return {
        kind: 'done',
        account: {
          id: step.account.id,
          provider: step.account.provider,
          name: displayAccountName(step.account.name, step.account.provider),
          status: mapAccountStatus(step.account.status, step.account.is_locked === true),
        },
      };
    case 'qrcode':
      return { kind: 'qrcode', qrcode: step.qrcode };
    case 'oauth_url':
      if (!isSafeRedirectUrl(step.url)) throw new TypeError('unsafe oauth url');
      return { kind: 'redirect', url: step.url };
    case 'checkpoint': {
      const c = step.checkpoint;
      if (c.type === 'LOADING') return { kind: 'pending' };
      const next: NextCheckpoint = { kind: 'checkpoint', type: c.type };
      const channel = stringOrUndefined(c.channel);
      if (channel) next.channel = channel;
      const platform = stringOrUndefined(c.platform);
      if (platform) next.platform = platform;
      const code = stringOrUndefined(c.code);
      if (code) next.code = code;
      if (Array.isArray(c.challenges)) {
        next.challenges = c.challenges.map((ch) => ({
          id: ch.id,
          label: scrubVendor(String(ch.label ?? ch.id)),
          ...(ch.description ? { description: scrubVendor(String(ch.description)) } : {}),
        }));
      }
      if (Array.isArray(c.contracts)) {
        next.contracts = c.contracts.map((ct) => ({ id: ct.id, name: scrubVendor(String(ct.name ?? ct.id)) }));
      }
      if (Array.isArray(c.products)) {
        next.products = c.products.map((p) => ({ id: p.id, display_name: scrubVendor(String(p.display_name ?? p.id)) }));
      }
      if (c.type === 'CAPTCHA') {
        next.captcha = { public_key: c.public_key ?? null, data: c.data ?? null };
      }
      return next;
    }
  }
}

/** The intent id carried by an auth step, when it has one (account and OAuth steps have none). */
export function intentIdOf(step: AuthStep): string | null {
  return step.kind === 'checkpoint' || step.kind === 'qrcode' ? step.intentId : null;
}

/** Steps where the member waits for something to happen elsewhere: no code to type. */
export const WAITING_STEPS = ['QR_CODE', 'IN_APP_VALIDATION', 'LOADING'] as const;
export type WaitingStep = typeof WAITING_STEPS[number];

export function parseWaitingStep(value: unknown): WaitingStep | null {
  return typeof value === 'string' && (WAITING_STEPS as readonly string[]).includes(value) ? value as WaitingStep : null;
}

// ---------------------------------------------------------------------------
// Error wording
// ---------------------------------------------------------------------------

/**
 * French text of a provider failure during a connection. Never the provider text.
 * `validation` while submitting a code is a wrong code; while starting it is
 * refused information (identifier, password, cookie). The provider does not
 * document its error bodies, so a refusal that cannot be told apart keeps a
 * generic wording.
 */
export function connectionErrorMessage(kind: ErrorKind, phase: 'start' | 'checkpoint'): string {
  if (phase === 'checkpoint') {
    if (kind === 'validation') return "Ce code n'est pas valide. Vérifiez-le, puis réessayez.";
    if (kind === 'not_found') return 'La vérification a expiré. Recommencez la connexion.';
  }
  if (phase === 'start') {
    if (kind === 'validation' || kind === 'auth') {
      return "La connexion n'a pas abouti. Vérifiez vos informations, puis réessayez. Si le problème continue, écrivez-nous.";
    }
    if (kind === 'forbidden') return "Cette connexion n'est pas autorisée pour ce compte.";
  }
  return userSafeMessage(kind);
}

/** HTTP status of a provider failure that escapes an action (the body stays neutral French). */
export function httpStatusForKind(kind: ErrorKind): number {
  switch (kind) {
    case 'validation':
      return 400;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'account_disconnected':
      return 409;
    case 'rate_limited':
    case 'provider_limit':
      return 429;
    default:
      return 502;
  }
}

// ---------------------------------------------------------------------------
// Redirect and hosted link rules
// ---------------------------------------------------------------------------

/** Return page of every connection flow. */
export const CONNECTION_RETURN_PATH = '/settings/account/connections/retour';

const DEFAULT_APP_URL = 'https://konekt-app-navy.vercel.app';

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * The redirect URI of the provider, built by the server from the `APP_URL` secret.
 * A browser-supplied URL is never used. Falls back to the production origin when
 * the secret is missing or unusable (http is accepted only for a local host).
 */
export function buildRedirectUri(appUrl: string | undefined | null): string {
  let origin = DEFAULT_APP_URL;
  if (typeof appUrl === 'string' && appUrl.trim() !== '') {
    try {
      const url = new URL(appUrl.trim());
      const secure = url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHost(url.hostname));
      if (secure && !url.username && !url.password) origin = url.origin;
    } catch {
      // keep the default
    }
  }
  return `${origin}${CONNECTION_RETURN_PATH}`;
}

/**
 * True when a hosted link is acceptable: https, no credentials and, when a
 * white-label domain is configured, exactly that host. Without a configured
 * domain the provider's own host is accepted (the link is still https only).
 */
export function isExpectedHostedLink(link: unknown, domain: string | null): boolean {
  if (!isSafeRedirectUrl(link)) return false;
  if (!domain) return true;
  return new URL(link).hostname.toLowerCase() === domain.toLowerCase();
}

/**
 * A hosted page on the provider's own host shows the provider's name and wizard to the
 * member. It is therefore refused unless a white-label domain is configured, or the
 * environment says so explicitly (`CONNECTION_ALLOW_VENDOR_HOSTED_LINK` = "1": local
 * stack and end-to-end tests, never production).
 */
export function hostedLinkAllowed(domain: string | null, allowVendorHostEnv: string | undefined | null): boolean {
  return domain !== null || allowVendorHostEnv === '1';
}

/** Name of a return target from an old client's `success_redirect_url` / `failure_redirect_url`, or `null`. */
export function returnTargetFromUrl(value: unknown): ReturnTarget | null {
  if (typeof value !== 'string') return null;
  try {
    const path = new URL(value).pathname.replace(/\/+$/, '');
    return path === '/onboarding' ? 'onboarding' : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Start request
// ---------------------------------------------------------------------------

export type NativeLinkedInMethod = 'credentials' | 'cookie';

export interface ImapServerRequest {
  host: string;
  port: number;
  encryption?: 'tls' | 'ssl' | 'starttls' | 'default';
}

export interface StartRequest {
  provider: ConnectionProvider;
  mode: 'hosted' | 'native';
  reconnectAccountId: string | null;
  /** ISO 3166-1 alpha-2, upper case. */
  country: string | null;
  /** IANA time zone. */
  timezone: string | null;
  /** Page the return page sends the member back to afterwards (closed list), or `null` for the connections page. */
  returnTo: ReturnTarget | null;
  linkedin: {
    products: LinkedInProduct[] | null;
    method: NativeLinkedInMethod | null;
    username?: string;
    password?: string;
    accessToken?: string;
    premiumAccessToken?: string;
    userAgent?: string;
  } | null;
  whatsapp: { method: 'qr' | 'pairing'; phoneNumber?: string } | null;
  imap: { user: string; password: string; imap?: ImapServerRequest; smtp?: ImapServerRequest } | null;
}

export type StartParse =
  | { ok: true; value: StartRequest }
  | { ok: false; error_code: 'validation'; error: string };

const PRODUCTS: readonly LinkedInProduct[] = ['classic', 'recruiter', 'sales_navigator', 'company'];
const ENCRYPTIONS = ['tls', 'ssl', 'starttls', 'default'] as const;

function invalid(error: string): StartParse {
  return { ok: false, error_code: 'validation', error };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 512): string | undefined {
  return typeof value === 'string' && value.trim() !== '' && value.length <= max ? value.trim() : undefined;
}

/** A browser user agent: long enough, no address, a known browser family. */
export function userAgentLooksValid(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const ua = value.trim();
  const lower = ua.toLowerCase();
  return ua.length >= 20 && ua.length <= 512 && !ua.includes('@') &&
    (lower.startsWith('mozilla/') || lower.startsWith('opera/') || lower.includes('applewebkit') || lower.includes('chrome/'));
}

/** ISO 3166-1 alpha-2 code in upper case, or `null`. */
export function normalizeCountry(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
}

/** Digits only, international format without `+` (WhatsApp pairing), or `null`. */
export function pairingPhoneNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[\s().+-]/g, '');
  return /^\d{6,15}$/.test(digits) ? digits : null;
}

/** IANA zone name (`Europe/Paris`), or `null`. */
export function normalizeTimezone(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(value.trim()) && value.trim().length <= 64
    ? value.trim()
    : null;
}

function imapServer(value: unknown): ImapServerRequest | null | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = record(value);
  const host = text(raw.host, 253);
  const port = typeof raw.port === 'number' ? raw.port : Number(raw.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const encryption = raw.encryption === undefined || raw.encryption === ''
    ? undefined
    : (ENCRYPTIONS as readonly string[]).includes(String(raw.encryption))
    ? raw.encryption as ImapServerRequest['encryption']
    : null;
  if (encryption === null) return null;
  return { host, port, ...(encryption ? { encryption } : {}) };
}

/**
 * Validates the body of `connection_start`. Pure. Native credentials are read only
 * when the mode is native; in hosted mode they are dropped. The reconnect account id
 * is NOT checked here (ownership needs the database).
 */
export function parseStartRequest(params: Record<string, unknown>): StartParse {
  const provider = params.provider;
  if (typeof provider !== 'string' || !(CONNECTION_PROVIDERS as readonly string[]).includes(provider)) {
    return invalid('Choisissez le compte à connecter.');
  }
  const mode = params.mode === undefined || params.mode === null || params.mode === '' ? 'hosted' : params.mode;
  if (mode !== 'hosted' && mode !== 'native') return invalid('Mode de connexion inconnu.');

  const reconnectAccountId = text(params.reconnect_account_id, 200) ?? null;
  const country = params.country === undefined || params.country === null || params.country === '' ? null : normalizeCountry(params.country);
  if (params.country !== undefined && params.country !== null && params.country !== '' && country === null) {
    return invalid('Code pays invalide (format ISO 3166-1 alpha-2 attendu, par exemple FR, US, DE).');
  }
  const timezone = normalizeTimezone(params.timezone);

  const value: StartRequest = {
    provider: provider as ConnectionProvider,
    mode,
    reconnectAccountId,
    country,
    timezone,
    returnTo: (RETURN_TARGETS as readonly unknown[]).includes(params.return_to) ? params.return_to as ReturnTarget : null,
    linkedin: null,
    whatsapp: null,
    imap: null,
  };

  const lk = record(params.linkedin);
  if (provider === 'linkedin') {
    let products: LinkedInProduct[] | null = null;
    if (lk.products !== undefined && lk.products !== null) {
      if (!Array.isArray(lk.products) || lk.products.length === 0 || lk.products.length > PRODUCTS.length) {
        return invalid('Choisissez au moins une offre LinkedIn.');
      }
      const list = [...new Set(lk.products.map(String))];
      if (!list.every((p) => (PRODUCTS as readonly string[]).includes(p))) return invalid('Offre LinkedIn inconnue.');
      products = list as LinkedInProduct[];
    }
    value.linkedin = { products, method: null };
    if (mode === 'native') {
      const method = lk.method === 'cookie' || lk.method === 'credentials'
        ? lk.method
        : text(lk.access_token) ? 'cookie' : 'credentials';
      value.linkedin.method = method;
      const userAgent = text(lk.user_agent);
      if (userAgent !== undefined && !userAgentLooksValid(userAgent)) {
        return invalid("Le User-Agent fourni n'est pas valide. Utilisez le bouton « Utiliser mon navigateur actuel ».");
      }
      if (method === 'cookie') {
        const accessToken = text(lk.access_token, 4096);
        if (!accessToken) return invalid('Cookie li_at requis.');
        if (!userAgent) {
          return invalid("Le User-Agent est requis pour la connexion par cookie. Utilisez le bouton « Utiliser mon navigateur actuel ».");
        }
        value.linkedin.accessToken = accessToken;
        value.linkedin.userAgent = userAgent;
        const premium = text(lk.premium_access_token, 4096);
        if (premium) value.linkedin.premiumAccessToken = premium;
      } else {
        const username = text(lk.username, 320);
        const password = typeof lk.password === 'string' && lk.password !== '' && lk.password.length <= 512 ? lk.password : undefined;
        if (!username || !password) return invalid('Identifiant et mot de passe requis.');
        value.linkedin.username = username;
        value.linkedin.password = password;
        if (userAgent) value.linkedin.userAgent = userAgent;
      }
    }
  }

  if (provider === 'whatsapp' && mode === 'native') {
    const wa = record(params.whatsapp);
    const method = wa.method === 'pairing' ? 'pairing' : 'qr';
    value.whatsapp = { method };
    if (method === 'pairing') {
      const phone = pairingPhoneNumber(wa.phone_number);
      if (!phone) return invalid("Numéro WhatsApp invalide. Saisissez-le avec l'indicatif du pays, par exemple +33 6 12 34 56 78.");
      value.whatsapp.phoneNumber = phone;
    }
  }

  if (provider === 'imap' && mode === 'native') {
    const im = record(params.imap);
    const user = text(im.user, 320);
    const password = typeof im.password === 'string' && im.password !== '' && im.password.length <= 512 ? im.password : undefined;
    if (!user || !password) return invalid('Adresse e-mail et mot de passe requis.');
    const imap = imapServer(im.imap);
    const smtp = imapServer(im.smtp);
    if (imap === null || smtp === null) return invalid('Paramètres du serveur de messagerie invalides.');
    if ((imap === undefined) !== (smtp === undefined)) {
      return invalid("Renseignez le serveur de réception et le serveur d'envoi, ou aucun des deux.");
    }
    value.imap = { user, password, ...(imap && smtp ? { imap, smtp } : {}) };
  }

  return { ok: true, value };
}

/** Link kind of the account a provider connects (matches `providerKind` of the claim helper). */
export function ownedKindForProvider(provider: ConnectionProvider): 'linkedin' | 'whatsapp' | 'email' {
  return provider === 'linkedin' ? 'linkedin' : provider === 'whatsapp' ? 'whatsapp' : 'email';
}
