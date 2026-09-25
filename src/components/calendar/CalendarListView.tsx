/**
 * CalendarListView — la période en liste chronologique, jour par jour.
 *
 * Seuls les jours qui ont des événements s'affichent : une semaine à un seul
 * entretien tient en une ligne (revue design A-43). L'en-tête de jour reste
 * visible en haut pendant le défilement. Lisible sur téléphone, c'est
 * l'affichage par défaut sous 768 px.
 */

import React from 'react';
import { format, isSameDay, isToday, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';

interface CalendarListViewProps {
  days: Date[];
  events: CalendarEvent[];
  renderEvent: (event: CalendarEvent, opts: { compact: boolean }) => React.ReactNode;
}

export const CalendarListView: React.FC<CalendarListViewProps> = ({ days, events, renderEvent }) => {
  const groups = days
    .map((day) => ({
      day,
      events: events
        .filter((e) => {
          try {
            return isSameDay(parseISO(e.startAt), day);
          } catch {
            return false;
          }
        })
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    }))
    .filter((g) => g.events.length > 0);

  return (
    <div className="rounded-xl border border-border bg-card">
      {groups.map(({ day, events: dayEvents }, i) => {
        const today = isToday(day);
        return (
          <section key={format(day, 'yyyy-MM-dd')} aria-label={format(day, 'EEEE d MMMM', { locale: fr })}>
            <header
              className={cn(
                'sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-2.5',
                i > 0 && 'border-t',
                i === 0 && 'rounded-t-xl',
              )}
            >
              <p className="text-sm font-semibold text-foreground">
                {format(day, 'EEEE d MMMM', { locale: fr }).replace(/^./, (c) => c.toUpperCase())}
                {today && <span className="ml-2 text-xs font-medium text-brand">Aujourd'hui</span>}
              </p>
              <span className="text-xs tabular-nums text-muted-foreground">
                {dayEvents.length} événement{dayEvents.length > 1 ? 's' : ''}
              </span>
            </header>
            <ul className="space-y-2 p-2">
              {dayEvents.map((event) => (
                <li key={event.id}>{renderEvent(event, { compact: false })}</li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
};
