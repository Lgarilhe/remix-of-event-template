import { useCallback, useSyncExternalStore } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import {
  MISSION_VISITS_KEY_PREFIX,
  missionVisitsStorageKey,
  parseMissionVisits,
  withMissionBaselines,
  withMissionVisit,
  type MissionVisits,
} from '@/lib/sidebarMissions';

/**
 * Relevé local des missions (D18, §3.6) : dernière vue et total de profils vu,
 * par utilisateur, dans le stockage local (clé konekt:nav:missions:{userId}).
 *
 * Magasin partagé au niveau du module : MissionVisitTracker (qui écrit) et le
 * panneau Missions (qui lit) voient la même copie. Chaque écriture notifie tous
 * les abonnés : le point « nouveaux profils » s'éteint dès l'ouverture de la
 * mission, dans le panneau affiché. L'événement `storage` ne se déclenche pas
 * dans l'onglet qui écrit ; il sert seulement à suivre les autres onglets.
 */

const EMPTY: MissionVisits = Object.freeze({});

const cache = new Map<string, MissionVisits>();
const subscribers = new Set<() => void>();

function readStored(userId: string): MissionVisits {
  try {
    return parseMissionVisits(localStorage.getItem(missionVisitsStorageKey(userId)));
  } catch {
    // Stockage indisponible (navigation privée, sites bloqués) : relevé vide.
    return EMPTY;
  }
}

function getVisits(userId: string | null): MissionVisits {
  if (!userId) return EMPTY;
  let visits = cache.get(userId);
  if (!visits) {
    visits = readStored(userId);
    cache.set(userId, visits);
  }
  return visits;
}

function notifySubscribers(): void {
  for (const notify of subscribers) notify();
}

function writeVisits(userId: string, next: MissionVisits): void {
  if (getVisits(userId) === next) return;
  cache.set(userId, next);
  try {
    localStorage.setItem(missionVisitsStorageKey(userId), JSON.stringify(next));
  } catch {
    // Stockage indisponible : le relevé vaut pour la session en cours.
  }
  notifySubscribers();
}

function onStorage(event: StorageEvent): void {
  if (!event.key || !event.key.startsWith(MISSION_VISITS_KEY_PREFIX)) return;
  const userId = event.key.slice(MISSION_VISITS_KEY_PREFIX.length);
  cache.set(userId, parseMissionVisits(event.newValue));
  notifySubscribers();
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  if (subscribers.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

export interface MissionVisitsApi {
  visits: MissionVisits;
  /** Relevé de la mission ouverte : vue courante et total vu. */
  recordVisit: (projectId: string, visit: { view: string | null; seenTotal: number }) => void;
  /** Référence `{ v: null, n }` des missions jamais relevées (n'allume aucun point). */
  ensureBaselines: (items: ReadonlyArray<{ id: string; n: number }>) => void;
}

export function useMissionVisits(): MissionVisitsApi {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;

  const visits = useSyncExternalStore(
    subscribe,
    () => getVisits(userId),
    () => EMPTY,
  );

  const recordVisit = useCallback(
    (projectId: string, visit: { view: string | null; seenTotal: number }) => {
      if (!userId || !projectId) return;
      const current = getVisits(userId);
      writeVisits(
        userId,
        withMissionVisit(current, projectId, { v: visit.view, n: visit.seenTotal }, new Date().toISOString()),
      );
    },
    [userId],
  );

  const ensureBaselines = useCallback(
    (items: ReadonlyArray<{ id: string; n: number }>) => {
      if (!userId || items.length === 0) return;
      const current = getVisits(userId);
      writeVisits(userId, withMissionBaselines(current, items, new Date().toISOString()));
    },
    [userId],
  );

  return { visits, recordVisit, ensureBaselines };
}
