import React from 'react';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import { AgentChatPanel } from './AgentChatPanel';

interface AgentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AgentDrawer: React.FC<AgentDrawerProps> = ({ open, onOpenChange }) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[420px] p-0 glass-strong border-l border-foreground/10 border-t-0 border-r-0 border-b-0 h-full flex flex-col [&>button]:hidden"
      >
        <AgentChatPanel onClose={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
};
