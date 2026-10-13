// Agenda en lecture seule : calendriers et événements. Chaque appel est joué
// contre un transport factice qui vérifie l'URL, la méthode, la requête et le corps.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/calendar.test.ts

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import * as calendar from './calendar.ts';
import { collectEvents, listCalendars, listEvents } from './calendar.ts';
import { isUnipileError } from './errors.ts';
import { OutdatedAccountIdError } from './ids.ts';
import { fixtures, jsonResponse, withMockTransport } from './testing.ts';

const ACC = 'acc_01abc';

function event(id: string, extra: Record<string, unknown> = {}) {
  return {
    object: 'CalendarEvent', id, calendar_id: 'cal_1', title: `Entretien ${id}`, is_cancelled: false,
    start: { type: 'datetime', date_time: '2026-10-12T09:00:00', timezone: 'Europe/Paris' },
    end: { type: 'datetime', date_time: '2026-10-12T10:00:00', timezone: 'Europe/Paris' },
    ...extra,
  };
}

Deno.test('listCalendars : GET /{acc}/calendars', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ object: 'Calendar', id: 'cal_1', name: 'Agenda', is_default: true }])), async (mock) => {
    const page = await listCalendars(ACC, { limit: 10 });
    strictEqual(page.items[0].name, 'Agenda');
    strictEqual(mock.calls[0].method, 'GET');
    strictEqual(mock.calls[0].path, `/${ACC}/calendars`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { limit: '10' });
    await rejects(() => listCalendars('old-id'), OutdatedAccountIdError);
  });
});

Deno.test('listEvents : GET /{acc}/calendars/{cal}/events avec filtres en ISO, is_cancelled seulement s\'il est donné', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([event('ev1')], { nextCursor: 'n1' })), async (mock) => {
    const page = await listEvents(ACC, 'cal_1', {
      start: new Date('2026-10-01T00:00:00Z'), end: '2026-11-01T00:00:00.000Z', updatedAfter: new Date('2026-10-10T08:00:00Z'),
      updatedBefore: '2026-10-11T08:00:00.000Z', icalUid: 'uid-1@x', isCancelled: false, busy: true, expandRecurring: true,
      cursor: 'c0', limit: 100,
    });
    strictEqual(page.nextCursor, 'n1');
    strictEqual(mock.calls[0].path, `/${ACC}/calendars/cal_1/events`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), {
      start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z', updated_after: '2026-10-10T08:00:00.000Z',
      updated_before: '2026-10-11T08:00:00.000Z', ical_uid: 'uid-1@x', is_cancelled: 'false', busy: 'true',
      expand_recurring: 'true', cursor: 'c0', limit: '100',
    });
    await listEvents(ACC, 'cal_1');
    strictEqual(mock.calls[1].url, `https://api.unipile.com/v2/${ACC}/calendars/cal_1/events`);
  });
});

Deno.test('listEvents : date invalide ou calendrier vide refusés avant tout appel', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([])), async (mock) => {
    await rejects(() => listEvents(ACC, 'cal_1', { start: 'bientôt' }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
    await rejects(() => listEvents(ACC, ''), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('collectEvents : suit next_cursor et dédoublonne', async () => {
  let n = 0;
  await withMockTransport(() => {
    n++;
    return n === 1
      ? jsonResponse(fixtures.page([event('ev1'), event('ev2')], { nextCursor: 'p2' }))
      : jsonResponse(fixtures.page([event('ev3')]));
  }, async (mock) => {
    const result = await collectEvents(ACC, 'cal_1', { isCancelled: true, limit: 2 });
    deepStrictEqual(result.items.map((e) => e.id), ['ev1', 'ev2', 'ev3']);
    strictEqual(mock.calls.length, 2);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { is_cancelled: 'true', limit: '2' });
    deepStrictEqual(Object.fromEntries(mock.calls[1].query), { is_cancelled: 'true', limit: '2', cursor: 'p2' });
  });
});

Deno.test('le module n\'expose aucune méthode d\'écriture', () => {
  for (const name of Object.keys(calendar)) {
    ok(!/^(create|update|delete|cancel|restore|rsvp|respond|send)/i.test(name), `écriture exposée : ${name}`);
  }
});
