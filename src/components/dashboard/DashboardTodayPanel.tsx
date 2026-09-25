/**
 * DashboardTodayPanel — la journée en une liste chronologique.
 *
 * - Entretiens que j'anime aujourd'hui (qualification_sessions), avec « En
 *   cours » ou « Dans 12 min » et le lien de visio quand il existe ;
 * - Envois prévus (séquences et InMails) ;
 * - Tâches du jour et tâches en retard, cochables sur place.
 *
 * Le sous-titre compte ce qui est en retard, à venir et fait. Une lecture en
 * échec s'affiche comme une erreur avec « Réessayer », jamais comme une
 * journée vide.
 */

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO, isToday, differenceInMinutes, startOfDay } from 'date-fns';
import { ArrowRight, CalendarDays, Plus } from 'lucide-react';
import { Section, EmptyState, ErrorState } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ScheduledMessage } from '@/hooks/useTodayScheduledMessages';
import type { Reminder } from '@/hooks/useAllReminders';
import { useCalendarEvents, type CalendarEvent } from '@/hooks/useCalendarEvents';
import { useTodoInterviews } from '@/hooks/sidebar/useTodoInterviews';
import { CandidateAvatar } from '@/components/dashboard/CandidateAvatar';
import { EventDetailSheet } from '@/components/calendar/EventDetailSheet';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { LivePulse } from './LivePulse';

interface DashboardTodayPanelProps {
  scheduledMessages: ScheduledMessage[];
  remindersToday: Reminder[];
  isLoading?: boolean;
  /** Message technique si une lecture (tâches, envois) a échoué. */
  error?: string | null;
  onRetry?: () => void;
  onToggleReminder: (reminder: Reminder) => void;
}

type ItemType = 'event' | 'message' | 'reminder';

interface CombinedItem {
  id: string;
  type: ItemType;
  time: string;
  startAt: Date;
  endAt: Date | null;
  payload: CalendarEvent | ScheduledMessage | Reminder;
}

const isVisio = (loc: string | null | undefined) => !!loc && /^https?:\/\//i.test(loc);

const isItemDone = (item: CombinedItem): boolean => {
  if (item.type === 'event') return (item.payload as CalendarEvent).status === 'completed';
  if (item.type === 'message') {
    const m = item.payload as ScheduledMessage;
    return m.status === 'sent' || m.status === 'executed';
  }
  return !!(item.payload as Reminder).completed_at;
};

const roundLabel = (round: { kind: string; n?: number } | null | undefined): string | null => {
  if (!round) return null;
  if (round.kind === 'final') return 'Entretien final';
  if (round.n === 1) return '1er entretien';
  return round.n ? `${round.n}e entretien` : null;
};

export const DashboardTodayPanel: React.FC<DashboardTodayPanelProps> = ({
  scheduledMessages,
  remindersToday,
  isLoading,
  error,
  onRetry,
  onToggleReminder,
}) => {
  const [sheetEvent, setSheetEvent] = useState<CalendarEvent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);

  // Entretiens du jour, lus avec leurs détails (candidat, mission, animateur).
  const today = useMemo(() => startOfDay(new Date()), []);
  const { data: todayEvents = [] } = useCalendarEvents({ from: today, days: 1 });

  // Entretiens que j'anime dans l'organisation active, lus comme la barre
  // latérale : le calendrier, lui, montre ceux de toute l'équipe. Tant que la
  // liste est inconnue, le panneau reste en chargement, sauf lecture en échec
  // ou hors ligne (jamais sans fin).
  const { mineTodayIds, status: interviewsStatus } = useTodoInterviews();
  const interviewsLoading = mineTodayIds === null && interviewsStatus === 'loading';

  const qualifEvents = useMemo(
    () =>
      mineTodayIds
        ? todayEvents.filter(
            (e) =>
              e.type === 'qualification' &&
              isToday(parseISO(e.startAt)) &&
              // Identifiant de l'événement : `qualif-{id de qualification_sessions}`.
              mineTodayIds.has(e.id.replace(/^qualif-/, '')),
          )
        : [],
    [todayEvents, mineTodayIds],
  );

  const now = new Date();

  const combined: CombinedItem[] = useMemo(() => {
    const items: CombinedItem[] = [];
    const push = (id: string, type: ItemType, start: string, end: string | null, payload: CombinedItem['payload']) => {
      try {
        const startAt = parseISO(start);
        items.push({ id, type, time: format(startAt, 'HH:mm'), startAt, endAt: end ? parseISO(end) : null, payload });
      } catch {
        // date illisible : l'élément est ignoré
      }
    };
    for (const ev of qualifEvents) push(ev.id, 'event', ev.startAt, ev.endAt ?? null, ev);
    for (const msg of scheduledMessages) push(`msg-${msg.id}`, 'message', msg.scheduledAt, null, msg);
    for (const r of remindersToday) push(`rem-${r.id}`, 'reminder', r.due_at, null, r);
    return items.sort((a, b) => a.startAt.getTime() - b.startAt.getTime()).slice(0, 12);
  }, [qualifEvents, scheduledMessages, remindersToday]);

  // Recalculé à chaque rendu (12 éléments au plus) : le décompte suit l'heure.
  const counts = { late: 0, upcoming: 0, done: 0 };
  for (const it of combined) {
    if (isItemDone(it)) counts.done++;
    else if (it.startAt < now) counts.late++;
    else counts.upcoming++;
  }

  const subtitle = [
    counts.late > 0 && `${counts.late} en retard`,
    counts.upcoming > 0 && `${counts.upcoming} à venir`,
    counts.done > 0 && `${counts.done} fait${counts.done > 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const openEvent = (event: CalendarEvent) => {
    setSheetEvent(event);
    setSheetOpen(true);
  };

  const loading = isLoading || interviewsLoading;

  return (
    <Section
      headingLevel={2}
      title="Aujourd'hui"
      subtitle={!loading && !error ? subtitle || undefined : undefined}
      className="flex h-full flex-col"
      action={
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => setCreateTaskOpen(true)} aria-label="Ajouter une tâche">
                <Plus aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ajouter une tâche</TooltipContent>
          </Tooltip>
          <Button asChild variant="ghost" size="xs">
            <Link to="/calendar">
              Agenda
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      }
    >
      <div className="p-2">
        {loading ? (
          <div className="space-y-2 p-1" role="status" aria-label="Chargement de la journée">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <ErrorState
            variant="compact"
            className="border-0 bg-transparent"
            title="Impossible de charger votre journée"
            description="Vérifiez votre connexion, puis réessayez."
            detail={error}
            onRetry={onRetry}
          />
        ) : combined.length === 0 ? (
          <EmptyState
            variant="compact"
            className="border-0"
            icon={CalendarDays}
            title="Rien de prévu aujourd'hui"
            description="Aucun entretien, envoi ni tâche pour aujourd'hui."
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => setCreateTaskOpen(true)}>
                <Plus aria-hidden="true" />
                Ajouter une tâche
              </Button>
            }
          />
        ) : (
          <ul className="space-y-0.5">
            {combined.map((item) => (
              <TodayItem
                key={item.id}
                item={item}
                now={now}
                onClickEvent={openEvent}
                onToggleReminder={onToggleReminder}
              />
            ))}
          </ul>
        )}
      </div>

      <EventDetailSheet event={sheetEvent} open={sheetOpen} onOpenChange={setSheetOpen} />
      <CreateTaskModal open={createTaskOpen} onOpenChange={setCreateTaskOpen} />
    </Section>
  );
};

// ─── Lignes ──────────────────────────────────────────────────────────────

const TimeCell: React.FC<{ time: string; note?: React.ReactNode; muted?: boolean }> = ({ time, note, muted }) => (
  <span className="flex w-16 shrink-0 flex-col whitespace-nowrap">
    <span className={cn('text-xs font-medium tabular-nums', muted ? 'text-muted-foreground' : 'text-foreground')}>{time}</span>
    {note}
  </span>
);

const TodayItem: React.FC<{
  item: CombinedItem;
  now: Date;
  onClickEvent: (e: CalendarEvent) => void;
  onToggleReminder: (r: Reminder) => void;
}> = ({ item, now, onClickEvent, onToggleReminder }) => {
  const isDone = isItemDone(item);
  const isLate = !isDone && item.startAt < now;

  // ─── Entretien ──────────────────────────────────────────────────────
  if (item.type === 'event') {
    const ev = item.payload as CalendarEvent;
    const meta = ev.meta || {};
    const candidateName = meta.candidateName || 'Profil LinkedIn';
    const visioHref = isVisio(meta.location) ? meta.location : null;
    const isLive =
      !isDone && item.startAt <= now && (item.endAt ? item.endAt >= now : differenceInMinutes(now, item.startAt) < 60);
    const minutesUntil = differenceInMinutes(item.startAt, now);
    const isImminent = !isDone && !isLive && minutesUntil > 0 && minutesUntil < 30;
    const round = roundLabel(meta.round);
    const context = [meta.clientName, meta.jobTitle].filter(Boolean).join(' · ');

    const note = isLive ? (
      <LivePulse tone="success" label="En cours" />
    ) : isImminent ? (
      <span className="text-2xs font-medium text-warning">Dans {minutesUntil} min</span>
    ) : item.endAt ? (
      <span className="text-2xs tabular-nums text-muted-foreground">à {format(item.endAt, 'HH:mm')}</span>
    ) : null;

    return (
      <li className={cn('flex items-center gap-2 rounded-lg pr-2 transition-colors hover:bg-accent/60', isDone && 'opacity-60')}>
        <button
          type="button"
          onClick={() => onClickEvent(ev)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <TimeCell time={item.time} note={note} muted={isDone || (isLate && !isLive)} />
          <CandidateAvatar name={candidateName} avatarUrl={meta.candidateAvatarUrl ?? null} size={28} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              {candidateName}
              {round && <span className="font-normal text-muted-foreground"> · {round}</span>}
            </span>
            {context && <span className="block truncate text-xs text-muted-foreground">{context}</span>}
          </span>
        </button>
        {(isLive || isImminent) && visioHref && (
          <Button asChild variant="primary" size="xs">
            <a href={visioHref} target="_blank" rel="noopener noreferrer">
              Rejoindre
            </a>
          </Button>
        )}
      </li>
    );
  }

  // ─── Tâche ──────────────────────────────────────────────────────────
  if (item.type === 'reminder') {
    const r = item.payload as Reminder;
    const context = r.candidate_name || r.job_title;
    return (
      <li className={cn('flex items-center gap-3 rounded-lg p-2.5 transition-colors hover:bg-accent/60', isDone && 'opacity-60')}>
        <TimeCell
          time={item.time}
          muted={isDone || isLate}
          note={isLate ? <span className="text-2xs text-muted-foreground">en retard</span> : null}
        />
        <Checkbox
          checked={isDone}
          onCheckedChange={() => onToggleReminder(r)}
          aria-label={isDone ? `Rouvrir la tâche « ${r.title} »` : `Marquer la tâche « ${r.title} » comme faite`}
        />
        <Link
          to={r.candidate_id ? `/pipeline?candidate=${r.candidate_id}` : '/tasks'}
          className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className={cn('block truncate text-sm text-foreground', isDone && 'line-through')}>{r.title}</span>
          {context && <span className="block truncate text-xs text-muted-foreground">{context}</span>}
        </Link>
      </li>
    );
  }

  // ─── Envoi prévu ────────────────────────────────────────────────────
  const msg = item.payload as ScheduledMessage;
  const isInmail = msg.type === 'inmail';
  const recipientName = msg.recipientName || 'Profil LinkedIn';
  const subtitle =
    isInmail && msg.subject
      ? msg.subject
      : msg.sequenceName
        ? `${msg.sequenceName} · étape ${(msg.stepOrder || 0) + 1}`
        : msg.recipientHeadline;

  return (
    <li className={cn('flex items-center gap-3 rounded-lg p-2.5', isDone && 'opacity-60')}>
      <TimeCell
        time={item.time}
        muted={isDone || isLate}
        note={isDone ? <span className="text-2xs text-muted-foreground">envoyé</span> : null}
      />
      <CandidateAvatar name={recipientName} avatarUrl={null} size={28} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm text-foreground">{recipientName}</span>
          <Badge variant="muted" className="shrink-0">
            {isInmail ? 'InMail' : 'Séquence'}
          </Badge>
        </span>
        {subtitle && <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
    </li>
  );
};
