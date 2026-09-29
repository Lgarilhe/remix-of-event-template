// Refonte mission, lot 1 : coquille de la nouvelle page mission
// (conception, 3.1 et 4.2). Colonne pleine hauteur : en-tête de 48 px, trois
// onglets, bandeau d'état, puis le contenu et le panneau de droite côte à côte.
// Pipeline et Sourcing prennent toute la largeur, Cadrage 1 280 px au plus.
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
import { SourcingScreen } from './SourcingScreen';

export function MissionShell() {
  const { location } = useMissionV3();
  const reduceMotion = useReducedMotion();
  const screen = location.screen;

  return (
    <div data-testid="mission-v3" className="relative flex h-screen w-full max-w-full flex-col overflow-hidden bg-background">
      <MissionHeader />
      <MissionTabs />
      <MissionStateBanner />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
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
    </div>
  );
}
