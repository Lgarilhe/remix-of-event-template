/**
 * Copies privées des photos des candidats, côté écran (design simplifié, lot P,
 * docs/design/06-simplicite.md).
 *
 * La fonction capture-candidate-photos copie la photo LinkedIn d'un candidat
 * dans le bucket privé candidate-photos. PersonAvatar, avec `candidateId`,
 * montre cette copie d'abord, sinon le lien LinkedIn, sinon les initiales.
 *
 * - Les visages affichés en même temps sont lus ensemble : une lecture de
 *   candidate_photos et une signature d'adresses par lot de 100 candidats.
 * - Une adresse signée vaut une heure ; elle est redemandée cinq minutes avant
 *   la fin pour les visages encore à l'écran.
 * - Un candidat sans copie n'est pas relu avant cinq minutes.
 *
 * Ce module ne lit pas la base : le chargeur est donné par
 * CandidatePhotosProvider (src/components/CandidatePhotosProvider.tsx). Sans
 * fournisseur (pages publiques, rendu statique des tests), pas de copie.
 */

import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

export const PHOTO_BUCKET = 'candidate-photos';
/** Durée d'une adresse signée, en secondes. */
export const PHOTO_URL_TTL_S = 3600;

export interface SignedPhoto {
  url: string;
  /** Fin de validité de l'adresse (ms depuis l'époque). */
  expiresAt: number;
}

/** Copies des candidats demandés ; un candidat absent de la réponse n'en a pas. */
export type CandidatePhotoLoader = (candidateIds: string[]) => Promise<Map<string, SignedPhoto>>;

export interface CandidatePhotoStore {
  subscribe(candidateId: string, onChange: () => void): () => void;
  /** Adresse de la copie, ou null (pas de copie, ou pas encore lue). */
  get(candidateId: string): string | null;
}

export interface CandidatePhotoStoreOptions {
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** Attente avant une lecture, pour grouper les visages d'un même rendu. */
  batchDelayMs?: number;
  batchSize?: number;
  /** Délai avant de relire un candidat sans copie, ou après une lecture en échec. */
  missRetryMs?: number;
  /** Avance prise sur la fin d'une adresse signée pour la redemander. */
  refreshMarginMs?: number;
}

interface Entry {
  url: string | null;
  /** Au-delà, le candidat est relu à son prochain affichage. */
  staleAt: number;
}

export function createCandidatePhotoStore(
  load: CandidatePhotoLoader,
  {
    now = Date.now,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    batchDelayMs = 16,
    batchSize = 100,
    missRetryMs = 5 * 60_000,
    refreshMarginMs = 5 * 60_000,
  }: CandidatePhotoStoreOptions = {},
): CandidatePhotoStore {
  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<() => void>>();
  const queued = new Set<string>();
  const inflight = new Set<string>();
  let flushScheduled = false;

  const watched = (id: string) => (listeners.get(id)?.size ?? 0) > 0;

  const notify = (id: string) => {
    for (const listener of [...(listeners.get(id) ?? [])]) listener();
  };

  const write = (id: string, entry: Entry) => {
    const changed = (entries.get(id)?.url ?? null) !== entry.url;
    entries.set(id, entry);
    if (changed) notify(id);
  };

  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    setTimer(flush, batchDelayMs);
  };

  // Adresses du lot redemandées avant leur fin pour les visages encore à l'écran ;
  // les autres sont oubliées et relues au prochain affichage.
  const scheduleRefresh = (ids: string[], staleAt: number) => {
    setTimer(() => {
      for (const id of ids) {
        if (entries.get(id)?.staleAt !== staleAt) continue;
        if (watched(id)) queued.add(id);
        else entries.delete(id);
      }
      if (queued.size > 0) scheduleFlush();
    }, Math.max(0, staleAt - now()));
  };

  const loadBatch = async (ids: string[]) => {
    try {
      const photos = await load(ids);
      const hitsByStaleAt = new Map<number, string[]>();
      for (const id of ids) {
        const photo = photos.get(id);
        if (photo?.url) {
          const staleAt = photo.expiresAt - refreshMarginMs;
          hitsByStaleAt.set(staleAt, [...(hitsByStaleAt.get(staleAt) ?? []), id]);
          write(id, { url: photo.url, staleAt });
        } else {
          write(id, { url: null, staleAt: now() + missRetryMs });
        }
      }
      for (const [staleAt, hits] of hitsByStaleAt) scheduleRefresh(hits, staleAt);
    } catch (error) {
      console.warn('[candidatePhotos] lecture des copies impossible :', error);
      // L'adresse déjà connue reste affichée ; nouvel essai dans cinq minutes.
      for (const id of ids) write(id, { url: entries.get(id)?.url ?? null, staleAt: now() + missRetryMs });
    } finally {
      for (const id of ids) inflight.delete(id);
    }
  };

  function flush() {
    flushScheduled = false;
    const ids = [...queued].filter(watched);
    queued.clear();
    for (const id of ids) inflight.add(id);
    for (let i = 0; i < ids.length; i += batchSize) void loadBatch(ids.slice(i, i + batchSize));
  }

  const ensure = (id: string) => {
    if (queued.has(id) || inflight.has(id)) return;
    const entry = entries.get(id);
    if (entry && now() < entry.staleAt) return;
    queued.add(id);
    scheduleFlush();
  };

  return {
    subscribe(id, onChange) {
      const set = listeners.get(id) ?? new Set<() => void>();
      listeners.set(id, set);
      set.add(onChange);
      ensure(id);
      return () => {
        set.delete(onChange);
        if (set.size === 0 && listeners.get(id) === set) listeners.delete(id);
      };
    },
    get(id) {
      return entries.get(id)?.url ?? null;
    },
  };
}

export const CandidatePhotoContext = createContext<CandidatePhotoStore | null>(null);

const noSubscription = () => () => {};
const noPhoto = () => null;

/** Adresse signée de la copie privée du candidat, ou null. */
export function useCandidatePhoto(candidateId?: string | null): string | null {
  const store = useContext(CandidatePhotoContext);
  const id = candidateId?.trim() || null;
  const subscribe = useCallback(
    (onChange: () => void) => (store && id ? store.subscribe(id, onChange) : noSubscription()),
    [store, id],
  );
  const read = useCallback(() => (store && id ? store.get(id) : null), [store, id]);
  return useSyncExternalStore(subscribe, read, noPhoto);
}
