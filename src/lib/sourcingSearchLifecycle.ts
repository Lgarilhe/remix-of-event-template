import type { LinkedInFiltersState } from '@/components/outreach/types';
import { INITIAL_FILTERS } from '@/components/outreach/types';
import { stableScoringContextKey } from '@/lib/sourcingScoringContext';

const filterSaveQueues = new Map<string, Promise<unknown>>();
const localFilterSnapshots = new Map<string, { latestKey: string; keys: Set<string> }>();

/** Survives a tab remount while the serialized save queue is still draining. */
export function rememberLocalSourcingSnapshot(projectId: string, snapshot: unknown): void {
  const key = sourcingSnapshotKey(snapshot);
  const known = localFilterSnapshots.get(projectId) ?? { latestKey: key, keys: new Set<string>() };
  known.latestKey = key;
  known.keys.add(key);
  localFilterSnapshots.set(projectId, known);
  // Search tabs keep a short-lived in-memory working set, never a persisted store.
  if (localFilterSnapshots.size > 50) {
    for (const oldest of localFilterSnapshots.keys()) {
      if (oldest !== projectId && !filterSaveQueues.has(oldest)) { localFilterSnapshots.delete(oldest); break; }
    }
  }
}

export function isSupersededSourcingSnapshot(projectId: string, snapshot: unknown): boolean {
  const known = localFilterSnapshots.get(projectId);
  if (!known) return false;
  const key = sourcingSnapshotKey(snapshot);
  return known.keys.has(key) && known.latestKey !== key;
}

/** A rejected edit cannot indefinitely hide the last confirmed server value. */
export function forgetFailedSourcingSnapshot(projectId: string, snapshot: unknown): void {
  const known = localFilterSnapshots.get(projectId);
  if (!known) return;
  const key = sourcingSnapshotKey(snapshot);
  known.keys.delete(key);
  if (known.keys.size === 0) localFilterSnapshots.delete(projectId);
  else if (known.latestKey === key) {
    const remaining = [...known.keys];
    known.latestKey = remaining[remaining.length - 1];
  }
}

/** One write at a time per mission, including saves flushed by an unmounted
 * tab. A slower previous write must finish before the next edit is submitted. */
export function enqueueSourcingFilterSave(projectId: string, save: () => Promise<unknown>): Promise<unknown> {
  const previous = filterSaveQueues.get(projectId) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(save);
  filterSaveQueues.set(projectId, task);
  const cleanup = () => { if (filterSaveQueues.get(projectId) === task) filterSaveQueues.delete(projectId); };
  void task.then(cleanup, cleanup);
  return task;
}

/** The cursor belongs to this immutable, successfully executed search. */
export interface ExecutedSourcingSearch {
  scopeKey: string;
  inputKey: string;
  filters: LinkedInFiltersState;
  params: Record<string, unknown>;
}

export function sourcingSearchInputKey(scopeKey: string, filters: LinkedInFiltersState, augmentation: unknown): string {
  return stableScoringContextKey({ scopeKey, filters, augmentation: augmentation ?? null });
}

export function sourcingSnapshotKey(snapshot: unknown): string {
  return stableScoringContextKey(snapshot ?? {});
}

/** A just-saved draft may reach the server after navigation. Accept that exact
 * draft, but never reuse a cache across a different brief or memory revision. */
export function isSourcingCacheCurrent(
  cached: { schemaVersion: number; snapshotKey: string; briefKey: string; memoryKey: string; filters: LinkedInFiltersState },
  current: { snapshot: Record<string, unknown>; briefKey: string; memoryKey: string },
): boolean {
  if (cached.schemaVersion !== 1 || cached.briefKey !== current.briefKey || cached.memoryKey !== current.memoryKey) return false;
  if (cached.snapshotKey === sourcingSnapshotKey(current.snapshot)) return true;
  if (!current.snapshot.last_manual_edit) return false;
  const saved = Object.fromEntries(Object.entries(INITIAL_FILTERS).map(([key, fallback]) => [
    key, current.snapshot[key] === undefined ? fallback : current.snapshot[key],
  ]));
  return stableScoringContextKey(saved) === stableScoringContextKey(cached.filters);
}
