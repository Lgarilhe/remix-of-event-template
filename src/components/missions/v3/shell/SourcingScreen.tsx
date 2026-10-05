// Refonte mission, lot 1 : écran Sourcing de la nouvelle page mission.
// Le Sourcing d'aujourd'hui, pleine largeur, en disposition « mission-v3 »
// (rangée Affiner, Filtres, Nouvelle recherche ; résultats en trois groupes,
// src/components/missions/v3/sourcing/**). Même recherche et mêmes écritures ;
// l'ancienne page et /sourcing/:id gardent leur rendu. Mission archivée : fermé, une
// phrase (« Réactiver » est dans le bandeau de la page ; il n'a pas de mode lecture
// seule). Sans compte LinkedIn utilisable : un message « Relier LinkedIn »
// à la place de la recherche, une fois les comptes chargés (conception 5.3) ;
// design simplifié (04/10/2026) : sans cadre, pastille d'icône, un seul bouton plein.
import { Link } from 'react-router-dom';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/IconTile';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { MissionSourcing } from '@/components/missions/MissionSourcing';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { useMissionV3 } from '../MissionV3Context';
import { ArchivedNotice } from './ArchivedNotice';

export function SourcingScreen() {
  const { project, isArchived } = useMissionV3();
  const { accounts, accountsLoading } = useFilteredLinkedInAccounts();
  if (isArchived) {
    return (
      <div className="py-10">
        <ArchivedNotice text="Le sourcing est fermé. Réactivez la mission pour chercher, noter ou contacter des profils." />
      </div>
    );
  }
  // Pendant le chargement, le Sourcing s'affiche : aucun blocage avant de savoir.
  if (!accountsLoading && accounts.length === 0) {
    return (
      <section
        aria-labelledby="sourcing-linkedin-titre"
        className="mx-auto mt-16 flex w-full max-w-[460px] flex-col items-center gap-2.5 px-4 text-center"
      >
        <IconTile icon={Link2} size="lg" aria-hidden="true" className="mb-1" />
        <h2 id="sourcing-linkedin-titre" className="text-lg font-semibold text-foreground">
          Pour chercher des profils, reliez votre compte LinkedIn.
        </h2>
        <p className="text-md text-muted-foreground">Le Pipeline et le Cadrage restent disponibles.</p>
        <Button asChild variant="primary" className="mt-2 max-sm:min-h-11">
          <Link to="/settings/account/connections">Relier LinkedIn</Link>
        </Button>
      </section>
    );
  }
  return (
    <SectionErrorBoundary fallbackTitle="Erreur dans le Sourcing">
      <MissionSourcing project={project} layout="mission-v3" />
    </SectionErrorBoundary>
  );
}
