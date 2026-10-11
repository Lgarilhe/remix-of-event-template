/**
 * Test helpers for code that uses the shared provider client. NOT imported by
 * production code.
 *
 * `withMockTransport(handler)` installs a fake transport: no network, a fake
 * API key, a virtual clock (a retry wait is recorded in `sleeps`, never slept),
 * and every request is recorded in `calls`.
 *
 *   const mock = withMockTransport(() => jsonResponse(fixtures.account()));
 *   try { ... } finally { mock.restore(); }
 *   // or
 *   await withMockTransport(handler, async (mock) => { ... });
 *
 * A handler returns a `Response`, a plain `{ status, body, text, headers }`, or
 * an `Error` (the fetch rejects, like a connection failure). It may also throw,
 * or `return hang(req)` to never answer until the request times out.
 */

import { UNIPILE_BASE_URL } from './config.ts';
import { setTransportDefaults, type TransportOptions } from './http.ts';

/** A request as the fake transport saw it. */
export interface RecordedRequest {
  method: string;
  url: string;
  /** Path relative to the API root, without the query string. */
  path: string;
  query: URLSearchParams;
  /** Header names lowercased. */
  headers: Record<string, string>;
  /** Parsed JSON, a `FormData`, or `null`. */
  body: unknown;
  /** 1 for the first attempt of a call, 2 for its first retry... (per identical method + url). */
  attempt: number;
  signal: AbortSignal;
}

export interface PlainReply {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export type MockReply = Response | PlainReply | Error;
export type MockHandler = (request: RecordedRequest) => MockReply | Promise<MockReply>;

export interface MockTransport {
  calls: RecordedRequest[];
  /** Waits the transport asked for between attempts (in ms), in order. */
  sleeps: number[];
  /** Options to pass to a function that takes `TransportOptions` explicitly. */
  options: TransportOptions;
  restore(): void;
  [Symbol.dispose](): void;
}

/** A JSON `Response`. */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** A `Response` with no body (204 by default). */
export function emptyResponse(status = 204, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

/** A `Response` with a plain text body. */
export function textResponse(text: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(text, { status, headers });
}

/** A connection failure, as `fetch` rejects with it. */
export function networkError(message = 'connection reset'): Error {
  return new TypeError(message);
}

/** Never answers: settles only when the transport aborts the request (timeout). */
export function hang(request: RecordedRequest): Promise<never> {
  return new Promise((_resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
}

function toResponse(reply: MockReply): Response {
  if (reply instanceof Response) return reply;
  if (reply instanceof Error) throw reply;
  const status = reply.status ?? 200;
  if (reply.text !== undefined) return textResponse(reply.text, status, reply.headers);
  if (reply.body === undefined || status === 204) return emptyResponse(status, reply.headers);
  return jsonResponse(reply.body, status, reply.headers);
}

function readBody(body: BodyInit | null | undefined): unknown {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body; // FormData and others, as is
}

/** Installs the fake transport. Remember to `restore()` it (or use the callback form). */
export function withMockTransport(handler: MockHandler): MockTransport;
export function withMockTransport<T>(handler: MockHandler, run: (mock: MockTransport) => Promise<T> | T): Promise<T>;
export function withMockTransport<T>(
  handler: MockHandler,
  run?: (mock: MockTransport) => Promise<T> | T,
): MockTransport | Promise<T> {
  const calls: RecordedRequest[] = [];
  const sleeps: number[] = [];
  const attempts = new Map<string, number>();
  let clock = 1_000_000;

  const options: TransportOptions = {
    config: { apiKey: 'test-key', baseUrl: UNIPILE_BASE_URL },
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
    fetchImpl: async (input, init) => {
      const url = new URL(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const key = `${method} ${url.pathname}${url.search}`;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      const request: RecordedRequest = {
        method,
        url: url.toString(),
        path: url.pathname.replace(/^\/v2/, ''),
        query: url.searchParams,
        headers,
        body: readBody(init?.body as BodyInit | null | undefined),
        attempt,
        signal: init?.signal ?? new AbortController().signal,
      };
      calls.push(request);
      return toResponse(await handler(request));
    },
  };

  const mock: MockTransport = {
    calls,
    sleeps,
    options,
    restore: () => setTransportDefaults(null),
    [Symbol.dispose]: () => setTransportDefaults(null),
  };
  setTransportDefaults(options);
  if (!run) return mock;
  return (async () => {
    try {
      return await run(mock);
    } finally {
      mock.restore();
    }
  })();
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

let counter = 0;
function nextId(prefix: string): string {
  counter++;
  return `${prefix}${String(counter).padStart(4, '0')}`;
}

/** Small builders for provider-shaped payloads. Defaults are valid; override what a test cares about. */
export const fixtures = {
  /** A v2 `Account`. */
  account(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      object: 'Account',
      id: nextId('acc_'),
      user_id: nextId('ACoAA'),
      name: 'Test Account',
      created_at: '2026-01-01T00:00:00.000Z',
      application_id: 'app_test',
      status: 'running',
      is_locked: false,
      provider: 'linkedin',
      metadata: {},
      ...overrides,
    };
  },
  /** An accounts / webhook endpoints style page: `{ object, data, has_more }`. */
  hasMorePage(data: unknown[], hasMore = false, object = 'Accounts'): Record<string, unknown> {
    return { object, data, has_more: hasMore };
  },
  /** A cursor / offset style page: `{ data, total_count?, next_cursor? }`. */
  page(data: unknown[], extra: { nextCursor?: string; totalCount?: number } = {}): Record<string, unknown> {
    return {
      data,
      ...(extra.totalCount !== undefined ? { total_count: extra.totalCount } : {}),
      ...(extra.nextCursor !== undefined ? { next_cursor: extra.nextCursor } : {}),
    };
  },
  /** A send response. `messageId` may be a string, an array or `null`. */
  messageSent(messageId: string | string[] | null = nextId('msg_')): Record<string, unknown> {
    return { object: 'MessageSent', message_id: messageId };
  },
};
