import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { SEOHead } from '@/components/SEOHead';
import { useSourcingProject, useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { useAgent } from '@/contexts/AgentContext';
import { OutreachSearchProvider } from '@/contexts/OutreachSearchContext';
import { LinkedInSearch } from '@/components/outreach/LinkedInSearch';
import { BrutalLoader } from '@/components/ui/brutal-loader';
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
import { ArrowLeft, Briefcase, Sparkles } from 'lucide-react';
import { PromptSearchHero } from '@/components/sourcing/PromptSearchHero';
import type { JobDetails } from '@/types/jobDetails';

// Workspace d'une recherche autonome (kind='search') : le même moteur de
// recherche que dans les missions (LinkedInSearch + activeProject), sans
// brief. La cible se définit via le champ « Que cherches-tu ? » →
// job_details.title (requis pour le scoring IA, pas pour chercher).
export default function SourcingSearch() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading } = useSourcingProject(id);
  const { updateProject, isUpdating } = useSourcingProjects('search');
  const { accounts, accountsLoading, selectedAccount, setSelectedAccount } = useFilteredLinkedInAccounts();
  const { openContextualAgent } = useAgent();

  const jd = (project?.job_details || {}) as JobDetails;
  const jdTitle = (jd.title || '').trim();

  const [title, setTitle] = useState('');
  const [transformOpen, setTransformOpen] = useState(false);
  const [missionName, setMissionName] = useState('');

  // Hero « prompt IA » : affiché tant qu'aucun filtre n'existe, ré-ouvrable
  // via le bouton ✨, fermable via « Configurer manuellement ».
  const snapshotKeys = Object.keys((project?.filters_snapshot || {}) as Record<string, unknown>);
  const hasFilters = snapshotKeys.length > 0;
  const [heroOverride, setHeroOverride] = useState<'open' | 'closed' | null>(null);
  const showHero = heroOverride === 'open' || (heroOverride !== 'closed' && !hasFilters);

  // Hydrate le champ intitulé au chargement ET quand l'IA l'extrait du prompt
  // (l'user est le seul autre éditeur — pas de conflit de frappe).
  useEffect(() => {
    if (project?.id) setTitle(jdTitle);
  }, [project?.id, jdTitle]);

  // Changement de recherche (navigation) → l'état du hero repart du réel
  useEffect(() => {
    setHeroOverride(null);
  }, [project?.id]);

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

  const handleOpenSearchAgent = useCallback(() => {
    if (!project) return;
    const jobTitle = ((project.job_details as JobDetails | undefined)?.title || project.name || '').trim();
    const linkedInAccount = accounts.find(a => a.id === selectedAccount);
    openContextualAgent({
      mode: 'sourcing',
      briefContext: (project.job_details || {}) as Record<string, unknown>,
      initialMessage: `Aide-moi à trouver des candidats pour "${jobTitle}".\n\n=== ACCÈS ===\n${
        linkedInAccount
          ? `Compte LinkedIn : ${linkedInAccount.name || linkedInAccount.identifier} (${linkedInAccount.status})`
          : 'Pas de compte LinkedIn connecté'
      }`,
      job: undefined,
      projectId: project.id,
      accountId: selectedAccount || undefined,
    });
  }, [project, accounts, selectedAccount, openContextualAgent]);

  if (isLoading || accountsLoading) {
    return (
      <div className="py-6 px-3 sm:px-6 lg:px-8">
        <BrutalLoader variant="default" rows={3} messages={['Chargement de la recherche…']} />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="py-16 px-6 text-center">
        <p className="font-display font-bold text-foreground">Recherche introuvable</p>
        <p className="text-sm text-muted-foreground mt-1">Elle a peut-être été supprimée.</p>
        <Button variant="outline" className="mt-4 gap-1.5" onClick={() => navigate('/sourcing')}>
          <ArrowLeft className="w-4 h-4" />
          Retour aux recherches
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-full bg-background">
      <SEOHead title={`${project.name} | Recherche | Konekt`} description="Recherche de candidats" />

      <div className="py-4 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 p-0 shrink-0"
              onClick={() => navigate('/sourcing')}
              aria-label="Retour aux recherches"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1 min-w-[220px]">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                placeholder="Intitulé du poste (ex : Développeur React senior)"
                className="h-9 font-medium"
                aria-label="Intitulé du poste recherché"
              />
            </div>
            {!showHero && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 shrink-0"
                onClick={() => setHeroOverride('open')}
                title="Décrire la cible en langage naturel — l'IA génère les filtres"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Prompt IA
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-9 gap-1.5 shrink-0" onClick={openTransform}>
              <Briefcase className="w-3.5 h-3.5" />
              Transformer en mission
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3 ml-11">
            L'intitulé sert au scoring IA — il se remplit tout seul quand tu passes par le prompt.
          </p>

          {showHero ? (
            <PromptSearchHero
              project={project}
              hasExistingFilters={hasFilters}
              onGenerated={() => setHeroOverride('closed')}
              onSkip={() => setHeroOverride('closed')}
            />
          ) : (
            <OutreachSearchProvider>
              <LinkedInSearch
                accounts={accounts}
                selectedAccount={selectedAccount}
                onAccountChange={setSelectedAccount}
                activeProject={project}
                searchSource="linkedin"
                onOpenSearchAgent={handleOpenSearchAgent}
              />
            </OutreachSearchProvider>
          )}
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
