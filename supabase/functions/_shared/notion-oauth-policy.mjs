const PRODUCTION_APP_ORIGIN = 'https://konekt-app-navy.vercel.app';
const KONEKT_PREVIEW_HOST_RE = /^konekt-[a-z0-9-]+-lgarilhe-konektfrs-projects\.vercel\.app$/i;

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
/**
 * OAuth callbacks may redirect only to the Konekt app, an explicitly allowed
 * origin, or localhost in development. This prevents an authenticated admin
 * from turning the start endpoint into an open redirect.
 *
 * @param {unknown} rawUrl
 * @param {string | undefined} appUrl
 * @param {string | string[] | undefined} extraOrigins
 * @returns {string | null}
 */
export function normalizeNotionReturnUrl(rawUrl, appUrl, extraOrigins) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return null;

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.username || parsed.password) return null;
  const isLocal = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !isLocal) return null;

  const configuredOrigins = Array.isArray(extraOrigins)
    ? extraOrigins
    : typeof extraOrigins === 'string'
      ? extraOrigins.split(',')
      : [];
  const allowedOrigins = new Set([
    PRODUCTION_APP_ORIGIN,
    safeOrigin(appUrl || ''),
    ...configuredOrigins.map((value) => safeOrigin(String(value).trim())),
  ].filter(Boolean));

  const allowed =
    isLocal ||
    allowedOrigins.has(parsed.origin) ||
    KONEKT_PREVIEW_HOST_RE.test(parsed.hostname);

  if (!allowed) return null;

  parsed.hash = '';
  parsed.searchParams.delete('notion_oauth');
  parsed.searchParams.delete('notion_error');
  parsed.searchParams.delete('code');
  parsed.searchParams.delete('state');
  parsed.searchParams.delete('error');
  parsed.searchParams.delete('error_description');
  return parsed.toString();
}

/**
 * Request only scopes whose names explicitly describe read access.
 * The MCP tool allowlist remains the final fail-closed enforcement layer.
 *
 * @param {unknown} advertisedScopes
 * @returns {string[]}
 */
export function selectNotionReadScopes(advertisedScopes) {
  if (!Array.isArray(advertisedScopes)) return [];
  return [...new Set(advertisedScopes
    .filter((scope) => typeof scope === 'string')
    .map((scope) => scope.trim())
    .filter((scope) => scope && /read/i.test(scope) && !/write/i.test(scope)))]
    .slice(0, 8);
}

/**
 * @param {{
 *   authorizationEndpoint: string,
 *   clientId: string,
 *   redirectUri: string,
 *   codeChallenge: string,
 *   state: string,
 *   scopes?: string[],
 *   resource?: string,
 * }} input
 */
export function buildNotionAuthorizationUrl(input) {
  const url = new URL(input.authorizationEndpoint);
  if (url.protocol !== 'https:') throw new Error('Invalid Notion authorization endpoint');

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'consent');
  if (Array.isArray(input.scopes) && input.scopes.length > 0) {
    url.searchParams.set('scope', input.scopes.join(' '));
  }
  if (input.resource) url.searchParams.set('resource', input.resource);
  return url.toString();
}

/**
 * @param {string} returnTo
 * @param {'connected' | 'error'} outcome
 * @param {string | undefined} errorCode
 */
export function buildNotionReturnUrl(returnTo, outcome, errorCode) {
  const url = new URL(returnTo);
  url.searchParams.set('notion_oauth', outcome);
  if (outcome === 'error' && errorCode) url.searchParams.set('notion_error', errorCode);
  else url.searchParams.delete('notion_error');
  return url.toString();
}
