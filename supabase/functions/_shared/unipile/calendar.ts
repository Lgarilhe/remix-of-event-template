/**
 * Calendars of the provider API (area "email-calendar"), READ ONLY.
 *
 * Konekt only reads the agenda of a connected mailbox (opportunity CAL-1):
 * `listCalendars` and `listEvents`. The API has no free/busy query and no
 * booking, and no write method is exposed here on purpose.
 *
 * Wire facts
 *  - `GET /{acc}/calendars` and `GET /{acc}/calendars/{calendar}/events`, lists
 *    answer `{ data, total_count?, next_cursor? }`.
 *  - `is_cancelled` DEFAULTS TO TRUE on the provider side: cancelled events are
 *    included unless `isCancelled: false` is passed. The parameter is only sent
 *    when given, so the caller decides.
 *  - `start` and `end` of an event are `{ type: 'datetime', date_time,
 *    timezone? }` or `{ type: 'date', date }` (all-day).
 */

import { UnipileError } from './errors.ts';
import { unipileJson, type TransportOptions } from './http.ts';
import { accountPath } from './ids.ts';
import { collect, parsePage, type CollectResult, type Page } from './pagination.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Calendar {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly timezone?: string;
  readonly is_read_only?: boolean;
  readonly is_owned_by_user?: boolean;
  readonly is_default?: boolean;
  readonly [key: string]: unknown;
}

export type EventTime =
  | { readonly type: 'datetime'; readonly date_time: string; readonly timezone?: string }
  | { readonly type: 'date'; readonly date: string; readonly timezone?: string };

export interface EventAttendee {
  readonly email: string;
  readonly display_name?: string;
  readonly is_organizer?: boolean;
  readonly is_self?: boolean;
  /** `yes` | `no` | `maybe` | `noreply`. */
  readonly response_status?: string;
  readonly [key: string]: unknown;
}

export interface CalendarEvent {
  readonly id: string;
  readonly calendar_id: string;
  /** Shared by every copy of the event across attendees' calendars. */
  readonly ical_uid?: string;
  readonly master_event_id?: string;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly title: string;
  readonly body?: string;
  readonly location?: string;
  readonly is_cancelled: boolean;
  readonly is_all_day?: boolean;
  readonly start: EventTime;
  readonly end: EventTime;
  /** Set only when start and end share the same timezone. */
  readonly timezone?: string;
  readonly organizer?: { readonly email: string; readonly display_name?: string };
  readonly attendees?: readonly EventAttendee[];
  readonly conference?: { readonly provider: string; readonly hosting: string; readonly url: string; readonly conference_id?: string };
  /** `opaque` blocks time, `transparent` does not. */
  readonly transparency?: string;
  readonly visibility?: string;
  readonly [key: string]: unknown;
}

export interface ListEventsParams {
  /** Events starting after this date. */
  start?: Date | string;
  /** Events ending before this date. */
  end?: Date | string;
  updatedAfter?: Date | string;
  updatedBefore?: Date | string;
  icalUid?: string;
  /** The provider default is true (cancelled events included). */
  isCancelled?: boolean;
  /** Only events that block time (`transparency: opaque`). */
  busy?: boolean;
  /** Expands recurring series into their occurrences. */
  expandRecurring?: boolean;
  cursor?: string;
  offset?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function iso(value: Date | string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new UnipileError('validation', { debug: { note: `${name} is not a valid date` } });
  }
  return date.toISOString();
}

function eventsPath(accountId: string, calendarId: string): string {
  return accountPath(accountId, 'calendars', calendarId, 'events');
}

function eventsQuery(params: ListEventsParams): Record<string, string | number | boolean | undefined> {
  return {
    start: iso(params.start, 'start'),
    end: iso(params.end, 'end'),
    updated_after: iso(params.updatedAfter, 'updatedAfter'),
    updated_before: iso(params.updatedBefore, 'updatedBefore'),
    ical_uid: params.icalUid,
    is_cancelled: params.isCancelled,
    busy: params.busy,
    expand_recurring: params.expandRecurring,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** One page of the calendars of an account (`GET /{acc}/calendars`). */
export async function listCalendars(
  accountId: string,
  params: { cursor?: string; offset?: number; limit?: number } = {},
  options: TransportOptions = {},
): Promise<Page<Calendar>> {
  const body = await unipileJson(
    { path: accountPath(accountId, 'calendars'), query: { cursor: params.cursor, offset: params.offset, limit: params.limit } },
    options,
  );
  return parsePage<Calendar>(body);
}

/** One page of the events of a calendar (`GET /{acc}/calendars/{calendar}/events`). */
export async function listEvents(
  accountId: string,
  calendarId: string,
  params: ListEventsParams = {},
  options: TransportOptions = {},
): Promise<Page<CalendarEvent>> {
  const body = await unipileJson(
    {
      path: eventsPath(accountId, calendarId),
      query: { ...eventsQuery(params), cursor: params.cursor, offset: params.offset, limit: params.limit },
    },
    options,
  );
  return parsePage<CalendarEvent>(body);
}

/** Every event of a calendar for the given filters, within the pagination caps. */
export function collectEvents(
  accountId: string,
  calendarId: string,
  params: Omit<ListEventsParams, 'cursor' | 'offset'> & { maxItems?: number; maxPages?: number } = {},
  options: TransportOptions = {},
): Promise<CollectResult<CalendarEvent>> {
  const query = eventsQuery(params);
  return collect<CalendarEvent>({
    mode: 'auto',
    limit: params.limit,
    maxItems: params.maxItems,
    maxPages: params.maxPages,
    keyOf: (event) => (event && typeof event.id === 'string' ? event.id : null),
    fetchPage: (page) => unipileJson({ path: eventsPath(accountId, calendarId), query: { ...query, ...page.query } }, options),
  });
}
