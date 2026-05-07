/**
 * CalendarDayView — vue jour avec timeline horaire 8h–20h.
 *
 * Une seule colonne, hauteur scaled par durée. La line "il est 14h32"
 * est un trait rouge horizontal positionné en absolute. Click sur slot
 * vide → openCreateEvent(date, hour).
 *
 * Pattern Cal.com / Google Calendar.
 */

import React, { useEffect, useRef } from 'react';
import { format, isSameDay, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';

interface CalendarDayViewProps {
  day: Date;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick?: (date: Date) => void;
  conflictIds?: Set<string>;
  bufferIds?: Set<string>;
  renderEvent: (event: CalendarEvent, opts: { compact: boolean }) => React.ReactNode;
}

const HOUR_HEIGHT = 56; // px par heure
const START_HOUR = 7;
const END_HOUR = 21; // 21h exclusif → 7h-21h = 14 heures visibles

export const CalendarDayView: React.FC<CalendarDayViewProps> = ({
  day,
  events,
  onEventClick,
  onSlotClick,
  renderEvent,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isToday = isSameDay(day, new Date());

  // Auto-scroll to current hour at mount (si today) ou 9h sinon
  useEffect(() => {
    if (!containerRef.current) return;
    const targetHour = isToday ? new Date().getHours() : 9;
    const scrollY = (targetHour - START_HOUR) * HOUR_HEIGHT - 40;
    containerRef.current.scrollTop = Math.max(0, scrollY);
  }, [isToday]);

  // Heure courante en pixels depuis START_HOUR
  const nowOffsetPx = (() => {
    if (!isToday) return null;
    const now = new Date();
    const totalMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = START_HOUR * 60;
    return ((totalMinutes - startMinutes) / 60) * HOUR_HEIGHT;
  })();

  // Range d'heures à afficher
  const hours: number[] = [];
  for (let h = START_HOUR; h < END_HOUR; h++) hours.push(h);

  // Position d'un event en y (top) + height
  const eventPosition = (e: CalendarEvent): { top: number; height: number } | null => {
    try {
      const start = parseISO(e.startAt);
      if (!isSameDay(start, day)) return null;
      const startMinutes = start.getHours() * 60 + start.getMinutes();
      const baseMinutes = START_HOUR * 60;
      const top = ((startMinutes - baseMinutes) / 60) * HOUR_HEIGHT;

      let endMinutes = startMinutes + 30; // default 30 min
      if (e.endAt) {
        try {
          const end = parseISO(e.endAt);
          endMinutes = end.getHours() * 60 + end.getMinutes();
        } catch {
          // skip
        }
      }
      const height = Math.max(((endMinutes - startMinutes) / 60) * HOUR_HEIGHT, 32);
      return { top, height };
    } catch {
      return null;
    }
  };

  const dayEvents = events.filter((e) => {
    try {
      return isSameDay(parseISO(e.startAt), day);
    } catch {
      return false;
    }
  });

  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden flex flex-col">
      {/* Day header */}
      <div
        className={cn(
          'px-5 py-3 border-b border-border flex items-center justify-between',
          isToday && 'bg-emerald-500/15',
        )}
      >
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {format(day, 'EEEE', { locale: fr })}
          </p>
          <p className="font-display text-xl font-bold leading-tight tabular-nums tracking-tight text-foreground">
            {format(day, 'd MMMM yyyy', { locale: fr })}
          </p>
        </div>
        <span className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 rounded-full text-xs font-bold tabular-nums bg-foreground/10 text-foreground">
          {dayEvents.length}
        </span>
      </div>

      {/* Timeline */}
      <div ref={containerRef} className="flex-1 overflow-y-auto max-h-[640px]">
        <div
          className="relative"
          style={{ height: `${(END_HOUR - START_HOUR) * HOUR_HEIGHT}px` }}
        >
          {/* Hour lines */}
          {hours.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => {
                if (onSlotClick) {
                  const slotDate = new Date(day);
                  slotDate.setHours(h, 0, 0, 0);
                  onSlotClick(slotDate);
                }
              }}
              className="absolute left-0 right-0 h-[56px] flex items-start gap-3 px-3 hover:bg-muted/20 transition-colors group"
              style={{ top: `${(h - START_HOUR) * HOUR_HEIGHT}px` }}
              aria-label={`Programmer un événement à ${h}h`}
            >
              <span className="text-[10px] text-muted-foreground tabular-nums font-medium w-10 shrink-0 mt-0.5">
                {String(h).padStart(2, '0')}:00
              </span>
              <div className="flex-1 h-px bg-border/40 mt-1.5" />
            </button>
          ))}

          {/* Current time indicator */}
          {nowOffsetPx != null && nowOffsetPx >= 0 && (
            <div
              className="absolute left-12 right-2 z-10 pointer-events-none"
              style={{ top: `${nowOffsetPx}px` }}
            >
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-destructive shadow-[0_0_0_4px_rgba(239,68,68,0.15)]" />
                <div className="flex-1 h-px bg-destructive" />
                <span className="text-[10px] font-bold text-destructive tabular-nums">
                  {format(new Date(), 'HH:mm')}
                </span>
              </div>
            </div>
          )}

          {/* Events */}
          {dayEvents.map((e) => {
            const pos = eventPosition(e);
            if (!pos) return null;
            return (
              <div
                key={e.id}
                className="absolute left-[60px] right-3 z-20"
                style={{ top: `${pos.top}px`, height: `${pos.height}px` }}
              >
                <div
                  className="h-full overflow-hidden cursor-pointer"
                  onClick={() => onEventClick(e)}
                >
                  {renderEvent(e, { compact: pos.height < 70 })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
