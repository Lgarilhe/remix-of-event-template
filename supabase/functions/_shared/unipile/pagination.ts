/**
 * Pagination of provider list endpoints.
 *
 * Three families exist (see the spec digests, which say which endpoint uses
 * which):
 *  - `cursor`: query `cursor`, response `next_cursor` (people, company and post
 *    searches, Recruiter and Sales Navigator searches).
 *  - `offset`: query `offset` + `limit`, response `total_count?` (jobs search,
 *    Recruiter projects, Sales Navigator from a URL). The provider says
 *    nothing about the end of the list, so the page is followed until it is
 *    empty or `total_count` is reached.
 *  - `has_more`: query `offset` + `limit` sent as STRINGS, response
 *    `{ object, data, has_more }` (accounts and webhook endpoints lists).
 *  - `auto`: for the dual-mode lists (chats, messages, relations, emails):
 *    follow `next_cursor` when present, else `has_more`, else the offset while
 *    `total_count` says more remains. Without any of these signals the list
 *    ends: it never guesses "a full page means another page" (`limit` is a
 *    ceiling, not a guarantee).
 *
 * Hard caps bound the time spent (an edge function lives 60 s): at most
 * `HARD_MAX_PAGES` pages and `HARD_MAX_ITEMS` items whatever the caller asks.
 * A cursor repeated by the provider, or a page that only repeats items already
 * seen (when `keyOf` is given), ends the loop.
 */

export type PaginationMode = 'cursor' | 'offset' | 'has_more' | 'auto';

export const DEFAULT_PAGE_SIZE = 20;
export const DEFAULT_MAX_PAGES = 10;
export const DEFAULT_MAX_ITEMS = 1_000;
export const HARD_MAX_PAGES = 50;
export const HARD_MAX_ITEMS = 5_000;

/** One parsed page, whatever the envelope. */
export interface Page<T> {
  items: T[];
  /** `next_cursor` when the provider sent a non-empty one. */
  nextCursor: string | null;
  /** `total_count` when the provider sent a number. */
  totalCount: number | null;
  /** `has_more` when the provider sent a boolean. */
  hasMore: boolean | null;
}

const ITEM_KEYS = ['data', 'items', 'entities', 'contracts'] as const;

/**
 * Tolerant reader of a list envelope: items from `data` (or `items`,
 * `entities`, `contracts`), cursor from `next_cursor`, `total_count`,
 * `has_more`. A body that is not an object gives an empty page.
 */
export function parsePage<T = unknown>(body: unknown): Page<T> {
  const page: Page<T> = { items: [], nextCursor: null, totalCount: null, hasMore: null };
  if (Array.isArray(body)) {
    page.items = body as T[];
    return page;
  }
  if (!body || typeof body !== 'object') return page;
  const record = body as Record<string, unknown>;
  for (const key of ITEM_KEYS) {
    if (Array.isArray(record[key])) {
      page.items = record[key] as T[];
      break;
    }
  }
  if (typeof record.next_cursor === 'string' && record.next_cursor !== '') page.nextCursor = record.next_cursor;
  if (typeof record.total_count === 'number' && Number.isFinite(record.total_count)) {
    page.totalCount = record.total_count;
  }
  if (typeof record.has_more === 'boolean') page.hasMore = record.has_more;
  return page;
}

/** What a page request needs. `query` is ready to merge into `UnipileRequest.query`. */
export interface PageParams {
  /** 0-based index of the page in this run. */
  pageIndex: number;
  limit: number;
  /** Set when the previous page gave a cursor. */
  cursor?: string;
  /** Set (possibly 0) when the run is offset based. */
  offset?: number;
  query: Record<string, string | number>;
}

export interface PaginateOptions<T> {
  mode: PaginationMode;
  /** Fetches one page and returns the raw response body. */
  fetchPage: (params: PageParams) => Promise<unknown>;
  /** Page size asked from the provider (default 20). */
  limit?: number;
  /** Default 10, clamped to `HARD_MAX_PAGES`. */
  maxPages?: number;
  /** Default 1000, clamped to `HARD_MAX_ITEMS`. */
  maxItems?: number;
  /** Resume from a cursor. */
  startCursor?: string;
  /** Resume from an offset (offset, has_more and auto modes). */
  startOffset?: number;
  /**
   * Wall-clock budget in ms. Once it is spent no further page is requested (the page in
   * flight is finished): the run stops as truncated when the provider had more. An edge
   * function lives 60 s, so a caller that loops over slow pages passes one. `0` stops after
   * the first page. Default: none, only the page and item caps apply.
   */
  deadlineMs?: number;
  /** Item identity, used to stop on a page that repeats items already seen. */
  keyOf?: (item: T) => string | null | undefined;
}

export interface CollectResult<T> {
  items: T[];
  pages: number;
  /** True when a cap stopped the run while the provider had more. */
  truncated: boolean;
  /** `total_count` of the last page that gave one. */
  totalCount: number | null;
  /** Cursor to resume from when the run was truncated in cursor mode. */
  nextCursor: string | null;
  /** Offset to resume from when the run was truncated in an offset based mode. */
  nextOffset: number | null;
}

/** Builds the query parameters of a page: numbers for cursor and offset lists, strings for `has_more` lists. */
export function pageQuery(
  mode: PaginationMode,
  state: { cursor?: string; offset?: number; limit: number },
): Record<string, string | number> {
  const asText = mode === 'has_more';
  const num = (n: number) => (asText ? String(n) : n);
  const query: Record<string, string | number> = { limit: num(state.limit) };
  if (state.cursor !== undefined) query.cursor = state.cursor;
  if (state.offset !== undefined) query.offset = num(state.offset);
  return query;
}

function clamp(value: number | undefined, fallback: number, hard: number): number {
  const n = value === undefined || !Number.isFinite(value) ? fallback : Math.floor(value);
  return Math.min(Math.max(n, 1), hard);
}

interface Next {
  cursor?: string;
  offset?: number;
}

/** Decides how to continue after a page, or `null` when the list ended. */
function nextStep<T>(mode: PaginationMode, page: Page<T>, usedCursor: string | undefined, offsetAfter: number): Next | null {
  const moreByTotal = page.totalCount !== null && offsetAfter < page.totalCount && page.items.length > 0;
  switch (mode) {
    case 'cursor':
      return page.nextCursor !== null && page.nextCursor !== usedCursor ? { cursor: page.nextCursor } : null;
    case 'offset':
      if (page.items.length === 0) return null;
      if (page.totalCount !== null && offsetAfter >= page.totalCount) return null;
      return { offset: offsetAfter };
    case 'has_more':
      return page.hasMore === true && page.items.length > 0 ? { offset: offsetAfter } : null;
    case 'auto':
      if (page.nextCursor !== null) return page.nextCursor !== usedCursor ? { cursor: page.nextCursor } : null;
      if (page.hasMore === true && page.items.length > 0) return { offset: offsetAfter };
      if (moreByTotal) return { offset: offsetAfter };
      return null;
  }
}

interface Step<T> {
  page: Page<T>;
  /** How the run would continue, `null` when the list ended on this page. */
  next: Next | null;
  /** Offset reached after this page (start offset plus every item received). */
  offsetAfter: number;
}

async function* walk<T>(options: PaginateOptions<T>): AsyncGenerator<Step<T>, void, void> {
  const limit = clamp(options.limit, DEFAULT_PAGE_SIZE, 1_000);
  const maxPages = clamp(options.maxPages, DEFAULT_MAX_PAGES, HARD_MAX_PAGES);
  const maxItems = clamp(options.maxItems, DEFAULT_MAX_ITEMS, HARD_MAX_ITEMS);
  const offsetBased = options.mode === 'offset' || options.mode === 'has_more';

  let cursor = options.startCursor;
  let offset: number | undefined = options.startOffset ?? (offsetBased && cursor === undefined ? 0 : undefined);
  let received = options.startOffset ?? 0;
  let seenItems = 0;
  const seenKeys = new Set<string>();

  const startedAt = Date.now();
  for (let pageIndex = 0; pageIndex < maxPages && seenItems < maxItems; pageIndex++) {
    if (pageIndex > 0 && options.deadlineMs !== undefined && Date.now() - startedAt >= options.deadlineMs) return;
    const params: PageParams = {
      pageIndex,
      limit,
      ...(cursor !== undefined ? { cursor } : {}),
      ...(offset !== undefined ? { offset } : {}),
      query: pageQuery(options.mode, { cursor, offset, limit }),
    };
    const page = parsePage<T>(await options.fetchPage(params));

    // A provider that ignores the offset answers the same page again.
    if (options.keyOf && page.items.length > 0) {
      const keys = page.items.map((item) => options.keyOf!(item)).filter((k): k is string => typeof k === 'string');
      if (keys.length === page.items.length && keys.every((k) => seenKeys.has(k))) return;
      for (const k of keys) seenKeys.add(k);
    }

    received += page.items.length;
    seenItems += page.items.length;
    const next = nextStep(options.mode, page, cursor, received);
    yield { page, next, offsetAfter: received };
    if (next === null) return;
    cursor = next.cursor;
    offset = next.offset;
  }
}

/**
 * Walks a list page by page. Yields each parsed page and stops on the end of
 * the list, a repeated cursor, a repeated page, or a hard cap. Errors thrown by
 * `fetchPage` propagate to the consumer.
 */
export async function* paginate<T = unknown>(options: PaginateOptions<T>): AsyncGenerator<Page<T>, void, void> {
  for await (const step of walk(options)) yield step.page;
}

/**
 * Collects a list into one array within the caps. `truncated` is true when a
 * cap stopped the run while the provider still had more (or more items than
 * `maxItems` were received). `nextCursor` / `nextOffset` say where to resume.
 */
export async function collect<T = unknown>(options: PaginateOptions<T>): Promise<CollectResult<T>> {
  const maxItems = clamp(options.maxItems, DEFAULT_MAX_ITEMS, HARD_MAX_ITEMS);
  const maxPages = clamp(options.maxPages, DEFAULT_MAX_PAGES, HARD_MAX_PAGES);
  const items: T[] = [];
  let pages = 0;
  let totalCount: number | null = null;
  let truncated = false;
  let nextCursor: string | null = null;
  let nextOffset: number | null = null;
  const startOffset = options.startOffset ?? 0;
  const startedAt = Date.now();

  for await (const { page, next, offsetAfter } of walk({ ...options, maxItems, maxPages })) {
    pages++;
    if (page.totalCount !== null) totalCount = page.totalCount;
    const room = maxItems - items.length;
    items.push(...page.items.slice(0, room));
    if (page.items.length > room) {
      // More items were received than the cap allows: resume right after the last kept one.
      truncated = true;
      nextOffset = startOffset + items.length;
      break;
    }
    const outOfTime = options.deadlineMs !== undefined && Date.now() - startedAt >= options.deadlineMs;
    if (items.length >= maxItems || pages >= maxPages || outOfTime) {
      // Stopped by a cap or the deadline: truncated only when the provider signalled more.
      truncated = next !== null;
      nextCursor = next?.cursor ?? null;
      nextOffset = next?.offset ?? (next ? offsetAfter : null);
      break;
    }
  }
  return { items, pages, truncated, totalCount, nextCursor, nextOffset };
}
