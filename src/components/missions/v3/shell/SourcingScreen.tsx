// Refonte mission, lot 1 : écran Sourcing de la nouvelle page mission.
// Le Sourcing d'aujourd'hui, pleine largeur, en disposition « mission-v3 »
// (rangée Affiner, Filtres, Nouvelle recherche ; résultats en trois groupes,
// src/components/missions/v3/sourcing/**). Même recherche et mêmes écritures ;
// l'ancienne page et /sourcing/:id gardent leur rendu. Mission archivée : fermé, avec « Réactiver » (il n'a pas de mode
// lecture seule). Sans compte LinkedIn utilisable : une carte « Relier LinkedIn »
// à la place de la recherche, une fois les comptes chargés (conception 5.3).
import { Link } from 'react-router-dom';
import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
      <div className="py-6">
        <ArchivedNotice text="Le sourcing est fermé. Réactivez la mission pour chercher, noter ou contacter des profils." />
      </div>
    );
  }
  // Pendant le chargement, le Sourcing s'affiche : aucun blocage avant de savoir.
  if (!accountsLoading && accounts.length === 0) {
    return (
      <section
        aria-labelledby="sourcing-linkedin-titre"
        className="mx-auto mt-16 flex w-full max-w-[460px] flex-col items-start gap-2.5 rounded-xl border border-border bg-card px-7 py-6"
      >
        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground-secondary">
          <Link2 className="h-4 w-4" />
        </span>
        <h2 id="sourcing-linkedin-titre" className="text-[15px] font-semibold text-foreground">
          Pour chercher des profils, reliez votre compte LinkedIn.
        </h2>
        <p className="text-sm text-foreground-secondary">Le Pipeline et le Cadrage restent disponibles.</p>
        <Button asChild className="mt-1.5">
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
