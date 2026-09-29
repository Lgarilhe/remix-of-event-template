// Refonte mission, lot 2 : barre d'actions groupées (conception 4.2), visible
// dès qu'une ligne est cochée (liste et À trier partagent la sélection) :
// Retenir, Écarter (avec confirmation), Déplacer vers, Contacter, Tout
// désélectionner. Écritures par useMissionStageActions, sur le groupe entier
// de chaque candidat.

import { useState } from 'react';
import { ArrowRightLeft, Check, ChevronDown, UserX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { plural } from '@/lib/plural';
import {
  moveOptions,
  type MissionCandidateRow,
  type MissionStageActions,
  type MissionStepRef,
  type StageMoveSummary,
} from '../types';
import { ContactSelectionButton } from './ContactSelectionButton';
import { RejectConfirmDialog } from './RejectConfirmDialog';

interface BulkActionBarProps {
  rows: readonly MissionCandidateRow[];
  steps: readonly MissionStepRef[];
  project: SourcingProject;
  canMove: boolean;
  moveDisabledReason: string | null;
  actions: MissionStageActions;
  /** Après un geste : sélection vidée si quelque chose a changé. */
  onMoved: (summary: StageMoveSummary) => void;
  onContacted: () => void;
  onClear: () => void;
}

export function selectionText(count: number): string {
  return `${plural(count, 'candidat sélectionné', 'candidats sélectionnés')}`;
}

export function BulkActionBar({
  rows,
  steps,
  project,
  canMove,
  moveDisabledReason,
  actions,
  onMoved,
  onContacted,
  onClear,
}: BulkActionBarProps) {
  const [confirmReject, setConfirmReject] = useState(false);
  const count = rows.length;
  if (count === 0) return null;

  const busy = actions.isMoving;
  const disabled = !canMove || busy;
  const run = async (request: Parameters<MissionStageActions['move']>[0]) => {
    const summary = await actions.move(request);
    onMoved(summary);
  };

  return (
    <div
      role="toolbar"
      aria-label="Actions sur la sélection"
      className="sticky bottom-0 z-20 -mx-3 border-t border-border bg-background/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in-0 motion-safe:duration-200"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-medium text-foreground" aria-live="polite">
          {selectionText(count)}
        </span>
        <Button
          variant="primary"
          size="sm"
          disabled={disabled}
          onClick={() => void run({ rows, target: { stage: 'retained' }, fromStages: ['to_sort', 'rejected'], verb: 'retenu' })}
        >
          <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Retenir
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => setConfirmReject(true)}>
          <UserX className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Écarter
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={disabled}>
              <ArrowRightLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Déplacer vers
              <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
            {moveOptions(steps).map((option) => (
              <DropdownMenuItem
                key={option.key}
                onSelect={() => {
                  if (option.target.stage === 'rejected') setConfirmReject(true);
                  else void run({ rows, target: option.target, verb: 'déplacé' });
                }}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ContactSelectionButton rows={rows} project={project} disabled={disabled} onSuccess={onContacted} />
        <Button variant="ghost" size="sm" onClick={onClear} className="ml-auto">
          <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Tout désélectionner
        </Button>
      </div>
      {!canMove && moveDisabledReason && <p className="mt-1.5 text-xs text-muted-foreground">{moveDisabledReason}</p>}
      <RejectConfirmDialog
        open={confirmReject}
        count={count}
        onOpenChange={setConfirmReject}
        onConfirm={() => {
          setConfirmReject(false);
          void run({ rows, target: { stage: 'rejected' }, verb: 'écarté' });
        }}
      />
    </div>
  );
}
