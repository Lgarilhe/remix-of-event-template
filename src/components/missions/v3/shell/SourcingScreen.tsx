// Refonte mission, lot 1 : écran Sourcing de la nouvelle page mission.
// Le Sourcing d'aujourd'hui, tel quel et pleine largeur (ses retraits viennent
// au lot 4). Mission archivée : fermé, avec « Réactiver » (il n'a pas de mode
// lecture seule).
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { MissionSourcing } from '@/components/missions/MissionSourcing';
import { useMissionV3 } from '../MissionV3Context';
import { ArchivedNotice } from './ArchivedNotice';

export function SourcingScreen() {
  const { project, isArchived } = useMissionV3();
  if (isArchived) {
    return (
      <div className="py-6">
        <ArchivedNotice text="Le sourcing est fermé. Réactivez la mission pour chercher, noter ou contacter des profils." />
      </div>
    );
  }
  return (
    <SectionErrorBoundary fallbackTitle="Erreur dans le Sourcing">
      <MissionSourcing project={project} />
    </SectionErrorBoundary>
  );
}
