/**
 * Calendar — l'agenda : entretiens (dont ceux pris via Calendly), InMails
 * programmés et étapes de séquence.
 *
 * Trois affichages : semaine (du lundi au dimanche), jour (grille horaire),
 * liste (jours qui ont des événements). Un clic sur un événement ouvre sa
 * fiche. Les types restent neutres, reconnaissables à leur icône ; la seule
 * couleur signale un conflit d'horaire (revue design A-44).
 *
 * Une lecture en échec s'affiche comme une erreur avec « Réessayer », jamais
 * comme une semaine vide (A-40). Raccourcis J, K, T, N, 1, 2, 3, inactifs
 * dans un champ, un menu, une liste ou un dialogue (A-48).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  differenceInMinutes,
  format,
  isToday,
  isWeekend,
  parseISO,
  startOfDay,
  startOfWeek,
  subDays,
} from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  ListOrdered,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { EmptyState, ErrorState, PageHeader, PageLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCalendarEvents, groupEventsByDay, type CalendarEvent } from '@/hooks/useCalendarEvents';
import { useCalendarFiltersPersistence } from '@/hooks/useCalendarFiltersPersistence';
import { useAuthReady } from '@/hooks/useAuthReady';
import { shouldIgnoreShortcut } from '@/lib/keyboardShortcuts';
import { cn } from '@/lib/utils';
import { EventDetailSheet } from '@/components/calendar/EventDetailSheet';
import { CalendarFiltersBar, applyCalendarFilters, DEFAULT_FILTERS } from '@/components/calendar/CalendarFiltersBar';
import { CalendarDayView } from '@/components/calendar/CalendarDayView';
import { CalendarListView } from '@/components/calendar/CalendarListView';
import { CreateEventModal } from '@/components/calendar/CreateEventModal';
import { useCalendarConflicts } from '@/components/calendar/useCalendarConflicts';
import { EVENT_TYPES, roundLabel } from '@/components/calendar/eventMeta';

type CalendarView = 'week' | 'day' | 'list';
const VIEW_KEY = 'calendar-view-mode';

/** Affichage mémorisé ; sur téléphone, la liste par défaut (A-49). */
function readStoredView(): CalendarView {
  try {
    const stored = window.localStorage.getItem(VIEW_KEY);
    if (stored === 'week' || stored === 'day' || stored === 'list') return stored;
  } catch {
    // stockage indisponible
  }
  return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches ? 'list' : 'week';
}

const plural = (n: number, singular: string, pluralForm = `${singular}s`) => `${n} ${n > 1 ? pluralForm : singular}`;

/** « 45 min », « 1 h », « 1 h 30 ». */
function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export default function CalendarPage() {
  const { user } = useAuthReady();
  const [view, setViewState] = useState<CalendarView>(readStoredView);
  const setView = (next: CalendarView) => {
    setViewState(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // stockage indisponible : l'affichage vaut pour la session
    }
  };

  // Jour de référence : la semaine affichée est celle qui le contient.
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const rangeStart = useMemo(
    () => (view === 'day' ? anchor : startOfWeek(anchor, { weekStartsOn: 1 })),
    [view, anchor],
  );
  const fetchDays = view === 'day' ? 1 : 7;
  const step = view === 'day' ? 1 : 7;

  const {
    data: rawEvents = [],
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useCalendarEvents({ from: rangeStart, days: fetchDays });

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaultDate, setCreateDefaultDate] = useState<Date | undefined>(undefined);

  const { filters, setFilters, presets, savePreset, loadPreset, deletePreset } = useCalendarFiltersPersistence();

  const events = useMemo(
    () => applyCalendarFilters(rawEvents, filters, user?.id ?? null),
    [rawEvents, filters, user?.id],
  );

  const { conflictIds, bufferIds, overloadDays } = useCalendarConflicts(events);

  const days = useMemo(
    () => Array.from({ length: fetchDays }, (_, i) => addDays(rangeStart, i)),
    [rangeStart, fetchDays],
  );
  const eventsByDay = useMemo(() => groupEventsByDay(events), [events]);

  const openEvent = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setSheetOpen(true);
  };

  const openCreate = (defaultDate?: Date) => {
    setCreateDefaultDate(defaultDate);
    setCreateOpen(true);
  };

  const goPrev = () => setAnchor((a) => subDays(a, step));
  const goNext = () => setAnchor((a) => addDays(a, step));
  const goToday = () => setAnchor(startOfDay(new Date()));

  // Raccourcis clavier (garde commune avec les raccourcis G)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;
      const key = e.key.toLowerCase();
      if (key === 'k') setAnchor((a) => addDays(a, step));
      else if (key === 'j') setAnchor((a) => subDays(a, step));
      else if (key === 't') setAnchor(startOfDay(new Date()));
      else if (key === 'n') {
        e.preventDefault();
        openCreate();
      } else if (key === '1') setView('week');
      else if (key === '2') setView('day');
      else if (key === '3') setView('list');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step]);

  const interviews = events.filter((e) => e.type === 'qualification').length;
  const viaCalendly = events.filter((e) => e.meta?.calendlyEventId).length;

  const rangeLabel = (() => {
    if (view === 'day') {
      return format(rangeStart, 'EEEE d MMMM yyyy', { locale: fr }).replace(/^./, (c) => c.toUpperCase());
    }
    const end = addDays(rangeStart, 6);
    const sameMonth = rangeStart.getMonth() === end.getMonth();
    return `Semaine du ${format(rangeStart, sameMonth ? 'd' : 'd MMM', { locale: fr })} au ${format(end, 'd MMM yyyy', { locale: fr })}`;
  })();

  // « 6 entretiens » quand tout est entretien, sinon « 8 événements, dont 6 entretiens »
  const countLabel =
    events.length === 0
      ? null
      : interviews === events.length
        ? plural(interviews, 'entretien')
        : interviews > 0
          ? `${plural(events.length, 'événement')}, dont ${plural(interviews, 'entretien')}`
          : plural(events.length, 'événement');
  const subtitle = [
    rangeLabel,
    !isLoading && !isError && countLabel,
    !isLoading && !isError && viaCalendly > 0 && `${viaCalendly} via Calendly`,
  ]
    .filter(Boolean)
    .join(' · ');

  const conflictCount = conflictIds.size;
  const overloads = Array.from(overloadDays.entries());

  const renderEvent = (e: CalendarEvent, opts: { compact: boolean }) => (
    <EventCard
      event={e}
      onClick={() => openEvent(e)}
      hasConflict={conflictIds.has(e.id)}
      hasBuffer={bufferIds.has(e.id)}
      compact={opts.compact}
    />
  );

  const periodNoun = view === 'day' ? 'ce jour' : 'cette semaine';

  return (
    <PageLayout maxWidth="2xl">
      <SEOHead title="Agenda | Konekt" description="Entretiens, InMails et étapes de séquence programmés" />

      <PageHeader
        title="Agenda"
        subtitle={subtitle}
        actions={
          <>
            <SegmentedControl
              aria-label="Affichage"
              size="default"
              value={view}
              onValueChange={setView}
              options={[
                { value: 'week', label: 'Semaine', icon: LayoutGrid, title: 'Semaine (1)' },
                { value: 'day', label: 'Jour', icon: CalendarRange, title: 'Jour (2)' },
                { value: 'list', label: 'Liste', icon: ListOrdered, title: 'Liste (3)' },
              ]}
            />
            <div className="flex items-center gap-1" role="group" aria-label="Période">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={goPrev}
                aria-label={view === 'day' ? 'Jour précédent' : 'Semaine précédente'}
                title="Précédent (J)"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button type="button" variant="outline" onClick={goToday} title="Aujourd'hui (T)">
                Aujourd'hui
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={goNext}
                aria-label={view === 'day' ? 'Jour suivant' : 'Semaine suivante'}
                title="Suivant (K)"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  aria-label="Actualiser l'agenda"
                >
                  <RefreshCw className={cn(isFetching && 'animate-spin')} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Actualiser</TooltipContent>
            </Tooltip>
            <Button type="button" variant="primary" onClick={() => openCreate()} title="Programmer un entretien (N)">
              <Plus aria-hidden="true" />
              Programmer un entretien
            </Button>
          </>
        }
      />

      <div className="mb-4">
        <CalendarFiltersBar
          filters={filters}
          onFiltersChange={setFilters}
          allEvents={rawEvents}
          currentUserId={user?.id ?? null}
          presets={presets}
          onSavePreset={savePreset}
          onLoadPreset={loadPreset}
          onDeletePreset={deletePreset}
        />
      </div>

      {!isLoading && !isError && (conflictCount > 0 || overloads.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" role="status">
          {conflictCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-danger">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {plural(conflictCount, 'événement')} en conflit d'horaire
            </span>
          )}
          {overloads.map(([day, count]) => (
            <span key={day} className="inline-flex items-center gap-1.5 text-warning">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {format(parseISO(`${day}T00:00:00`), 'EEEE d', { locale: fr }).replace(/^./, (c) => c.toUpperCase())} :{' '}
              {plural(count, 'événement')}, journée chargée
            </span>
          ))}
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-label="Chargement de l'agenda">
          <Skeleton className="h-[440px] rounded-xl" />
        </div>
      ) : isError ? (
        <ErrorState
          title="Impossible de charger l'agenda"
          description="Vérifiez votre connexion, puis réessayez. Vos entretiens ne sont pas perdus."
          detail={(error as { message?: string } | null)?.message ?? null}
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      ) : rawEvents.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={`Rien de prévu ${periodNoun}`}
          description="Les entretiens, les InMails programmés et les étapes de séquence s'afficheront ici. Les rendez-vous pris via Calendly arrivent d'eux-mêmes."
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => openCreate()}>
              <Plus aria-hidden="true" />
              Programmer un entretien
            </Button>
          }
        />
      ) : events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Aucun événement ne correspond à vos filtres"
          description={`${plural(rawEvents.length, 'événement')} ${periodNoun}, masqué${rawEvents.length > 1 ? 's' : ''} par les filtres.`}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Effacer les filtres
            </Button>
          }
        />
      ) : view === 'week' ? (
        <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 lg:grid-cols-7">
          {days.map((day, idx) => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const dayEvents = eventsByDay[dayKey] || [];
            const today = isToday(day);
            const isOverloaded = overloadDays.has(dayKey);
            return (
              <section
                key={dayKey}
                aria-label={format(day, 'EEEE d MMMM', { locale: fr })}
                className={cn(
                  'group/day flex flex-col border-border lg:min-h-[440px]',
                  idx > 0 && 'max-sm:border-t',
                  idx >= 2 && 'sm:max-lg:border-t',
                  idx % 2 === 1 && 'sm:max-lg:border-l',
                  idx > 0 && 'lg:border-l',
                  isWeekend(day) && 'bg-muted/30',
                )}
              >
                <header className={cn('flex items-center justify-between gap-2 border-b border-border px-3 py-2', today && 'bg-accent/60')}>
                  <div className="min-w-0">
                    <p className={cn('text-xs capitalize', today ? 'font-medium text-brand' : 'text-muted-foreground')}>
                      {format(day, 'EEEE', { locale: fr })}
                      {today && <span className="sr-only"> (aujourd'hui)</span>}
                    </p>
                    <p className="text-md font-semibold tabular-nums text-foreground">{format(day, 'd MMM', { locale: fr })}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                    {isOverloaded && (
                      <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-label="Journée chargée" role="img" />
                    )}
                    {dayEvents.length > 0 && <span aria-label={plural(dayEvents.length, 'événement')}>{dayEvents.length}</span>}
                  </div>
                </header>
                <div className="flex-1 space-y-2 p-2">
                  {dayEvents.length === 0 ? (
                    <div className="flex h-full min-h-8 items-center justify-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground focus-visible:opacity-100 lg:opacity-0 lg:group-hover/day:opacity-100"
                        onClick={() => {
                          const slotDate = new Date(day);
                          slotDate.setHours(10, 0, 0, 0);
                          openCreate(slotDate);
                        }}
                        aria-label={`Programmer un entretien le ${format(day, 'EEEE d MMMM', { locale: fr })}`}
                      >
                        <Plus aria-hidden="true" />
                        Programmer
                      </Button>
                    </div>
                  ) : (
                    dayEvents.map((event) => <React.Fragment key={event.id}>{renderEvent(event, { compact: false })}</React.Fragment>)
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : view === 'day' ? (
        <CalendarDayView
          day={rangeStart}
          events={events}
          onSlotClick={(d) => openCreate(d)}
          renderEvent={renderEvent}
        />
      ) : (
        <CalendarListView days={days} events={events} renderEvent={renderEvent} />
      )}

      {!isLoading && !isError && events.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {(['qualification', 'inmail', 'sequence_step'] as const).map((type) => {
            const Icon = EVENT_TYPES[type].icon;
            return (
              <span key={type} className="inline-flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {EVENT_TYPES[type].label}
              </span>
            );
          })}
          {viaCalendly > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
              Pris via Calendly
            </span>
          )}
        </div>
      )}

      <p className="mt-6 hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground md:flex">
        <span>Raccourcis :</span>
        <span><kbd className="rounded-sm border border-border bg-muted px-1 font-mono">J</kbd> période précédente</span>
        <span><kbd className="rounded-sm border border-border bg-muted px-1 font-mono">K</kbd> période suivante</span>
        <span><kbd className="rounded-sm border border-border bg-muted px-1 font-mono">T</kbd> aujourd'hui</span>
        <span><kbd className="rounded-sm border border-border bg-muted px-1 font-mono">N</kbd> programmer un entretien</span>
        <span><kbd className="rounded-sm border border-border bg-muted px-1 font-mono">1</kbd> <kbd className="rounded-sm border border-border bg-muted px-1 font-mono">2</kbd> <kbd className="rounded-sm border border-border bg-muted px-1 font-mono">3</kbd> semaine, jour, liste</span>
      </p>

      <EventDetailSheet event={selectedEvent} open={sheetOpen} onOpenChange={setSheetOpen} />
      <CreateEventModal open={createOpen} onOpenChange={setCreateOpen} defaultDate={createDefaultDate} />
    </PageLayout>
  );
}

const EventCard = React.memo(function EventCard({
  event,
  onClick,
  hasConflict = false,
  hasBuffer = false,
  compact = false,
}: {
  event: CalendarEvent;
  onClick: () => void;
  hasConflict?: boolean;
  hasBuffer?: boolean;
  compact?: boolean;
}) {
  const type = EVENT_TYPES[event.type];
  const TypeIcon = type.icon;
  const meta = event.meta || {};

  const startDate = (() => {
    try {
      return parseISO(event.startAt);
    } catch {
      return null;
    }
  })();
  const endDate = (() => {
    if (!event.endAt) return null;
    try {
      return parseISO(event.endAt);
    } catch {
      return null;
    }
  })();

  const time = startDate ? format(startDate, 'HH:mm') : '';
  const durationMin = startDate && endDate ? differenceInMinutes(endDate, startDate) : null;
  const isPast = startDate ? startDate < new Date() : false;
  const round = roundLabel(meta.round);

  // Ligne principale : le candidat pour un entretien, le destinataire sinon.
  const primary = event.type === 'qualification' ? meta.candidateName || event.title : event.subtitle || event.title;
  const secondary = [round, meta.clientName, event.type !== 'qualification' ? meta.sequenceName ?? null : meta.jobTitle]
    .filter(Boolean)
    .join(' · ');

  const status = hasConflict ? " Conflit d'horaire." : hasBuffer ? " Moins de 10 minutes après l'événement précédent." : '';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-lg border bg-card text-left transition-colors duration-150 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        compact ? 'flex h-full items-start gap-2 px-2 py-1' : 'p-2.5',
        hasConflict ? 'border-danger' : hasBuffer ? 'border-warning' : 'border-border',
        // Passé : fond retiré et nom atténué, sans opacité (le texte garde son contraste).
        isPast && 'bg-transparent',
      )}
      aria-label={`${type.label} à ${time} : ${primary}${secondary ? `, ${secondary}` : ''}.${isPast ? ' Passé.' : ''}${status}`}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        <TypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={cn('font-medium tabular-nums', isPast ? 'text-muted-foreground' : 'text-foreground')}>{time}</span>
        {durationMin && !compact && <span className="text-muted-foreground">· {durationLabel(durationMin)}</span>}
        {meta.calendlyEventId && <CalendarCheck2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </span>
      {compact ? (
        <span className={cn('min-w-0 truncate text-xs font-medium', isPast ? 'text-muted-foreground' : 'text-foreground')}>
          {primary}
        </span>
      ) : (
        <>
          <span className={cn('mt-1.5 block truncate text-sm font-medium', isPast ? 'text-muted-foreground' : 'text-foreground')}>
            {primary}
          </span>
          {secondary && <span className="block truncate text-xs text-muted-foreground">{secondary}</span>}
          {meta.manager?.displayName && (
            <span className="mt-1 block truncate text-xs text-muted-foreground">Animé par {meta.manager.displayName}</span>
          )}
          {hasConflict && <span className="mt-1 block text-xs font-medium text-danger">Conflit d'horaire</span>}
        </>
      )}
    </button>
  );
});
