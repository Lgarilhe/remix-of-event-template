import { format, parseISO, startOfDay } from 'date-fns';
import { PanelLeft } from 'lucide-react';
import { CalendarListView } from '@/components/calendar/CalendarListView';
import { CalendarServiceLogo } from '@/components/calendar/CalendarServiceLogo';
import { useCalendarDemo } from '@/components/calendar/CalendarDemoProvider';
import { InterviewActionButtons } from '@/components/sidebar/InterviewActionButtons';
import { PageHeader, PageLayout } from '@/components/layout';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CALENDAR_DEMO_SERVICE_LABELS, calendarDemoLinks, type CalendarDemoService } from '@/lib/calendarDemo';

function ServiceLabel({ service }: { service: CalendarDemoService }) {
  return <span className="inline-flex items-center gap-1.5 text-xs text-foreground-secondary">
    <CalendarServiceLogo service={service} decorative />{CALENDAR_DEMO_SERVICE_LABELS[service]}
  </span>;
}

/** Les mêmes exemples et brouillons restent accessibles depuis la barre latérale. */
export default function CalendarDemo() {
  const { interviews, startDemo, stopDemo, openPreview } = useCalendarDemo();
  const days = [...new Map(interviews.map(({ event }) => {
    const day = startOfDay(parseISO(event.startAt));
    return [day.toISOString(), day];
  })).values()];

  return <PageLayout maxWidth="md">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted p-3 text-sm" data-component="calendar-demo-banner">
      <p><strong className="font-semibold">Données fictives</strong><span className="text-muted-foreground"> · Aperçu des entretiens</span></p>
      <Button variant="outline" size="sm" className="min-h-11" onClick={stopDemo}>Quitter la démo</Button>
    </div>
    <PageHeader title="Entretiens" subtitle="Explorez deux rendez-vous fictifs : la visio, la grille et l’assistant d’entretien." />
    <Button variant="outline" className="mb-4 min-h-11" onClick={startDemo}><PanelLeft aria-hidden="true" />Voir dans la barre latérale</Button>
    <p className="mb-5 text-sm text-muted-foreground">Les exemples Outlook et Google Agenda illustrent les connexions à venir. Aucun agenda n’est connecté par cette démonstration.</p>
    <CalendarListView days={days} events={interviews.map(interview => interview.event)} renderEvent={event => {
      const interview = interviews.find(item => item.event.id === event.id)!;
      const links = calendarDemoLinks(event.id);
      return <article className="space-y-4 rounded-lg border border-border bg-background p-4" aria-label={event.title}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold tabular-nums">{format(parseISO(event.startAt), 'HH:mm')}–{format(parseISO(event.endAt!), 'HH:mm')}</p>
          <Badge variant="muted">Exemple</Badge>
        </div>
        <div className="flex items-start gap-3">
          <Avatar className="h-11 w-11 shrink-0"><AvatarFallback>{interview.initials}</AvatarFallback></Avatar>
          <div className="min-w-0">
            <h2 className="text-md font-semibold text-foreground">{event.meta?.candidateName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{event.subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><ServiceLabel service={interview.calendar} /><ServiceLabel service={interview.meeting} /></div>
        <div className="border-t border-border pt-3">
          <InterviewActionButtons links={links} joinUrl={null} onJoin={() => openPreview(interview, 'meeting')}
            showContextLinks={false} onOpen={to => openPreview(interview, to === links.coaching ? 'assistant' : 'scorecard')} />
        </div>
      </article>;
    }} />
    <p className="mt-4 text-xs text-muted-foreground">Vos essais restent dans cet aperçu et s’effacent en quittant la démonstration. Aucun message ni invitation n’est envoyé.</p>

  </PageLayout>;
}
