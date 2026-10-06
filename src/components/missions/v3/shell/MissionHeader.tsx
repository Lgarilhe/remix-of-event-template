// Refonte mission, lot 1 : en-tête de 48 px, sur une ligne (conception, 4.2).
// À gauche « Missions » > logo et nom de la mission (menu des autres missions),
// puis le client en discret ; au centre les trois onglets (sur ordinateur, à
// partir de lg ; en dessous ils forment une bande à part, MissionTabs) ; à
// droite le statut (menu, sans cadre ni couleur : le mot et un chevron) et le
// menu « ... », qui porte aussi « Revenir à l'ancienne page ». Gauche et droite
// partagent la place (flex-1 basis-0) pour centrer les onglets ; le statut est à
// droite pour que le nom garde la sienne (design simplifié, 04/10/2026). Le
// client n'est écrit que si ce qui reste après le nom lui laisse au moins 6 rem
// (requête de conteneur) : jamais un fragment de mot. Pas de bouton Assistant :
// Ctrl K reste.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMissionV3 } from '../MissionV3Context';
import { ArchiveMissionDialog } from './ArchiveMissionDialog';
import { MissionMoreMenu } from './MissionMoreMenu';
import { MissionSwitcher } from './MissionSwitcher';
import { MissionTabsNav } from './MissionTabs';
import { missionClientName } from './missionClient';
import {
  MISSION_STATUS_LABEL,
  MISSION_STATUS_ORDER,
  missionStatusLabel,
  useMissionStatusControl,
} from './missionStatus';

function MissionStatusMenu() {
  const { project, canEditBrief } = useMissionV3();
  const control = useMissionStatusControl();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const enabled = canEditBrief && !control.saving;

  // Sans cadre, fond ni couleur : le mot, en texte discret (la couleur est réservée à ce qui attend quelqu'un).
  const baseClass =
    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground outline-none ' +
    'transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11';

  if (!canEditBrief) {
    const label = (
      <span
        className={cn(baseClass, 'cursor-default')}
        tabIndex={control.blockedReason ? 0 : undefined}
        aria-label={control.blockedReason ? `Statut : ${missionStatusLabel(project.status)}. ${control.blockedReason}` : undefined}
      >
        <span className="truncate">{missionStatusLabel(project.status)}</span>
      </span>
    );
    if (!control.blockedReason) return label;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{label}</TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">
          {control.blockedReason}
        </TooltipContent>
      </Tooltip>
    );
  }

  const onValueChange = (value: string) => {
    if (value === project.status) return;
    if (value === 'archived') {
      setArchiveOpen(true);
      return;
    }
    if (value === 'active' || value === 'paused' || value === 'completed') void control.changeStatus(value);
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          ref={triggerRef}
          disabled={!enabled}
          aria-busy={control.saving}
          aria-label={`Statut : ${missionStatusLabel(project.status)}, changer le statut`}
          className={cn(baseClass, 'hover:bg-accent hover:text-foreground disabled:opacity-60')}
        >
          <span className="truncate">{missionStatusLabel(project.status)}</span>
          <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuRadioGroup value={project.status} onValueChange={onValueChange}>
            {MISSION_STATUS_ORDER.map((status) => (
              <DropdownMenuRadioItem key={status} value={status} className="max-sm:min-h-11">
                {MISSION_STATUS_LABEL[status]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ArchiveMissionDialog
        projectId={project.id}
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        returnFocusRef={triggerRef}
      />
    </>
  );
}

export function MissionHeader() {
  const { project } = useMissionV3();
  const client = missionClientName(project);

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border pl-3 pr-2 sm:pl-6 sm:pr-5">
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-1.5 text-sm">
        {/* Entre lg et xl (barre latérale ouverte), la place revient au nom : « Missions » reste dans le menu du nom et la barre. */}
        <Link
          to="/missions"
          className="hidden shrink-0 rounded-md py-1 text-muted-foreground outline-none transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex lg:hidden xl:inline-flex"
        >
          Missions
        </Link>
        <ChevronRight aria-hidden="true" className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block lg:hidden xl:block" />
        <h1 className="flex min-w-0 items-center">
          <MissionSwitcher />
        </h1>
        {client && (
          // Le client prend ce qui reste après le nom (base nulle, conteneur de taille en ligne) et ne s'écrit que
          // s'il y a 6 rem : sinon il s'efface d'un bloc, avant que le nom ne soit coupé, au lieu de laisser un fragment.
          <div className="hidden min-w-0 flex-1 basis-0 [container-type:inline-size] sm:block">
            <span className="hidden truncate text-muted-foreground [@container(min-width:6rem)]:block">{client}</span>
          </div>
        )}
      </div>
      <MissionTabsNav className="-mb-px hidden self-stretch lg:flex" linkClassName="h-full" />
      <div className="flex shrink-0 items-center justify-end gap-1 lg:flex-1 lg:basis-0">
        <MissionStatusMenu />
        <MissionMoreMenu />
      </div>
    </header>
  );
}
