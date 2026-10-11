/**
 * Configuration of the shared provider client.
 *
 * The API is global (one host, one key for the whole Konekt application): there
 * is no per-organisation credential and no base URL override. The e2e harness
 * rewrites outbound fetches at the server level, so tests do not need a
 * switch here.
 *
 * Secrets read here:
 *  - UNIPILE_V2_API_KEY (required)
 *  - UNIPILE_HOSTED_DOMAIN (optional, white-label hostname of the hosted
 *    connection pages)
 * UNIPILE_V2_WEBHOOK_TOKEN is read by the webhook module, not here.
 *
 * Nothing is cached in a module-level variable: the environment is read on
 * every call, so credentials never bleed between concurrent requests.
 */

import { UnipileError } from './errors.ts';

/** Constant API root. No override. */
export const UNIPILE_BASE_URL = 'https://api.unipile.com/v2';

/** Reads one environment variable. Injectable for tests. */
export type EnvReader = (name: string) => string | undefined;

const defaultEnv: EnvReader = (name) => {
  try {
    return Deno.env.get(name);
  } catch {
    // Missing --allow-env permission behaves like an unset variable.
    return undefined;
  }
};

/** Thrown when the deployment is missing a required secret. */
export class UnipileConfigError extends UnipileError {
  constructor(note: string) {
    super('config', { debug: { note } });
    this.name = 'ConfigError'; // neutral: String(error) must not carry the vendor name
  }
}

/** Resolved configuration of one call. */
export interface UnipileConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** True when the API key is present. Never throws. */
export function isUnipileConfigured(env: EnvReader = defaultEnv): boolean {
  return clean(env('UNIPILE_V2_API_KEY')) !== null;
}

/**
 * Resolves the configuration. Throws `UnipileConfigError` (neutral French
 * message, the variable name only in the server-side debug note) when the key
 * is missing: there is no fallback and no silent empty result.
 */
export function getUnipileConfig(env: EnvReader = defaultEnv): UnipileConfig {
  const apiKey = clean(env('UNIPILE_V2_API_KEY'));
  if (!apiKey) throw new UnipileConfigError('UNIPILE_V2_API_KEY is not set');
  return { apiKey, baseUrl: UNIPILE_BASE_URL };
}

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * White-label hostname for hosted connection links, or `null` when unset.
 * Accepts a bare hostname; a scheme and trailing slash are tolerated and
 * stripped. A value that is not a valid hostname throws `UnipileConfigError`
 * rather than producing a broken link.
 */
export function hostedDomain(env: EnvReader = defaultEnv): string | null {
  const raw = clean(env('UNIPILE_HOSTED_DOMAIN'));
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  if (!HOSTNAME_RE.test(host)) {
    throw new UnipileConfigError('UNIPILE_HOSTED_DOMAIN is not a valid hostname');
  }
  return host;
}
