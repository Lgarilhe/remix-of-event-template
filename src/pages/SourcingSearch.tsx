import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { SEOHead } from '@/components/SEOHead';
import { useSourcingProject, useSourcingProjects } from '@/hooks/useSourcingProjects';
import { Skeleton } from '@/components/ui/skeleton';
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
  const location = useLocation();
  const { data: project, isLoading } = useSourcingProject(id);
  const { updateProject, isUpdating } = useSourcingProjects('search');

  const jd = (project?.job_details || {}) as JobDetails;
  const jdTitle = (jd.title || '').trim();

  // Départ choisi sur /sourcing (phrase à lancer, ou filtres à ouvrir) : gardé
  // à l'arrivée, puis retiré de l'historique du navigateur pour qu'un
  // rechargement ne relance pas (et ne facture) rien.
  const [start] = useState(() => {
    const s = (location.state as { phrase?: string; filters?: boolean } | null) ?? {};
    return { phrase: s.phrase, filters: !!s.filters };
  });
  useEffect(() => {
    if (start.phrase || start.filters) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          {/* Barre compacte : retour, intitulé modifiable sur place, transformation. */}
          <div className="mb-3 flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={() => navigate('/sourcing')}
              aria-label="Retour aux recherches"
              title="Retour aux recherches"
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
            <Input
              id="search-job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              placeholder="Intitulé du poste, ex : Développeur React senior"
              aria-label="Intitulé du poste recherché (sert au scoring IA)"
              title="Sert au scoring IA"
              className="h-9 min-w-0 flex-1 border-transparent bg-transparent px-2 text-lg font-semibold tracking-tight shadow-none hover:border-border focus-visible:border-input"
            />
            <Button variant="outline" className="shrink-0" onClick={openTransform}>
              <Briefcase aria-hidden="true" />
              <span className="hidden sm:inline">Transformer en mission</span>
              <span className="sm:hidden">Mission</span>
            </Button>
          </div>

          {/* Le même Sourcing que dans une mission : prompt, reprise d'une recherche, filtres, résultats. */}
          <SectionErrorBoundary fallbackTitle="Erreur dans la recherche">
            <MissionSourcing project={project} layout="mission-v3" initialPhrase={start.phrase} startWithFilters={start.filters} />
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
