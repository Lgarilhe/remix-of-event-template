/**
 * Error model of the shared provider client.
 *
 * The provider API publishes no error schema, so classification looks at the
 * HTTP status first and only then at tolerant probes of the body (error,
 * message, code, type, detail, nested objects). An unknown shape becomes
 * `server`; no user-facing text ever derives from the provider body.
 *
 * Vendor hygiene: `UnipileError.message` is always the neutral French text of
 * `userSafeMessage(kind)`. The raw provider body, the request path and the
 * request id live on the NON-ENUMERABLE `debug` property, meant for
 * `console.error` on the server only (see `describeForLog`).
 *
 * This module has no import so every other module of the client can use it.
 */

/** Closed list of error kinds the client can produce. */
export type ErrorKind =
  | 'auth' // the API key is refused
  | 'forbidden' // the key or the account may not do this
  | 'not_found'
  | 'rate_limited' // too many requests on the API itself
  | 'validation' // the request is invalid
  | 'account_disconnected' // the account must be reconnected
  | 'account_degraded' // account degraded, partial or locked: do not send for now
  | 'provider_limit' // a network quota or limit was hit (invitations, InMail credits...)
  | 'uncertain' // a non-idempotent call may or may not have been executed
  | 'server' // 5xx or a response that cannot be understood
  | 'network' // no usable answer (connection error, timeout) on a call that is safe to repeat
  | 'config'; // deployment misconfiguration (missing secret)

/** Server-side debugging data of an error. Never shown to a user. */
export interface UnipileErrorDebug {
  status: number | null;
  code: string | null;
  /** Raw provider body (parsed JSON or truncated text). */
  body: unknown;
  method?: string;
  /** Path relative to the API root, without the query string. */
  path?: string;
  requestId?: string | null;
  attempts?: number;
  /** Free-form note (for example the offending identifier). */
  note?: string;
}

export interface UnipileErrorInit {
  status?: number | null;
  code?: string | null;
  retryAfterMs?: number | null;
  debug?: Partial<UnipileErrorDebug>;
  cause?: unknown;
}

/**
 * Neutral French wording per kind: Konekt voice (vouvoiement), no provider
 * name, no provider text. Safe to return to the browser.
 */
export function userSafeMessage(kind: ErrorKind): string {
  switch (kind) {
    case 'auth':
      return "L'accès au service de connexion est refusé. Contactez le support Konekt si le problème persiste.";
    case 'forbidden':
      return "Cette action n'est pas autorisée pour ce compte.";
    case 'not_found':
      return "L'élément demandé est introuvable.";
    case 'rate_limited':
      return 'Trop de requêtes en peu de temps. Veuillez réessayer dans quelques instants.';
    case 'validation':
      return "La demande n'a pas pu être traitée : certaines informations sont invalides.";
    case 'account_disconnected':
      return "Le compte n'est plus connecté. Veuillez le reconnecter dans les paramètres de connexion.";
    case 'account_degraded':
      return 'Le compte est temporairement limité. Veuillez réessayer plus tard ou le reconnecter.';
    case 'provider_limit':
      return "La limite d'actions autorisée est atteinte pour le moment. Veuillez réessayer plus tard.";
    case 'uncertain':
      // Neutral on purpose: `uncertain` also covers connection and profile actions, not only sends.
      return "Le résultat de l'opération est incertain : elle a peut-être été effectuée. Vérifiez avant de réessayer, pour éviter un doublon.";
    case 'server':
      return 'Le service est momentanément indisponible. Veuillez réessayer dans quelques instants.';
    case 'network':
      return 'La connexion au service a échoué. Veuillez réessayer.';
    case 'config':
      return "La connexion n'est pas configurée sur le serveur. Contactez le support Konekt.";
  }
}

/** Error thrown by every module of the client. */
export class UnipileError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  /** Server-suggested wait before a retry, when the answer carried one. */
  readonly retryAfterMs: number | null;
  /** Server-side debugging data. Non-enumerable: absent from JSON and spreads. */
  declare readonly debug: UnipileErrorDebug;

  constructor(kind: ErrorKind, init: UnipileErrorInit = {}) {
    super(userSafeMessage(kind), init.cause === undefined ? undefined : { cause: init.cause });
    // Neutral name: String(error) and template interpolation must not carry the vendor name.
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    Object.defineProperty(this, 'debug', {
      value: {
        status: this.status,
        code: this.code,
        body: null,
        ...init.debug,
      } satisfies UnipileErrorDebug,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  /** Neutral French text, same as `message`. */
  get userMessage(): string {
    return this.message;
  }

  /** Safe serialisation: kind, neutral text and status. Never the debug data. */
  toJSON(): { kind: ErrorKind; message: string; status: number | null } {
    return { kind: this.kind, message: this.message, status: this.status };
  }
}

/** Type guard that also works across module copies (checks the shape). */
export function isUnipileError(value: unknown): value is UnipileError {
  return value instanceof UnipileError;
}

/**
 * Kind of any thrown value: the kind of a `UnipileError`, `server` for
 * anything else (an unexpected exception is never shown as a provider fault).
 */
export function errorKindOf(error: unknown): ErrorKind {
  return isUnipileError(error) ? error.kind : 'server';
}

/**
 * Neutral `{ kind, message }` of any thrown value, for a catch-all that
 * answers a caller. Never exposes the text of a foreign exception.
 */
export function safeErrorOf(error: unknown): { kind: ErrorKind; message: string } {
  const kind = errorKindOf(error);
  return { kind, message: userSafeMessage(kind) };
}

const LOG_BODY_MAX = 500;

/**
 * One-line description for `console.error` (server logs only): kind, status,
 * code, path, request id and a truncated copy of the provider body.
 */
export function describeForLog(error: unknown): string {
  if (!isUnipileError(error)) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  const d = error.debug;
  let body = '';
  if (d.body !== null && d.body !== undefined) {
    try {
      body = typeof d.body === 'string' ? d.body : JSON.stringify(d.body);
    } catch {
      body = '[unserialisable body]';
    }
    if (body.length > LOG_BODY_MAX) body = `${body.slice(0, LOG_BODY_MAX)}...`;
  }
  const parts = [
    `kind=${error.kind}`,
    `status=${d.status ?? 'none'}`,
    d.code ? `code=${d.code}` : null,
    d.method && d.path ? `${d.method} ${d.path}` : d.path ?? null,
    d.requestId ? `request_id=${d.requestId}` : null,
    d.attempts ? `attempts=${d.attempts}` : null,
    d.note ? `note=${d.note}` : null,
    body ? `body=${body}` : null,
  ].filter((p): p is string => p !== null);
  return `[unipile] ${parts.join(' ')}`;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export interface Classification {
  kind: ErrorKind;
  /** Machine code found in the body, when any (lowercased, trimmed). */
  code: string | null;
}

const PROBE_KEYS = ['error', 'message', 'code', 'type', 'detail', 'title', 'reason', 'errors'] as const;
const PROBE_MAX_DEPTH = 3;
const PROBE_MAX_STRINGS = 20;

function collectStrings(value: unknown, depth: number, out: string[]): void {
  if (out.length >= PROBE_MAX_STRINGS || depth > PROBE_MAX_DEPTH) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (typeof value === 'number') {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, depth + 1, out);
    return;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of PROBE_KEYS) {
      if (key in record) collectStrings(record[key], depth + 1, out);
    }
  }
}

/** Lowercased text of the probed body fields (string bodies are probed as is). */
export function probeText(body: unknown): string {
  const out: string[] = [];
  collectStrings(body, 0, out);
  return out.join(' | ').toLowerCase();
}

/** First machine-looking code of the body (`code`, `type` or `error` when it is a short token). */
function probeCode(body: unknown): string | null {
  const read = (value: unknown, depth: number): string | null => {
    if (!value || typeof value !== 'object' || depth > PROBE_MAX_DEPTH) return null;
    const record = value as Record<string, unknown>;
    for (const key of ['code', 'type', 'error'] as const) {
      const candidate = record[key];
      if (typeof candidate === 'string' && /^[\w./:-]{2,80}$/.test(candidate.trim())) {
        return candidate.trim().toLowerCase();
      }
    }
    for (const key of ['error', 'detail', 'errors'] as const) {
      const nested = record[key];
      const found = Array.isArray(nested) ? read(nested[0], depth + 1) : read(nested, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return read(body, 0);
}

// The haystack has its separators (_ - / .) turned into spaces, so a code such as
// `errors/login_required` reads like the sentence "login required".
const DISCONNECTED_RE =
  /disconnected|reconnect|re ?authenticat|re ?auth\b|requires? (re)?authentication|(account|session).{0,25}not connected|session (has )?(expired|invalid|revoked)|login required|credentials (have )?(expired|changed|invalid|revoked)/;
const DEGRADED_RE =
  /degraded|account (is )?locked|\blocked\b|partial(ly)? (connected|available)|product.{0,20}(errored|unavailable)/;
// `limit reached` and `too many ...` need a subject: a bare "limit exceeded" is
// also what a note or message LENGTH refusal says (a validation error, not a quota).
const PROVIDER_LIMIT_RE =
  /(daily|weekly|monthly|invitation|invite|inmail|message|search|action|provider|usage|network) ?(sending )?limit|(daily|weekly|monthly|invitation|invite|inmail|credit|quota|usage|network|provider|connection|sending|action)s?[a-z ]{0,20} limit (has been )?(reached|exceeded)|quota|too many (invitation|invite|connection)|too many messages (sent|today|this)|out of (inmail )?credits|no (inmail )?credits|inmail.{0,15}(balance|credit)/;
// A size refusal (character count, length, maximum) is a validation error even when it says "limit".
const SIZE_REFUSAL_RE = /character|\blength\b|too long|too large|max(imum)? (length|size)/;

function normalizeSeparators(text: string): string {
  return text.replace(/[_/.-]+/g, ' ');
}

/** Haystack without the generic rate limit wording, so it is not read as a provider limit. */
function withoutGenericRateLimit(text: string): string {
  return text
    .replace(/rate ?limit(ed|ing)?/g, ' ')
    .replace(/too many requests/g, ' ')
    .replace(/too many [a-z ]{0,20} per (second|minute)/g, ' ');
}

/**
 * Classifies a failed exchange. `status` is the HTTP status, or `null` when no
 * answer came back. HTTP status decides the base kind; body probes refine it
 * for the statuses where the provider reports account state in the body.
 */
export function classifyError(status: number | null, body?: unknown): Classification {
  const code = probeCode(body);
  if (status === null || status === 0) return { kind: 'network', code };

  const text = normalizeSeparators(probeText(body));
  const providerText = withoutGenericRateLimit(text);

  if (status === 401) {
    // An account-level 401 (session gone) is a reconnection, an API key 401 is not.
    if (text.includes('account') && DISCONNECTED_RE.test(text)) {
      return { kind: 'account_disconnected', code };
    }
    return { kind: 'auth', code };
  }
  if (status === 404 || status === 410) return { kind: 'not_found', code };
  if (status === 429) {
    const isQuota = PROVIDER_LIMIT_RE.test(providerText) && !SIZE_REFUSAL_RE.test(providerText);
    return { kind: isQuota ? 'provider_limit' : 'rate_limited', code };
  }
  if (status === 423) return { kind: 'account_degraded', code };

  const refine = (fallback: ErrorKind): ErrorKind => {
    if (DISCONNECTED_RE.test(text)) return 'account_disconnected';
    if (DEGRADED_RE.test(text)) return 'account_degraded';
    if (PROVIDER_LIMIT_RE.test(providerText) && !SIZE_REFUSAL_RE.test(providerText)) return 'provider_limit';
    return fallback;
  };

  if (status === 403 || status === 402) return { kind: refine('forbidden'), code };
  if (status >= 400 && status < 500) return { kind: refine('validation'), code };
  if (status >= 500) return { kind: refine('server'), code };
  // 1xx and 3xx never reach a caller as a success.
  return { kind: 'server', code };
}
