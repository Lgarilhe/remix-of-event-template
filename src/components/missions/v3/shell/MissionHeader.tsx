// Refonte mission, lot 1 : en-tête de 48 px, sur une ligne (conception, 4.2).
// « Missions » > nom de la mission (menu des autres missions) · client, statut
// en menu, menu « ... ». Pas de bouton Assistant : Ctrl K reste.
import { useState } from 'react';
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
import {
  MISSION_STATUS_DOT,
  MISSION_STATUS_LABEL,
  MISSION_STATUS_ORDER,
  missionStatusLabel,
  useMissionStatusControl,
  type MissionStatus,
} from './missionStatus';

function StatusLabel({ status }: { status: string }) {
  const dot = MISSION_STATUS_DOT[status as MissionStatus] ?? 'bg-muted-foreground';
  return (
    <>
      <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />
      <span className="truncate">{missionStatusLabel(status)}</span>
    </>
  );
}

function MissionStatusMenu() {
  const { project, canEditBrief } = useMissionV3();
  const control = useMissionStatusControl();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const enabled = canEditBrief && !control.saving;

  const baseClass =
    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none ' +
    'transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring';

  if (!canEditBrief) {
    const label = (
      <span
        className={cn(baseClass, 'cursor-default')}
        tabIndex={control.blockedReason ? 0 : undefined}
        aria-label={control.blockedReason ? `Statut : ${missionStatusLabel(project.status)}. ${control.blockedReason}` : undefined}
      >
        <StatusLabel status={project.status} />
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
          disabled={!enabled}
          aria-busy={control.saving}
          aria-label={`Statut : ${missionStatusLabel(project.status)}, changer le statut`}
          className={cn(baseClass, 'hover:bg-accent hover:text-foreground disabled:opacity-60')}
        >
          <StatusLabel status={project.status} />
          <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuRadioGroup value={project.status} onValueChange={onValueChange}>
            {MISSION_STATUS_ORDER.map((status) => (
              <DropdownMenuRadioItem key={status} value={status} className="gap-2">
                <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', MISSION_STATUS_DOT[status])} />
                {MISSION_STATUS_LABEL[status]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ArchiveMissionDialog projectId={project.id} open={archiveOpen} onOpenChange={setArchiveOpen} />
    </>
  );
}

export function MissionHeader() {
  const { project } = useMissionV3();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
        <Link
          to="/missions"
          className="hidden shrink-0 rounded-md px-1.5 py-1 font-medium text-muted-foreground outline-none transition-colors duration-150 ease-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
        >
          Missions
        </Link>
        <ChevronRight aria-hidden="true" className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block" />
        <h1 className="flex min-w-0 items-center">
          <MissionSwitcher />
        </h1>
        {project.client_name && (
          <span className="hidden min-w-0 items-center gap-1 text-sm text-muted-foreground sm:inline-flex">
            <span aria-hidden="true">·</span>
            <span className="truncate">{project.client_name}</span>
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <MissionStatusMenu />
        <MissionMoreMenu />
      </div>
    </header>
  );
}
