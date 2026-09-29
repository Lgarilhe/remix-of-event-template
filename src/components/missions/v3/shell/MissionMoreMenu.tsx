// Refonte mission, lot 1 : menu « ... » de l'en-tête (conception, 3.2 et 4.2).
// Archiver (avec confirmation) ou réactiver, et revenir à l'ancienne page.
// Pas de « Dupliquer » (aucune fonction de duplication n'existe) ni de
// « Confier à des cabinets » (une seule porte, dans Cadrage).
import { useState } from 'react';
import { ArchiveRestore, Archive, MoreHorizontal, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMissionV3 } from '../MissionV3Context';
import { ArchiveMissionDialog } from './ArchiveMissionDialog';
import { useMissionStatusControl } from './missionStatus';

export function MissionMoreMenu() {
  const { project, isArchived, leaveBeta } = useMissionV3();
  const status = useMissionStatusControl();
  const [archiveOpen, setArchiveOpen] = useState(false);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Plus d'actions"
            className="min-h-11 min-w-11 shrink-0 lg:min-h-0 lg:min-w-0"
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {status.canManage && isArchived && (
            <DropdownMenuItem disabled={status.saving} onSelect={() => void status.changeStatus('active')}>
              <ArchiveRestore aria-hidden="true" className="mr-2 h-4 w-4" />
              Réactiver la mission
            </DropdownMenuItem>
          )}
          {status.canManage && !isArchived && (
            <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
              <Archive aria-hidden="true" className="mr-2 h-4 w-4" />
              Archiver la mission
            </DropdownMenuItem>
          )}
          {status.canManage && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={leaveBeta}>
            <Undo2 aria-hidden="true" className="mr-2 h-4 w-4" />
            Revenir à l'ancienne page
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ArchiveMissionDialog projectId={project.id} open={archiveOpen} onOpenChange={setArchiveOpen} />
    </>
  );
}
