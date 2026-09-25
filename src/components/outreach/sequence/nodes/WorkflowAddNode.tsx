import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type AddNodeData = {
  onClick: () => void;
  variant?: 'true' | 'false';
};

const LABELS = {
  true: 'Ajouter une étape à la branche Connecté',
  false: 'Ajouter une étape à la branche Non connecté',
  none: 'Ajouter une étape',
} as const;

/** Bouton « + » du déroulé : neutre, nommé, sans agrandissement au survol. */
export const WorkflowAddNode = memo(({ data }: NodeProps) => {
  const { onClick, variant } = data as unknown as AddNodeData;
  const label = LABELS[variant ?? 'none'];

  return (
    <>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-transparent !bg-transparent" />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            aria-label={label}
            className="rounded-full border-dashed border-border-strong bg-background text-muted-foreground hover:text-foreground"
          >
            <Plus aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </>
  );
});

WorkflowAddNode.displayName = 'WorkflowAddNode';
