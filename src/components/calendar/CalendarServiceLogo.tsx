import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { cn } from '@/lib/utils';
import googleCalendarLogo from '@/assets/google-calendar-logo.svg';
import teamsLogo from '@/assets/microsoft-teams-logo.svg';

export type CalendarService = 'outlook' | 'google_calendar' | 'teams' | 'google_meet';

/** Marques d'agenda et de visio ; fichiers locaux, sans chargement distant. */
export function CalendarServiceLogo({ service, className, decorative = false }: {
  service: CalendarService;
  className?: string;
  decorative?: boolean;
}) {
  if (service === 'outlook' || service === 'google_meet') {
    return <ServiceLogo service={service} decorative={decorative} className={className} />;
  }
  return <img src={service === 'teams' ? teamsLogo : googleCalendarLogo}
    alt={decorative ? '' : service === 'teams' ? 'Microsoft Teams' : 'Google Agenda'}
    className={cn('h-4 w-4 shrink-0 object-contain', className)} />;
}
