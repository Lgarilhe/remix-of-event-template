/**
 * Calendar — vue calendrier interne.
 *
 * Affiche en lecture seule les événements à venir agrégés depuis 3 sources :
 * - qualification_sessions (entretiens)
 * - inmail_queue (InMails programmés)
 * - sequence_step_executions (étapes de séquence)
 *
 * Vue par défaut : 7 jours roulants à partir d'aujourd'hui.
 *
 * V2 (mai 2026) : refonte design — passage du brutalism (border sharp,
 * font-mono uppercase, today bg-foreground full) au V2 (rounded-xl, font-display,
 * today subtle emerald accent, event cards rounded-lg avec couleurs sémantiques
 * conservées par type).
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { SEOHead } from '@/components/SEOHead';
import { useCalendarEvents, groupEventsByDay, type CalendarEvent } from '@/hooks/useCalendarEvents';
import { format, addDays, subDays, parseISO, isToday, isWeekend, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Mail,
  Zap,
  Briefcase,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageLayout } from '@/components/layout';

const TYPE_STYLES: Record<
  CalendarEvent['type'],
  { icon: React.ElementType; bg: string; iconBg: string; iconColor: string; label: string }
> = {
  qualification: {
    icon: Briefcase,
    bg: 'bg-violet-500/[0.06] hover:bg-violet-500/[0.12] border-violet-500/20',
    iconBg: 'bg-violet-500/15',
    iconColor: 'text-violet-600 dark:text-violet-400',
    label: 'Qualif',
  },
  inmail: {
    icon: Mail,
    bg: 'bg-info/[0.06] hover:bg-info/[0.12] border-info/20',
    iconBg: 'bg-info/15',
    iconColor: 'text-info',
    label: 'InMail',
  },
  sequence_step: {
    icon: Zap,
    bg: 'bg-cyan-500/[0.06] hover:bg-cyan-500/[0.12] border-cyan-500/20',
    iconBg: 'bg-cyan-500/15',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    label: 'Séquence',
  },
  reminder: {
    icon: Clock,
    bg: 'bg-warning/[0.06] hover:bg-warning/[0.12] border-warning/20',
    iconBg: 'bg-warning/15',
    iconColor: 'text-warning',
    label: 'Rappel',
  },
};

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfDay(new Date()));
  const { data: events = [], isLoading, isFetching, refetch } = useCalendarEvents({
    from: weekStart,
    days: 7,
  });

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

      {/* Header */}
      <motion.header
        className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-emerald-500/15 text-foreground flex items-center justify-center shrink-0">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-tight leading-tight">
              Calendrier
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {weekRangeLabel}
              {totalCount > 0 && (
                <>
                  {' · '}
                  <span className="text-foreground font-medium">{totalCount}</span>{' '}
                  événement{totalCount > 1 ? 's' : ''}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-background hover:bg-accent text-[11.5px] font-medium text-foreground transition-colors disabled:opacity-50"
            aria-label="Rafraîchir le calendrier"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} aria-hidden="true" />
            <span className="hidden sm:inline">Actualiser</span>
          </button>

          {/* Navigation semaine */}
          <div
            className="inline-flex items-center bg-muted/40 p-0.5 rounded-full border border-border"
            role="group"
            aria-label="Navigation semaine"
          >
            <button
              onClick={() => setWeekStart((prev) => subDays(prev, 7))}
              className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Semaine précédente"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => setWeekStart(startOfDay(new Date()))}
              className="h-8 px-3 rounded-full text-[11.5px] font-medium text-foreground hover:bg-muted/60 transition-colors"
            >
              Aujourd'hui
            </button>
            <button
              onClick={() => setWeekStart((prev) => addDays(prev, 7))}
              className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Semaine suivante"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </motion.header>

      {/* Week grid */}
      <motion.div
        className="rounded-xl bg-card border border-border overflow-hidden"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7">
          {days.map((day, idx) => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const dayEvents = eventsByDay[dayKey] || [];
            const today = isToday(day);
            const weekend = isWeekend(day);

            return (
              <div
                key={dayKey}
                className={cn(
                  'flex flex-col min-h-[200px] lg:min-h-[400px]',
                  idx > 0 && 'lg:border-l lg:border-border',
                  idx > 0 && idx < 7 && 'sm:border-l sm:border-border max-lg:border-l-0',
                  idx >= 2 && 'max-sm:border-t max-sm:border-border',
                  weekend && 'bg-muted/10',
                )}
              >
                {/* Day header */}
                <div
                  className={cn(
                    'px-3 py-2.5 border-b border-border flex items-center justify-between',
                    today && 'bg-emerald-500/15',
                  )}
                >
                  <div>
                    <p
                      className={cn(
                        'text-[10px] uppercase tracking-wider font-semibold',
                        today ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {format(day, 'EEEE', { locale: fr })}
                    </p>
                    <p
                      className={cn(
                        'font-display text-base font-bold leading-none mt-0.5 tabular-nums tracking-tight',
                        'text-foreground',
                      )}
                    >
                      {format(day, 'd MMM', { locale: fr })}
                    </p>
                  </div>
                  {dayEvents.length > 0 && (
                    <span
                      className={cn(
                        'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums',
                        today
                          ? 'bg-foreground text-background'
                          : 'bg-foreground/10 text-foreground',
                      )}
                    >
                      {dayEvents.length}
                    </span>
                  )}
                </div>

                {/* Events */}
                <div className="flex-1 p-2 space-y-1.5 overflow-y-auto">
                  {isLoading ? (
                    <div className="space-y-1.5">
                      {[1, 2].map((i) => (
                        <div key={i} className="h-12 rounded-lg bg-muted/40 animate-pulse" />
                      ))}
                    </div>
                  ) : dayEvents.length === 0 ? (
                    <div className="flex items-center justify-center h-full opacity-30">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                        —
                      </span>
                    </div>
                  ) : (
                    dayEvents.map((event) => <EventCard key={event.id} event={event} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 flex-wrap">
        {(Object.keys(TYPE_STYLES) as CalendarEvent['type'][])
          .filter((t) => t !== 'reminder')
          .map((type) => {
            const style = TYPE_STYLES[type];
            const Icon = style.icon;
            return (
              <div key={type} className="inline-flex items-center gap-1.5">
                <div
                  className={cn(
                    'h-5 w-5 rounded-md flex items-center justify-center shrink-0',
                    style.iconBg,
                  )}
                >
                  <Icon className={cn('w-3 h-3', style.iconColor)} aria-hidden="true" />
                </div>
                <span className="text-xs text-muted-foreground font-medium">{style.label}</span>
              </div>
            );
          })}
      </div>

      {/* Empty state global */}
      {!isLoading && totalCount === 0 && (
        <motion.div
          className="mt-6 rounded-xl bg-card border border-border p-10 text-center"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="h-12 w-12 rounded-full bg-emerald-500/15 text-foreground flex items-center justify-center mx-auto mb-4">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <p className="font-display font-bold text-foreground text-base">
            Pas d'événement cette semaine
          </p>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
            Les entretiens (qualifications), InMails programmés et étapes de séquence à
            venir s'afficheront ici.
          </p>
        </motion.div>
      )}
    </PageLayout>
  );
}

const EventCard = React.memo(function EventCard({ event }: { event: CalendarEvent }) {
  const style = TYPE_STYLES[event.type];
  const Icon = style.icon;
  const time = (() => {
    try {
      return format(parseISO(event.startAt), 'HH:mm');
    } catch {
      return '—';
    }
  })();
  const isPast = (() => {
    try {
      return new Date(event.startAt) < new Date();
    } catch {
      return false;
    }
  })();

  return (
    <button
      type="button"
      className={cn(
        'w-full text-left rounded-lg border p-2 transition-colors',
        style.bg,
        isPast && 'opacity-50',
      )}
      title={event.title}
      aria-label={`${style.label} à ${time}: ${event.title}${
        event.subtitle ? ' — ' + event.subtitle : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            'h-5 w-5 rounded-md flex items-center justify-center shrink-0',
            style.iconBg,
          )}
        >
          <Icon className={cn('w-2.5 h-2.5', style.iconColor)} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-bold tabular-nums text-muted-foreground">
            {time}
          </span>
          <p className="text-xs font-medium truncate text-foreground leading-tight mt-0.5">
            {event.title}
          </p>
          {event.subtitle && (
            <p className="text-[10px] text-muted-foreground truncate">{event.subtitle}</p>
          )}
        </div>
      </div>
    </button>
  );
});
