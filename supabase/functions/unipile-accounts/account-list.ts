/**
 * Pure helpers of the account lists of `unipile-accounts` (no I/O, no database,
 * no provider call): the projection of a v2 account to the Konekt list entry, the
 * licences of an account, a bounded parallel map and a small time-to-live cache. Unit-tested in `account-list.test.ts`.
 */

import { isReconnectable, type KonektAccountStatus, mapAccountStatus } from '../_shared/unipile/index.ts';
import { displayAccountName } from './connection-steps.ts';

export interface LinkedInSubscriptions {
  classic: true;
  recruiter: boolean;
  sales_navigator: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * LinkedIn licences of an account. With the contract list (`GET .../linkedin/contracts`):
 * exact. Without it, a best effort from `metadata.products_connection_status` (its key
 * names are not documented, so a key that mentions a product counts for it); classic is
 * always on. A list entry is therefore never worse than the previous "classic only".
 */
export function subscriptionsFrom(
  contracts: ReadonlyArray<{ product?: unknown }> | null,
  productsConnectionStatus: unknown,
): LinkedInSubscriptions {
  if (contracts) {
    const products = contracts.map((c) => String(c?.product ?? '').toLowerCase());
    return { classic: true, recruiter: products.includes('recruiter'), sales_navigator: products.includes('sales_navigator') };
  }
  const keys = Object.keys(asRecord(productsConnectionStatus)).map((k) => k.toLowerCase());
  return {
    classic: true,
    recruiter: keys.some((k) => k.includes('recruiter')),
    sales_navigator: keys.some((k) => k.includes('sales') || k.includes('navigator')),
  };
}

export interface LinkedInListEntry {
  id: string;
  name: string;
  identifier: string;
  status: KonektAccountStatus | 'DELETED';
  mapped: boolean;
  profile_picture_url: string | null;
  subscriptions: LinkedInSubscriptions;
  is_locked: boolean;
  reconnectable: boolean;
  initial_sync_status: string | null;
  /** Vrai quand le prestataire n'a pas répondu pour ce compte : statut et licences ne sont pas lus (écran : « État à vérifier »). */
  unverified?: boolean;
}

/** List entry of a live v2 LinkedIn account. */
export function projectLinkedInEntry(
  account: Record<string, unknown>,
  options: {
    mapped: boolean;
    pictureUrl: string | null;
    contracts: ReadonlyArray<{ product?: unknown }> | null;
    storedName?: string | null;
  },
): LinkedInListEntry {
  const status = mapAccountStatus(account.status, account.is_locked === true);
  const metadata = asRecord(account.metadata);
  const name = displayAccountName(account.name ?? options.storedName, 'linkedin');
  return {
    id: String(account.id),
    name,
    identifier: name,
    status,
    mapped: options.mapped,
    profile_picture_url: options.pictureUrl,
    subscriptions: subscriptionsFrom(options.contracts, metadata.products_connection_status),
    is_locked: account.is_locked === true,
    reconnectable: isReconnectable(status),
    initial_sync_status: typeof asRecord(account.initial_sync).status === 'string' ? String(asRecord(account.initial_sync).status) : null,
  };
}

/**
 * Entry of a link whose stored account id is not a v2 id (an account that was not
 * carried over by the migration): shown as "to reconnect", classic licence only.
 * No provider call is made for it.
 */
export function outdatedLinkEntry(row: { linkedin_account_id: string; linkedin_account_name?: string | null }): LinkedInListEntry {
  const name = displayAccountName(row.linkedin_account_name, 'linkedin');
  return {
    id: row.linkedin_account_id,
    name,
    identifier: name,
    status: 'CREDENTIALS',
    mapped: true,
    profile_picture_url: null,
    subscriptions: { classic: true, recruiter: false, sales_navigator: false },
    is_locked: false,
    reconnectable: true,
    initial_sync_status: null,
  };
}

const KNOWN_STORED_STATUSES: readonly string[] = ['OK', 'CREDENTIALS', 'ERROR', 'DEGRADED', 'PARTIAL', 'LOCKED'];

/**
 * Stored statuses a webhook has already told us about: the account needs a person (reconnect), is interrupted, only
 * partly working or locked. When the provider cannot be read, these are shown as they are, with their matching action.
 */
const TOLD_STORED_STATUSES: readonly string[] = ['CREDENTIALS', 'ERROR', 'PARTIAL', 'LOCKED'];

/**
 * Entry of a link whose account the provider did not answer for (rate limit, server error,
 * timeout): the last stored status, no picture, classic licence only.
 *
 * `unverified: true` tells the screen that neither the status nor the licences were read, so it
 * shows "à vérifier" instead of "Actif" and an invented licence. It is set only when the stored
 * status says nothing (OK, DEGRADED, absent or unknown): nothing then says the account needs a
 * reconnection, so it is not marked reconnectable either. When the stored status is CREDENTIALS,
 * ERROR, PARTIAL or LOCKED, a webhook already told the truth: the entry carries that status and no
 * marker (the key is absent), and is reconnectable exactly as a read account in that status would be,
 * so the card shows the real state with its action instead of "État à vérifier".
 */
export function unverifiedLinkEntry(row: {
  linkedin_account_id: string;
  linkedin_account_name?: string | null;
  account_status?: string | null;
}): LinkedInListEntry {
  const name = displayAccountName(row.linkedin_account_name, 'linkedin');
  const stored = typeof row.account_status === 'string' && KNOWN_STORED_STATUSES.includes(row.account_status)
    ? row.account_status as KonektAccountStatus
    : 'OK';
  const told = TOLD_STORED_STATUSES.includes(stored);
  return {
    id: row.linkedin_account_id,
    name,
    identifier: name,
    status: stored,
    mapped: true,
    profile_picture_url: null,
    subscriptions: { classic: true, recruiter: false, sales_navigator: false },
    is_locked: stored === 'LOCKED',
    reconnectable: isReconnectable(stored),
    initial_sync_status: null,
    ...(told ? {} : { unverified: true }),
  };
}

/** True when the account goes through a custom proxy (not the provider's automatic one). */
export function hasCustomProxy(account: unknown): boolean {
  const proxy = asRecord(asRecord(account).proxy);
  return proxy.auto_proxy === false || (typeof proxy.host === 'string' && proxy.host !== '');
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** A host name or an IP address a proxy can be reached at: a string of at most 253 characters, nothing else. */
export function isValidProxyHost(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const host = value.trim();
  if (host === '' || host.length > 253) return false;
  if (host.includes(':')) return /^[0-9a-f:.]+$/i.test(host) && host.split(':').length >= 3; // IPv6
  return host.split('.').every((label) => HOST_LABEL.test(label));
}

/** Runs `fn` over `items` with at most `limit` calls in flight. Results keep the order of `items`. */
export async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Small time-to-live cache for values read per account (profile picture, contracts).
 * Per isolate and best effort: an empty cache only costs one more provider read.
 * Holds no credential.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  constructor(private readonly ttlMs: number, private readonly maxEntries = 200, private readonly now: () => number = Date.now) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** `ttlMs` overrides the default lifetime for this entry (a failed read is kept shorter). */
  set(key: string, value: V, ttlMs: number = this.ttlMs): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
  }
}
