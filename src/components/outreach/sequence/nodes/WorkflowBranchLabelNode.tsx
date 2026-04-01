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
  const Icon = isTrue ? Check : X;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-transparent !border-transparent" />
      <div className={cn(
        "flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border shadow-sm",
        isTrue
          ? "text-emerald-700 bg-emerald-50 border-emerald-200/60 dark:text-emerald-400 dark:bg-emerald-950/60 dark:border-emerald-800/60"
          : "text-orange-700 bg-orange-50 border-orange-200/60 dark:text-orange-400 dark:bg-orange-950/60 dark:border-orange-800/60"
      )}>
        <Icon className="w-3 h-3" />
        {label}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-transparent !border-transparent" />
    </>
  );
});

WorkflowBranchLabelNode.displayName = 'WorkflowBranchLabelNode';
