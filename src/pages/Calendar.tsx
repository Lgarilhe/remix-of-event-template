/**
 * Calendar — vue calendrier interne V3.
 *
 * Affiche les événements à venir agrégés depuis :
 * - qualification_sessions (entretiens, dont Calendly)
 * - inmail_queue (InMails programmés)
 * - sequence_step_executions (étapes de séquence)
 *
 * V3 (mai 2026) : refonte complète avec cards riches qui montrent en 1 coup
 * d'œil "qui voit qui pour quel poste avec quel manager", click → sheet
 * détaillé avec actions (voir candidat, voir mission, ouvrir lien meet, etc.)
 *
 * Design : pattern Cal.com / Notion Calendar — tout est rounded, soft, les
 * couleurs sémantiques sont préservées (entretiens=violet, inmails=info,
 * séquences=cyan) pour distinction rapide.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { SEOHead } from '@/components/SEOHead';
import {
  useCalendarEvents,
  groupEventsByDay,
  type CalendarEvent,
} from '@/hooks/useCalendarEvents';
import {
  format,
  addDays,
  subDays,
  parseISO,
  isToday,
  isWeekend,
  startOfDay,
  differenceInMinutes,
} from 'date-fns';
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
  Video,
  MapPin,
  Sparkles,
  Building2,
  Plus,
  AlertTriangle,
  LayoutGrid,
  CalendarRange,
  ListOrdered,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageLayout } from '@/components/layout';
import { CandidateAvatar } from '@/components/dashboard/CandidateAvatar';
import { MissionCompanyLogo } from '@/components/dashboard/MissionCompanyLogo';
import { EventDetailSheet } from '@/components/calendar/EventDetailSheet';
import {
  CalendarFiltersBar,
  applyCalendarFilters,
  DEFAULT_FILTERS,
} from '@/components/calendar/CalendarFiltersBar';
import { CalendarDayView } from '@/components/calendar/CalendarDayView';
import { CalendarListView } from '@/components/calendar/CalendarListView';
import { CreateEventModal } from '@/components/calendar/CreateEventModal';
import { useCalendarConflicts } from '@/components/calendar/useCalendarConflicts';
import { useCalendarFiltersPersistence } from '@/hooks/useCalendarFiltersPersistence';
import { useAuthReady } from '@/hooks/useAuthReady';

type CalendarView = 'week' | 'day' | 'list';
const VIEW_KEY = 'calendar-view-mode';

const TYPE_STYLES: Record<
  CalendarEvent['type'],
  {
    icon: React.ElementType;
    label: string;
    bg: string;
    border: string;
    iconBg: string;
    iconColor: string;
  }
> = {
  qualification: {
    icon: Briefcase,
    label: 'Entretien',
    bg: 'bg-violet-500/[0.08] hover:bg-violet-500/[0.14]',
    border: 'border-violet-500/30',
    iconBg: 'bg-violet-500/15',
    iconColor: 'text-violet-600 dark:text-violet-400',
  },
  inmail: {
    icon: Mail,
    label: 'InMail',
    bg: 'bg-info/[0.08] hover:bg-info/[0.14]',
    border: 'border-info/30',
    iconBg: 'bg-info/15',
    iconColor: 'text-info',
  },
  sequence_step: {
    icon: Zap,
    label: 'Séquence',
    bg: 'bg-cyan-500/[0.08] hover:bg-cyan-500/[0.14]',
    border: 'border-cyan-500/30',
    iconBg: 'bg-cyan-500/15',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
  },
  reminder: {
    icon: Clock,
    label: 'Rappel',
    bg: 'bg-warning/[0.08] hover:bg-warning/[0.14]',
    border: 'border-warning/30',
    iconBg: 'bg-warning/15',
    iconColor: 'text-warning',
  },
};

const isVisioLink = (loc: string | null | undefined) =>
  !!loc && /^https?:\/\//i.test(loc);

const getInitials = (name: string | null | undefined): string => {
  if (!name) return '?';
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return (tokens[0][0] + tokens[tokens.length - 1][0]).toUpperCase();
};

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfDay(new Date()));
  const { user } = useAuthReady();

  // View mode (week / day / list) — persisté localStorage
  const [view, setViewState] = useState<CalendarView>(() => {
    if (typeof window === 'undefined') return 'week';
    const stored = window.localStorage.getItem(VIEW_KEY);
    return (stored === 'day' || stored === 'list') ? stored : 'week';
  });
  const setView = (next: CalendarView) => {
    setViewState(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(VIEW_KEY, next);
  };

  // Day view : ne fetch que 1 jour, sinon 7
  const fetchDays = view === 'day' ? 1 : 7;
  const { data: rawEvents = [], isLoading, isFetching, refetch } = useCalendarEvents({
    from: weekStart,
    days: fetchDays,
  });

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaultDate, setCreateDefaultDate] = useState<Date | undefined>(undefined);

  // Filtres : persistance + presets via hook dédié
  const {
    filters,
    setFilters,
    presets,
    savePreset,
    loadPreset,
    deletePreset,
  } = useCalendarFiltersPersistence();

  // Filtre appliqué côté client
  const events = useMemo(
    () => applyCalendarFilters(rawEvents, filters, user?.id ?? null),
    [rawEvents, filters, user?.id],
  );

  // Détection conflits + buffers + jours surchargés
  const { conflictIds, bufferIds, overloadDays } = useCalendarConflicts(events);

  const days = useMemo(
    () => Array.from({ length: fetchDays }, (_, i) => addDays(weekStart, i)),
    [weekStart, fetchDays],
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

  // ─── Raccourcis clavier ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ne pas trigger si on tape dans un input/textarea/contenteditable
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      // J/K next/prev period (jour ou semaine selon view)
      if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowRight') {
        if (view === 'day') setWeekStart((prev) => addDays(prev, 1));
        else setWeekStart((prev) => addDays(prev, 7));
      } else if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowLeft') {
        if (view === 'day') setWeekStart((prev) => subDays(prev, 1));
        else setWeekStart((prev) => subDays(prev, 7));
      } else if (e.key === 't' || e.key === 'T') {
        setWeekStart(startOfDay(new Date()));
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openCreate();
      } else if (e.key === '1') {
        setView('week');
      } else if (e.key === '2') {
        setView('day');
      } else if (e.key === '3') {
        setView('list');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const totalCount = events.length;

  // Stats inline : entretiens / Calendly / conflits
  const stats = useMemo(() => {
    let interviews = 0;
    let calendly = 0;
    for (const e of events) {
      if (e.type === 'qualification') interviews++;
      if (e.meta?.calendlyEventId) calendly++;
    }
    return { interviews, calendly };
  }, [events]);

  const rangeLabel = useMemo(() => {
    if (view === 'day') {
      return format(weekStart, "EEEE d MMMM yyyy", { locale: fr }).replace(
        /^./,
        (c) => c.toUpperCase(),
      );
    }
    const start = weekStart;
    const end = addDays(weekStart, 6);
    return `${format(start, 'd MMM', { locale: fr })} – ${format(end, 'd MMM yyyy', { locale: fr })}`;
  }, [weekStart, view]);

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
              {rangeLabel}
              {totalCount > 0 && (
                <>
                  {' · '}
                  <span className="text-foreground font-medium">{totalCount}</span> événement
                  {totalCount > 1 ? 's' : ''}
                  {stats.interviews > 0 && (
                    <>
                      {' · '}
                      <span className="text-foreground font-medium">{stats.interviews}</span>{' '}
                      entretien{stats.interviews > 1 ? 's' : ''}
                    </>
                  )}
                  {stats.calendly > 0 && (
                    <>
                      {' · '}
                      <span className="inline-flex items-center gap-1 text-foreground font-medium">
                        <Sparkles className="w-3 h-3 inline" />
                        {stats.calendly} via Calendly
                      </span>
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* View mode toggle (Semaine / Jour / Liste) */}
          <div
            className="inline-flex items-center bg-muted/40 p-0.5 rounded-full border border-border"
            role="group"
            aria-label="Mode d'affichage"
          >
            {(
              [
                { value: 'week', icon: LayoutGrid, label: 'Semaine', shortcut: '1' },
                { value: 'day', icon: CalendarRange, label: 'Jour', shortcut: '2' },
                { value: 'list', icon: ListOrdered, label: 'Liste', shortcut: '3' },
              ] as const
            ).map((m) => {
              const Icon = m.icon;
              const isActive = view === m.value;
              return (
                <button
                  key={m.value}
                  onClick={() => setView(m.value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full text-[11.5px] font-medium transition-colors',
                    isActive
                      ? 'bg-foreground text-background shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                  )}
                  title={`${m.label} (raccourci ${m.shortcut})`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">{m.label}</span>
                </button>
              );
            })}
          </div>

          {/* Refresh */}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-background hover:bg-accent text-[11.5px] font-medium text-foreground transition-colors disabled:opacity-50"
            aria-label="Rafraîchir le calendrier"
          >
            <RefreshCw
              className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">Actualiser</span>
          </button>

          {/* Navigation prev/today/next */}
          <div
            className="inline-flex items-center bg-muted/40 p-0.5 rounded-full border border-border"
            role="group"
            aria-label="Navigation"
          >
            <button
              onClick={() =>
                setWeekStart((prev) => subDays(prev, view === 'day' ? 1 : 7))
              }
              className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label={view === 'day' ? 'Jour précédent' : 'Semaine précédente'}
              title="Précédent (J)"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={() => setWeekStart(startOfDay(new Date()))}
              className="h-8 px-3 rounded-full text-[11.5px] font-medium text-foreground hover:bg-muted/60 transition-colors"
              title="Aujourd'hui (T)"
            >
              Aujourd'hui
            </button>
            <button
              onClick={() =>
                setWeekStart((prev) => addDays(prev, view === 'day' ? 1 : 7))
              }
              className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label={view === 'day' ? 'Jour suivant' : 'Semaine suivante'}
              title="Suivant (K)"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          {/* + Nouvel event */}
          <button
            onClick={() => openCreate()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-foreground text-background text-[11.5px] font-medium hover:opacity-90 transition-opacity"
            title="Programmer un entretien (N)"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Programmer</span>
          </button>
        </div>
      </motion.header>

      {/* Filters bar avec presets */}
      <motion.div
        className="mb-4"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.05 }}
      >
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
      </motion.div>

      {/* Conflict / overload warnings */}
      {(conflictIds.size > 0 || overloadDays.size > 0) && (
        <motion.div
          className="mb-4 flex flex-wrap gap-2"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {conflictIds.size > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-destructive/10 border border-destructive/30 text-destructive text-xs font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />
              {conflictIds.size / 2} conflit{conflictIds.size > 2 ? 's' : ''} d'horaire détecté
              {conflictIds.size > 2 ? 's' : ''}
            </span>
          )}
          {Array.from(overloadDays.entries()).map(([day, count]) => (
            <span
              key={day}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warning/10 border border-warning/30 text-warning text-xs font-medium"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              {format(parseISO(day + 'T00:00:00'), 'EEEE d', { locale: fr })} : {count} events,
              journée chargée
            </span>
          ))}
        </motion.div>
      )}

      {/* Body : Week / Day / List selon le view mode */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        {view === 'week' && (
          <div className="rounded-xl bg-card border border-border overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7">
              {days.map((day, idx) => {
                const dayKey = format(day, 'yyyy-MM-dd');
                const dayEvents = eventsByDay[dayKey] || [];
                const today = isToday(day);
                const weekend = isWeekend(day);
                const isOverloaded = overloadDays.has(dayKey);
                // Heure courante pour today
                const nowOffsetPct = (() => {
                  if (!today) return null;
                  const now = new Date();
                  // 7h-21h range, pourcentage dans la zone events
                  const min = now.getHours() * 60 + now.getMinutes();
                  const dayMinStart = 7 * 60;
                  const dayMinEnd = 21 * 60;
                  if (min < dayMinStart || min > dayMinEnd) return null;
                  return ((min - dayMinStart) / (dayMinEnd - dayMinStart)) * 100;
                })();

                return (
                  <div
                    key={dayKey}
                    className={cn(
                      'flex flex-col min-h-[260px] lg:min-h-[440px] relative',
                      idx > 0 && 'lg:border-l lg:border-border',
                      idx > 0 && idx < 7 && 'sm:border-l sm:border-border max-lg:border-l-0',
                      idx >= 2 && 'max-sm:border-t max-sm:border-border',
                      weekend && 'bg-muted/10',
                    )}
                  >
                    <div
                      className={cn(
                        'px-3 py-2.5 border-b border-border flex items-center justify-between',
                        today && 'bg-emerald-500/15',
                        isOverloaded && !today && 'bg-warning/[0.06]',
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
                        <p className="font-display text-base font-bold leading-none mt-0.5 tabular-nums tracking-tight text-foreground">
                          {format(day, 'd MMM', { locale: fr })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {isOverloaded && (
                          <AlertTriangle
                            className="w-3 h-3 text-warning"
                            aria-label="Journée surchargée"
                          />
                        )}
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
                    </div>

                    {/* Events area + heure courante line */}
                    <div className="flex-1 p-2 space-y-2 overflow-y-auto relative">
                      {/* Ligne heure courante (today only) */}
                      {nowOffsetPct != null && (
                        <div
                          className="absolute left-2 right-2 z-10 pointer-events-none flex items-center gap-1"
                          style={{ top: `${nowOffsetPct}%` }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-destructive shadow-[0_0_0_3px_rgba(239,68,68,0.15)]" />
                          <div className="flex-1 h-px bg-destructive" />
                        </div>
                      )}
                      {isLoading ? (
                        <div className="space-y-2">
                          {[1, 2].map((i) => (
                            <div key={i} className="h-24 rounded-xl bg-muted/40 animate-pulse" />
                          ))}
                        </div>
                      ) : dayEvents.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            const slotDate = new Date(day);
                            slotDate.setHours(10, 0, 0, 0);
                            openCreate(slotDate);
                          }}
                          className="flex items-center justify-center h-full w-full opacity-20 hover:opacity-60 transition-opacity"
                          title="Programmer un entretien ce jour"
                        >
                          <Plus className="w-4 h-4 text-muted-foreground" />
                        </button>
                      ) : (
                        dayEvents.map((event) => (
                          <EventCard
                            key={event.id}
                            event={event}
                            onClick={() => openEvent(event)}
                            hasConflict={conflictIds.has(event.id)}
                            hasBuffer={bufferIds.has(event.id)}
                            compact={false}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === 'day' && (
          <CalendarDayView
            day={weekStart}
            events={events}
            onEventClick={openEvent}
            onSlotClick={(d) => openCreate(d)}
            conflictIds={conflictIds}
            bufferIds={bufferIds}
            renderEvent={(e, opts) => (
              <EventCard
                event={e}
                onClick={() => openEvent(e)}
                hasConflict={conflictIds.has(e.id)}
                hasBuffer={bufferIds.has(e.id)}
                compact={opts.compact}
              />
            )}
          />
        )}

        {view === 'list' && (
          <CalendarListView
            days={days}
            events={events}
            onEventClick={openEvent}
            renderEvent={(e) => (
              <EventCard
                event={e}
                onClick={() => openEvent(e)}
                hasConflict={conflictIds.has(e.id)}
                hasBuffer={bufferIds.has(e.id)}
                compact={false}
              />
            )}
          />
        )}
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
      {!isLoading && totalCount === 0 && rawEvents.length === 0 && (
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
            Les entretiens, InMails programmés et étapes de séquence à venir s'afficheront ici.
            Les RDV pris via Calendly remontent automatiquement.
          </p>
        </motion.div>
      )}

      {/* Empty state filtré (rawEvents > 0 mais après filtrage = 0) */}
      {!isLoading && totalCount === 0 && rawEvents.length > 0 && (
        <motion.div
          className="mt-6 rounded-xl bg-card border border-border p-10 text-center"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="h-12 w-12 rounded-full bg-warning/10 text-warning flex items-center justify-center mx-auto mb-4">
            <CalendarIcon className="w-6 h-6" />
          </div>
          <p className="font-display font-bold text-foreground text-base">
            Aucun événement ne correspond à vos filtres
          </p>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto mb-4">
            {rawEvents.length} événement{rawEvents.length > 1 ? 's' : ''} cette semaine, mais
            tous filtré{rawEvents.length > 1 ? 's' : ''}. Essayez de relâcher un filtre.
          </p>
          <button
            onClick={() => setFilters(DEFAULT_FILTERS)}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-foreground text-background text-[12px] font-medium hover:opacity-90 transition-opacity"
          >
            Effacer les filtres
          </button>
        </motion.div>
      )}

      {/* Detail sheet */}
      <EventDetailSheet event={selectedEvent} open={sheetOpen} onOpenChange={setSheetOpen} />

      {/* Create event modal */}
      <CreateEventModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultDate={createDefaultDate}
      />

      {/* Aide raccourcis clavier — discret en bas */}
      <div className="mt-6 text-[10px] text-muted-foreground/60 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Raccourcis :</span>
        <kbd className="font-mono px-1 py-0.5 rounded border border-border bg-muted/40">J</kbd>
        <span>précédent</span>
        <kbd className="font-mono px-1 py-0.5 rounded border border-border bg-muted/40">K</kbd>
        <span>suivant</span>
        <kbd className="font-mono px-1 py-0.5 rounded border border-border bg-muted/40">T</kbd>
        <span>aujourd'hui</span>
        <kbd className="font-mono px-1 py-0.5 rounded border border-border bg-muted/40">N</kbd>
        <span>nouvel entretien</span>
        <kbd className="font-mono px-1 py-0.5 rounded border border-border bg-muted/40">1/2/3</kbd>
        <span>semaine/jour/liste</span>
      </div>
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
  const style = TYPE_STYLES[event.type];
  const meta = event.meta || {};

  const startDate = (() => {
    try {
      return parseISO(event.startAt);
    } catch {
      return null;
    }
  })();
  const endDate = event.endAt
    ? (() => {
        try {
          return parseISO(event.endAt);
        } catch {
          return null;
        }
      })()
    : null;

  const time = startDate ? format(startDate, 'HH:mm') : '—';
  const durationMin = startDate && endDate ? differenceInMinutes(endDate, startDate) : null;
  const isPast = startDate ? startDate < new Date() : false;
  const isQualif = event.type === 'qualification';
  const hasVisio = isVisioLink(meta.location);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group w-full text-left rounded-xl border p-2.5 transition-colors',
        style.bg,
        style.border,
        isPast && 'opacity-50',
        // Conflit : ring rouge fort
        hasConflict && 'ring-2 ring-destructive/60 border-destructive/40',
        // Buffer : ring warning subtle
        hasBuffer && !hasConflict && 'ring-1 ring-warning/50',
      )}
      title={
        hasConflict
          ? `⚠ Conflit d'horaire — ${event.title}`
          : hasBuffer
          ? `⚠ Moins de 10 min depuis l'event précédent — ${event.title}`
          : event.title
      }
      aria-label={`${style.label} à ${time}: ${event.title}${hasConflict ? ' (conflit)' : ''}`}
    >
      {/* Top row : time + duration + badges (round, calendly, type) */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-display text-[12px] font-bold tabular-nums text-foreground tracking-tight">
            {time}
          </span>
          {durationMin && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              · {durationMin}min
            </span>
          )}
          {/* Round badge — visuellement fort si c'est un final */}
          {meta.round && (
            <span
              className={cn(
                'inline-flex items-center text-[9.5px] font-bold uppercase tracking-wider px-1.5 h-4 rounded-full shrink-0',
                meta.round.kind === 'final'
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30'
                  : meta.round.n === 1
                  ? 'bg-foreground/[0.08] text-foreground/80'
                  : meta.round.n === 2
                  ? 'bg-info/10 text-info'
                  : 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400',
              )}
              title={meta.round.label}
            >
              {meta.round.kind === 'final'
                ? 'Final'
                : meta.round.n === 1
                ? '1er'
                : `${meta.round.n}e`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {meta.calendlyEventId && (
            <span
              className="inline-flex items-center justify-center h-4 w-4 rounded bg-foreground/[0.08]"
              title="Via Calendly"
            >
              <Sparkles className="w-2.5 h-2.5 text-foreground/70" />
            </span>
          )}
          <div
            className={cn(
              'h-5 w-5 rounded-md flex items-center justify-center shrink-0',
              style.iconBg,
              style.iconColor,
            )}
          >
            <style.icon className="w-3 h-3" aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* Candidate row (qualifs) — avatar + name + société sur la même ligne */}
      {isQualif && meta.candidateName && (
        <div className="flex items-center gap-2 mb-1.5">
          {/* Avatar candidat avec logo société overlay en bas-droite (style "qui x qui") */}
          <div className="relative shrink-0">
            <CandidateAvatar
              name={meta.candidateName}
              avatarUrl={meta.candidateAvatarUrl ?? null}
              size={32}
            />
            {meta.clientName && (
              <div className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card rounded-md">
                <MissionCompanyLogo
                  company={meta.clientName}
                  size={16}
                />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-display font-semibold text-foreground truncate tracking-tight leading-tight">
              {meta.candidateName}
            </div>
            {(meta.clientName || meta.jobTitle) && (
              <div className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">
                {meta.clientName && (
                  <span className="font-medium text-foreground/80">{meta.clientName}</span>
                )}
                {meta.clientName && meta.jobTitle && <span className="text-muted-foreground/40"> · </span>}
                {meta.jobTitle && <span>{meta.jobTitle}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mission / job line — uniquement si ni qualif (pas déjà affiché ci-dessus) */}
      {!isQualif && (meta.clientName || meta.jobTitle) && (
        <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground truncate mb-1">
          {meta.clientName && (
            <MissionCompanyLogo company={meta.clientName} size={16} />
          )}
          <span className="truncate">
            {meta.clientName && (
              <span className="font-medium text-foreground/80">{meta.clientName}</span>
            )}
            {meta.clientName && meta.jobTitle && <span className="text-muted-foreground/40"> · </span>}
            {meta.jobTitle && <span>{meta.jobTitle}</span>}
          </span>
        </div>
      )}

      {/* Non-qualif (sequence/inmail) — show subtitle as candidate name */}
      {!isQualif && event.subtitle && (
        <div className="text-xs font-medium text-foreground truncate mb-0.5">
          {event.subtitle}
        </div>
      )}

      {/* Bottom : manager + location indicators */}
      <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-border/40">
        {meta.manager?.displayName ? (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground truncate"
            title={`Animé par ${meta.manager.displayName}`}
          >
            <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-emerald-500/15 text-foreground font-bold text-[8px]">
              {getInitials(meta.manager.displayName)}
            </span>
            <span className="truncate">{meta.manager.displayName.split(' ')[0]}</span>
          </span>
        ) : (
          <span />
        )}

        {meta.location && (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground shrink-0"
            title={meta.location}
          >
            {hasVisio ? <Video className="w-2.5 h-2.5" /> : <MapPin className="w-2.5 h-2.5" />}
          </span>
        )}
      </div>
    </button>
  );
});
