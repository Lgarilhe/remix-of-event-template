import React from 'react';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import { AgentChatPanel } from './AgentChatPanel';
import { useAgent } from '@/contexts/AgentContext';

export const AgentDrawer: React.FC = () => {
  const { isOpen, closeAgent } = useAgent();

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) closeAgent(); }}>
      <SheetContent
        side="right"
        className="w-full sm:w-[420px] p-0 glass-strong border-l border-foreground/10 border-t-0 border-r-0 border-b-0 h-full flex flex-col [&>button]:hidden"
      >
        <AgentChatPanel onClose={closeAgent} />
      </SheetContent>
    </Sheet>
  );
};
