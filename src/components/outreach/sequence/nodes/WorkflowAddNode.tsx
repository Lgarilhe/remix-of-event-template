import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

type AddNodeData = {
  onClick: () => void;
  variant?: 'true' | 'false';
};

export const WorkflowAddNode = memo(({ data }: NodeProps) => {
  const { onClick, variant } = data as unknown as AddNodeData;

  const variantStyles = variant === 'true'
    ? 'border-emerald-300 text-emerald-500 hover:bg-emerald-50 hover:border-emerald-400 dark:hover:bg-emerald-950/40'
    : variant === 'false'
    ? 'border-orange-300 text-orange-500 hover:bg-orange-50 hover:border-orange-400 dark:hover:bg-orange-950/40'
    : 'border-border text-muted-foreground hover:bg-muted/50 hover:border-foreground/30 hover:text-foreground';

  return (
    <>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-transparent !border-transparent" />
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={cn(
          "w-9 h-9 rounded-full border-2 border-dashed flex items-center justify-center transition-all duration-200 hover:scale-110 hover:shadow-sm",
          variantStyles,
        )}
      >
        <Plus className="w-4 h-4" />
      </button>
    </>
  );
});

WorkflowAddNode.displayName = 'WorkflowAddNode';
