// Refonte mission, lot 2 : barre d'actions groupées (conception 4.2), flottante
// en bas à gauche, visible dès qu'une ligne est cochée (liste et À trier
// partagent la sélection) : Contacter, Étape suivante (candidats à la même
// étape), Écarter (avec confirmation), Retenir (sélection avec un À trier ou un
// écarté), Déplacer vers, Tout désélectionner. Pas de « Présenter au client »
// (lot 8). Écritures par useMissionStageActions, sur le groupe entier de
// chaque candidat.

import { useState } from 'react';
import { ArrowRight, ArrowRightLeft, Check, ChevronDown, UserX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { plural } from '@/lib/plural';
import type { GeneralStage } from '@/lib/candidateStage';
import {
  moveOptions,
  nextStageOption,
  type MissionCandidateRow,
  type MoveOption,
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

/** Étape suivante commune à toute la sélection ; null si les candidats n'ont pas la même. */
export function commonNextStage(rows: readonly MissionCandidateRow[], steps: readonly MissionStepRef[]): MoveOption | null {
  if (rows.length === 0) return null;
  const first = nextStageOption(rows[0], steps);
  if (!first) return null;
  return rows.every((row) => nextStageOption(row, steps)?.key === first.key) ? first : null;
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
  const next = commonNextStage(rows, steps);
  const canRetain = rows.some((row) => row.stage === 'to_sort' || row.stage === 'rejected');

  const busy = actions.isMoving;
  const disabled = !canMove || busy;
  const run = async (request: Parameters<MissionStageActions['move']>[0]) => {
    const summary = await actions.move(request);
    onMoved(summary);
  };

  return (
    <div
      role="toolbar"
      data-bulk-bar=""
      aria-label="Actions sur la sélection"
      className="sticky bottom-6 z-20 flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-xl border border-border-strong bg-popover py-2 pl-3.5 pr-2 text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-safe:fade-in-0 motion-safe:duration-200"
    >
      {/* Annoncé par la zone permanente de PipelineScreen. */}
      <span className="mr-1.5 text-sm font-semibold text-foreground">{selectionText(count)}</span>
      <ContactSelectionButton rows={rows} project={project} disabled={disabled} onSuccess={onContacted} />
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || !next}
        title={next ? `Passer à ${next.label}` : "Les candidats sélectionnés n'ont pas la même étape suivante."}
        onClick={() => {
          if (!next) return;
          const fromStages = [...new Set(rows.map((row) => row.stage))] as GeneralStage[];
          void run({ rows, target: next.target, fromStages, verb: next.target.stage === 'retained' ? 'retenu' : 'déplacé' });
        }}
      >
        <ArrowRight className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Étape suivante
      </Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => setConfirmReject(true)} className="text-danger hover:text-danger">
        <UserX className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Écarter
      </Button>
      {canRetain && (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => void run({ rows, target: { stage: 'retained' }, fromStages: ['to_sort', 'rejected'], verb: 'retenu' })}
        >
          <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Retenir
        </Button>
      )}
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
      <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Tout désélectionner" title="Tout désélectionner">
        <X aria-hidden="true" />
      </Button>
      {!canMove && moveDisabledReason && <p className="w-full text-xs text-muted-foreground">{moveDisabledReason}</p>}
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
