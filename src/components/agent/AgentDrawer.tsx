import React, { useEffect, useState, useMemo, lazy, Suspense } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { useAgent } from '@/contexts/AgentContext';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

// Lazy : AgentChatPanel tire @assistant-ui/react + react-markdown (~2 200 lignes).
// Le chunk n'est chargé qu'à la première ouverture du drawer, pas dans le bundle initial.
const AgentChatPanel = lazy(() =>
  import('./AgentChatPanel').then((m) => ({ default: m.AgentChatPanel }))
);

// Routes publiques où l'agent est totalement désactivé (FAB + raccourci clavier) :
// landing, auth, portail candidat et portail client externe — les visiteurs et
// clients finaux ne doivent jamais voir l'assistant interne.
const AGENT_BLOCKED_ROUTES = ['/', '/auth', '/portal', '/client'];
// Routes internes où seul le FAB est masqué (Cmd+K reste actif).
const HIDDEN_FAB_ROUTES = ['/onboarding'];

const matchesRoute = (pathname: string, routes: string[]) =>
  routes.some((r) => pathname === r || pathname.startsWith(r + '/'));

const AgentFAB: React.FC = () => {
  const { toggleAgent, isOpen, unreadCount } = useAgent();
  const location = useLocation();
  const [hovered, setHovered] = useState(false);

  const isMac = useMemo(() => typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform), []);
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl+K';

  const isHidden = isOpen || matchesRoute(location.pathname, HIDDEN_FAB_ROUTES);

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
          "text-xs font-bold text-muted-foreground bg-background/80 backdrop-blur-sm border border-border px-1.5 py-0.5 transition-all duration-200 pointer-events-none",
          hovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
        )}
      >
        {shortcutLabel}
      </span>
    </div>
  );
};

export const AgentDrawer: React.FC = () => {
  const { isOpen, closeAgent, toggleAgent, contextMode, briefContext, initialMessage, autoJob, projectId, accountId } = useAgent();
  const location = useLocation();
  const isBlocked = matchesRoute(location.pathname, AGENT_BLOCKED_ROUTES);

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    if (isBlocked) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleAgent();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggleAgent, isBlocked]);

  if (isBlocked) return null;

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
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full border border-border border-t-foreground animate-spin" />
              </div>
            }
          >
            <AgentChatPanel
              onClose={closeAgent}
              contextMode={contextMode}
              briefContext={briefContext}
              initialMessage={initialMessage}
              autoJob={autoJob}
              projectId={projectId}
              accountId={accountId}
            />
          </Suspense>
        </SheetContent>
      </Sheet>
    </>
  );
};
