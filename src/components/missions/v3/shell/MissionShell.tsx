// Refonte mission, lot 1 : coquille de la nouvelle page mission
// (conception, 3.1 et 4.2). Colonne pleine hauteur : en-tête de 48 px (trois
// onglets au centre à partir de lg, en bande à part en dessous), bandeau d'état,
// puis le contenu et le panneau de droite côte à côte.
// Pipeline et Sourcing prennent toute la largeur, Cadrage 1 280 px au plus.
//
// Hauteur : la fenêtre sous l'en-tête et les bandeaux de la mise en page
// (ViewportFrame), jamais plus. Changer d'écran remet le défilement en haut.
// Panneau ouvert sous lg (plein écran) : le reste de la coquille est rendu
// inerte, le panneau est une fenêtre modale.
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { useMissionV3 } from '../MissionV3Context';
import { CadrageScreen } from '../cadrage/CadrageScreen';
import { PipelineScreen } from '../pipeline/PipelineScreen';
import { MissionHeader } from './MissionHeader';
import { MissionStateBanner } from './MissionStateBanner';
import { MissionTabs } from './MissionTabs';
import { PanelHost } from './PanelHost';
import { SourcingPanelSlotProvider, useSourcingPanelSlot } from './sourcingPanelSlot';
import { SourcingScreen } from './SourcingScreen';
import { PANEL_FULLSCREEN_QUERY, useMediaQuery } from './useMediaQuery';
import { ViewportFrame } from './ViewportFrame';

/** Pose ou retire l'attribut inert (hors de portée du clavier et des lecteurs d'écran). */
function useInert(refs: readonly RefObject<HTMLElement>[], inert: boolean): void {
  useLayoutEffect(() => {
    const nodes = refs.map((ref) => ref.current).filter((node): node is HTMLElement => !!node);
    for (const node of nodes) {
      if (inert) node.setAttribute('inert', '');
      else node.removeAttribute('inert');
    }
    return () => {
      for (const node of nodes) node.removeAttribute('inert');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inert]);
}

export function MissionShell() {
  return (
    <SourcingPanelSlotProvider>
      <MissionShellFrame />
    </SourcingPanelSlotProvider>
  );
}

function MissionShellFrame() {
  const { location } = useMissionV3();
  const sourcingPanelOpen = !!useSourcingPanelSlot()?.open;
  const reduceMotion = useReducedMotion();
  const screen = location.screen;
  const fullscreenPanel = useMediaQuery(PANEL_FULLSCREEN_QUERY);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Nouvel écran : en haut (Cadrage fait ensuite défiler vers ?section=).
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [screen]);

  useInert([topRef, scrollRef], fullscreenPanel && (location.panel !== null || sourcingPanelOpen));

  return (
    <ViewportFrame data-testid="mission-v3" className="relative flex w-full max-w-full flex-col overflow-hidden bg-background">
      <div ref={topRef} className="flex shrink-0 flex-col">
        <MissionHeader />
        <MissionTabs className="lg:hidden" />
        <MissionStateBanner />
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
          <motion.div
            key={screen}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={cn('min-w-0 px-3 py-2 sm:px-6 sm:py-3 lg:px-8', screen === 'cadrage' && 'w-full max-w-[1280px]')}
          >
            {screen === 'pipeline' && (
              <SectionErrorBoundary fallbackTitle="Erreur dans le Pipeline">
                <PipelineScreen />
              </SectionErrorBoundary>
            )}
            {screen === 'sourcing' && <SourcingScreen />}
            {screen === 'cadrage' && (
              <SectionErrorBoundary fallbackTitle="Erreur dans le Cadrage">
                <CadrageScreen />
              </SectionErrorBoundary>
            )}
          </motion.div>
        </div>
        <PanelHost />
      </div>
    </ViewportFrame>
  );
}
