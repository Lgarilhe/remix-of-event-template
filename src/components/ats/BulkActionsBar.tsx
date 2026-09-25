/**
 * BulkActionsBar — barre d'actions groupées, en bas de l'écran, dès qu'au
 * moins un candidat est coché dans les colonnes.
 *
 * Actions :
 * - Déplacer vers une étape (menu)
 * - Tout désélectionner
 *
 * Un déplacement groupé donne un seul toast, avec le nombre exact de
 * candidats déplacés, les échecs comptés et « Annuler » (revue design E-23).
 */

import React, { useState } from 'react';
import { ATS_STAGES } from '@/hooks/useATSData';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { X, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { plural } from '@/lib/plural';

/** Bilan d'un déplacement groupé. */
export interface BulkMoveResult {
  moved: number;
  failed: number;
  /** Remet les candidats déplacés à leur étape précédente. */
  undo?: () => void | Promise<void>;
}

export interface BulkActionsBarProps {
  selectedIds: Set<string>;
  onClearSelection: () => void;
  /** Déplace le lot ; la page garde cochés les candidats non déplacés. */
  onBulkStageChange: (candidateIds: string[], newStage: string) => Promise<BulkMoveResult>;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedIds,
  onClearSelection,
  onBulkStageChange,
}) => {
  const [loading, setLoading] = useState(false);
  const count = selectedIds.size;

  if (count === 0) return null;

  const handleBulkMove = async (stage: { key: string; label: string }) => {
    setLoading(true);
    try {
      const { moved, failed, undo } = await onBulkStageChange(Array.from(selectedIds), stage.key);
      const target = `«\u00a0${stage.label}\u00a0»`;
      const undoAction = undo ? { action: { label: 'Annuler', onClick: () => void undo() } } : undefined;
      if (failed === 0) {
        toast.success(`${plural(moved, 'candidat déplacé', 'candidats déplacés')} vers ${target}`, undoAction);
      } else if (moved === 0) {
        toast.error(`Aucun candidat déplacé vers ${target}\u00a0: l'enregistrement a échoué. Réessayez.`);
      } else {
        toast.warning(
          `${plural(moved, 'candidat déplacé', 'candidats déplacés')} vers ${target}, ${plural(failed, 'échec')}. Les candidats non déplacés restent cochés\u00a0: réessayez.`,
          undoAction,
        );
      }
    } catch {
      toast.error('Le déplacement groupé a échoué. Réessayez.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={cn(
        'fixed bottom-4 left-1/2 z-sticky -translate-x-1/2',
        'inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border border-border bg-popover py-1.5 pl-4 pr-1.5 text-popover-foreground shadow-lg',
        'animate-in fade-in-0 slide-in-from-bottom-4 duration-200',
      )}
      role="toolbar"
      aria-label={`Actions sur ${plural(count, 'candidat sélectionné', 'candidats sélectionnés')}`}
    >
      <span className="whitespace-nowrap text-sm font-medium tabular-nums" aria-live="polite">
        {plural(count, 'candidat sélectionné', 'candidats sélectionnés')}
      </span>

      <div className="h-5 w-px bg-border" aria-hidden="true" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={loading}>
          <Button type="button" variant="outline" size="sm" loading={loading} className="max-md:h-11">
            {!loading && <ArrowRightLeft aria-hidden="true" />}
            Déplacer vers…
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top" className="w-52">
          <DropdownMenuLabel>Choisir une étape</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {ATS_STAGES.map((stage) => (
            <DropdownMenuItem key={stage.key} onSelect={() => handleBulkMove(stage)}>
              {stage.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClearSelection}
            disabled={loading}
            aria-label="Tout désélectionner"
            className="max-md:h-11 max-md:w-11"
          >
            <X aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Tout désélectionner</TooltipContent>
      </Tooltip>
    </div>
  );
};
