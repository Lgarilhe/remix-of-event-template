// Refonte mission, lot 1 : écran Sourcing de la nouvelle page mission.
// Le Sourcing d'aujourd'hui, tel quel et pleine largeur (ses retraits viennent
// au lot 4).
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { MissionSourcing } from '@/components/missions/MissionSourcing';
import { useMissionV3 } from '../MissionV3Context';

export function SourcingScreen() {
  const { project } = useMissionV3();
  return (
    <SectionErrorBoundary fallbackTitle="Erreur dans le Sourcing">
      <MissionSourcing project={project} />
    </SectionErrorBoundary>
  );
}
