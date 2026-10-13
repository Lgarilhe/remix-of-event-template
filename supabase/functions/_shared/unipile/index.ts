/**
 * Single import path of the shared provider client:
 *
 *   import { sendMessage, userSafeMessage } from '../_shared/unipile/index.ts';
 *
 * Re-exports the public API of every module of this directory and of
 * `normalize/`. The names do not collide, so the modules are re-exported with
 * `export *` and a new export of a module reaches the barrel by itself.
 *
 * Left out on purpose
 *  - `testing.ts` (`withMockTransport`, `fixtures`, the reply builders): test
 *    helpers, imported by `*.test.ts` only, never by production code.
 *  - `setTransportDefaults` of `http.ts`: the test seam `testing.ts` relies on.
 *    `http.ts` is therefore re-exported by name, not with `export *`.
 *
 * Guard: tests/c1/unipile-client.test.mjs checks that every export of every
 * module is reachable from here, except the two cases above.
 */

export * from './config.ts';

export {
  buildUrl,
  DEFAULT_RETRY_POLICY,
  DEFAULT_TIMEOUT_MS,
  HEAVY_TIMEOUT_MS,
  isIdempotentRequest,
  parseRetryAfter,
  unipileDeleteJson,
  unipileFetch,
  unipileJson,
  unipileVoid,
} from './http.ts';
export type {
  FetchImpl,
  HttpMethod,
  QueryValue,
  RetryPolicy,
  TransportFailure,
  TransportOk,
  TransportOptions,
  TransportResult,
  UnipileRequest,
} from './http.ts';

export * from './errors.ts';
export * from './pagination.ts';
export * from './ids.ts';
export * from './status.ts';
export * from './guard.ts';
export * from './accounts.ts';
export * from './webhooks.ts';
export * from './messaging.ts';
export * from './users.ts';
export * from './linkedin.ts';
export * from './email.ts';
export * from './calendar.ts';

export * from './normalize/profile.ts';
export * from './normalize/search.ts';
export * from './normalize/messages.ts';
