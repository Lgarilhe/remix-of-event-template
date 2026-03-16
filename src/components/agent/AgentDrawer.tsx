import React from 'react';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import { Bot } from 'lucide-react';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { AgentChatPanel } from './AgentChatPanel';
import { useAgent } from '@/contexts/AgentContext';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

const HIDDEN_FAB_ROUTES = ['/auth', '/onboarding', '/portal'];

const AgentFAB: React.FC = () => {
  const { toggleAgent, isOpen, unreadCount } = useAgent();
  const location = useLocation();

  const isHidden = isOpen || HIDDEN_FAB_ROUTES.some(r =>
    location.pathname === r || location.pathname.startsWith('/portal/')
  );

  if (isHidden) return null;

  return (
    <button
      onClick={toggleAgent}
      className="fixed bottom-6 right-6 z-50 group animate-[scale-in_0.35s_cubic-bezier(0.34,1.56,0.64,1)]"
      aria-label="Ouvrir l'agent IA"
    >
      <div className="relative">
        <AnimatedOrb size={52} speed={6}>
          <Bot className="w-5 h-5 text-foreground group-hover:scale-110 transition-transform" />
        </AnimatedOrb>
        {/* Brutal shadow */}
        <div className="absolute inset-0 -z-10 translate-x-[3px] translate-y-[3px] rounded-full bg-brutal-accent/40" />
        {/* Notification dot */}
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 h-2.5 w-2.5 rounded-full bg-brutal-accent ring-2 ring-background animate-pulse" />
        )}
      </div>
    </button>
  );
};

export const AgentDrawer: React.FC = () => {
  const { isOpen, closeAgent } = useAgent();

  return (
    <>
      <AgentFAB />
      <Sheet open={isOpen} onOpenChange={(open) => { if (!open) closeAgent(); }}>
        <SheetContent
          side="right"
          className="w-full sm:w-[420px] p-0 glass-strong border-l border-foreground/10 border-t-0 border-r-0 border-b-0 h-full flex flex-col [&>button]:hidden"
        >
          <AgentChatPanel onClose={closeAgent} />
        </SheetContent>
      </Sheet>
    </>
  );
};
