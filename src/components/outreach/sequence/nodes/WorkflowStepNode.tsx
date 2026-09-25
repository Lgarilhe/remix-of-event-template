import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Trash2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { sequenceActionLabel, formatStepDelay } from '@/lib/sequenceCatalog';
import { SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import { SequenceStep } from '../../SequenceBuilder';
import { getStepMessageType } from '../messageTypeUtils';

type StepNodeData = {
  step: SequenceStep;
  index: number;
  allSteps: SequenceStep[];
  isSelected: boolean;
  canRemove: boolean;
  onRemove: () => void;
  compact?: boolean;
};

/**
 * Étape du déroulé : neutre, reconnue à son icône et à son libellé du
 * catalogue. La sélection se voit à l'anneau d'accent, sans agrandissement ni
 * ombre colorée (revue design D-35, D-42).
 */
export const WorkflowStepNode = memo(({ data }: NodeProps) => {
  const { step, index, allSteps, isSelected, canRemove, onRemove, compact } = data as unknown as StepNodeData;
  const msgType = getStepMessageType(step, allSteps);
  const label = sequenceActionLabel(step.actionType);
  const delayLabel = formatStepDelay(step.delayDays, step.delayHours, step.delayMinutes);

  return (
    <>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-transparent !bg-transparent" />

      <div
        className={cn(
          'group relative cursor-pointer rounded-xl border bg-card transition-colors duration-150',
          isSelected
            ? 'border-border-strong ring-2 ring-brand ring-offset-2 ring-offset-background'
            : 'border-border hover:border-border-strong',
          compact ? 'min-w-[150px] px-3 py-2.5' : 'min-w-[200px] max-w-[220px] px-4 py-3',
        )}
      >
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'grid shrink-0 place-items-center rounded-lg bg-muted text-foreground-secondary',
              compact ? 'h-7 w-7' : 'h-9 w-9',
            )}
          >
            <SequenceActionIcon type={step.actionType} className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          </span>

          <div className="min-w-0 flex-1">
            {!compact && (
              <div className="mb-0.5 text-3xs font-medium leading-none text-muted-foreground">
                Étape {index + 1}
              </div>
            )}
            <div className="truncate text-xs font-semibold leading-tight text-foreground">{label}</div>
            {!compact && msgType && (
              <div className="mt-1 w-fit rounded-full bg-muted px-1.5 py-0.5 text-3xs font-medium text-muted-foreground">
                {msgType.shortLabel}
              </div>
            )}
            {delayLabel && (
              <div className="mt-0.5 flex items-center gap-1 text-3xs text-muted-foreground">
                <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                Après {delayLabel}
              </div>
            )}
          </div>
        </div>

        {canRemove && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-xs"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                aria-label={`Supprimer l'étape ${index + 1} : ${label}`}
                className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-popover text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Supprimer l'étape</TooltipContent>
          </Tooltip>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-transparent !bg-transparent" />
    </>
  );
});

WorkflowStepNode.displayName = 'WorkflowStepNode';
