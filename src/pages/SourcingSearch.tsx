import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { SEOHead } from '@/components/SEOHead';
import { useSourcingProject, useSourcingProjects } from '@/hooks/useSourcingProjects';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowLeft, Briefcase, Search } from 'lucide-react';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { MissionSourcing } from '@/components/missions/MissionSourcing';
import type { JobDetails } from '@/types/jobDetails';

// Workspace d'une recherche autonome (kind='search') : le même moteur de
// recherche que dans les missions (MissionSourcing, disposition mission-v3), sans
// brief. La cible se définit via le champ « Intitulé du poste » →
// job_details.title (requis pour le scoring IA, pas pour chercher).
export default function SourcingSearch() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading } = useSourcingProject(id);
  const { updateProject, isUpdating } = useSourcingProjects('search');

  const jd = (project?.job_details || {}) as JobDetails;
  const jdTitle = (jd.title || '').trim();

  const [title, setTitle] = useState('');
  const [transformOpen, setTransformOpen] = useState(false);
  const [missionName, setMissionName] = useState('');

  // Hydrate le champ intitulé au chargement et quand il change côté serveur
  // (l'user est le seul éditeur : pas de conflit de frappe).
  useEffect(() => {
    if (project?.id) setTitle(jdTitle);
  }, [project?.id, jdTitle]);


  // Une recherche déjà transformée (ou un deep-link vers une mission) vit
  // dans le workspace mission.
  useEffect(() => {
    if (project && project.kind !== 'search') {
      navigate(`/missions/${project.id}`, { replace: true });
    }
  }, [project?.id, project?.kind, navigate]);

  const commitTitle = useCallback(async () => {
    if (!project) return;
    const trimmed = title.trim();
    if (trimmed === ((project.job_details as JobDetails | undefined)?.title || '').trim()) return;
    try {
      await updateProject({
        id: project.id,
        job_details: { ...(project.job_details || {}), title: trimmed } as JobDetails,
        // Le nom de la recherche suit l'intitulé (la liste /sourcing reste lisible)
        ...(trimmed ? { name: trimmed } : {}),
      });
    } catch {
      // toast d'erreur déjà géré par le hook
    }
  }, [project, title, updateProject]);

  const openTransform = () => {
    setMissionName(title.trim() || project?.name || '');
    setTransformOpen(true);
  };

  const handleTransform = async () => {
    if (!project) return;
    try {
      await updateProject({
        id: project.id,
        kind: 'mission',
        name: missionName.trim() || project.name,
      });
      toast.success('Recherche transformée en mission', {
        description: 'Candidats, filtres et statuts sont conservés.',
      });
      navigate(`/missions/${project.id}`);
    } catch {
      // toast d'erreur déjà géré par le hook
    }
  };

  if (isLoading) {
    return (
      <div className="py-6 px-3 sm:px-6 lg:px-8" aria-busy="true" aria-label="Chargement de la recherche">
        <Skeleton className="mb-2 h-6 w-64 max-w-full" />
        <Skeleton className="mb-6 h-4 w-96 max-w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="py-6 px-3 sm:px-6 lg:px-8">
        <EmptyState
          icon={Search}
          headingLevel={2}
          title="Recherche introuvable"
          description="Elle a peut-être été supprimée."
          action={
            <Button variant="outline" onClick={() => navigate('/sourcing')}>
              <ArrowLeft aria-hidden="true" />
              Retour aux recherches
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-full bg-background">
      <SEOHead title={`${project.name} | Recherche | Konekt`} description="Recherche de candidats" />

      <div className="py-4 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-2 text-muted-foreground"
            onClick={() => navigate('/sourcing')}
          >
            <ArrowLeft aria-hidden="true" />
            Recherches
          </Button>

          <PageHeader
            className="mb-4"
            title={project.name}
            subtitle="Recherche hors mission. Candidats, filtres et statuts sont conservés si vous la transformez en mission."
            actions={
              <>
                <Button variant="outline" onClick={openTransform}>
                  <Briefcase aria-hidden="true" />
                  Transformer en mission
                </Button>
              </>
            }
          />

          <div className="mb-4 max-w-xl">
            <label htmlFor="search-job-title" className="mb-1 block text-xs font-medium text-foreground">
              Intitulé du poste
            </label>
            <Input
              id="search-job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              placeholder="Ex : Développeur React senior"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Il sert au scoring IA. Sans intitulé, la recherche utilise son nom.
            </p>
          </div>

          {/* Le même Sourcing que dans une mission : prompt, reprise d'une recherche, filtres, résultats. */}
          <SectionErrorBoundary fallbackTitle="Erreur dans la recherche">
            <MissionSourcing project={project} layout="mission-v3" />
          </SectionErrorBoundary>
        </div>
      </div>

      <Dialog open={transformOpen} onOpenChange={setTransformOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transformer en mission</DialogTitle>
            <DialogDescription>
              La recherche devient une mission complète (brief, process, pipeline, outreach).
              Les candidats, filtres et statuts sont conservés tels quels.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="mission-name" className="text-xs font-medium text-foreground">
              Nom de la mission
            </label>
            <Input
              id="mission-name"
              value={missionName}
              onChange={(e) => setMissionName(e.target.value)}
              placeholder="Ex : Développeur React senior — Client X"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransformOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleTransform} disabled={isUpdating || !missionName.trim()}>
              Créer la mission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
