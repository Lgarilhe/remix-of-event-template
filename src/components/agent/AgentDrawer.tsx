import React, { useEffect, useState, useMemo } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { AgentChatPanel } from './AgentChatPanel';
import { useAgent } from '@/contexts/AgentContext';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

const HIDDEN_FAB_ROUTES = ['/auth', '/onboarding', '/portal'];

const AgentFAB: React.FC = () => {
  const { toggleAgent, isOpen, unreadCount } = useAgent();
  const location = useLocation();
  const [hovered, setHovered] = useState(false);

  const isMac = useMemo(() => typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform), []);
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl+K';

  const isHidden = isOpen || HIDDEN_FAB_ROUTES.some(r =>
    location.pathname === r || location.pathname.startsWith('/portal/')
  );

  if (isHidden) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[1900] flex flex-col items-center gap-1.5">
      <button
        onClick={toggleAgent}
        onTouchEnd={(e) => { e.preventDefault(); toggleAgent(); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="group animate-[scale-in_0.35s_cubic-bezier(0.34,1.56,0.64,1)] touch-manipulation"
        aria-label="Ouvrir l'agent IA"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        <div className="relative pointer-events-none">
          <AnimatedOrb size={52} speed={6} />
          <div className="absolute inset-0 -z-10 rounded-full bg-accent/20 blur-sm" />
          {unreadCount > 0 && (
            <span className="absolute top-0 right-0 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-background animate-pulse" />
          )}
        </div>
      </button>
      <span
        className={cn(
          "text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground bg-background/80 backdrop-blur-sm border border-border px-1.5 py-0.5 transition-all duration-200 pointer-events-none",
          hovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
        )}
      >
        {shortcutLabel}
      </span>
    </div>
  );
};

export const AgentDrawer: React.FC = () => {
  const { isOpen, closeAgent, toggleAgent, contextMode, briefContext, initialMessage, autoJob } = useAgent();

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleAgent();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggleAgent]);

  return (
    <>
      <AgentFAB />
      <Sheet open={isOpen} onOpenChange={(open) => { if (!open) closeAgent(); }}>
        <SheetContent
          side="right"
          className="w-full sm:w-[420px] p-0 bg-background border-l border-border border-t-0 border-r-0 border-b-0 h-full flex flex-col [&>button]:hidden"
        >
          <SheetTitle className="sr-only">Assistant IA</SheetTitle>
          <SheetDescription className="sr-only">
            Conversation contextuelle avec l'assistant recrutement.
          </SheetDescription>
          <AgentChatPanel
            onClose={closeAgent}
            contextMode={contextMode}
            briefContext={briefContext}
            initialMessage={initialMessage}
            autoJob={autoJob}
          />
        </SheetContent>
      </Sheet>
    </>
  );
};
