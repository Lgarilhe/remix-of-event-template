const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 20;
const DEFAULT_THREAD_LIMIT = 15;
const MAX_THREAD_LIMIT = 20;
const MAX_QUERY_LENGTH = 200;
const MAX_THREAD_ID_LENGTH = 255;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} maximum
 */
export function clampEmailLimit(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), maximum);
}

/** @param {unknown} value */
export function normalizeEmailAddress(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

/** @param {unknown} value */
export function normalizeEmailDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

/**
 * Build the provider query for a mailbox search. The account id is supplied
 * only by the trusted server-side account resolver; it is never model input.
 *
 * Microsoft rejects `search` combined with participant/date filters. When a
 * free-text query is present we therefore send only `search`, then apply the
 * optional participant/date filters locally to the bounded response.
 *
 * @param {{
 *   accountId: string,
 *   query?: unknown,
 *   participantEmail?: unknown,
 *   after?: unknown,
 *   before?: unknown,
 *   limit?: unknown,
 * }} input
 */
export function buildEmailSearchQuery(input) {
  const outputLimit = clampEmailLimit(input.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
  const providerLimit = Math.min(Math.max(outputLimit * 3, outputLimit), 60);
  const params = new URLSearchParams({
    account_id: String(input.accountId),
    limit: String(providerLimit),
  });
  const query = typeof input.query === 'string'
    ? input.query.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH)
    : '';
  const participantEmail = normalizeEmailAddress(input.participantEmail);
  const after = normalizeEmailDate(input.after);
  const before = normalizeEmailDate(input.before);

  if (query) {
    params.set('search', query);
  } else {
    if (participantEmail) params.set('any_email', participantEmail);
    if (after) params.set('after', after);
    if (before) params.set('before', before);
  }

  return {
    params,
    outputLimit,
    localFilters: { participantEmail, after, before },
  };
}

/**
 * @param {{ accountId: string, threadId: unknown, limit?: unknown }} input
 */
export function buildEmailThreadQuery(input) {
  const threadId = typeof input.threadId === 'string'
    ? input.threadId.trim().slice(0, MAX_THREAD_ID_LENGTH)
    : '';
  const limit = clampEmailLimit(input.limit, DEFAULT_THREAD_LIMIT, MAX_THREAD_LIMIT);
  const params = new URLSearchParams({
    account_id: String(input.accountId),
    thread_id: threadId,
    limit: String(limit),
  });
  return { params, threadId, limit };
}

/**
 * Turns provider HTML into bounded plain text. Script/style content, comments,
 * tags, control characters and excess whitespace are removed before the value
 * is ever returned to the model.
 *
 * @param {unknown} value
 * @param {number} [maximum]
 */
export function stripEmailHtml(value, maximum = 3500) {
  const cap = Math.min(Math.max(Math.trunc(maximum) || 3500, 1), 10_000);
  const sourceCap = Math.min(Math.max(cap * 8, 12_000), 80_000);
  return String(value ?? '')
    .slice(0, sourceCap)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(?:p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d{1,6});/g, (_match, digits) => {
      const codePoint = Number(digits);
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : ' ';
    })
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, cap);
}

/**
 * @param {unknown} value
 * @param {number} [maximum]
 */
export function cleanEmailText(value, maximum = 3500) {
  const cap = Math.min(Math.max(Math.trunc(maximum) || 3500, 1), 10_000);
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, cap);
}

/**
 * Prefer the provider's plain body; sanitize HTML only as a fallback.
 * @param {unknown} bodyPlain
 * @param {unknown} bodyHtml
 * @param {number} [maximum]
 */
export function sanitizeEmailBody(bodyPlain, bodyHtml, maximum = 3500) {
  const plain = cleanEmailText(bodyPlain, maximum);
  return plain || stripEmailHtml(bodyHtml, maximum);
}
