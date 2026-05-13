/**
 * MissionWorkspaceV2 — Nouveau parcours mission à 3 phases.
 *
 * Remplace les 8 tabs actuelles (overview/brief/process/sourcing/outreach/
 * pipeline/insights/config) par 3 phases linéaires :
 *
 *   Phase 1 — Cadrage : Brief / Process / Config (sous-onglets)
 *   Phase 2 — Sourcing & Outreach : Sourcing / Outreach (sous-onglets)
 *   Phase 3 — Pipeline : Pipeline / Insights (sous-onglets)
 *
 * IMPORTANT : ce composant ne change RIEN au métier. Il importe et
 * compose les composants existants (MissionBrief, MissionSourcing, etc.)
 * tels quels. Aucun hook, aucune action, aucune feature n'est touchée.
 *
 * Architecture :
 *   ┌─ Header breadcrumb ─────────────────────────────────┐
 *   │ Missions / Senior React Engineer · Doctolib   • Actif│
 *   ├─ PhaseStepper ──────────────────────────────────────┤
 *   │ ① Cadrage  ──  ② Sourcing & Outreach  ──  ③ Pipeline│
 *   ├─ Sub-tabs (selon la phase courante) ────────────────┤
 *   │ Brief · Process · Config                             │
 *   ├──────────────────────────────────────────────────────┤
 *   │                                                      │
 *   │   Vue active (composant existant)                    │
 *   │                                                      │
 *   └──────────────────────────────────────────────────────┘
 *
 * Note : le copilot IA est accessible via le bouton flottant 👁
 * en bas à droite (pas un rail latéral persistant).
 */

import React, { useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hasFeature } from '@/lib/featureGates';
import { useOrganization } from '@/hooks/useOrganization';
import { useMissionReadiness } from '@/hooks/useMissionReadiness';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { toast } from 'sonner';

import { MissionBentoDashboard } from '@/components/missions/MissionBentoDashboard';
import { MissionBrief } from '@/components/missions/MissionBrief';
import { MissionProcess } from '@/components/missions/MissionProcess';
import { MissionConfig } from '@/components/missions/MissionConfig';
import { MissionSourcing } from '@/components/missions/MissionSourcing';
import { MissionOutreach } from '@/components/missions/MissionOutreach';
import { MissionPipeline } from '@/components/missions/MissionPipeline';
import { MissionInsights } from '@/components/missions/MissionInsights';

import { PhaseStepper, PhaseId } from './PhaseStepper';
import { MissionOverviewV2 } from './MissionOverviewV2';
import { MissionBriefV2 } from './MissionBriefV2';
import { MissionProcessV2 } from './MissionProcessV2';
import { MissionConfigV2 } from './MissionConfigV2';

// ── Mapping ancien tab → phase + sous-onglet ───────────────────────
// Pour préserver la rétrocompat des deep links (?tab=brief continue de
// marcher en redirigeant vers ?phase=1&sub=brief).
type SubTab =
  | 'overview' // phase 1, vue par défaut (dashboard)
  | 'brief'    // phase 1
  | 'process'  // phase 1
  | 'config'   // phase 1
  | 'sourcing' // phase 2
  | 'outreach' // phase 2
  | 'pipeline' // phase 3
  | 'insights'; // phase 3

const SUB_TO_PHASE: Record<SubTab, PhaseId> = {
  overview: 1,
  brief: 1,
  process: 1,
  config: 1,
  sourcing: 2,
  outreach: 2,
  pipeline: 3,
  insights: 3,
};

const PHASE_SUBS: Record<PhaseId, { id: SubTab; label: string }[]> = {
  1: [
    { id: 'overview', label: 'Vue d\'ensemble' },
    { id: 'brief', label: 'Brief' },
    { id: 'process', label: 'Process' },
    { id: 'config', label: 'Configuration' },
  ],
  2: [
    { id: 'sourcing', label: 'Sourcing' },
    { id: 'outreach', label: 'Outreach' },
  ],
  3: [
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'insights', label: 'Insights' },
  ],
};

const ALL_SUBS: SubTab[] = [
  'overview', 'brief', 'process', 'config',
  'sourcing', 'outreach', 'pipeline', 'insights',
];

// Sub-tabs qui doivent être limités en largeur pour rester lisibles
// (forms / dashboards). Les autres (sourcing/pipeline) prennent toute
// la largeur pour exploiter l'espace (filtres + grille / kanban).
const NARROW_SUBS = new Set<SubTab>([
  'overview', 'brief', 'process', 'config', 'outreach', 'insights',
]);

const tabVariants = {
  enter: { opacity: 0, y: 6 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

// ── Status dot ──
const STATUS_DOT: Record<SourcingProject['status'], { color: string; label: string }> = {
  active: { color: 'bg-success', label: 'Actif' },
  paused: { color: 'bg-warning', label: 'En pause' },
  completed: { color: 'bg-info', label: 'Terminé' },
  archived: { color: 'bg-muted-foreground', label: 'Archivé' },
};

export interface MissionWorkspaceV2Props {
  project: SourcingProject;
}

export const MissionWorkspaceV2: React.FC<MissionWorkspaceV2Props> = ({ project }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { orgType, organizationId } = useOrganization();

  const isOwnMission = project.organization_id === organizationId;
  const canEditBrief = hasFeature(orgType, 'edit_brief') && isOwnMission;
  const canEditProcess = hasFeature(orgType, 'edit_process') && isOwnMission;

  const readiness = useMissionReadiness(project);

  // Lit le sous-tab depuis ?tab=, fallback overview (rétrocompat avec
  // les anciens deep links).
  const tabFromUrl = searchParams.get('tab');
  const activeSub: SubTab = ALL_SUBS.includes((tabFromUrl || '') as SubTab)
    ? (tabFromUrl as SubTab)
    : 'overview';
  const activePhase: PhaseId = SUB_TO_PHASE[activeSub];

  const setActiveSub = useCallback((sub: SubTab) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', sub);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleSubChange = useCallback((sub: SubTab) => {
    const step = readiness.find(s => s.id === sub);
    if (step?.isLocked) {
      toast.info(step.blockerMessage || 'Complétez les étapes précédentes.');
      return;
    }
    setActiveSub(sub);
  }, [readiness, setActiveSub]);

  // Quand l'user clique sur une phase → on saute au PREMIER sous-tab non-locké de cette phase
  const handlePhaseChange = useCallback((phase: PhaseId) => {
    const subs = PHASE_SUBS[phase];
    // Trouve le 1er sous-tab non-locké
    const firstAvailable = subs.find(s => !readiness.find(r => r.id === s.id)?.isLocked);
    if (!firstAvailable) {
      toast.info('Complétez les étapes précédentes pour débloquer cette phase.');
      return;
    }
    setActiveSub(firstAvailable.id);
  }, [readiness, setActiveSub]);

  // Détermine si une phase entière est lockée (= tous ses sous-tabs lockés)
  const isPhaseLocked = useCallback((phase: PhaseId): boolean => {
    const subs = PHASE_SUBS[phase];
    return subs.every(s => readiness.find(r => r.id === s.id)?.isLocked === true);
  }, [readiness]);

  const subsForActivePhase = useMemo(() => PHASE_SUBS[activePhase], [activePhase]);

  return (
    <div className="h-screen w-full max-w-full bg-background relative flex flex-col overflow-hidden">
      {/* ── Header breadcrumb (compact) ── */}
      <div className="border-b border-border px-4 sm:px-5 h-11 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0 text-sm">
          <button
            onClick={() => navigate('/missions')}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 font-medium"
          >
            Missions
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
          <h1 className="font-semibold text-foreground truncate min-w-0">{project.name}</h1>
          {project.client_name && (
            <>
              <span className="text-muted-foreground/40 hidden sm:inline mx-1">·</span>
              <span className="text-sm text-muted-foreground truncate hidden sm:inline min-w-0">
                {project.client_name}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn('w-2 h-2 rounded-full', STATUS_DOT[project.status].color)} />
            {STATUS_DOT[project.status].label}
          </span>
        </div>
      </div>

      {/* ── PhaseStepper ── (pill "Sourcing actif" retirée — duplique l'info
          déjà donnée par le highlight de la phase 2 dans le stepper, et
          créait du bruit visuel à côté du statut global "Terminé"/"Actif"). */}
      <PhaseStepper
        active={activePhase}
        onSelect={handlePhaseChange}
        isPhaseLocked={isPhaseLocked}
      />

      {/* ── Sub-tabs de la phase courante ── */}
      <div className="border-b border-border bg-background px-4 sm:px-5 flex items-center gap-1 overflow-x-auto scrollbar-hide flex-shrink-0">
        {subsForActivePhase.map(sub => {
          const isActive = sub.id === activeSub;
          const step = readiness.find(s => s.id === sub.id);
          const locked = step?.isLocked === true;
          return (
            <button
              key={sub.id}
              type="button"
              onClick={() => handleSubChange(sub.id)}
              disabled={locked}
              className={cn(
                'px-3 py-1.5 text-[13px] font-medium border-b-2 transition-colors flex-shrink-0',
                isActive
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
                locked && 'opacity-40 cursor-not-allowed',
              )}
            >
              {sub.label}
              {locked && <span className="ml-1.5 text-[10px]">🔒</span>}
            </button>
          );
        })}
      </div>

      {/* ── Body : main content (le copilot est accessible via le bouton flottant en bas à droite) ── */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto min-w-0">
          <div
            className={cn(
              'px-3 sm:px-6 lg:px-8 py-2 sm:py-3',
              // Brief, Process & Config : layout 1280px max, aligné à gauche.
              // Form principal + sidebar sticky (auto-save / KPI / conseils).
              (activeSub === 'brief' || activeSub === 'process' || activeSub === 'config') && 'max-w-[1280px] w-full',
              // Autres forms/dashboards : 960px centrés (lecture confortable)
              NARROW_SUBS.has(activeSub)
                && activeSub !== 'brief'
                && activeSub !== 'process'
                && activeSub !== 'config'
                && 'max-w-[960px] mx-auto w-full',
              // Sourcing/Pipeline : pleine largeur (filtres + grille)
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeSub}
                variants={tabVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="min-w-0"
              >
                {activeSub === 'overview' && (
                  <SectionErrorBoundary fallbackTitle="Erreur dans la Vue d'ensemble">
                    <MissionOverviewV2 project={project} onNavigateToSub={handleSubChange} />
                  </SectionErrorBoundary>
                )}
                {activeSub === 'brief' && (
                  <SectionErrorBoundary fallbackTitle="Erreur dans le Brief">
                    <MissionBriefV2 project={project} readOnly={!canEditBrief} />
                  </SectionErrorBoundary>
                )}
                {activeSub === 'process' && (
                  <SectionErrorBoundary fallbackTitle="Erreur dans le Process">
                    <MissionProcessV2 project={project} readOnly={!canEditProcess} />
                  </SectionErrorBoundary>
                )}
                {activeSub === 'config' && (
                  <SectionErrorBoundary fallbackTitle="Erreur dans la Config">
                    <MissionConfigV2 project={project} readOnly={!canEditBrief} />
                  </SectionErrorBoundary>
                )}
                {activeSub === 'sourcing' && (
                  <SectionErrorBoundary fallbackTitle="Erreur dans le Sourcing">
                    <MissionSourcing project={project} />
                  </SectionErrorBoundary>
                )}
                {activeSub === 'outreach' && (
                  <SectionErrorBoundary fallbackTitle="Erreur dans l'Outreach">
                    <MissionOutreach project={project} />
                  </SectionErrorBoundary>
                )}
                {activeSub === 'pipeline' && (
                  <SectionErrorBoundary fallbackTitle="Erreur dans le Pipeline">
                    <MissionPipeline project={project} />
                  </SectionErrorBoundary>
                )}
                {activeSub === 'insights' && (
                  <SectionErrorBoundary fallbackTitle="Erreur dans les Insights">
                    <MissionInsights project={project} />
                  </SectionErrorBoundary>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

      </div>
    </div>
  );
};
