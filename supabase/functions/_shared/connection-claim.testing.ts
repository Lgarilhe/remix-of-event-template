/**
 * In-memory stand-in for the slice of the Supabase client used by the connection
 * code (`connection-claim.ts`, `unipile-accounts/connection.ts`). Test helper: NOT
 * imported by production code.
 *
 *   const db = new FakeDb({ connection_attempts: [row] });
 *   await claimForAttempt(db, { attemptId, account });
 *   db.table('member_linkedin_accounts')   // rows after the call
 *
 * Supported chains (anything else throws, so a test never passes by accident):
 *   from(t).select(cols).eq().neq().in().or().contains().limit().range().order().maybeSingle() / .single() / await
 *   from(t).insert(row|rows)[.select(cols)][.single()]
 *   from(t).update(patch).eq()...[.select(cols)]
 *   from(t).upsert(row, { onConflict })[.select(cols)]
 *   from(t).delete().eq()...[.select(cols)]
 *   rpc(name, args)
 *
 * Failures: `db.failOn(table, op, error)` makes the next matching operation answer
 * `{ data: null, error }`. Uniqueness: `db.unique(table, columns, { where })`.
 */

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete';

interface Failure {
  table: string;
  op: Op;
  error: { code?: string; message?: string };
}

interface UniqueRule {
  columns: string[];
  where?: (row: Row) => boolean;
}

export class FakeDb {
  private tables: Record<string, Row[]>;
  private failures: Failure[] = [];
  private uniques: Record<string, UniqueRule[]> = {};
  private defaultsFor: Record<string, () => Row> = {};
  /** Operations seen, in order. */
  calls: Array<{ table: string; op: Op; patch?: Row }> = [];
  rpcCalls: Array<{ name: string; args: Row }> = [];
  rpcResults: Record<string, unknown> = {};

  constructor(tables: Record<string, Row[]> = {}) {
    this.tables = {};
    for (const [name, rows] of Object.entries(tables)) this.tables[name] = rows.map((r) => ({ ...r }));
  }

  table(name: string): Row[] {
    return this.tables[name] ?? [];
  }

  failOn(table: string, op: Op, error: { code?: string; message?: string } = { code: 'XX000', message: 'boom' }): void {
    this.failures.push({ table, op, error });
  }

  unique(table: string, columns: string[], options: { where?: (row: Row) => boolean } = {}): void {
    (this.uniques[table] ??= []).push({ columns, where: options.where });
  }

  defaults(table: string, make: () => Row): void {
    this.defaultsFor[table] = make;
  }

  // deno-lint-ignore no-explicit-any
  from(table: string): any {
    return new Query(this, table);
  }

  rpc(name: string, args: Row): Promise<{ data: unknown; error: null }> {
    this.rpcCalls.push({ name, args });
    return Promise.resolve({ data: name in this.rpcResults ? this.rpcResults[name] : true, error: null });
  }

  /** @internal */
  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  /** @internal */
  takeFailure(table: string, op: Op): Failure | null {
    const index = this.failures.findIndex((f) => f.table === table && f.op === op);
    return index >= 0 ? this.failures.splice(index, 1)[0] : null;
  }

  /** @internal */
  conflicts(table: string, candidate: Row, ignore?: Row): boolean {
    return (this.uniques[table] ?? []).some((rule) => {
      if (rule.where && !rule.where(candidate)) return false;
      return this.rows(table).some((row) =>
        row !== ignore && (!rule.where || rule.where(row)) && rule.columns.every((c) => row[c] === candidate[c])
      );
    });
  }

  /** @internal */
  fill(table: string, row: Row): Row {
    const base = this.defaultsFor[table]?.() ?? {};
    return { id: crypto.randomUUID(), ...base, ...row };
  }
}

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private op: Op = 'select';
  private filters: Array<(row: Row) => boolean> = [];
  private patch: Row | Row[] | null = null;
  private onConflict: string | null = null;
  private wantsRows = false;
  private wantOne = false;
  private wantMaybe = false;
  private max = Infinity;
  private offset = 0;

  constructor(private readonly db: FakeDb, private readonly name: string) {}

  select(_columns?: string): this {
    this.wantsRows = true;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  or(expression: string): this {
    // "col.eq.value,col.is.null" : a row passes when ANY term matches.
    const terms = expression.split(',').map((t) => t.trim()).filter(Boolean);
    this.filters.push((row) =>
      terms.some((term) => {
        const [column, operator, ...rest] = term.split('.');
        const value = rest.join('.');
        return operator === 'is' && value === 'null' ? row[column] == null : operator === 'eq' ? String(row[column]) === value : false;
      })
    );
    return this;
  }
  contains(column: string, json: string): this {
    // JSON array containment: every wanted element must be matched by one element of the column.
    const wanted = JSON.parse(json) as Array<Record<string, unknown>>;
    this.filters.push((row) => {
      const have = Array.isArray(row[column]) ? row[column] as Array<Record<string, unknown>> : [];
      return wanted.every((w) => have.some((h) => Object.entries(w).every(([k, v]) => h?.[k] === v)));
    });
    return this;
  }
  limit(count: number): this {
    this.max = count;
    return this;
  }
  range(from: number, to: number): this {
    this.offset = from;
    this.max = to - from + 1;
    return this;
  }
  order(): this {
    return this;
  }
  insert(rows: Row | Row[]): this {
    this.op = 'insert';
    this.patch = rows;
    this.wantsRows = false;
    return this;
  }
  update(patch: Row): this {
    this.op = 'update';
    this.patch = patch;
    this.wantsRows = false;
    return this;
  }
  upsert(row: Row, options: { onConflict?: string } = {}): this {
    this.op = 'upsert';
    this.patch = row;
    this.onConflict = options.onConflict ?? null;
    this.wantsRows = false;
    return this;
  }
  delete(): this {
    this.op = 'delete';
    this.wantsRows = false;
    return this;
  }
  maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    this.wantMaybe = true;
    return this.then((r) => r);
  }
  // deno-lint-ignore no-explicit-any
  single(): any {
    this.wantOne = true;
    return this;
  }

  then<R1 = { data: unknown; error: unknown }, R2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private run(): { data: unknown; error: unknown } {
    const { db, name, op } = this;
    db.calls.push({ table: name, op, patch: this.patch && !Array.isArray(this.patch) ? this.patch : undefined });
    const failure = db.takeFailure(name, op);
    if (failure) return { data: null, error: failure.error };
    const matches = () => db.rows(name).filter((row) => this.filters.every((f) => f(row)));
    const shape = (rows: Row[]): { data: unknown; error: unknown } => {
      if (this.wantOne || this.wantMaybe) {
        if (rows.length > 1 && this.wantOne) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
        if (rows.length === 0 && this.wantOne) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows.slice(this.offset, this.offset + this.max), error: null };
    };

    if (op === 'select') return shape(matches());

    if (op === 'insert') {
      const created: Row[] = [];
      for (const raw of Array.isArray(this.patch) ? this.patch : [this.patch as Row]) {
        const row = db.fill(name, raw);
        if (db.conflicts(name, row)) return { data: null, error: { code: '23505', message: 'duplicate' } };
        db.rows(name).push(row);
        created.push(row);
      }
      return this.wantsRows ? shape(created) : { data: null, error: null };
    }

    if (op === 'update') {
      const rows = matches();
      for (const row of rows) {
        const next = { ...row, ...(this.patch as Row) };
        if (db.conflicts(name, next, row)) return { data: null, error: { code: '23505', message: 'duplicate' } };
        Object.assign(row, this.patch);
      }
      return this.wantsRows ? shape(rows) : { data: null, error: null };
    }

    if (op === 'upsert') {
      const incoming = this.patch as Row;
      const keys = (this.onConflict ?? 'id').split(',').map((k) => k.trim());
      const existing = db.rows(name).find((row) => keys.every((k) => row[k] === incoming[k]));
      if (existing) {
        const next = { ...existing, ...incoming };
        if (db.conflicts(name, next, existing)) return { data: null, error: { code: '23505', message: 'duplicate' } };
        Object.assign(existing, incoming);
        return this.wantsRows ? shape([existing]) : { data: null, error: null };
      }
      const row = db.fill(name, incoming);
      if (db.conflicts(name, row)) return { data: null, error: { code: '23505', message: 'duplicate' } };
      db.rows(name).push(row);
      return this.wantsRows ? shape([row]) : { data: null, error: null };
    }

    // delete
    const doomed = matches();
    const rows = db.rows(name);
    for (const row of doomed) rows.splice(rows.indexOf(row), 1);
    return this.wantsRows ? shape(doomed) : { data: null, error: null };
  }
}
