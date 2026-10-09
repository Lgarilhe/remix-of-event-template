import { useCallback, useSyncExternalStore } from 'react';

// Only the introduction's dismissal is stored here, never memory content or consent.
const seenThisSession = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function hasSeen(key: string | null) {
  if (!key || seenThisSession.has(key)) return true;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** First discovery is private to this user and workspace in the current browser. */
export function useAgentMemoryIntroduction(organizationId: string | null, userId: string | undefined) {
  const key = organizationId && userId ? `konekt_agent_memory_intro_v1:${organizationId}:${userId}` : null;
  const read = useCallback(() => hasSeen(key), [key]);
  const seen = useSyncExternalStore(subscribe, read, () => true);
  const markSeen = useCallback(() => {
    if (!key) return;
    seenThisSession.add(key);
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      // A blocked or full store still remembers dismissal for this session.
    }
    listeners.forEach((listener) => listener());
  }, [key]);

  return { key, shouldIntroduce: Boolean(key) && !seen, markSeen };
}
