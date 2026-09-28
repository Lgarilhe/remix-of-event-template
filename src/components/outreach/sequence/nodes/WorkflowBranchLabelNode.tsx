import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Check, X } from 'lucide-react';

type BranchLabelData = {
  label: string;
  variant: 'true' | 'false';
};

/** Étiquette d'une branche : un mot et une icône, en neutre (revue design D-35). */
export const WorkflowBranchLabelNode = memo(({ data }: NodeProps) => {
  const { label, variant } = data as unknown as BranchLabelData;
  const isTrue = variant === 'true';

  return (
    <>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-transparent !bg-transparent" />
      <div className="flex items-center gap-1.5 rounded-full border border-border-strong bg-card px-3 py-1 text-2xs font-semibold text-foreground">
        {isTrue ? <Check className="h-3 w-3" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
        {label}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-transparent !bg-transparent" />
    </>
  );
});

WorkflowBranchLabelNode.displayName = 'WorkflowBranchLabelNode';
