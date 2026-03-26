import React, { useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Play, Pause, CheckCircle, Archive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature } from '@/lib/featureGates';
import { MissionBrief } from '@/components/missions/MissionBrief';
import { MissionSourcing } from '@/components/missions/MissionSourcing';
import { MissionPipeline } from '@/components/missions/MissionPipeline';
import { MissionOutreach } from '@/components/missions/MissionOutreach';
import { MissionInsights } from '@/components/missions/MissionInsights';
import { MissionProcess } from '@/components/missions/MissionProcess';
import { MissionCopilot } from '@/components/missions/MissionCopilot';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

// ── Status config ──

const statusConfig: Record<SourcingProject['status'], { label: string; color: string; icon: typeof Play }> = {
  active: { label: 'Actif', color: 'bg-green-100 text-green-700', icon: Play },
  paused: { label: 'En pause', color: 'bg-yellow-100 text-yellow-700', icon: Pause },
  completed: { label: 'Terminé', color: 'bg-blue-100 text-blue-700', icon: CheckCircle },
  archived: { label: 'Archivé', color: 'bg-gray-100 text-gray-500', icon: Archive },
};

// ── Tabs config ──

const tabs = [
  { value: 'brief', label: 'Brief', emoji: '📋', description: "Analysez le poste avec l'IA, définissez l'ICP et la stratégie d'approche." },
  { value: 'process', label: 'Process', emoji: '🏗️', description: 'Définissez les étapes du recrutement, les interviewers et les objectifs.' },
  { value: 'sourcing', label: 'Sourcing', emoji: '🔍', description: 'Lancez des recherches LinkedIn, Apollo ou PDL pour trouver les meilleurs candidats.' },
  { value: 'pipeline', label: 'Pipeline', emoji: '📊', description: 'Suivez la progression des candidats dans le processus de recrutement.' },
  { value: 'outreach', label: 'Outreach', emoji: '🚀', description: 'Gérez vos séquences de messages et suivez les réponses.' },
  { value: 'insights', label: 'Insights', emoji: '💡', description: 'Statistiques et analyses de performance de cette mission.' },
];

const validTabs = tabs.map(t => t.value);

// ── Main component ──

const MissionWorkspace = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { orgType } = useOrganization();
  const canEditBrief = hasFeature(orgType, 'edit_brief');
  const canEditProcess = hasFeature(orgType, 'edit_process');

  const { projects, isLoading } = useSourcingProjects();

  const project = useMemo(
    () => projects.find(p => p.id === id) || null,
    [projects, id]
  );

  const tabFromUrl = searchParams.get('tab');
  const activeTab = validTabs.includes(tabFromUrl || '') ? tabFromUrl! : 'brief';

  const setActiveTab = useCallback((tab: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen w-full max-w-full bg-background">
        <SEOHead title="Mission | Skalr" description="Espace de travail mission" />
        <Navbar />
        <main className="pt-20 pb-14 w-full max-w-full">
          <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
            <BrutalLoader variant="default" rows={3} messages={['Chargement de la mission…', 'Récupération des données…']} />
          </div>
        </main>
      </div>
    );
  }

  // Not found
  if (!project) {
    return (
      <div className="min-h-screen w-full max-w-full bg-background">
        <SEOHead title="Mission introuvable | Skalr" description="Mission introuvable" />
        <Navbar />
        <main className="pt-20 pb-14 w-full max-w-full">
          <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
            <div className="bg-background border border-foreground p-12 text-center">
              <div className="text-4xl mb-4">🔍</div>
              <h2 className="text-sm font-bold uppercase tracking-wider mb-2">Mission introuvable</h2>
              <p className="text-xs text-muted-foreground mb-6">
                Cette mission n'existe pas ou a été supprimée.
              </p>
              <button
                onClick={() => navigate('/missions')}
                className="relative overflow-hidden h-[34px] px-6 bg-foreground text-background border border-foreground text-xs font-medium uppercase tracking-wider group"
              >
                <span className="relative z-10">Retour aux missions</span>
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const StatusIcon = statusConfig[project.status].icon;

  return (
    <div className="min-h-screen w-full max-w-full bg-background">
      <SEOHead title={`${project.name} | Skalr`} description={`Mission ${project.name}`} />
      <Navbar />
      <main className="pt-20 pb-14 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => navigate('/missions')}
                className="relative overflow-hidden flex items-center gap-1.5 h-[30px] px-3 text-[10px] font-medium uppercase tracking-wider border border-foreground bg-background text-foreground group shrink-0"
              >
                <ArrowLeft className="w-3 h-3 relative z-10" />
                <span className="relative z-10">Missions</span>
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              </button>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight uppercase truncate">
                  {project.name}
                </h1>
                {project.client_name && (
                  <p className="text-xs text-muted-foreground truncate">{project.client_name}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge className={statusConfig[project.status].color}>
                <StatusIcon className="w-3 h-3 mr-1" />
                {statusConfig[project.status].label}
              </Badge>
            </div>
          </div>

          {/* Tabs — brutal style */}
          <div className="flex gap-0 w-full min-w-0 overflow-x-auto no-scrollbar">
            {tabs.map((tab, index) => {
              const isActive = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={cn(
                    "relative overflow-hidden flex items-center justify-center gap-1 h-[34px] px-2 sm:px-4 text-[10px] sm:text-xs font-medium uppercase tracking-wider border border-foreground transition-colors duration-200 group shrink-0",
                    index > 0 && "border-l-0",
                    isActive
                      ? "bg-brutal-accent text-foreground"
                      : "bg-background text-foreground"
                  )}
                >
                  <span className="text-sm shrink-0 relative z-10">{tab.emoji}</span>
                  <span className="relative z-10 whitespace-nowrap">{tab.label}</span>
                  {!isActive && (
                    <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                  )}
                </button>
              );
            })}
          </div>

          <div className={cn("mt-0 min-w-0", activeTab !== 'brief' && 'hidden')}>
            <SectionErrorBoundary fallbackTitle="Erreur dans le Brief">
              <MissionBrief project={project} readOnly={!canEditBrief} />
            </SectionErrorBoundary>
          </div>

          <div className={cn("mt-0 min-w-0", activeTab !== 'process' && 'hidden')}>
            <SectionErrorBoundary fallbackTitle="Erreur dans le Process">
              <MissionProcess project={project} readOnly={!canEditProcess} />
            </SectionErrorBoundary>
          </div>

          <div className={cn("mt-0 min-w-0", activeTab !== 'sourcing' && 'hidden')}>
            <SectionErrorBoundary fallbackTitle="Erreur dans le Sourcing">
              <MissionSourcing project={project} />
            </SectionErrorBoundary>
          </div>

          <div className={cn("mt-0 min-w-0", activeTab !== 'pipeline' && 'hidden')}>
            <SectionErrorBoundary fallbackTitle="Erreur dans le Pipeline">
              <MissionPipeline project={project} />
            </SectionErrorBoundary>
          </div>

          <div className={cn("mt-0 min-w-0", activeTab !== 'outreach' && 'hidden')}>
            <SectionErrorBoundary fallbackTitle="Erreur dans l'Outreach">
              <MissionOutreach project={project} />
            </SectionErrorBoundary>
          </div>

          <div className={cn("mt-0 min-w-0", activeTab !== 'insights' && 'hidden')}>
            <SectionErrorBoundary fallbackTitle="Erreur dans les Insights">
              <MissionInsights project={project} />
            </SectionErrorBoundary>
          </div>
        </div>
      </main>

      <MissionCopilot project={project} activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default MissionWorkspace;
