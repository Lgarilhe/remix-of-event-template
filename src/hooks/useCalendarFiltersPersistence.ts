/**
 * useCalendarFiltersPersistence — persiste les filtres du calendrier dans
 * localStorage par user (comme `useDashboardLayout`).
 *
 * Expose aussi la gestion de **presets** nommés : "Mes entretiens semaine",
 * "Tous les Calendly", etc. L'user sauvegarde son set de filtres + lui
 * donne un nom, peut le re-charger en 1 clic.
 *
 * Pattern Linear / Notion : presets utilisateur, chargement instantané.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';
import {
  DEFAULT_FILTERS,
  type CalendarFilters,
} from '@/components/calendar/CalendarFiltersBar';

const FILTERS_KEY = (userId: string | null) =>
  userId ? `calendar-filters-${userId}` : 'calendar-filters-anon';

const PRESETS_KEY = (userId: string | null) =>
  userId ? `calendar-filter-presets-${userId}` : 'calendar-filter-presets-anon';

export interface CalendarFilterPreset {
  id: string;
  name: string;
  filters: CalendarFilters;
  createdAt: string;
}

const readJson = <T>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = (key: string, value: unknown) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage plein/désactivé → silencieux
  }
};

export function useCalendarFiltersPersistence() {
  const { user } = useAuthReady();
  const userId = user?.id || null;

  // ─── Filters live state ───────────────────────────────────────────────
  const [filters, setFiltersState] = useState<CalendarFilters>(DEFAULT_FILTERS);

  // Charger les filtres au mount du userId
  useEffect(() => {
    const stored = readJson<CalendarFilters | null>(FILTERS_KEY(userId), null);
    if (stored) {
      // Reconcile : keep only known keys (DEFAULT_FILTERS shape)
      setFiltersState({
        types: Array.isArray(stored.types) ? stored.types : [],
        myEventsOnly: !!stored.myEventsOnly,
        managerUserIds: Array.isArray(stored.managerUserIds) ? stored.managerUserIds : [],
        projectIds: Array.isArray(stored.projectIds) ? stored.projectIds : [],
        formats: Array.isArray(stored.formats) ? stored.formats : [],
        rounds: Array.isArray(stored.rounds) ? stored.rounds : [],
      });
    } else {
      setFiltersState(DEFAULT_FILTERS);
    }
  }, [userId]);

  const setFilters = useCallback(
    (next: CalendarFilters) => {
      setFiltersState(next);
      writeJson(FILTERS_KEY(userId), next);
    },
    [userId],
  );

  // ─── Presets ──────────────────────────────────────────────────────────
  const [presets, setPresetsState] = useState<CalendarFilterPreset[]>([]);

  useEffect(() => {
    setPresetsState(readJson<CalendarFilterPreset[]>(PRESETS_KEY(userId), []));
  }, [userId]);

  const writePresets = useCallback(
    (list: CalendarFilterPreset[]) => {
      setPresetsState(list);
      writeJson(PRESETS_KEY(userId), list);
    },
    [userId],
  );

  const savePreset = useCallback(
    (name: string) => {
      const next: CalendarFilterPreset = {
        id: `preset-${Date.now()}`,
        name: name.trim() || 'Sans nom',
        filters,
        createdAt: new Date().toISOString(),
      };
      writePresets([...presets, next]);
      return next;
    },
    [filters, presets, writePresets],
  );

  const loadPreset = useCallback(
    (presetId: string) => {
      const preset = presets.find((p) => p.id === presetId);
      if (preset) setFilters(preset.filters);
    },
    [presets, setFilters],
  );

  const deletePreset = useCallback(
    (presetId: string) => {
      writePresets(presets.filter((p) => p.id !== presetId));
    },
    [presets, writePresets],
  );

  return {
    filters,
    setFilters,
    presets,
    savePreset,
    loadPreset,
    deletePreset,
  };
}
