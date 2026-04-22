/**
 * Calendar — vue calendrier interne (B5 MVP).
 *
 * Affiche en lecture seule les événements à venir agrégés depuis 3 sources :
 * - qualification_sessions (entretiens)
 * - inmail_queue (InMails programmés)
 * - sequence_step_executions (étapes de séquence)
 *
 * Vue par défaut : 7 jours roulants à partir d'aujourd'hui.
 * Navigation : précédent / suivant pour shifter d'une semaine.
 *
 * Phase 2 (futur) : drag & drop pour replanifier, création directe d'event,
 * intégration ICS pour Google/Outlook.
 */

import React, { useMemo, useState } from 'react';
import { SEOHead } from '@/components/SEOHead';
import { useCalendarEvents, groupEventsByDay, type CalendarEvent } from '@/hooks/useCalendarEvents';
import { format, addDays, subDays, parseISO, isToday, isWeekend, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Mail, Zap, Briefcase, Clock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
// Design system — primitives partagées
import { PageLayout, PageHeader, EmptyState } from '@/components/layout';

const TYPE_STYLES: Record<CalendarEvent['type'], { icon: React.ElementType; color: string; label: string }> = {
  qualification: { icon: Briefcase, color: 'bg-brand-purple/10 border-brand-purple/30 text-brand-purple', label: 'Qualif' },
  inmail: { icon: Mail, color: 'bg-info/10 border-info/30 text-info', label: 'InMail' },
  sequence_step: { icon: Zap, color: 'bg-brand-cyan/10 border-brand-cyan/30 text-brand-cyan', label: 'Séquence' },
  reminder: { icon: Clock, color: 'bg-warning/10 border-warning/30 text-warning', label: 'Rappel' },
};

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfDay(new Date()));
  const { data: events = [], isLoading, isFetching, refetch } = useCalendarEvents({ from: weekStart, days: 7 });

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const eventsByDay = useMemo(() => groupEventsByDay(events), [events]);

  const totalCount = events.length;
  const weekRangeLabel = useMemo(() => {
    const start = weekStart;
    const end = addDays(weekStart, 6);
    return `${format(start, 'd MMM', { locale: fr })} — ${format(end, 'd MMM yyyy', { locale: fr })}`;
  }, [weekStart]);

  return (
    <PageLayout maxWidth="2xl">
      <SEOHead
        title="Calendrier | Konekt"
        description="Vue calendrier des entretiens, InMails et étapes de séquence à venir"
      />

      <PageHeader
        icon={CalendarIcon}
        title="Calendrier"
        meta={totalCount > 0 ? `${totalCount} événement${totalCount > 1 ? 's' : ''}` : undefined}
        subtitle={weekRangeLabel}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Rafraîchir le calendrier"
              className="h-8 gap-1.5"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} aria-hidden="true" />
              <span className="hidden sm:inline">Actualiser</span>
            </Button>

            <div className="flex items-center border border-border" role="group" aria-label="Navigation semaine">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setWeekStart(prev => subDays(prev, 7))}
                aria-label="Semaine précédente"
                className="h-8 w-8 rounded-none border-r border-border hover:bg-muted/40"
              >
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setWeekStart(startOfDay(new Date()))}
                className="h-8 px-3 text-xs uppercase tracking-wider rounded-none border-r border-border hover:bg-muted/40"
              >
                Aujourd'hui
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setWeekStart(prev => addDays(prev, 7))}
                aria-label="Semaine suivante"
                className="h-8 w-8 rounded-none hover:bg-muted/40"
              >
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
          </>
        }
      />

      {/* Week view */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-0 border border-border bg-background stagger-in">
        {days.map((day, idx) => {
          const dayKey = format(day, 'yyyy-MM-dd');
          const dayEvents = eventsByDay[dayKey] || [];
          const today = isToday(day);
          const weekend = isWeekend(day);

          return (
            <div
              key={dayKey}
              className={cn(
                'flex flex-col min-h-[200px] lg:min-h-[400px] border-border',
                idx > 0 && 'lg:border-l',
                idx > 0 && idx < 7 && 'sm:border-l max-lg:border-l-0',
                idx >= 2 && 'max-sm:border-t',
                weekend && 'bg-muted/20',
              )}
            >
              {/* Day header */}
              <div className={cn(
                'px-3 py-2 border-b border-border flex items-center justify-between',
                today && 'bg-foreground text-background',
              )}>
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-bold opacity-80">
                    {format(day, 'EEEE', { locale: fr })}
                  </p>
                  <p className={cn(
                    'text-lg font-bold font-mono leading-none mt-0.5 tabular-nums',
                    today && 'text-background',
                  )}>
                    {format(day, 'd MMM', { locale: fr })}
                  </p>
                </div>
                {dayEvents.length > 0 && (
                  <span className={cn(
                    'text-xs font-mono font-bold px-1.5 py-0.5 tabular-nums',
                    today
                      ? 'bg-background text-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}>
                    {dayEvents.length}
                  </span>
                )}
              </div>

              {/* Events */}
              <div className="flex-1 p-2 space-y-1.5 overflow-y-auto">
                {isLoading ? (
                  <div className="space-y-1.5">
                    {[1, 2].map(i => <div key={i} className="h-12 bg-muted animate-pulse" />)}
                  </div>
                ) : dayEvents.length === 0 ? (
                  <div className="flex items-center justify-center h-full opacity-30">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">—</span>
                  </div>
                ) : (
                  dayEvents.map(event => <EventCard key={event.id} event={event} />)
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
        {(Object.keys(TYPE_STYLES) as CalendarEvent['type'][]).filter(t => t !== 'reminder').map(type => {
          const style = TYPE_STYLES[type];
          const Icon = style.icon;
          return (
            <div key={type} className="flex items-center gap-1.5">
              <Icon className="w-3 h-3" aria-hidden="true" />
              <span className="uppercase tracking-wider font-medium">{style.label}</span>
            </div>
          );
        })}
      </div>

          {/* Empty state global */}
          {!isLoading && totalCount === 0 && (
            <div className="mt-6">
              <EmptyState
                icon={CalendarIcon}
                title="Pas d'événement cette semaine"
                description="Les entretiens (qualifications), InMails programmés et étapes de séquence à venir s'afficheront ici."
              />
            </div>
          )}
    </PageLayout>
  );
}

const EventCard = React.memo(function EventCard({ event }: { event: CalendarEvent }) {
  const style = TYPE_STYLES[event.type];
  const Icon = style.icon;
  const time = (() => {
    try { return format(parseISO(event.startAt), 'HH:mm'); } catch { return '—'; }
  })();
  const isPast = (() => {
    try { return new Date(event.startAt) < new Date(); } catch { return false; }
  })();

  return (
    <div
      className={cn(
        'border p-2 interactive-card cursor-pointer',
        style.color,
        isPast && 'opacity-60',
      )}
      title={event.title}
      role="button"
      tabIndex={0}
      aria-label={`${style.label} à ${time}: ${event.title}${event.subtitle ? ' — ' + event.subtitle : ''}`}
    >
      <div className="flex items-start gap-1.5">
        <Icon className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-mono font-bold tracking-wider uppercase opacity-80 tabular-nums">
              {time}
            </span>
          </div>
          <p className="text-xs font-medium truncate text-foreground mt-0.5">{event.title}</p>
          {event.subtitle && (
            <p className="text-[10px] text-muted-foreground truncate">{event.subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );
});
