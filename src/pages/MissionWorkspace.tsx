import React, { useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { SEOHead } from '@/components/SEOHead';
import { useSourcingProject, SourcingProject } from '@/hooks/useSourcingProjects';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import { ArrowLeft, Play, Pause, CheckCircle, Archive, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature } from '@/lib/featureGates';
import { useMissionReadiness } from '@/hooks/useMissionReadiness';
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
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { toast } from 'sonner';

// ── V2 (3 phases linéaires) — derrière feature flag mission_v2 ──
import { useFlag } from '@/lib/featureFlags';
import { MissionWorkspaceV2 } from '@/components/missions/v2/MissionWorkspaceV2';

// ── Status config ──

const statusConfig: Record<SourcingProject['status'], { label: string; dotColor: string; icon: typeof Play }> = {
  active: { label: 'Actif', dotColor: 'bg-success', icon: Play },
  paused: { label: 'En pause', dotColor: 'bg-warning', icon: Pause },
  completed: { label: 'Terminé', dotColor: 'bg-info', icon: CheckCircle },
  archived: { label: 'Archivé', dotColor: 'bg-muted-foreground', icon: Archive },
};

// All valid tab values
const allTabs = ['overview', 'brief', 'process', 'sourcing', 'outreach', 'pipeline', 'insights', 'config'];

// Animation variant for tab content
const tabVariants = {
  enter: { opacity: 0, y: 6 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

// ── Main component ──

const MissionWorkspace = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { orgType, organizationId } = useOrganization();

  // Feature flag : si mission_v2 actif, on utilise le nouveau parcours
  // (3 phases au lieu de 8 tabs). Toutes les vues internes sont
  // réutilisées telles quelles.
  // Pour activer : localStorage.setItem('konekt:flag:mission_v2', 'true')
  const useV2 = useFlag('mission_v2');

  const { data: project = null, isLoading } = useSourcingProject(id);

  const isOwnMission = project?.organization_id === organizationId;
  const canEditBrief = hasFeature(orgType, 'edit_brief') && isOwnMission;
  const canEditProcess = hasFeature(orgType, 'edit_process') && isOwnMission;

  const readiness = useMissionReadiness(project);

  const tabFromUrl = searchParams.get('tab');
  const activeTab = allTabs.includes(tabFromUrl || '') ? tabFromUrl! : 'overview';

  const setActiveTab = useCallback((tab: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleTabChange = useCallback((tab: string) => {
    const step = readiness.find(s => s.id === tab);
    if (step?.isLocked) {
      toast.info(step.blockerMessage || 'Complétez les étapes précédentes.');
      return;
    }
    setActiveTab(tab);
  }, [readiness, setActiveTab]);

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

  // ── V2 : nouveau parcours derrière feature flag ──
  // Branché APRÈS le check isLoading et AVANT le check !project pour
  // partager les mêmes états loading/not-found avec la v1.
  if (useV2 && project) {
    return (
      <>
        <SEOHead title={`${project.name} | Konekt`} description={`Mission ${project.name}`} />
        <MissionWorkspaceV2 project={project} />
      </>
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
    <div className="min-h-screen w-full max-w-full bg-background relative">
      <SEOHead title={`${project.name} | Konekt`} description={`Mission ${project.name}`} />
      <div className="py-4 pb-14 w-full max-w-full relative z-10">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          {/* Header — breadcrumb style */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-1.5 min-w-0 text-sm">
              <button
                onClick={() => navigate('/missions')}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0 font-medium"
              >
                Missions
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
              <h1 className="font-semibold text-foreground truncate min-w-0">
                {project.name}
              </h1>
              {project.client_name && (
                <>
                  <span className="text-muted-foreground/40 hidden sm:inline mx-1">·</span>
                  <span className="text-sm text-muted-foreground truncate hidden sm:inline min-w-0">{project.client_name}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("w-2 h-2 rounded-full", statusConfig[project.status].dotColor)} />
                {statusConfig[project.status].label}
              </span>
            </div>
          </div>

          {/* ── Unified tab bar ── */}
          <MissionProgressBar
            project={project}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            readiness={readiness}
          />

          {/* ── Tab content with animations ── */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              variants={tabVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="mt-4 min-w-0"
            >
              {activeTab === 'overview' && (
                <SectionErrorBoundary fallbackTitle="Erreur dans le Dashboard">
                  <MissionBentoDashboard project={project} onTabChange={handleTabChange} readiness={readiness} />
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
      </div>

      <MissionCopilot project={project} activeTab={activeTab} onTabChange={handleTabChange} readiness={readiness} />
    </div>
  );
};

export default MissionWorkspace;
