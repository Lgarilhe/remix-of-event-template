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
import { useAuthReady } from '@/hooks/useAuthReady';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

const HIDDEN_FAB_ROUTES = ['/auth', '/onboarding', '/portal'];

/**
 * Hauteur RÉELLEMENT visible du viewport, suivie en temps réel via
 * l'API visualViewport. Sur mobile, 100dvh est mal mesuré par certains
 * navigateurs (Samsung Internet, webviews in-app) et ne suit pas toujours
 * le clavier virtuel → le composer du chat sortait de l'écran et le champ
 * de saisie passait sous le clavier. visualViewport donne la vraie hauteur
 * visible, clavier inclus. Retourne null si l'API est absente (desktop
 * ancien) → fallback CSS 100dvh.
 */
function useVisualViewportHeight(active: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setHeight(Math.round(vv.height));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);

  return active ? height : null;
}

const AgentFAB: React.FC = () => {
  const { toggleAgent, isOpen, unreadCount } = useAgent();
  const { session } = useAuthReady();
  const location = useLocation();
  const [hovered, setHovered] = useState(false);

  const isMac = useMemo(() => typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform), []);
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl+K';

  // Le copilote ne s'affiche qu'aux utilisateurs connectés : sur les pages
  // publiques (landing, 404, désinscription) il n'aurait aucun contexte.
  const isHidden = !session || isOpen || HIDDEN_FAB_ROUTES.some(r =>
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
  const viewportHeight = useVisualViewportHeight(isOpen);
  const { session } = useAuthReady();

  // Global Cmd+K / Ctrl+K shortcut (utilisateurs connectés uniquement)
  useEffect(() => {
    if (!session) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleAgent();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggleAgent, session]);

  return (
    <>
      <AgentFAB />
      <Sheet open={isOpen} onOpenChange={(open) => { if (!open) closeAgent(); }}>
        <SheetContent
          side="right"
          className="w-full sm:w-[420px] p-0 bg-background border-l border-border border-t-0 border-r-0 border-b-0 h-full flex flex-col [&>button]:hidden"
          // Mobile : hauteur pilotée par visualViewport (vraie zone visible,
          // clavier virtuel inclus). Fallback 100dvh si l'API est absente ;
          // les navigateurs sans dvh ignorent le style inline → h-full.
          style={{
            height: viewportHeight ? `${viewportHeight}px` : '100dvh',
            maxHeight: viewportHeight ? `${viewportHeight}px` : '100dvh',
          }}
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
            projectId={projectId}
            accountId={accountId}
          />
        </SheetContent>
      </Sheet>
    </>
  );
};
