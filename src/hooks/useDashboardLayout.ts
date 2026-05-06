/**
 * useDashboardLayout — gère l'ordre des sections du Dashboard.
 *
 * Persisté dans localStorage par user (clé `dashboard-layout-${userId}`).
 * Les sections sont identifiées par des clés stables, l'ordre est un
 * `string[]`. Si une nouvelle section est ajoutée au code, elle est
 * automatiquement appendée à la fin de l'ordre persisté ; les sections
 * supprimées sont filtrées.
 *
 * Pattern Notion/Linear : drag-to-reorder avec persistance silencieuse,
 * pas de bouton "save layout" — le user range, c'est rangé.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';

/** Clés stables des sections du Dashboard (ordre par défaut). */
export const DASHBOARD_SECTION_KEYS = [
  'connections',
  'focus',
  'missions-today',
  'week',
  'activity',
] as const;

export type DashboardSectionKey = (typeof DASHBOARD_SECTION_KEYS)[number];

const DEFAULT_ORDER: DashboardSectionKey[] = [...DASHBOARD_SECTION_KEYS];

const storageKeyFor = (userId: string | null) =>
  userId ? `dashboard-layout-${userId}` : 'dashboard-layout-anon';

const readFromStorage = (userId: string | null): DashboardSectionKey[] | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKeyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Filtrer les clés invalides (en cas de section renommée/supprimée)
    return parsed.filter((k): k is DashboardSectionKey =>
      (DASHBOARD_SECTION_KEYS as readonly string[]).includes(k),
    );
  } catch {
    return null;
  }
};

const writeToStorage = (userId: string | null, order: DashboardSectionKey[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKeyFor(userId), JSON.stringify(order));
  } catch {
    // localStorage plein/désactivé → on ignore silencieusement
  }
};

/**
 * Reconciliate stored order with current code:
 * - Garde l'ordre persisté pour les clés qui existent toujours
 * - Append les nouvelles clés (ajoutées au code) à la fin
 * - Drop les clés supprimées (déjà filtrées par readFromStorage)
 */
const reconcileOrder = (stored: DashboardSectionKey[]): DashboardSectionKey[] => {
  const result = [...stored];
  for (const key of DEFAULT_ORDER) {
    if (!result.includes(key)) result.push(key);
  }
  return result;
};

export function useDashboardLayout() {
  const { user } = useAuthReady();
  const userId = user?.id || null;

  const [order, setOrderState] = useState<DashboardSectionKey[]>(DEFAULT_ORDER);

  // Charge depuis localStorage à l'arrivée du userId
  useEffect(() => {
    const stored = readFromStorage(userId);
    if (stored && stored.length > 0) {
      setOrderState(reconcileOrder(stored));
    } else {
      setOrderState(DEFAULT_ORDER);
    }
  }, [userId]);

  const setOrder = useCallback(
    (next: DashboardSectionKey[]) => {
      setOrderState(next);
      writeToStorage(userId, next);
    },
    [userId],
  );

  const resetOrder = useCallback(() => {
    setOrderState(DEFAULT_ORDER);
    writeToStorage(userId, DEFAULT_ORDER);
  }, [userId]);

  const isCustomized = useMemo(
    () => order.some((k, i) => k !== DEFAULT_ORDER[i]),
    [order],
  );

  return {
    order,
    setOrder,
    resetOrder,
    isCustomized,
  };
}
