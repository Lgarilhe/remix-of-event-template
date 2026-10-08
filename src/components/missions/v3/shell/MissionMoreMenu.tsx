// Refonte mission, lot 1 : menu « ... » de l'en-tête (conception, 3.2 et 4.2).
// Archiver (avec confirmation) ou réactiver, et revenir à l'ancienne page.
// Pas de « Dupliquer » (aucune fonction de duplication n'existe) ni de
// « Confier à des cabinets » (une seule porte, dans Cadrage).
import { useRef, useState } from 'react';
import { ArchiveRestore, Archive, Brain, MoreHorizontal, Undo2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
import { AgentMemoryDialog } from '@/components/agent/AgentMemoryDialog';
import { AgentOrb } from '@/components/agent/AgentOrb';

export function MissionMoreMenu() {
  const { project, isOwnMission, isArchived, leaveBeta } = useMissionV3();
  const status = useMissionStatusControl();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const navigate = useNavigate();
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
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
          {isOwnMission && <DropdownMenuItem onSelect={() => navigate(`/agents/sourcing/${project.id}`)} className="max-sm:min-h-11">
            <AgentOrb size="sm" className="mr-2" />
            Agent de sourcing
          </DropdownMenuItem>}
          {isOwnMission && <DropdownMenuItem onSelect={() => setMemoryOpen(true)} className="max-sm:min-h-11">
            <Brain aria-hidden="true" className="mr-2 h-4 w-4" />
            Mémoire de la mission
          </DropdownMenuItem>}
          {status.canManage && isArchived && (
            <DropdownMenuItem
              disabled={status.saving}
              onSelect={() => void status.changeStatus('active')}
              className="max-sm:min-h-11"
            >
              <ArchiveRestore aria-hidden="true" className="mr-2 h-4 w-4" />
              Réactiver la mission
            </DropdownMenuItem>
          )}
          {status.canManage && !isArchived && (
            <DropdownMenuItem onSelect={() => setArchiveOpen(true)} className="max-sm:min-h-11">
              <Archive aria-hidden="true" className="mr-2 h-4 w-4" />
              Archiver la mission
            </DropdownMenuItem>
          )}
          {status.canManage && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={leaveBeta} className="max-sm:min-h-11">
            <Undo2 aria-hidden="true" className="mr-2 h-4 w-4" />
            Revenir à l'ancienne page
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {isOwnMission && <AgentMemoryDialog open={memoryOpen} onOpenChange={setMemoryOpen} projectId={project.id} projectTitle={project.name} />}
      <ArchiveMissionDialog
        projectId={project.id}
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
