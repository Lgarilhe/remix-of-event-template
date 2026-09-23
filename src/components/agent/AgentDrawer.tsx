import React, { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { AgentChatPanel } from './AgentChatPanel';
import { useAgent } from '@/contexts/AgentContext';
import { useAuthReady } from '@/hooks/useAuthReady';

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

export const AgentDrawer: React.FC = () => {
  const { isOpen, closeAgent, toggleAgent, contextMode, briefContext, initialMessage, autoJob, projectId, accountId } = useAgent();
  const viewportHeight = useVisualViewportHeight(isOpen);
  const { session } = useAuthReady();

  // Global Cmd+K / Ctrl+K shortcut (utilisateurs connectés uniquement)
  useEffect(() => {
    if (!session) return;
    const handler = (e: KeyboardEvent) => {
      // Dans l'éditeur de message, Ctrl+K insère un lien (preventDefault déjà appelé).
      // Exception : la palette (cmdk) appelle aussi preventDefault sur Ctrl+K, alors
      // qu'elle affiche « Ctrl K » pour ouvrir l'assistant.
      const inPalette = !!(e.target as HTMLElement | null)?.closest?.('[cmdk-root]');
      if (e.defaultPrevented && !inPalette) return;
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
