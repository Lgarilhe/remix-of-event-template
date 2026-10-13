import { X } from 'lucide-react';
import { useCalendarDemo } from '@/components/calendar/CalendarDemoProvider';
import { CalendarServiceLogo } from '@/components/calendar/CalendarServiceLogo';
import { Button } from '@/components/ui/button';
import { useNow } from '@/hooks/sidebar/useNow';
import { CALENDAR_DEMO_SERVICE_LABELS, calendarDemoLinks } from '@/lib/calendarDemo';
import { formatUpcomingTime } from '@/lib/sidebarSignals';
import { UpcomingInterviewMenu } from './UpcomingInterviewMenu';
import { SidebarSection } from './SidebarSection';
import { SIDEBAR_GHOST_CLASS } from './sidebarButtonClass';
import { cn } from '@/lib/utils';

/** Exemples locaux : jamais ajoutés aux rendez-vous ou aux alertes réels. */
export function UpcomingInterviewExamples({ hasRealEvents }: { hasRealEvents: boolean }) {
  const { active, interviews, openPreview, stopDemo } = useCalendarDemo();
  const now = new Date(useNow(60_000));
  if (!active) return null;

  return <div data-component="sidebar-interview-examples">
    <SidebarSection id="interview-examples" title={hasRealEvents ? 'Entretiens fictifs' : 'Événements à venir'}
      state="ok" isEmpty={false} headerAction={<div className="flex items-center gap-1">
        <span className="text-2xs text-muted-foreground">Exemples</span>
        <Button type="button" variant="ghost" size="icon-xs" onClick={stopDemo} aria-label="Quitter les exemples" title="Quitter les exemples"
          className={cn(SIDEBAR_GHOST_CLASS, 'h-11 w-11 text-muted-foreground md:h-6 md:w-6 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11')}>
          <X className="h-3 w-3" aria-hidden="true" />
        </Button>
      </div>}>
      {interviews.map(interview => {
        const { event } = interview;
        const links = calendarDemoLinks(event.id);
        const person = event.meta?.candidateName ?? event.title;
        return <li key={event.id} aria-label={`Entretien fictif avec ${person}`}
          className="group/sidebar-row flex min-w-0 items-center gap-0.5">
          <Button type="button" variant="ghost" onClick={() => openPreview(interview, 'scorecard')}
            title={`${person} · ${event.meta?.jobTitle} · ${CALENDAR_DEMO_SERVICE_LABELS[interview.calendar]}`}
            className={cn(SIDEBAR_GHOST_CLASS, 'h-11 min-w-0 flex-1 justify-start gap-2 rounded-md px-2 text-left font-normal md:h-8 [@media(pointer:coarse)]:h-11')}>
            <span role="img" aria-label={CALENDAR_DEMO_SERVICE_LABELS[interview.calendar]} title={CALENDAR_DEMO_SERVICE_LABELS[interview.calendar]} className="shrink-0">
              <CalendarServiceLogo service={interview.calendar} decorative className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-foreground-secondary">{person}</span>
            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">{formatUpcomingTime(event.startAt, now)}</span>
          </Button>
          <UpcomingInterviewMenu person={person} links={links} joinUrl={null} meetingService={interview.meeting}
            onJoin={() => openPreview(interview, 'meeting')}
            onOpen={to => openPreview(interview, to === links.coaching ? 'assistant' : 'scorecard')} />
        </li>;
      })}
    </SidebarSection>
  </div>;
}
