import React from 'react';
import { Activity, Clock, Target, Send, GitBranch, Calendar, Award, FileText } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { EmptyState as EmptyStateUI } from '@/components/ui/EmptyState';
import { CenteredLoader } from './shared';
import { usePhoneCallInsights } from '@/hooks/usePhoneCallInsights';
import { PhoneCallInsights } from '@/components/outreach/PhoneCallInsights';

const ACTIVITY_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  scored: { icon: <Target className="w-3 h-3" />, color: 'bg-foreground text-background' },
  messaged: { icon: <Send className="w-3 h-3" />, color: 'bg-foreground text-background' },
  sequence_enrolled: { icon: <GitBranch className="w-3 h-3" />, color: 'bg-foreground text-background' },
  sequence_step: { icon: <Send className="w-3 h-3" />, color: 'bg-foreground/80 text-background' },
  inmail_sent: { icon: <Send className="w-3 h-3" />, color: 'bg-foreground text-background' },
  qualification_scheduled: { icon: <Calendar className="w-3 h-3" />, color: 'bg-accent text-foreground' },
  qualification_verdict: { icon: <Award className="w-3 h-3" />, color: 'bg-accent text-foreground' },
  shortlist_added: { icon: <FileText className="w-3 h-3" />, color: 'bg-foreground text-background' },
  appointment: { icon: <Calendar className="w-3 h-3" />, color: 'bg-foreground text-background' },
};

interface TimelineEvent {
  type: string;
  title: string;
  detail?: string;
  date: string;
  /** Appel : { callId, outcome, talkSeconds } pour afficher son résumé sous l'événement. */
  meta?: Record<string, unknown>;
}

interface ActivityTabProps {
  loading: boolean;
  timeline: TimelineEvent[];
  /** Candidat de la fiche : les tâches proposées après un appel lui sont rattachées. */
  candidate?: { id: string; name?: string | null } | null;
}

const callIdOf = (event: TimelineEvent): string | null =>
  event.type === 'aircall_call' && typeof event.meta?.callId === 'string' ? event.meta.callId : null;

export const ActivityTab = React.memo<ActivityTabProps>(({ loading, timeline, candidate = null }) => {
  // Avant les retours anticipés : l'ordre des hooks ne doit pas dépendre de l'état.
  const callIds = React.useMemo(
    () => timeline.map(callIdOf).filter((id): id is string => id !== null),
    [timeline],
  );
  const { byCallId } = usePhoneCallInsights(callIds);

  if (loading) return <CenteredLoader />;

  if (timeline.length === 0) {
    return <EmptyStateUI icon={<Activity className="w-7 h-7" />} title="Aucune activité enregistrée" description="" compact />;
  }

  return (
    <div className="relative pl-6 space-y-4">
      <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-foreground/15" />
      {timeline.map((event, i) => {
        const typeConfig = ACTIVITY_TYPE_CONFIG[event.type] || { icon: <Clock className="w-3 h-3" />, color: 'bg-foreground/10 text-foreground' };
        return (
          <div key={i} className="relative">
            <div className={cn("absolute -left-6 top-1 w-5 h-5 flex items-center justify-center", typeConfig.color)}>
              {typeConfig.icon}
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{event.title}</p>
              {event.detail && <p className="text-xs text-muted-foreground mt-0.5">{event.detail}</p>}
              {callIdOf(event) && (
                <PhoneCallInsights
                  callId={callIdOf(event) as string}
                  insight={byCallId.get(callIdOf(event) as string)}
                  outcome={typeof event.meta?.outcome === 'string' ? event.meta.outcome : undefined}
                  talkSeconds={typeof event.meta?.talkSeconds === 'number' ? event.meta.talkSeconds : undefined}
                  callStartedAt={event.date || null}
                  candidate={candidate}
                />
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {formatDistanceToNow(parseISO(event.date), { addSuffix: true, locale: fr })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
});

ActivityTab.displayName = 'ActivityTab';
