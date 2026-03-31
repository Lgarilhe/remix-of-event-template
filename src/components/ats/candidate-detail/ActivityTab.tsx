import React from 'react';
import { Activity, Clock, Target, Send, GitBranch, Calendar, Award, FileText } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { EmptyState as EmptyStateUI } from '@/components/ui/EmptyState';
import { CenteredLoader } from './shared';

const ACTIVITY_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  scored: { icon: <Target className="w-3 h-3" />, color: 'bg-foreground text-background' },
  messaged: { icon: <Send className="w-3 h-3" />, color: 'bg-foreground text-background' },
  sequence_enrolled: { icon: <GitBranch className="w-3 h-3" />, color: 'bg-foreground text-background' },
  sequence_step: { icon: <Send className="w-3 h-3" />, color: 'bg-foreground/80 text-background' },
  inmail_sent: { icon: <Send className="w-3 h-3" />, color: 'bg-foreground text-background' },
  qualification_scheduled: { icon: <Calendar className="w-3 h-3" />, color: 'bg-brutal-accent text-foreground' },
  qualification_verdict: { icon: <Award className="w-3 h-3" />, color: 'bg-brutal-accent text-foreground' },
  shortlist_added: { icon: <FileText className="w-3 h-3" />, color: 'bg-foreground text-background' },
  appointment: { icon: <Calendar className="w-3 h-3" />, color: 'bg-foreground text-background' },
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
