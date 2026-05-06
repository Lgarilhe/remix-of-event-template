/**
 * BulkActionsBar — barre d'actions groupées sticky en bas de l'écran quand
 * l'user a sélectionné ≥ 1 candidat via checkbox sur les cards kanban.
 *
 * Actions :
 * - Déplacer vers un stage (dropdown)
 * - Tout désélectionner
 *
 * Pattern Pipedrive/Linear : la barre slide-in depuis le bas, always visible
 * pendant le scroll, forte contrast pour ne pas se perdre.
 */

import React, { useState } from 'react';
import { ATS_STAGES } from '@/hooks/useATSData';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { X, ArrowRight, Loader2, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export interface BulkActionsBarProps {
  selectedIds: Set<string>;
  onClearSelection: () => void;
  /** Appelé pour chaque candidat. Doit retourner la promesse pour suivre le loading. */
  onBulkStageChange: (candidateIds: string[], newStage: string) => Promise<void>;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedIds,
  onClearSelection,
  onBulkStageChange,
}) => {
  const [loading, setLoading] = useState(false);
  const count = selectedIds.size;

  if (count === 0) return null;

  const handleBulkMove = async (newStage: string) => {
    setLoading(true);
    try {
      await onBulkStageChange(Array.from(selectedIds), newStage);
      toast.success(`${count} candidat${count > 1 ? 's' : ''} déplacé${count > 1 ? 's' : ''} vers "${newStage}"`);
      onClearSelection();
    } catch (err) {
      toast.error('Erreur lors du déplacement groupé');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={cn(
        'fixed bottom-4 left-1/2 -translate-x-1/2 z-[200]',
        'inline-flex items-center gap-2 px-3 py-2 rounded-full',
        'bg-foreground text-background shadow-xl',
        'animate-in fade-in-0 slide-in-from-bottom-4 duration-200',
      )}
      role="toolbar"
      aria-label={`${count} candidat${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`}
    >
      <div className="flex items-center gap-2 px-2">
        <CheckCheck className="w-4 h-4" aria-hidden="true" />
        <span className="text-[12px] font-bold tabular-nums">
          {count} sélectionné{count > 1 ? 's' : ''}
        </span>
      </div>

      <div className="w-px h-5 bg-background/30" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={loading}>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-background hover:bg-background/10 hover:text-background focus-visible:outline-background"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span className="text-xs font-medium">Déplacer vers…</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top">
          <DropdownMenuLabel className="text-xs">Choisir une étape</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {ATS_STAGES.map((stage) => (
            <DropdownMenuItem
              key={stage.key}
              onSelect={() => handleBulkMove(stage.key)}
              className="text-sm"
            >
              {stage.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon"
        onClick={onClearSelection}
        disabled={loading}
        aria-label="Tout désélectionner"
        className="h-8 w-8 text-background hover:bg-background/10 hover:text-background focus-visible:outline-background"
      >
        <X className="w-3.5 h-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
};
