import React from 'react';
import { Activity, Clock, Target, Send, GitBranch, Calendar, Award, FileText } from 'lucide-react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { EmptyState } from '@/components/layout/EmptyState';
import { CenteredLoader } from './shared';

const ICON_CLASS = 'h-3.5 w-3.5';

/** Une pastille ronde par type d'événement, toutes sur le même fond neutre : la couleur est réservée à ce qui demande d'agir. */
const ACTIVITY_TYPE_ICON: Record<string, React.ReactNode> = {
  scored: <Target className={ICON_CLASS} aria-hidden="true" />,
  messaged: <Send className={ICON_CLASS} aria-hidden="true" />,
  sequence_enrolled: <GitBranch className={ICON_CLASS} aria-hidden="true" />,
  sequence_step: <Send className={ICON_CLASS} aria-hidden="true" />,
  inmail_sent: <Send className={ICON_CLASS} aria-hidden="true" />,
  qualification_scheduled: <Calendar className={ICON_CLASS} aria-hidden="true" />,
  qualification_verdict: <Award className={ICON_CLASS} aria-hidden="true" />,
  shortlist_added: <FileText className={ICON_CLASS} aria-hidden="true" />,
  appointment: <Calendar className={ICON_CLASS} aria-hidden="true" />,
};

interface TimelineEvent {
  type: string;
  title: string;
  detail?: string;
  date: string;
}

interface ActivityTabProps {
  loading: boolean;
  timeline: TimelineEvent[];
}

export const ActivityTab = React.memo<ActivityTabProps>(({ loading, timeline }) => {
  if (loading) return <CenteredLoader />;

  if (timeline.length === 0) {
    return (
      <EmptyState
        className="border-0 py-8"
        icon={Activity}
        title="Aucune activité enregistrée"
        description="Les notes, messages, séquences et rendez-vous de ce candidat apparaîtront ici."
      />
    );
  }

  return (
    <ul className="divide-y divide-border">
      {timeline.map((event, i) => {
        const date = parseISO(event.date);
        return (
          <li key={i} className="flex items-start gap-3 py-3 first:pt-0">
            <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-foreground-secondary">
              {ACTIVITY_TYPE_ICON[event.type] ?? <Clock className={ICON_CLASS} aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{event.title}</p>
              {event.detail && <p className="mt-0.5 text-sm text-muted-foreground">{event.detail}</p>}
            </div>
            <time
              dateTime={event.date}
              title={format(date, "d MMMM yyyy 'à' HH:mm", { locale: fr })}
              className="shrink-0 pt-0.5 text-xs text-muted-foreground"
            >
              {formatDistanceToNow(date, { addSuffix: true, locale: fr })}
            </time>
          </li>
        );
      })}
    </ul>
  );
});

ActivityTab.displayName = 'ActivityTab';
