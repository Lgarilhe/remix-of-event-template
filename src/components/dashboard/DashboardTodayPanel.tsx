/**
 * DashboardTodayPanel — programme du jour V2 (interactif et riche).
 *
 * Pattern Linear "My Day" / Cal.com agenda : agrège tout ce qui se passe
 * AUJOURD'HUI dans 1 timeline ordonnée :
 * - Entretiens (qualification_sessions) avec avatar candidat + logo société
 *   + badge round (1er/2e/Final) + format (visio/présentiel)
 * - Envois prévus (séquences + InMails)
 * - Rappels du jour (tâches dues)
 *
 * Interactivité :
 * - Click sur un entretien → ouvre EventDetailSheet (full détail + actions)
 * - Bouton "Rejoindre" inline si lien visio dans event
 * - Cocher le rappel directement depuis la card
 * - Quick add task button (+ en footer)
 * - Indicateur "en cours" / "imminent" (pulse dot live)
 *
 * Pulse "now" : si event_start_at < now < event_end_at → ring vert + "EN COURS"
 * Pulse "soon" : event dans <30 min → ring amber + "DANS Xmin"
 */

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  format,
  parseISO,
  isToday,
  differenceInMinutes,
  startOfDay,
} from 'date-fns';
import {
  CalendarClock,
  Send,
  Mail,
  Bell,
  CheckCircle2,
  Clock,
  ArrowRight,
  Video,
  Sparkles,
  Plus,
  ExternalLink,
  Briefcase,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScheduledMessage } from '@/hooks/useTodayScheduledMessages';
import type { Reminder } from '@/hooks/useAllReminders';
import { useCalendarEvents, type CalendarEvent } from '@/hooks/useCalendarEvents';
import { CandidateAvatar } from '@/components/dashboard/CandidateAvatar';
import { MissionCompanyLogo } from '@/components/dashboard/MissionCompanyLogo';
import { EventDetailSheet } from '@/components/calendar/EventDetailSheet';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { LivePulse } from './LivePulse';

interface DashboardTodayPanelProps {
  scheduledMessages: ScheduledMessage[];
  remindersToday: Reminder[];
  isLoading?: boolean;
}

type ItemType = 'event' | 'message' | 'reminder';

interface CombinedItem {
  id: string;
  type: ItemType;
  time: string;
  startAt: Date;
  endAt: Date | null;
  /** Raw payload pour passer au sheet ou pour les actions */
  payload: any;
}

const isVisio = (loc: string | null | undefined) => !!loc && /^https?:\/\//i.test(loc);

export const DashboardTodayPanel: React.FC<DashboardTodayPanelProps> = ({
  scheduledMessages,
  remindersToday,
  isLoading,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sheetEvent, setSheetEvent] = useState<CalendarEvent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);

  // Today's qualif events depuis le calendar hook (riches : avatar, mission, manager...)
  const today = useMemo(() => startOfDay(new Date()), []);
  const { data: todayEvents = [] } = useCalendarEvents({ from: today, days: 1 });

  // Filter pour qualif uniquement (les inmails/sequences arrivent déjà via scheduledMessages)
  const qualifEvents = useMemo(
    () => todayEvents.filter((e) => e.type === 'qualification' && isToday(parseISO(e.startAt))),
    [todayEvents],
  );

  const now = new Date();

  // Combine all items in chronological order
  const combined: CombinedItem[] = useMemo(() => {
    const items: CombinedItem[] = [];

    // Qualif events
    for (const ev of qualifEvents) {
      try {
        const start = parseISO(ev.startAt);
        const end = ev.endAt ? parseISO(ev.endAt) : null;
        items.push({
          id: ev.id,
          type: 'event',
          time: format(start, 'HH:mm'),
          startAt: start,
          endAt: end,
          payload: ev,
        });
      } catch {
        // skip
      }
    }

    // Scheduled messages
    for (const msg of scheduledMessages) {
      try {
        const start = parseISO(msg.scheduledAt);
        items.push({
          id: `msg-${msg.id}`,
          type: 'message',
          time: format(start, 'HH:mm'),
          startAt: start,
          endAt: null,
          payload: msg,
        });
      } catch {
        // skip
      }
    }

    // Reminders
    for (const r of remindersToday) {
      try {
        const start = parseISO(r.due_at);
        items.push({
          id: `rem-${r.id}`,
          type: 'reminder',
          time: format(start, 'HH:mm'),
          startAt: start,
          endAt: null,
          payload: r,
        });
      } catch {
        // skip
      }
    }

    return items
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .slice(0, 12);
  }, [qualifEvents, scheduledMessages, remindersToday]);

  // Stat de progression : x/y faits
  const stats = useMemo(() => {
    let total = 0;
    let done = 0;
    let upcoming = 0;
    for (const it of combined) {
      total++;
      const isDone = isItemDone(it);
      if (isDone) done++;
      else if (it.startAt > now) upcoming++;
    }
    return { total, done, upcoming };
  }, [combined, now]);

  const openEvent = (event: CalendarEvent) => {
    setSheetEvent(event);
    setSheetOpen(true);
  };

  const handleToggleReminder = async (reminder: Reminder) => {
    const newCompletedAt = reminder.completed_at ? null : new Date().toISOString();
    const { error } = await supabase
      .from('candidate_reminders')
      .update({ completed_at: newCompletedAt })
      .eq('id', reminder.id);
    if (!error) {
      await queryClient.invalidateQueries({ queryKey: ['all-reminders'] });
    }
  };

  return (
    <motion.div
      className="rounded-xl bg-card border border-border overflow-hidden h-full flex flex-col"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut', delay: 0.15 }}
    >
      {/* Header avec progression */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-emerald-500/15 text-foreground flex items-center justify-center shrink-0">
            <CalendarClock className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-bold text-foreground text-[15px] tracking-tight leading-none">
              Aujourd'hui
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {combined.length === 0
                ? "Pas d'événement programmé"
                : stats.done > 0
                ? `${stats.done}/${stats.total} fait${stats.done > 1 ? 's' : ''} · ${stats.upcoming} à venir`
                : `${combined.length} événement${combined.length > 1 ? 's' : ''} à venir`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setCreateTaskOpen(true)}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            title="Ajouter une tâche (Cmd+T)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {combined.length > 0 && (
            <button
              onClick={() => navigate('/calendar')}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
            >
              Calendrier
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar — pourcentage fait */}
      {combined.length > 0 && stats.done > 0 && (
        <div className="h-0.5 bg-muted/40 relative">
          <motion.div
            className="absolute inset-y-0 left-0 bg-success/60"
            initial={{ width: 0 }}
            animate={{ width: `${(stats.done / stats.total) * 100}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>
      )}

      {/* Body */}
      <div className="p-2 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1.5 p-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : combined.length === 0 ? (
          <EmptyState onCreate={() => setCreateTaskOpen(true)} />
        ) : (
          <motion.div
            className="space-y-1"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.04, delayChildren: 0.2 } },
            }}
          >
            <AnimatePresence>
              {combined.map((item) => (
                <TodayItem
                  key={item.id}
                  item={item}
                  now={now}
                  onClickEvent={openEvent}
                  onToggleReminder={handleToggleReminder}
                  onMessageClick={() => navigate('/missions')}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* Detail sheet */}
      <EventDetailSheet event={sheetEvent} open={sheetOpen} onOpenChange={setSheetOpen} />

      {/* Quick add task modal */}
      <CreateTaskModal open={createTaskOpen} onOpenChange={setCreateTaskOpen} />
    </motion.div>
  );
};

// ─── Item Renderer ───────────────────────────────────────────────────────

const isItemDone = (item: CombinedItem): boolean => {
  if (item.type === 'event') {
    return item.payload.status === 'completed';
  }
  if (item.type === 'message') {
    const m = item.payload as ScheduledMessage;
    return m.status === 'sent' || m.status === 'executed';
  }
  if (item.type === 'reminder') {
    return !!(item.payload as Reminder).completed_at;
  }
  return false;
};

const TodayItem: React.FC<{
  item: CombinedItem;
  now: Date;
  onClickEvent: (e: CalendarEvent) => void;
  onToggleReminder: (r: Reminder) => void;
  onMessageClick: () => void;
}> = ({ item, now, onClickEvent, onToggleReminder, onMessageClick }) => {
  const isDone = isItemDone(item);
  const isPast = !isDone && item.startAt < now;
  const isLive =
    !isDone &&
    item.startAt <= now &&
    (item.endAt ? item.endAt >= now : differenceInMinutes(now, item.startAt) < 60);
  const minutesUntil = differenceInMinutes(item.startAt, now);
  const isImminent = !isDone && !isLive && minutesUntil > 0 && minutesUntil < 30;

  const variants = {
    hidden: { opacity: 0, x: 8 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut' } },
  };

  // ─── Render qualif event ─────────────────────────────────────────────
  if (item.type === 'event') {
    const ev = item.payload as CalendarEvent;
    const meta = ev.meta || {};
    const candidateName = meta.candidateName || 'Profil LinkedIn';
    const visioHref = isVisio(meta.location) ? meta.location : null;

    return (
      <motion.div
        variants={variants}
        exit={{ opacity: 0, x: -8 }}
        className={cn(
          'group rounded-lg p-2.5 transition-colors relative',
          isLive
            ? 'bg-success/[0.08] ring-1 ring-success/40 hover:bg-success/[0.12]'
            : isImminent
            ? 'bg-warning/[0.06] ring-1 ring-warning/30 hover:bg-warning/[0.10]'
            : 'hover:bg-muted/40',
          (isDone || isPast) && !isLive && 'opacity-60',
        )}
      >
        <button
          type="button"
          onClick={() => onClickEvent(ev)}
          className="w-full text-left flex items-center gap-3"
        >
          {/* Time + status */}
          <div className="w-12 shrink-0 flex flex-col items-start">
            <span
              className={cn(
                'font-display text-[12px] font-bold tabular-nums tracking-tight',
                isLive ? 'text-success' :
                isImminent ? 'text-warning' :
                isPast ? 'text-muted-foreground line-through' :
                'text-foreground',
              )}
            >
              {item.time}
            </span>
            {isLive ? (
              <span className="inline-flex items-center gap-1 mt-0.5">
                <LivePulse tone="success" />
                <span className="text-3xs uppercase tracking-wider font-bold text-success">
                  Live
                </span>
              </span>
            ) : isImminent ? (
              <span className="text-3xs uppercase tracking-wider font-bold text-warning mt-0.5">
                {minutesUntil}min
              </span>
            ) : item.endAt ? (
              <span className="text-3xs text-muted-foreground tabular-nums mt-0.5">
                — {format(item.endAt, 'HH:mm')}
              </span>
            ) : null}
          </div>

          {/* Avatar + logo overlay */}
          <div className="relative shrink-0">
            <CandidateAvatar
              name={candidateName}
              avatarUrl={meta.candidateAvatarUrl ?? null}
              size={32}
            />
            {meta.clientName && (
              <div className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card rounded-md">
                <MissionCompanyLogo company={meta.clientName} size={14} />
              </div>
            )}
          </div>

          {/* Text + badges */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-display font-semibold text-foreground tracking-tight truncate">
                {candidateName}
              </span>
              {/* Round badge */}
              {meta.round && (
                <span
                  className={cn(
                    'inline-flex items-center text-3xs font-bold uppercase tracking-wider px-1.5 h-3.5 rounded-full shrink-0',
                    meta.round.kind === 'final'
                      ? 'bg-warning/15 text-warning'
                      : meta.round.n === 1
                      ? 'bg-foreground/[0.08] text-foreground/80'
                      : 'bg-info/10 text-info',
                  )}
                  title={meta.round.label}
                >
                  {meta.round.kind === 'final' ? 'Final' : meta.round.n === 1 ? '1er' : `${meta.round.n}e`}
                </span>
              )}
              {meta.calendlyEventId && (
                <Sparkles className="w-2.5 h-2.5 text-foreground/50" />
              )}
            </div>
            {(meta.clientName || meta.jobTitle) && (
              <p className="text-2xs text-muted-foreground truncate leading-tight mt-0.5">
                {meta.clientName && (
                  <span className="font-medium text-foreground/80">{meta.clientName}</span>
                )}
                {meta.clientName && meta.jobTitle && (
                  <span className="text-muted-foreground/40"> · </span>
                )}
                {meta.jobTitle}
              </p>
            )}
          </div>

          {/* Right indicator */}
          <div className="shrink-0">
            {isDone ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
            ) : visioHref ? (
              <Video className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
            ) : (
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* CTA "Rejoindre" si imminent ou live + visio */}
        {(isLive || isImminent) && visioHref && (
          <div className="mt-2 pl-[60px]">
            <a
              href={visioHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-2xs font-medium transition-colors',
                isLive
                  ? 'bg-success text-success-foreground hover:bg-success/90'
                  : 'bg-foreground text-background hover:opacity-90',
              )}
            >
              <Video className="w-3 h-3" />
              {isLive ? 'Rejoindre maintenant' : 'Rejoindre'}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        )}
      </motion.div>
    );
  }

  // ─── Render reminder ─────────────────────────────────────────────────
  if (item.type === 'reminder') {
    const r = item.payload as Reminder;
    return (
      <motion.div
        variants={variants}
        exit={{ opacity: 0, x: -8 }}
        className={cn(
          'group rounded-lg p-2.5 transition-colors flex items-center gap-3',
          'hover:bg-muted/40',
          isDone && 'opacity-60',
        )}
      >
        {/* Time */}
        <span
          className={cn(
            'font-display text-[12px] font-bold tabular-nums tracking-tight w-12 shrink-0',
            isDone ? 'text-muted-foreground line-through' :
            isPast ? 'text-destructive' :
            'text-foreground',
          )}
        >
          {item.time}
        </span>

        {/* Checkbox quick toggle */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleReminder(r);
          }}
          className={cn(
            'h-5 w-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-colors',
            isDone
              ? 'bg-success/20 border-success/60 text-success'
              : 'border-muted-foreground/40 hover:border-foreground hover:bg-muted/40',
          )}
          title={isDone ? 'Marquer non fait' : 'Marquer fait'}
        >
          {isDone && <CheckCircle2 className="w-3 h-3" />}
        </button>

        {/* Content */}
        <button
          type="button"
          onClick={() => {
            // Navigate to candidate or task page
            if (r.candidate_id) {
              window.location.href = `/pipeline?candidate=${r.candidate_id}`;
            } else {
              window.location.href = '/tasks';
            }
          }}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          <div className="h-7 w-7 rounded-lg bg-warning/10 text-warning flex items-center justify-center shrink-0">
            <Bell className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'text-xs font-medium text-foreground truncate',
                isDone && 'line-through',
              )}
            >
              {r.title}
            </p>
            <p className="text-2xs text-muted-foreground truncate">
              {r.candidate_name || r.job_title || 'Rappel'}
            </p>
          </div>
        </button>
      </motion.div>
    );
  }

  // ─── Render scheduled message ────────────────────────────────────────
  const msg = item.payload as ScheduledMessage;
  const isInmail = msg.type === 'inmail';
  const recipientName = msg.recipientName || 'Profil LinkedIn';
  const subtitle =
    isInmail && msg.subject
      ? msg.subject
      : msg.sequenceName
      ? `${msg.sequenceName} · Étape ${(msg.stepOrder || 0) + 1}`
      : msg.recipientHeadline || '—';

  return (
    <motion.button
      variants={variants}
      exit={{ opacity: 0, x: -8 }}
      whileHover={{ x: 2, transition: { duration: 0.15 } }}
      onClick={onMessageClick}
      className={cn(
        'w-full text-left rounded-lg p-2.5 transition-colors flex items-center gap-3 hover:bg-muted/40',
        isDone && 'opacity-60',
      )}
    >
      <span
        className={cn(
          'font-display text-[12px] font-bold tabular-nums tracking-tight w-12 shrink-0',
          isDone ? 'text-muted-foreground line-through' :
          isPast ? 'text-destructive' :
          'text-foreground',
        )}
      >
        {item.time}
      </span>

      {/* Avatar candidat (si recipient name dispo) */}
      <CandidateAvatar
        name={recipientName}
        avatarUrl={null}
        size={28}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p
            className={cn(
              'text-xs font-medium text-foreground truncate',
              isDone && 'line-through',
            )}
          >
            {recipientName}
          </p>
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-3xs font-bold uppercase tracking-wider px-1.5 h-3.5 rounded-full shrink-0',
              isInmail
                ? 'bg-info/15 text-info'
                : 'bg-foreground/[0.08] text-foreground/70',
            )}
          >
            {isInmail ? <Mail className="w-2 h-2" /> : <Send className="w-2 h-2" />}
            {isInmail ? 'InMail' : 'Séq.'}
          </span>
        </div>
        <p className="text-2xs text-muted-foreground truncate">{subtitle}</p>
      </div>

      {isDone ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
      ) : (
        <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      )}
    </motion.button>
  );
};

// ─── Empty State ─────────────────────────────────────────────────────────

const EmptyState: React.FC<{ onCreate: () => void }> = ({ onCreate }) => (
  <motion.div
    className="rounded-xl border border-dashed border-border py-8 px-6 text-center mx-1 relative overflow-hidden"
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.4 }}
  >
    <motion.div
      aria-hidden="true"
      className="absolute -bottom-12 -right-12 h-32 w-32 rounded-full bg-success/10 blur-2xl pointer-events-none"
      animate={{ opacity: [0.3, 0.6, 0.3] }}
      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
    />
    <div className="relative h-10 w-10 rounded-full bg-success/10 text-success flex items-center justify-center mx-auto mb-3">
      <CheckCircle2 className="w-5 h-5" />
    </div>
    <p className="relative text-sm text-foreground font-medium">Rien à l'agenda</p>
    <p className="relative text-xs text-muted-foreground mt-1 mb-4">
      Aucun entretien, envoi ou rappel pour aujourd'hui.
    </p>
    <button
      onClick={onCreate}
      className="relative inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-background hover:bg-accent text-2xs font-medium text-foreground transition-colors"
    >
      <Plus className="w-3.5 h-3.5" />
      Ajouter une tâche
    </button>
  </motion.div>
);
