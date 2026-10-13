/**
 * Test helper (NOT imported by production code): makes the in-memory `FakeDb` read a uuid filter the way Postgres does.
 *
 * Postgres accepts a uuid in several spellings (upper case, braces, no hyphens, a hyphen after every group of four digits)
 * and rejects the rest, a padded value included (SQLSTATE 22P02). `FakeDb` compares strings strictly, so a test that sends
 * an upper-case organisation id would be refused by the fake membership lookup while the real database accepts it, and the
 * defect it wants to show would never be reached.
 *
 *   const db = postgresUuidDb(new FakeDb({ ... }));
 */

import type { FakeDb } from '../_shared/connection-claim.testing.ts';

const HEX = /^[0-9a-f]$/i;

/**
 * Postgres `uuid_in` (string_to_uuid): optional braces, 16 bytes of two hex digits, a hyphen allowed only after every second
 * byte and never at the end, nothing else, no whitespace. Returns the canonical lower-case form, or `null` when Postgres refuses it.
 */
export function parsePostgresUuid(value: string): string | null {
  let rest = value;
  const braces = rest.startsWith('{');
  if (braces) rest = rest.slice(1);
  let hex = '';
  let at = 0;
  for (let byte = 0; byte < 16; byte++) {
    if (!HEX.test(rest[at] ?? '') || !HEX.test(rest[at + 1] ?? '')) return null;
    hex += rest.slice(at, at + 2);
    at += 2;
    if (rest[at] === '-' && byte % 2 === 1 && byte < 15) at++;
  }
  if (braces) {
    if (rest[at] !== '}') return null;
    at++;
  }
  if (at !== rest.length) return null;
  const lower = hex.toLowerCase();
  return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
}

/** Columns whose filter value is read as a uuid. */
const UUID_COLUMNS: ReadonlySet<string> = new Set(['organization_id', 'user_id']);

/**
 * Wraps `db.from`: an `eq`/`neq` filter on an organisation or user column is read like Postgres (canonical form when
 * it parses, an error `22P02` answered at the end of the chain when it does not). Mutates and returns `db`.
 */
export function postgresUuidDb(db: FakeDb): FakeDb {
  const from = db.from.bind(db);
  // deno-lint-ignore no-explicit-any
  (db as any).from = (table: string) => {
    const query = from(table);
    let refused: string | null = null;
    for (const method of ['eq', 'neq'] as const) {
      const original = query[method].bind(query);
      query[method] = (column: string, value: unknown) => {
        if (UUID_COLUMNS.has(column) && typeof value === 'string') {
          const canonical = parsePostgresUuid(value);
          if (canonical === null) refused = value;
          else value = canonical;
        }
        return original(column, value);
      };
    }
    const then = query.then.bind(query);
    // deno-lint-ignore no-explicit-any
    query.then = (onfulfilled?: any, onrejected?: any) =>
      refused === null
        ? then(onfulfilled, onrejected)
        : Promise.resolve({ data: null, error: { code: '22P02', message: `invalid input syntax for type uuid: "${refused}"` } }).then(onfulfilled, onrejected);
    return query;
  };
  return db;
}
