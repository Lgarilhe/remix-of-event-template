import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { useSourcingProject } from '@/hooks/useSourcingProjects';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { Button } from '@/components/ui/button';
import { setMissionBeta } from '@/lib/missionBeta';
import { MissionWorkspaceV2 } from '@/components/missions/v2/MissionWorkspaceV2';

// ── Main component ──

const MissionWorkspace = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: project = null, isLoading } = useSourcingProject(id);

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen w-full max-w-full bg-background">
        <SEOHead title="Mission | Konekt" description="Espace de travail mission" />
        <div className="py-6 pb-14 w-full max-w-full">
          <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
            <BrutalLoader variant="default" rows={3} messages={['Chargement de la mission…', 'Récupération des données…']} />
          </div>
        </div>
      </div>
    );
  }

  // Not found
  if (!project) {
    return (
      <div className="min-h-screen w-full max-w-full bg-background">
        <SEOHead title="Mission introuvable | Konekt" description="Mission introuvable" />
        <div className="py-6 pb-14 w-full max-w-full">
          <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
            <div className="rounded-lg border border-border bg-card p-12 text-center">
              <div className="text-4xl mb-4">🔍</div>
              <h2 className="text-sm font-semibold mb-2">Mission introuvable</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Cette mission n'existe pas ou a été supprimée.
              </p>
              <button
                onClick={() => navigate('/missions')}
                className="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Retour aux missions
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <SEOHead title={`${project.name} | Konekt`} description={`Mission ${project.name}`} />
      {/* Cette page n'apparaît que sur un choix « ancienne page » : retour en un clic. */}
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2 text-sm"
      >
        <span className="text-foreground">Vous êtes sur l'ancienne page mission.</span>
        <Button size="sm" variant="primary" onClick={() => setMissionBeta(true)}>
          Passer à la nouvelle page
        </Button>
      </div>
      <MissionWorkspaceV2 project={project} />
    </>
  );
};

export default MissionWorkspace;
