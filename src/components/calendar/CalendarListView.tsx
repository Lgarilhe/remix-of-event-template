/**
 * CalendarListView — vue agenda chronologique scrollable.
 *
 * Pattern Notion / Cal.com agenda view : groupé par jour, ligne par event,
 * mobile-friendly. Pas de grille horaire, juste une liste lisible.
 */

import React from 'react';
import { format, isSameDay, isToday, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';

interface CalendarListViewProps {
  days: Date[];
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
  renderEvent: (event: CalendarEvent, opts: { compact: boolean }) => React.ReactNode;
}

export const CalendarListView: React.FC<CalendarListViewProps> = ({
  days,
  events,
  onEventClick,
  renderEvent,
}) => {
  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden divide-y divide-border">
      {days.map((day) => {
        const dayEvents = events
          .filter((e) => {
            try {
              return isSameDay(parseISO(e.startAt), day);
            } catch {
              return false;
            }
          })
          .sort((a, b) => a.startAt.localeCompare(b.startAt));

        const today = isToday(day);

        return (
          <div key={format(day, 'yyyy-MM-dd')}>
            {/* Day header sticky */}
            <div
              className={cn(
                'sticky top-0 z-10 px-5 py-2.5 backdrop-blur-sm flex items-center justify-between border-b border-border',
                today ? 'bg-emerald-500/15' : 'bg-muted/40',
              )}
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    'font-display font-bold text-foreground text-sm tracking-tight',
                  )}
                >
                  {format(day, 'EEEE d MMMM', { locale: fr }).replace(/^./, (c) => c.toUpperCase())}
                </span>
                {today && (
                  <span className="text-[10px] uppercase tracking-wider font-bold text-foreground">
                    Aujourd'hui
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10.5px] font-bold tabular-nums',
                  today ? 'bg-foreground text-background' : 'bg-foreground/10 text-foreground',
                )}
              >
                {dayEvents.length}
              </span>
            </div>

            {/* Events */}
            <div className="p-2 space-y-2">
              {dayEvents.length === 0 ? (
                <div className="text-center py-4 text-xs text-muted-foreground/60 italic">
                  Pas d'événement
                </div>
              ) : (
                dayEvents.map((event) => (
                  <div
                    key={event.id}
                    onClick={() => onEventClick(event)}
                    className="cursor-pointer"
                  >
                    {renderEvent(event, { compact: false })}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
