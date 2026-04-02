import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type BranchLabelData = {
  label: string;
  variant: 'true' | 'false';
};

export const WorkflowBranchLabelNode = memo(({ data }: NodeProps) => {
  const { label, variant } = data as unknown as BranchLabelData;
  const isTrue = variant === 'true';

  return (
    <>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-transparent !border-transparent" />
      <div className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border-2 shadow-sm",
        isTrue
          ? "text-white bg-emerald-500 border-emerald-400"
          : "text-white bg-orange-500 border-orange-400"
      )}>
        {isTrue ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
        {label}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-transparent !border-transparent" />
    </>
  );
});

WorkflowBranchLabelNode.displayName = 'WorkflowBranchLabelNode';
