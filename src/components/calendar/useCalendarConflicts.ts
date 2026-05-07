/**
 * useCalendarConflicts — détecte les chevauchements et la surcharge
 * journalière dans une liste d'events.
 *
 * - Conflict : 2 events qui se chevauchent (start1 < end2 && end1 > start2)
 *   pour le MÊME manager (sinon c'est juste 2 collègues qui ont chacun
 *   leur RDV en parallèle, pas un problème)
 * - Overload : >5 events sur la même journée
 * - Buffer : <10 min entre 2 events consécutifs du même manager
 *
 * Returns :
 * - conflictIds : Set<eventId> — events impliqués dans un chevauchement
 * - bufferIds : Set<eventId> — events trop proches du précédent
 * - overloadDays : Map<dateKey, count> — jours surchargés (>=5 events)
 */

import { useMemo } from 'react';
import { parseISO, format } from 'date-fns';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';

const OVERLOAD_THRESHOLD = 5;
const BUFFER_MIN_MINUTES = 10;
const DEFAULT_DURATION_MIN = 30;

export interface CalendarConflicts {
  conflictIds: Set<string>;
  bufferIds: Set<string>;
  overloadDays: Map<string, number>;
}

export function useCalendarConflicts(events: CalendarEvent[]): CalendarConflicts {
  return useMemo(() => {
    const conflictIds = new Set<string>();
    const bufferIds = new Set<string>();
    const overloadDays = new Map<string, number>();

    // Build {start, end, eventId, managerId} for chaque event
    const ranges = events
      .map((e) => {
        try {
          const start = parseISO(e.startAt).getTime();
          const end = e.endAt
            ? parseISO(e.endAt).getTime()
            : start + DEFAULT_DURATION_MIN * 60 * 1000;
          return {
            id: e.id,
            start,
            end,
            managerId: e.meta?.manager?.userId || null,
            type: e.type,
          };
        } catch {
          return null;
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Surcharge journalière
    for (const e of events) {
      try {
        const dayKey = format(parseISO(e.startAt), 'yyyy-MM-dd');
        overloadDays.set(dayKey, (overloadDays.get(dayKey) || 0) + 1);
      } catch {
        // skip
      }
    }
    // Garde uniquement les jours overloaded
    for (const [day, count] of Array.from(overloadDays.entries())) {
      if (count < OVERLOAD_THRESHOLD) overloadDays.delete(day);
    }

    // Conflits + buffers — uniquement entre events du même manager (ou 2 events
    // sans manager = on assume même user, prudence). Les events de managers
    // différents ne se chevauchent pas pour l'user courant.
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i];
        const b = ranges[j];
        // Skip si managers différents et tous deux non-null
        if (a.managerId && b.managerId && a.managerId !== b.managerId) continue;

        // Overlap strict : a.start < b.end && a.end > b.start
        if (a.start < b.end && a.end > b.start) {
          conflictIds.add(a.id);
          conflictIds.add(b.id);
          continue; // overlap = conflit, pas la peine de checker buffer
        }

        // Buffer : si gap < BUFFER_MIN_MINUTES entre fin d'un et début de l'autre
        const gapMs = Math.min(
          Math.abs(a.start - b.end),
          Math.abs(b.start - a.end),
        );
        const gapMin = gapMs / (60 * 1000);
        if (gapMin > 0 && gapMin < BUFFER_MIN_MINUTES) {
          // L'event "second" (qui démarre après l'autre) reçoit le warning buffer
          if (a.start > b.start) bufferIds.add(a.id);
          else bufferIds.add(b.id);
        }
      }
    }

    return { conflictIds, bufferIds, overloadDays };
  }, [events]);
}
