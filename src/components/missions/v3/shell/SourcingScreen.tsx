// Refonte mission, lot 1 : écran Sourcing de la nouvelle page mission.
// Le Sourcing d'aujourd'hui, pleine largeur, en disposition « mission-v3 »
// (rangée Affiner, Filtres, Nouvelle recherche ; résultats en trois groupes,
// src/components/missions/v3/sourcing/**). Même recherche et mêmes écritures ;
// l'ancienne page et /sourcing/:id gardent leur rendu. Mission archivée : fermé, une
// phrase (« Réactiver » est dans le bandeau de la page ; il n'a pas de mode lecture
// seule). Sans compte LinkedIn, le moteur propose la Base Konekt avec ses
// prérequis d'accès ; les résultats annoncent leur source et leurs limites.
import { useNavigate, useLocation } from 'react-router-dom';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { MissionSourcing } from '@/components/missions/MissionSourcing';
import { useMissionV3 } from '../MissionV3Context';
import { ArchivedNotice } from './ArchivedNotice';
import { SourcingAgentStatus } from '@/components/agent/SourcingAgentStatus';

export function SourcingScreen() {
  const { project, isArchived, isOwnMission } = useMissionV3();
  const navigate = useNavigate();
  const location = useLocation();
  const start = location.state as { phrase?: string; source?: 'linkedin' | 'database' } | null;
  if (isArchived) {
    return (
      <div className="py-10">
        <ArchivedNotice text="Le sourcing est fermé. Réactivez la mission pour chercher, noter ou contacter des profils." />
      </div>
    );
  }
  // Pendant le chargement, le Sourcing s'affiche : aucun blocage avant de savoir.
  return (
    <>
      {isOwnMission && <SectionErrorBoundary fallbackTitle="L’agent de sourcing n’a pas pu être chargé">
        <SourcingAgentStatus projectId={project.id} projectName={project.name} missionStatus={project.status} onManage={() => navigate(`/agents/sourcing/${project.id}`)} />
      </SectionErrorBoundary>}
    <SectionErrorBoundary fallbackTitle="Erreur dans le Sourcing">
      <MissionSourcing project={project} layout="mission-v3" initialPhrase={start?.phrase} initialSource={start?.source} />
    </SectionErrorBoundary>
    </>
  );
}
