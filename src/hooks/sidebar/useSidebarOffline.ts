/**
 * Hors ligne (D42) : état réseau du navigateur et heure des plus anciennes
 * données affichées par la barre.
 *
 * React Query met en pause une requête hors ligne au lieu de la mettre en
 * erreur ; la barre affiche alors un seul bandeau en tête du panneau.
 * dataTime = plus petit dataUpdatedAt > 0 des requêtes ['sidebar', …] et
 * ['all-reminders', 'overdue-count', …] qui ont des données, lu dans le cache
 * au rendu : le changement d'état réseau provoque le rendu.
 */
import { useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const getSnapshot = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;
const getServerSnapshot = (): boolean => false;

const SIDEBAR_KEY_PREFIXES: ReadonlyArray<readonly string[]> = [
  ['sidebar'],
  ['all-reminders', 'overdue-count'],
];

function oldestDataTime(queryClient: QueryClient): number | null {
  let oldest: number | null = null;
  for (const queryKey of SIDEBAR_KEY_PREFIXES) {
    for (const query of queryClient.getQueryCache().findAll({ queryKey })) {
      const { data, dataUpdatedAt } = query.state;
      if (data === undefined || dataUpdatedAt <= 0) continue;
      if (oldest === null || dataUpdatedAt < oldest) oldest = dataUpdatedAt;
    }
  }
  return oldest;
}

export function useSidebarOffline(): { offline: boolean; dataTime: number | null } {
  const offline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const queryClient = useQueryClient();
  return { offline, dataTime: offline ? oldestDataTime(queryClient) : null };
}
