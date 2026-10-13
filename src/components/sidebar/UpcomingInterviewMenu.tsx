import { useRef } from 'react';
import { ClipboardList, Ellipsis, Mic, Video } from 'lucide-react';
import { CalendarServiceLogo } from '@/components/calendar/CalendarServiceLogo';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { InterviewLinks } from '@/lib/sidebarSignals';
import { SIDEBAR_GHOST_CLASS } from './sidebarButtonClass';
import { cn } from '@/lib/utils';

interface UpcomingInterviewMenuProps {
  person: string;
  links: InterviewLinks;
  joinUrl: string | null;
  meetingService?: 'teams' | 'google_meet';
  onOpen: (to: string) => void;
  onJoin?: () => void;
}

/** Les actions restent à portée de clavier et de toucher sans occuper une seconde ligne. */
export function UpcomingInterviewMenu({ person, links, joinUrl, meetingService, onOpen, onJoin }: UpcomingInterviewMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedRef = useRef(false);
  const meetingLabel = meetingService === 'teams' ? 'Microsoft Teams' : meetingService === 'google_meet' ? 'Google Meet' : undefined;
  const choose = (action: () => void) => {
    selectedRef.current = true;
    // L'aperçu mémorise ce bouton stable, plutôt que l'option qui va disparaître.
    triggerRef.current?.focus();
    action();
  };
  const itemClass = 'min-h-11 gap-2 md:min-h-8 [@media(pointer:coarse)]:min-h-11';

  return <DropdownMenu modal={false} onOpenChange={open => { if (open) selectedRef.current = false; }}>
    <DropdownMenuTrigger asChild>
      <Button ref={triggerRef} type="button" variant="ghost" size="icon-xs" aria-label={`Actions pour ${person}`}
        className={cn(SIDEBAR_GHOST_CLASS, 'h-11 w-11 shrink-0 rounded-md text-muted-foreground md:h-7 md:w-7 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 md:[@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover/sidebar-row:opacity-100 group-focus-within/sidebar-row:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100')}>
        <Ellipsis className="h-4 w-4" aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={event => {
      if (selectedRef.current) event.preventDefault();
    }}>
      {(joinUrl || onJoin) && <DropdownMenuItem className={itemClass} aria-label="Rejoindre la visio" title={meetingLabel} onSelect={() => choose(() => {
        if (onJoin) onJoin();
        else if (joinUrl) window.open(joinUrl, '_blank', 'noopener,noreferrer');
      })}>
        {meetingService ? <span role="img" aria-label={meetingLabel}><CalendarServiceLogo service={meetingService} decorative /></span> : <Video className="h-4 w-4" aria-hidden="true" />}
        Rejoindre la visio
      </DropdownMenuItem>}
      {links.scorecard && <DropdownMenuItem className={itemClass} onSelect={() => choose(() => onOpen(links.scorecard!))}>
        <ClipboardList className="h-4 w-4" aria-hidden="true" />Grille d'entretien
      </DropdownMenuItem>}
      {links.coaching && <DropdownMenuItem className={itemClass} onSelect={() => choose(() => onOpen(links.coaching!))}>
        <Mic className="h-4 w-4" aria-hidden="true" />Assistant d'entretien
      </DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
