/**
 * DashboardTodayPanel — programme du jour.
 *
 * Pattern Linear "My Day" : on agrège ce qui se passe AUJOURD'HUI :
 * - Envois prévus (séquences + InMails)
 * - Rappels du jour (tasks/reminders)
 * - Entretiens calendrier (si data dispo)
 *
 * Format ligne ultra-condensé avec heure + libellé court + statut visuel
 * (sent/pending/late). Sticky en card de droite, complément naturel du
 * MissionsPanel.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  CalendarClock,
  Send,
  Mail,
  Bell,
  CheckCircle2,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ScheduledMessage } from '@/hooks/useTodayScheduledMessages';
import type { Reminder } from '@/hooks/useAllReminders';

interface DashboardTodayPanelProps {
  scheduledMessages: ScheduledMessage[];
  remindersToday: Reminder[];
  isLoading?: boolean;
}

export const DashboardTodayPanel: React.FC<DashboardTodayPanelProps> = ({
  scheduledMessages,
  remindersToday,
  isLoading,
}) => {
  const navigate = useNavigate();

  // Combine reminders + messages, sort by time, take next 8 events
  type CombinedItem = {
    id: string;
    time: string;
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    iconBg: string;
    iconColor: string;
    isDone: boolean;
    isLate: boolean;
    onClick: () => void;
  };

  const now = new Date();

  const combined: CombinedItem[] = [
    ...scheduledMessages.map((msg): CombinedItem => {
      const date = parseISO(msg.scheduledAt);
      const isDone = msg.status === 'sent' || msg.status === 'executed';
      const isLate = !isDone && date < now;
      return {
        id: `msg-${msg.id}`,
        time: format(date, 'HH:mm'),
        title: msg.recipientName || 'Profil LinkedIn',
        subtitle:
          msg.type === 'inmail' && msg.subject
            ? msg.subject
            : msg.sequenceName
            ? `${msg.sequenceName} · Étape ${(msg.stepOrder || 0) + 1}`
            : msg.recipientHeadline || '—',
        icon: msg.type === 'inmail' ? <Mail className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />,
        iconBg: msg.type === 'inmail' ? 'bg-info/10' : 'bg-foreground/[0.06]',
        iconColor: msg.type === 'inmail' ? 'text-info' : 'text-foreground',
        isDone,
        isLate,
        onClick: () => navigate('/missions'),
      };
    }),
    ...remindersToday.map((r): CombinedItem => {
      const date = parseISO(r.due_at);
      const isDone = !!r.completed_at;
      const isLate = !isDone && date < now;
      return {
        id: `rem-${r.id}`,
        time: format(date, 'HH:mm'),
        title: r.title,
        subtitle: r.candidate_name || r.job_title || 'Rappel',
        icon: <Bell className="w-3.5 h-3.5" />,
        iconBg: 'bg-warning/10',
        iconColor: 'text-warning',
        isDone,
        isLate,
        onClick: () => navigate('/tasks'),
      };
    }),
  ]
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 8);

  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-foreground/[0.06] text-foreground flex items-center justify-center shrink-0">
            <CalendarClock className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-bold text-foreground text-[15px] tracking-tight leading-none">
              Aujourd'hui
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {combined.length === 0
                ? 'Pas d\'événement programmé'
                : `${combined.length} événement${combined.length > 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        {combined.length > 0 && (
          <button
            onClick={() => navigate('/tasks')}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium transition-colors shrink-0"
          >
            Tout voir
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="p-2">
        {isLoading ? (
          <div className="space-y-1.5 p-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : combined.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-10 px-6 text-center mx-1">
            <div className="h-10 w-10 rounded-full bg-success/10 text-success flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <p className="text-sm text-foreground font-medium">Rien à l'agenda</p>
            <p className="text-xs text-muted-foreground mt-1">
              Aucun envoi ni rappel programmé pour aujourd'hui.
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {combined.map(item => (
              <button
                key={item.id}
                onClick={item.onClick}
                className={cn(
                  'w-full text-left rounded-lg px-3 py-2.5 transition-colors flex items-center gap-3 hover:bg-muted/40',
                  item.isDone && 'opacity-60',
                )}
              >
                <span
                  className={cn(
                    'text-xs font-bold tabular-nums w-12 shrink-0',
                    item.isDone ? 'text-muted-foreground line-through' : item.isLate ? 'text-destructive' : 'text-foreground',
                  )}
                >
                  {item.time}
                </span>
                <div
                  className={cn(
                    'h-7 w-7 rounded-lg flex items-center justify-center shrink-0',
                    item.iconBg,
                    item.iconColor,
                  )}
                >
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-xs font-medium text-foreground truncate',
                      item.isDone && 'line-through',
                    )}
                  >
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                </div>
                {item.isDone ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                ) : item.isLate ? (
                  <Clock className="w-3.5 h-3.5 text-destructive shrink-0" />
                ) : (
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
