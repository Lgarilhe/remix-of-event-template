import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type AddNodeData = {
  onClick: () => void;
  variant?: 'true' | 'false';
};

/**
 * Bouton « + » du parcours : neutre, sans agrandissement au survol. Son nom
 * précise la branche pour qui ne voit pas le canevas.
 */
export const WorkflowAddNode = memo(({ data }: NodeProps) => {
  const { onClick, variant } = data as unknown as AddNodeData;

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
            aria-label={variant === 'true'
              ? 'Ajouter une étape à la branche Connecté'
              : variant === 'false'
                ? 'Ajouter une étape à la branche Non connecté'
                : 'Ajouter une étape'}
            className="rounded-full border-dashed border-border-strong bg-background dark:border-border-strong"
          >
            <Plus aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Ajouter une étape</TooltipContent>
      </Tooltip>
    </>
  );
});

WorkflowAddNode.displayName = 'WorkflowAddNode';
