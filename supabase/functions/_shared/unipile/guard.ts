/**
 * Tenant isolation guard.
 *
 * The provider key is global to the Konekt application, so a wrong account id
 * passed to the client acts on another tenant's session. Every JWT-facing
 * function must therefore call `assertAccountOwnedByOrg` before any provider
 * call: the account id must be linked, in the caller's organisation, in one of
 *  - member_linkedin_accounts.linkedin_account_id
 *  - member_email_accounts.email_account_id
 *  - member_whatsapp_accounts.whatsapp_account_id
 * (each scoped by organization_id). Fail closed: an empty input or a lookup
 * error never grants access.
 *
 * The module does not import supabase-js: `admin` is any object with the small
 * `from(table).select(columns).eq(...).limit(n)` chain below, which a service
 * role client satisfies. The id is compared as stored, whatever its format
 * (v1 ids and v2 `acc_` ids are both plain text in these columns).
 */

import { UnipileError } from './errors.ts';

/** Awaitable query of the minimal chain. */
export interface GuardQuery extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(column: string, value: string): GuardQuery;
  limit(count: number): GuardQuery;
}

/**
 * The slice of a Supabase client the guard needs: `from(table)` returns an
 * object with `select(columns)`, which returns a `GuardQuery`. The result type
 * is left open on purpose: a real supabase-js client has deeply generic builder
 * types that do not unify with a structural interface (TS2589), so it is
 * narrowed at the single call site below instead.
 */
export interface GuardAdmin {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

/** Kind of connected account, one per `member_*_accounts` table. */
export type OwnedAccountKind = 'linkedin' | 'email' | 'whatsapp';

interface AccountTable {
  kind: OwnedAccountKind;
  table: string;
  accountColumn: string;
}

const ACCOUNT_TABLES: readonly AccountTable[] = [
  { kind: 'linkedin', table: 'member_linkedin_accounts', accountColumn: 'linkedin_account_id' },
  { kind: 'email', table: 'member_email_accounts', accountColumn: 'email_account_id' },
  { kind: 'whatsapp', table: 'member_whatsapp_accounts', accountColumn: 'whatsapp_account_id' },
];

/** Thrown when the account is not linked in the organisation. Kind `forbidden`. */
export class AccountNotOwnedError extends UnipileError {
  constructor(note = 'account is not linked in this organization') {
    super('forbidden', { status: 403, code: 'account_not_owned', debug: { note } });
    this.name = 'AccountNotOwnedError';
  }
}

/** Where an account is linked. */
export interface AccountOwnership {
  kind: OwnedAccountKind;
  /** Primary key of the `member_*_accounts` row. */
  rowId: string | null;
  /** Member who linked the account. */
  userId: string | null;
}

export interface OwnershipOptions {
  /** Restrict the lookup to some kinds (default: all three). */
  kinds?: readonly OwnedAccountKind[];
  /**
   * Require that this member linked the account. Member-initiated sends must
   * pass it (CLAUDE.md: the LinkedIn account of a colleague is never used); an
   * organisation-wide job (a cron on behalf of the organisation) leaves it out.
   * A blank value fails closed.
   */
  userId?: string;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Finds where an account is linked in the organisation, or `null` when it is
 * not linked anywhere. Throws a `server` `UnipileError` when a lookup fails
 * (never `null`: a database problem must not read as "not owned" nor as
 * "owned").
 */
export async function findAccountOwnership(
  admin: GuardAdmin,
  organizationId: string,
  accountId: string,
  options: OwnershipOptions = {},
): Promise<AccountOwnership | null> {
  if (typeof organizationId !== 'string' || organizationId.trim() === '') return null;
  if (typeof accountId !== 'string' || accountId.trim() === '') return null;
  if (options.userId !== undefined && (typeof options.userId !== 'string' || options.userId.trim() === '')) return null;
  const kinds = options.kinds ?? ACCOUNT_TABLES.map((t) => t.kind);
  for (const { kind, table, accountColumn } of ACCOUNT_TABLES) {
    if (!kinds.includes(kind)) continue;
    const query = (admin.from(table) as { select(columns: string): GuardQuery }).select('id, user_id');
    let scoped = query.eq('organization_id', organizationId).eq(accountColumn, accountId);
    if (options.userId !== undefined) scoped = scoped.eq('user_id', options.userId);
    const { data, error } = await scoped.limit(1);
    if (error) {
      throw new UnipileError('server', {
        code: 'ownership_check_failed',
        debug: { note: `ownership lookup failed on ${table}`, body: error },
      });
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (row && typeof row === 'object') {
      const record = row as Record<string, unknown>;
      return { kind, rowId: text(record.id), userId: text(record.user_id) };
    }
  }
  return null;
}

/**
 * Throws `AccountNotOwnedError` unless the account is linked in the
 * organisation; otherwise returns where. Call it before any provider call made
 * on behalf of a request.
 */
export async function assertAccountOwnedByOrg(
  admin: GuardAdmin,
  organizationId: string,
  accountId: string,
  options: OwnershipOptions = {},
): Promise<AccountOwnership> {
  const ownership = await findAccountOwnership(admin, organizationId, accountId, options);
  if (!ownership) throw new AccountNotOwnedError();
  return ownership;
}
