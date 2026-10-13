/**
 * The one transport of the shared provider client. No other module calls
 * `fetch` toward the provider.
 *
 * Contract
 *  - Base URL is the constant `UNIPILE_BASE_URL`; `X-API-KEY` header; JSON or
 *    FormData bodies; 204 and empty bodies give `data: null`.
 *  - Per-request timeout (15 s, 30 s with `heavy: true`, or `timeoutMs`).
 *  - Bounded retry, idempotent requests only (GET, DELETE, PUT, PATCH and a
 *    POST flagged `idempotent: true`), on network error, timeout, 429 (the
 *    `Retry-After` wait is honoured; one longer than the 5 s cap ends the retries
 *    instead of being shortened) and 502/503/504. At most 2 retries, and no
 *    retry that would start after a 10 s budget.
 *  - A non-idempotent request (message send, relation request, email send, chat
 *    start) is NEVER retried. A timeout, a network error, a 408, a 5xx or an
 *    unreadable 2xx answer on it gives `outcome: 'uncertain'`, never a success:
 *    the action may have been executed. A 429 or another 4xx is a plain refusal
 *    (`outcome: 'error'`), because the provider says nothing was done.
 *
 * `unipileFetch` never throws for an HTTP or network problem (it returns the
 * outcome); it throws `UnipileConfigError` when the API key is missing and a
 * `validation` `UnipileError` for a malformed request (programming error).
 * `unipileJson` and `unipileVoid` throw a `UnipileError` for every non-ok outcome.
 */

import { getUnipileConfig, type UnipileConfig } from './config.ts';
import { classifyError, UnipileError } from './errors.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A query value. Arrays repeat the key, `null` and `undefined` are skipped. */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<string | number | boolean>;

/** Retry limits of one request. */
export interface RetryPolicy {
  /** Retries after the first attempt (default 2). */
  maxRetries: number;
  /** No retry starts once the elapsed time plus its wait exceeds this (default 10 000 ms). */
  budgetMs: number;
  /** Longest `Retry-After` wait honoured (default 5 000 ms). A longer one ends the retries. */
  maxRetryAfterMs: number;
  /** Waits before retry 1, retry 2, after a network error, timeout or 5xx. */
  backoffMs: readonly number[];
  /** Waits before retry 1, retry 2, after a 429 without a usable `Retry-After`. */
  rateLimitBackoffMs: readonly number[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  budgetMs: 10_000,
  maxRetryAfterMs: 5_000,
  backoffMs: [500, 1_500],
  rateLimitBackoffMs: [1_000, 3_000],
};

export const DEFAULT_TIMEOUT_MS = 15_000;
export const HEAVY_TIMEOUT_MS = 30_000;

/** One request to the provider API. */
export interface UnipileRequest {
  /** Default GET. */
  method?: HttpMethod;
  /** Path relative to the API root, starting with `/`, segments already encoded (see `accountPath`). */
  path: string;
  query?: Record<string, QueryValue>;
  /** JSON body (serialised with JSON.stringify). Not allowed on GET. */
  body?: unknown;
  /** Multipart body. Mutually exclusive with `body`. */
  form?: FormData;
  /** Marks a POST as safe to repeat. Ignored for other methods (always safe). */
  idempotent?: boolean;
  /** Explicit timeout in ms. */
  timeoutMs?: number;
  /** 30 s timeout (search, large lists). Ignored when `timeoutMs` is set. */
  heavy?: boolean;
  /** Extra headers. `X-API-KEY` cannot be overridden. */
  headers?: Record<string, string>;
  /** Retry limits, or `false` for none. */
  retry?: Partial<RetryPolicy> | false;
}

export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

/** Injectable pieces of the transport (tests, or a caller that already resolved its config). */
export interface TransportOptions {
  config?: UnipileConfig;
  /** Default: global `fetch`. */
  fetchImpl?: FetchImpl;
  /** Default: `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Default: `Date.now`. */
  now?: () => number;
}

export interface TransportOk {
  outcome: 'ok';
  status: number;
  /** Parsed JSON, or `null` for 204 and empty bodies. */
  data: unknown;
  headers: Headers;
  attempts: number;
}

export interface TransportFailure {
  /** `uncertain` when a non-idempotent call may have been executed. `error` otherwise. */
  outcome: 'error' | 'uncertain';
  error: UnipileError;
  attempts: number;
}

export type TransportResult = TransportOk | TransportFailure;

// Test seam used by testing.ts only. Holds no credential of its own (a test may
// put a fake config in it). Production code never calls setTransportDefaults.
let transportDefaults: TransportOptions | null = null;

/** TEST SEAM: default options merged under the per-call options. Pass `null` to clear. */
export function setTransportDefaults(options: TransportOptions | null): void {
  transportDefaults = options;
}

/** True when the request may be repeated without risk of a duplicate effect. */
export function isIdempotentRequest(method: HttpMethod, flag?: boolean): boolean {
  return method === 'POST' ? flag === true : true;
}

/**
 * Parses a `Retry-After` header (delay in seconds or HTTP date) into
 * milliseconds. Returns `null` when absent, malformed or negative.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - nowMs);
}

function invalidRequest(note: string): UnipileError {
  return new UnipileError('validation', { debug: { note } });
}

/** Builds the absolute URL. Rejects a path that could leave the API root. */
export function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  if (!/^\/[^?#\s]*$/.test(path)) throw invalidRequest(`invalid request path: ${path}`);
  if (path.includes('//') || path.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw invalidRequest(`invalid request path: ${path}`);
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return `${baseUrl}${path}${qs ? `?${qs}` : ''}`;
}

const BODY_DEBUG_MAX = 2_000;

type AttemptResult =
  | { kind: 'response'; status: number; headers: Headers; text: string }
  | { kind: 'timeout' }
  | { kind: 'network'; cause: unknown };

async function attemptOnce(
  fetchImpl: FetchImpl,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<AttemptResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('timeout');
    }, timeoutMs);
  });
  const work = (async (): Promise<AttemptResult> => {
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = await response.text();
      return { kind: 'response', status: response.status, headers: response.headers, text };
    } catch (cause) {
      return controller.signal.aborted ? { kind: 'timeout' } : { kind: 'network', cause };
    }
  })();
  try {
    const result = await Promise.race([work, timeout]);
    return result === 'timeout' ? { kind: 'timeout' } : result;
  } finally {
    clearTimeout(timer);
  }
}

function parseBody(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === '') return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends one request. See the module header for the retry and uncertain-outcome
 * rules. Never throws for HTTP or network problems.
 */
export async function unipileFetch(request: UnipileRequest, options: TransportOptions = {}): Promise<TransportResult> {
  const merged: TransportOptions = { ...(transportDefaults ?? {}), ...options };
  const config = merged.config ?? getUnipileConfig();
  const fetchImpl = merged.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleep = merged.sleep ?? defaultSleep;
  const now = merged.now ?? Date.now;

  const method = request.method ?? 'GET';
  if (request.body !== undefined && request.form !== undefined) {
    throw invalidRequest('body and form are mutually exclusive');
  }
  if (method === 'GET' && (request.body !== undefined || request.form !== undefined)) {
    throw invalidRequest('a GET request cannot carry a body');
  }
  const url = buildUrl(config.baseUrl, request.path, request.query);
  const pathForDebug = request.path;

  const headers: Record<string, string> = { Accept: 'application/json', ...(request.headers ?? {}) };
  let payload: BodyInit | undefined;
  if (request.form !== undefined) {
    payload = request.form; // the runtime sets the multipart boundary
  } else if (request.body !== undefined) {
    payload = JSON.stringify(request.body);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  }
  // The key is ours alone: drop any caller header of that name whatever its case.
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'x-api-key') delete headers[name];
  }
  headers['X-API-KEY'] = config.apiKey;
  // Never follow a redirect: the key header would follow it and a 307/308 would replay a send body.
  const init: RequestInit = { method, headers, body: payload, redirect: 'manual' };

  const idempotent = isIdempotentRequest(method, request.idempotent);
  const policy: RetryPolicy = request.retry === false
    ? { ...DEFAULT_RETRY_POLICY, maxRetries: 0 }
    : { ...DEFAULT_RETRY_POLICY, ...(request.retry ?? {}) };
  const maxRetries = idempotent ? Math.max(0, policy.maxRetries) : 0;
  const timeoutMs = request.timeoutMs ?? (request.heavy ? HEAVY_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);

  const startedAt = now();
  let attempts = 0;

  // Waits and reports true when another attempt may start.
  const tryRetry = async (waitMs: number): Promise<boolean> => {
    const retriesDone = attempts - 1;
    if (retriesDone >= maxRetries) return false;
    if (now() - startedAt + waitMs > policy.budgetMs) return false;
    await sleep(waitMs);
    return true;
  };

  for (;;) {
    attempts++;
    const retryIndex = attempts - 1; // index of the retry that would follow this attempt
    const result = await attemptOnce(fetchImpl, url, init, timeoutMs);
    const baseDebug = { method, path: pathForDebug, attempts };

    if (result.kind === 'timeout' || result.kind === 'network') {
      const wait = policy.backoffMs[Math.min(retryIndex, policy.backoffMs.length - 1)] ?? 0;
      if (idempotent && await tryRetry(wait)) continue;
      const code = result.kind === 'timeout' ? 'timeout' : 'network_error';
      const cause = result.kind === 'network' ? result.cause : undefined;
      const error = new UnipileError(idempotent ? 'network' : 'uncertain', {
        code,
        cause,
        debug: { ...baseDebug, status: null, code, note: idempotent ? undefined : 'non-idempotent call, outcome unknown' },
      });
      return { outcome: idempotent ? 'error' : 'uncertain', error, attempts };
    }

    const requestId = result.headers.get('x-request-id') ?? result.headers.get('request-id');
    const parsed = parseBody(result.text);

    if (result.status >= 200 && result.status < 300) {
      if (parsed.ok) {
        return { outcome: 'ok', status: result.status, data: parsed.value, headers: result.headers, attempts };
      }
      // A 2xx whose body cannot be read: for a send the action may well have happened.
      const error = new UnipileError(idempotent ? 'server' : 'uncertain', {
        status: result.status,
        code: 'invalid_json',
        debug: { ...baseDebug, requestId, body: result.text.slice(0, BODY_DEBUG_MAX), note: 'unreadable success body' },
      });
      return { outcome: idempotent ? 'error' : 'uncertain', error, attempts };
    }

    const body = parsed.ok ? parsed.value : result.text.slice(0, BODY_DEBUG_MAX);
    const classification = classifyError(result.status, body);
    const retryAfterMs = parseRetryAfter(result.headers.get('retry-after'), now());
    const retryableStatus = result.status === 429 || result.status === 502 || result.status === 503 ||
      result.status === 504;
    // A network quota (weekly invitation limit...) does not clear in seconds: do not retry it.
    // A Retry-After beyond the cap is not shortened (that would hammer the shared key): no retry.
    const waitTooLong = retryAfterMs !== null && retryAfterMs > policy.maxRetryAfterMs;
    if (idempotent && retryableStatus && classification.kind !== 'provider_limit' && !waitTooLong) {
      const table = result.status === 429 ? policy.rateLimitBackoffMs : policy.backoffMs;
      const fallback = table[Math.min(retryIndex, table.length - 1)] ?? 0;
      // The server's own wait wins on 429 and 503; it never shortens the backoff of a 502/504.
      const wait = retryAfterMs !== null && (result.status === 429 || result.status === 503)
        ? retryAfterMs
        : Math.max(fallback, retryAfterMs ?? 0);
      if (await tryRetry(wait)) continue;
    }

    const unknownOutcome = !idempotent && (result.status >= 500 || result.status === 408);
    const kind = unknownOutcome ? 'uncertain' : classification.kind;
    const error = new UnipileError(kind, {
      status: result.status,
      code: classification.code,
      retryAfterMs,
      debug: {
        ...baseDebug,
        status: result.status,
        code: classification.code,
        requestId,
        body,
        note: unknownOutcome ? 'non-idempotent call, outcome unknown' : undefined,
      },
    });
    return { outcome: unknownOutcome ? 'uncertain' : 'error', error, attempts };
  }
}

/**
 * Sends a request and returns the parsed JSON body. Throws a `UnipileError`
 * for every failure, an uncertain outcome included (kind `uncertain`), and for
 * an empty body (use `unipileVoid` for calls that return nothing).
 */
export async function unipileJson<T = unknown>(request: UnipileRequest, options: TransportOptions = {}): Promise<T> {
  const result = await unipileFetch(request, options);
  if (result.outcome !== 'ok') throw result.error;
  if (result.data === null) {
    throw new UnipileError('server', {
      status: result.status,
      code: 'empty_body',
      debug: { method: request.method ?? 'GET', path: request.path, attempts: result.attempts, note: 'empty body where JSON was expected' },
    });
  }
  return result.data as T;
}

/**
 * `DELETE` returning JSON. A delete is retried like any idempotent call, so when
 * the first attempt removed the item and its answer was lost, the retry meets a
 * `not_found`: that is a success, reported as `{ success: true }`. A `not_found`
 * on the first and only attempt is still an error (nothing was there to delete).
 */
export async function unipileDeleteJson<T = unknown>(
  request: Omit<UnipileRequest, 'method'>,
  options: TransportOptions = {},
): Promise<T | { success: true }> {
  const result = await unipileFetch({ ...request, method: 'DELETE' }, options);
  if (result.outcome === 'ok') {
    if (result.data === null) {
      throw new UnipileError('server', {
        status: result.status,
        code: 'empty_body',
        debug: { method: 'DELETE', path: request.path, attempts: result.attempts, note: 'empty body where JSON was expected' },
      });
    }
    return result.data as T;
  }
  if (result.error.kind === 'not_found' && result.attempts > 1) return { success: true };
  throw result.error;
}

/** Sends a request and ignores the body (204 and JSON alike). Throws a `UnipileError` on failure. */
export async function unipileVoid(request: UnipileRequest, options: TransportOptions = {}): Promise<void> {
  const result = await unipileFetch(request, options);
  if (result.outcome !== 'ok') throw result.error;
}
