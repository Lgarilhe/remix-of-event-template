import React, { useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { Badge } from '@/components/ui/badge';
import { BackgroundPaths } from '@/components/ui/background-paths';
import { TextRotate } from '@/components/ui/text-rotate';
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
import { MissionConfig } from '@/components/missions/MissionConfig';
import { MissionCopilot } from '@/components/missions/MissionCopilot';
import { MissionProgressBar } from '@/components/missions/MissionProgressBar';
import { MissionBentoDashboard } from '@/components/missions/MissionBentoDashboard';
import { MissionAgentFAB } from '@/components/missions/MissionAgentFAB';
import { MissionAgentHelpCard } from '@/components/missions/MissionAgentHelpCard';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

// ── Status config ──

const statusConfig: Record<SourcingProject['status'], { label: string; color: string; icon: typeof Play }> = {
  active: { label: 'Actif', color: 'bg-green-100 text-green-700', icon: Play },
  paused: { label: 'En pause', color: 'bg-yellow-100 text-yellow-700', icon: Pause },
  completed: { label: 'Terminé', color: 'bg-blue-100 text-blue-700', icon: CheckCircle },
  archived: { label: 'Archivé', color: 'bg-gray-100 text-gray-500', icon: Archive },
};

// ── Tabs config (for secondary tabs) ──

const secondaryTabs = [
  { value: 'pipeline', label: 'Pipeline', emoji: '📊' },
  { value: 'insights', label: 'Insights', emoji: '💡' },
  { value: 'config', label: 'Config', emoji: '⚙️' },
];

// All valid tab values
const allTabs = ['overview', 'brief', 'process', 'sourcing', 'outreach', 'pipeline', 'insights', 'config'];

// Animation variant for tab content
const tabVariants = {
  enter: { opacity: 0, x: 12 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
};

// ── Main component ──

const MissionWorkspace = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { orgType, organizationId } = useOrganization();

  const { projects, isLoading } = useSourcingProjects();

  const project = useMemo(
    () => projects.find(p => p.id === id) || null,
    [projects, id]
  );

  const isOwnMission = project?.organization_id === organizationId;
  const canEditBrief = hasFeature(orgType, 'edit_brief') && isOwnMission;
  const canEditProcess = hasFeature(orgType, 'edit_process') && isOwnMission;

  const tabFromUrl = searchParams.get('tab');
  const activeTab = allTabs.includes(tabFromUrl || '') ? tabFromUrl! : 'overview';

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
  const isPrimaryTab = ['brief', 'process', 'sourcing', 'outreach'].includes(activeTab);

  return (
    <div className="min-h-screen w-full max-w-full bg-background relative">
      {/* Animated background paths */}
      <BackgroundPaths className="fixed inset-0 pointer-events-none z-0 opacity-40" pathCount={6} />

      <SEOHead title={`${project.name} | Skalr`} description={`Mission ${project.name}`} />
      <Navbar />
      <main className="pt-20 pb-14 w-full max-w-full relative z-10">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
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
                  <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                    {project.client_name}
                    <span className="text-foreground/20">·</span>
                    <TextRotate
                      texts={['En cours', 'Mission active', statusConfig[project.status].label]}
                      interval={4000}
                      rotationType="blur"
                      className="text-muted-foreground"
                    />
                  </p>
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

          {/* ── Progress bar (4 primary steps) ── */}
          <MissionProgressBar
            project={project}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />

          {/* ── Secondary tabs (Pipeline, Insights, Config) ── */}
          <div className="flex items-center border border-foreground border-t-0 bg-muted/20">
            {secondaryTabs.map((tab, index) => {
              const isActive = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={cn(
                    "flex items-center gap-1 h-[30px] px-3 text-[9px] font-medium uppercase tracking-wider transition-colors shrink-0",
                    index > 0 && "border-l border-foreground/10",
                    isActive
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="text-xs">{tab.emoji}</span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* ── Tab content with animations ── */}
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              variants={tabVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="mt-0 min-w-0"
            >
              {activeTab === 'overview' && (
                <SectionErrorBoundary fallbackTitle="Erreur dans le Dashboard">
                  <MissionBentoDashboard project={project} onTabChange={setActiveTab} />
                </SectionErrorBoundary>
              )}

              {activeTab === 'brief' && (
                <SectionErrorBoundary fallbackTitle="Erreur dans le Brief">
                  <MissionBrief project={project} readOnly={!canEditBrief} />
                </SectionErrorBoundary>
              )}

              {activeTab === 'process' && (
                <SectionErrorBoundary fallbackTitle="Erreur dans le Process">
                  <MissionProcess project={project} readOnly={!canEditProcess} />
                </SectionErrorBoundary>
              )}

              {activeTab === 'sourcing' && (
                <SectionErrorBoundary fallbackTitle="Erreur dans le Sourcing">
                  <MissionSourcing project={project} />
                </SectionErrorBoundary>
              )}

              {activeTab === 'pipeline' && (
                <SectionErrorBoundary fallbackTitle="Erreur dans le Pipeline">
                  <MissionPipeline project={project} />
                </SectionErrorBoundary>
              )}

              {activeTab === 'outreach' && (
                <SectionErrorBoundary fallbackTitle="Erreur dans l'Outreach">
                  <MissionOutreach project={project} />
                </SectionErrorBoundary>
              )}

              {activeTab === 'insights' && (
                <SectionErrorBoundary fallbackTitle="Erreur dans les Insights">
                  <MissionInsights project={project} />
                </SectionErrorBoundary>
              )}

              {activeTab === 'config' && (
                <SectionErrorBoundary fallbackTitle="Erreur dans la Config">
                  <MissionConfig project={project} readOnly={!canEditBrief} />
                </SectionErrorBoundary>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      <MissionCopilot project={project} activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default MissionWorkspace;
