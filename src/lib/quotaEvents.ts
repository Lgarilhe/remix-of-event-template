/**
 * Global event bus for quota tracking.
 * Any part of the app can emit quota events; the useUnipileQuota hook
 * listens and updates its state + localStorage accordingly.
 */

export type QuotaActionType =
  | 'searchResultsFetched'
  | 'profileVisits'
  | 'messagesSent'
  | 'invitationsSent'
  | 'inmailsSent'
  | 'otherActions';

const EVENT_NAME = 'quota:record';

interface QuotaEvent {
  type: QuotaActionType;
  count: number;
  accountId?: string;
}

export function emitQuotaAction(type: QuotaActionType, count = 1, accountId?: string) {
  window.dispatchEvent(
    new CustomEvent<QuotaEvent>(EVENT_NAME, {
      detail: { type, count, accountId },
    })
  );
}

export function onQuotaAction(handler: (e: QuotaEvent) => void): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<QuotaEvent>).detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
