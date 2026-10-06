/**
 * CalendarDayView — vue jour sur une grille horaire.
 *
 * - Plage de 7 h à 21 h, élargie pour montrer un événement plus tôt ou plus
 *   tard (revue design A-42) ;
 * - hauteur proportionnelle à la durée ; sous 70 px, la carte passe en forme
 *   compacte (heure et nom) ;
 * - événements simultanés côte à côte, en colonnes ;
 * - trait de l'heure courante en accent ; clic sur une heure libre pour
 *   programmer un entretien.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { format, isSameDay, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';

interface CalendarDayViewProps {
  day: Date;
  events: CalendarEvent[];
  onSlotClick?: (date: Date) => void;
  renderEvent: (event: CalendarEvent, opts: { compact: boolean }) => React.ReactNode;
}

const HOUR_HEIGHT = 56; // px par heure
const DEFAULT_START = 7;
const DEFAULT_END = 21;
const DEFAULT_DURATION_MIN = 30;

interface Placed {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
  column: number;
  columns: number;
}

/** Répartit les événements qui se chevauchent en colonnes. */
function placeEvents(events: CalendarEvent[], day: Date): Placed[] {
  const items = events
    .map((event) => {
      try {
        const start = parseISO(event.startAt);
        if (!isSameDay(start, day)) return null;
        const startMin = start.getHours() * 60 + start.getMinutes();
        let endMin = startMin + DEFAULT_DURATION_MIN;
        if (event.endAt) {
          const end = parseISO(event.endAt);
          endMin = isSameDay(end, day) ? end.getHours() * 60 + end.getMinutes() : 24 * 60;
        }
        return { event, startMin, endMin: Math.max(endMin, startMin + 15), column: 0, columns: 1 };
      } catch {
        return null;
      }
    })
    .filter((x): x is Placed => x !== null)
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  // Grappes d'événements qui se chevauchent ; dans chaque grappe, la première
  // colonne libre, et autant de colonnes que nécessaire.
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const columns = cluster.reduce((max, p) => Math.max(max, p.column + 1), 1);
    for (const p of cluster) p.columns = columns;
    cluster = [];
  };
  for (const item of items) {
    if (item.startMin >= clusterEnd && cluster.length) flush();
    const taken = new Set(cluster.filter((p) => p.endMin > item.startMin).map((p) => p.column));
    let column = 0;
    while (taken.has(column)) column++;
    item.column = column;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length) flush();
  return items;
}

export const CalendarDayView: React.FC<CalendarDayViewProps> = ({ day, events, onSlotClick, renderEvent }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isToday = isSameDay(day, new Date());

  const placed = useMemo(() => placeEvents(events, day), [events, day]);

  const startHour = Math.min(DEFAULT_START, ...placed.map((p) => Math.floor(p.startMin / 60)));
  const endHour = Math.max(DEFAULT_END, ...placed.map((p) => Math.ceil(p.endMin / 60)));
  const hours: number[] = [];
  for (let h = startHour; h < endHour; h++) hours.push(h);

  // Au chargement : l'heure courante (aujourd'hui) ou 9 h
  useEffect(() => {
    if (!containerRef.current) return;
    const targetHour = isToday ? new Date().getHours() : 9;
    containerRef.current.scrollTop = Math.max(0, (targetHour - startHour) * HOUR_HEIGHT - 40);
  }, [isToday, startHour]);

  const nowOffsetPx = (() => {
    if (!isToday) return null;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < startHour * 60 || minutes > endHour * 60) return null;
    return ((minutes - startHour * 60) / 60) * HOUR_HEIGHT;
  })();

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className={cn('flex items-center justify-between border-b border-border px-4 py-3', isToday && 'bg-accent/60')}>
        <div>
          <p className={cn('text-xs capitalize', isToday ? 'font-medium text-brand' : 'text-muted-foreground')}>
            {format(day, 'EEEE', { locale: fr })}
            {isToday && <span className="sr-only"> (aujourd'hui)</span>}
          </p>
          <p className="text-base font-semibold tabular-nums text-foreground">{format(day, 'd MMMM yyyy', { locale: fr })}</p>
        </div>
        <span className="text-sm tabular-nums text-muted-foreground">
          {placed.length} événement{placed.length > 1 ? 's' : ''}
        </span>
      </div>

      <div ref={containerRef} className="max-h-[640px] flex-1 overflow-y-auto">
        <div className="relative" style={{ height: `${hours.length * HOUR_HEIGHT}px` }}>
          {hours.map((h, i) => (
            <button
              key={h}
              type="button"
              onClick={() => {
                if (!onSlotClick) return;
                const slotDate = new Date(day);
                slotDate.setHours(h, 0, 0, 0);
                onSlotClick(slotDate);
              }}
              className="absolute left-0 right-0 flex items-start gap-3 px-3 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              style={{ top: `${i * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}
              aria-label={`Programmer un entretien à ${h} h`}
            >
              <span className="mt-0.5 w-10 shrink-0 text-2xs tabular-nums text-muted-foreground">{String(h).padStart(2, '0')}:00</span>
              <span className="mt-1.5 h-px flex-1 bg-border" aria-hidden="true" />
            </button>
          ))}

          {nowOffsetPx != null && (
            <div className="pointer-events-none absolute left-12 right-2 z-10" style={{ top: `${nowOffsetPx}px` }} aria-hidden="true">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-brand" />
                <span className="h-px flex-1 bg-brand" />
                <span className="text-2xs font-medium tabular-nums text-brand">{format(new Date(), 'HH:mm')}</span>
              </div>
            </div>
          )}

          {placed.map((p) => {
            const top = ((p.startMin - startHour * 60) / 60) * HOUR_HEIGHT;
            const height = Math.max(((p.endMin - p.startMin) / 60) * HOUR_HEIGHT, 28);
            const widthPct = 100 / p.columns;
            return (
              <div
                key={p.event.id}
                className="absolute z-20 pr-1"
                style={{
                  top: `${top}px`,
                  height: `${height}px`,
                  left: `calc(60px + (100% - 72px) * ${(p.column * widthPct) / 100})`,
                  width: `calc((100% - 72px) * ${widthPct / 100})`,
                }}
              >
                <div className="h-full overflow-hidden">{renderEvent(p.event, { compact: height < 70 })}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
