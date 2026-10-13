/**
 * Account status mapping.
 *
 * Both `GET /accounts` and the `account.status.*` events go through
 * `mapAccountStatus`. Stored `account_status` values stay `OK | CREDENTIALS |
 * ERROR` and gain `DEGRADED | PARTIAL | LOCKED` (the column is text).
 *
 * Provider status      Konekt status   Meaning
 *   running            OK              operational
 *   disconnected       CREDENTIALS     needs authentication (reconnect)
 *   errored            ERROR           service interruption
 *   degraded           DEGRADED        one product runs while another errored
 *   partial            PARTIAL         one product runs while another needs authentication
 *   is_locked: true    LOCKED          API access locked (wins over running, degraded, partial, errored)
 *
 * `disconnected` wins over `is_locked`: reconnecting is the actionable remedy.
 * An unknown, missing or malformed status maps to ERROR, never to OK: a doubt
 * must not let a send through.
 */

export type KonektAccountStatus = 'OK' | 'CREDENTIALS' | 'ERROR' | 'DEGRADED' | 'PARTIAL' | 'LOCKED';

const KONEKT_STATUSES: readonly KonektAccountStatus[] = ['OK', 'CREDENTIALS', 'ERROR', 'DEGRADED', 'PARTIAL', 'LOCKED'];

/**
 * Maps a provider account status (and its `is_locked` flag) to the Konekt
 * status. A value that already is a Konekt status passes through (so a stored
 * value can be re-mapped safely); the case of provider values is ignored.
 */
export function mapAccountStatus(status: unknown, isLocked?: unknown): KonektAccountStatus {
  const raw = typeof status === 'string' ? status.trim() : '';
  const konekt = KONEKT_STATUSES.find((s) => s === raw);
  const provider = raw.toLowerCase();
  const base: KonektAccountStatus = konekt ??
    (provider === 'running'
      ? 'OK'
      : provider === 'disconnected'
      ? 'CREDENTIALS'
      : provider === 'errored'
      ? 'ERROR'
      : provider === 'degraded'
      ? 'DEGRADED'
      : provider === 'partial'
      ? 'PARTIAL'
      : 'ERROR');
  if (base === 'CREDENTIALS') return base;
  return isLocked === true ? 'LOCKED' : base;
}

/** Only an `OK` account may send. DEGRADED, PARTIAL and LOCKED stop sends without pausing enrollments. */
export function isSendable(status: unknown): boolean {
  return status === 'OK';
}

/**
 * True when asking the member to reconnect can fix the account:
 * CREDENTIALS, PARTIAL (a product needs authentication) and ERROR.
 * DEGRADED recovers by itself and LOCKED is not fixed by reconnecting.
 */
export function isReconnectable(status: unknown): boolean {
  return status === 'CREDENTIALS' || status === 'PARTIAL' || status === 'ERROR';
}

/** Outcome of `account.remove`: terminal, not a recoverable disconnect. */
export interface AccountRemoval {
  status: 'REMOVED';
  /** A removed account is gone from the provider: reconnecting creates a new one. */
  recoverable: false;
  /** Drop the member link (`member_*_accounts`). */
  unlink: true;
  /** Stop every send of the account (enrollments, InMail queue, rotations). */
  stopSending: true;
}

/** What to do when the provider reports `account.remove`: never the disconnect path. */
export function mapAccountRemoved(): AccountRemoval {
  return { status: 'REMOVED', recoverable: false, unlink: true, stopSending: true };
}
