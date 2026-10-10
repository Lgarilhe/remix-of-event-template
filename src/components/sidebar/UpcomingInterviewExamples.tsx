import { CalendarClock, X } from 'lucide-react';
import { useCalendarDemo } from '@/components/calendar/CalendarDemoProvider';
import { CalendarServiceLogo } from '@/components/calendar/CalendarServiceLogo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useNow } from '@/hooks/sidebar/useNow';
import { CALENDAR_DEMO_SERVICE_LABELS, calendarDemoLinks } from '@/lib/calendarDemo';
import { formatUpcomingTime } from '@/lib/sidebarSignals';
import { InterviewActionButtons } from './InterviewActionButtons';
import { SidebarRow } from './SidebarRow';
import { SidebarSection } from './SidebarSection';
import { SIDEBAR_GHOST_CLASS } from './sidebarButtonClass';

/** Exemples locaux : jamais ajoutés aux rendez-vous ou aux alertes réels. */
export function UpcomingInterviewExamples({ hasRealEvents }: { hasRealEvents: boolean }) {
  const { active, interviews, openPreview, stopDemo } = useCalendarDemo();
  const now = new Date(useNow(60_000));
  if (!active) return null;

  return <div data-component="sidebar-interview-examples">
    <SidebarSection id="interview-examples" title={hasRealEvents ? 'Entretiens fictifs' : 'Événements à venir'}
      state="ok" isEmpty={false} headerAction={<Badge variant="muted">Exemples</Badge>}
      footer={<SidebarRow leading={<X />} title="Quitter les exemples" onSelect={stopDemo} muted />}>
      {interviews.map(interview => {
        const { event } = interview;
        const links = calendarDemoLinks(event.id);
        return <li key={event.id} aria-label={`Entretien fictif avec ${event.meta?.candidateName}`}
          className="mx-1 mb-2 rounded-lg border border-sidebar-border bg-sidebar-accent/30 p-1">
          <Button type="button" variant="ghost" onClick={() => openPreview(interview, 'scorecard')}
            className="h-auto min-h-11 w-full justify-start gap-2 whitespace-normal px-1.5 py-2 text-left font-normal">
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold">{event.meta?.candidateName}</span>
              <span className="block truncate text-2xs text-muted-foreground">{event.meta?.jobTitle}</span>
            </span>
            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{formatUpcomingTime(event.startAt, now)}</span>
          </Button>
          <div className="space-y-2 px-1.5 pb-1.5">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
              {[interview.calendar, interview.meeting].map(service => <span key={service} className="inline-flex items-center gap-1">
                <CalendarServiceLogo service={service} decorative />{CALENDAR_DEMO_SERVICE_LABELS[service]}
              </span>)}
            </div>
            <InterviewActionButtons links={links} joinUrl={null} compact
              onJoin={() => openPreview(interview, 'meeting')}
              onOpen={to => openPreview(interview, to === links.coaching ? 'assistant' : 'scorecard')}
              secondaryClassName={SIDEBAR_GHOST_CLASS} />
          </div>
        </li>;
      })}
    </SidebarSection>
  </div>;
}
