/**
 * Garde « une fois par chat (et par version du chat) et par session » pour les
 * déclencheurs front d'auto-analyze-message : prefetch (useAutoPrefetchAnalyses),
 * sélection sur cache-miss (useMessagesInbox) et ré-analyse « stale »
 * (useChatIntents). Persistée en sessionStorage pour résister aux remounts
 * (route change /inbox → /missions → /inbox), même pattern que
 * MessageView.autoSyncedChats. La clé inclut le timestamp du dernier message :
 * un nouveau message ré-autorise une analyse, une simple navigation non.
 */
const SESSION_KEY = 'inbox.autoAnalyzedChats';

let memo: Set<string> | null = null;

function load(): Set<string> {
  if (memo) return memo;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    memo = new Set(Array.isArray(arr) ? arr : []);
  } catch {
    memo = new Set();
  }
  return memo;
}

export function autoAnalyzeKey(chat: { id: string; last_message?: { timestamp?: string | null } | null }): string {
  return `${chat.id}@${chat.last_message?.timestamp ?? ''}`;
}

export function hasAutoAnalyzed(key: string): boolean {
  return load().has(key);
}

export function markAutoAnalyzed(key: string): void {
  const set = load();
  set.add(key);
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...set]));
  } catch {
    // Quota dépassé ou storage désactivé → garde en mémoire seule
  }
}

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Lance `run` une seule fois par clé et par session, et partage la promesse
 * en vol : un second déclencheur (sélection d'un chat pendant son
 * préchargement) attend la même analyse au lieu de repartir ou d'abandonner.
 * Retourne null si la clé a déjà été traitée et qu'aucune analyse n'est en cours.
 */
export function runAutoAnalyzeOnce<T>(key: string, run: () => Promise<T>): Promise<T> | null {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  if (hasAutoAnalyzed(key)) return null;
  markAutoAnalyzed(key);
  const pending = run().finally(() => { inFlight.delete(key); });
  inFlight.set(key, pending);
  return pending;
}
