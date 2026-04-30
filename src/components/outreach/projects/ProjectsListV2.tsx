/**
 * ProjectsListV2 — Liste des missions refondue (cohérente avec la DA v2).
 *
 * Tri narratif :
 *   ⚡ Demandent ton attention   (réponses à traiter, briefs incomplets, sourcing en attente)
 *   📍 En cours                  (missions actives normales)
 *   📦 Terminées / archivées     (collapsable)
 *
 * Header avec titre Outfit + KPI strip + CTA gradient Skalr.
 * Cards de mission avec :
 *   - Next-step explicite (bouton ciblé)
 *   - Status pill colorée
 *   - KPIs inline (Sourcés / Contactés / Réponses)
 *   - Hover lift subtil
 *
 * Réutilise tous les hooks existants — aucun changement métier.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Plus, Search, Sparkles, Briefcase, MapPin, Building2, MoreVertical,
  Play, Pause, CheckCircle, Archive, Trash2, ArrowRight, ChevronDown,
  ChevronUp, Zap, MessageSquare, FileText, AlertCircle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { useQuotaGate } from '@/hooks/useQuotaGate';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { useMultipleProjectStats, ProjectStats } from '@/hooks/useProjectStats';
import { UnifiedProject, mergeProjectsAndJobs } from '@/types/projects';
import { useOrganization } from '@/hooks/useOrganization';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CreateProjectModal } from './CreateProjectModal';
import { EmptyMissionState } from '@/components/missions/EmptyMissionState';
import { Pill } from '@/components/missions/v2/Pill';

// ── Types ──

const STATUS_CONFIG: Record<string, {
  label: string; color: string; icon: typeof Play;
}> = {
  active: { label: 'Actif', color: 'hsl(var(--status-success))', icon: Play },
  paused: { label: 'En pause', color: 'hsl(var(--status-warning))', icon: Pause },
  completed: { label: 'Terminé', color: 'hsl(var(--status-info))', icon: CheckCircle },
  archived: { label: 'Archivé', color: 'hsl(var(--muted-foreground))', icon: Archive },
};

// ── Next-step computation per project ──

interface NextStep {
  label: string;
  cta: string;
  targetTab: string;
  urgency: 'high' | 'medium' | 'low';
  icon: typeof FileText;
}

function computeNextStep(
  project: UnifiedProject,
  stats: ProjectStats,
): NextStep | null {
  const sp = project.sourcingProject;
  // Pas de sourcing project (mission Notion seule) → CTA pour démarrer
  if (!sp) {
    return {
      label: 'Démarrer la mission',
      cta: 'Commencer',
      targetTab: 'overview',
      urgency: 'medium',
      icon: Play,
    };
  }

  const filtersOk = sp.filters_snapshot && Object.keys(sp.filters_snapshot).length > 0;
  const briefOk = !!(sp.job_details as any)?.title;

  // Réponses non traitées = urgent
  if (stats.shortlisted > 0 && stats.untreated >= 1) {
    return {
      label: `${stats.untreated} candidat${stats.untreated > 1 ? 's' : ''} sourcé${stats.untreated > 1 ? 's' : ''} non contacté${stats.untreated > 1 ? 's' : ''}`,
      cta: 'Contacter',
      targetTab: 'outreach',
      urgency: 'high',
      icon: MessageSquare,
    };
  }
  // Brief incomplet
  if (!briefOk) {
    return {
      label: 'Brief incomplet',
      cta: 'Compléter',
      targetTab: 'brief',
      urgency: 'high',
      icon: FileText,
    };
  }
  // Brief OK mais pas de filtres → analyse IA à lancer
  if (!filtersOk) {
    return {
      label: 'Filtres à générer',
      cta: 'Analyser le brief',
      targetTab: 'brief',
      urgency: 'medium',
      icon: Sparkles,
    };
  }
  // Filtres OK, mais pas encore de sourcing
  if (stats.total === 0) {
    return {
      label: 'Sourcing en attente',
      cta: 'Lancer le sourcing',
      targetTab: 'sourcing',
      urgency: 'medium',
      icon: Search,
    };
  }
  // Candidats sourcés mais pas messagés
  if (stats.total > 0 && stats.messaged === 0) {
    return {
      label: `${stats.total} profil${stats.total > 1 ? 's' : ''} à contacter`,
      cta: 'Outreach',
      targetTab: 'outreach',
      urgency: 'medium',
      icon: Zap,
    };
  }
  // Tout en cours → suivi pipeline
  if (stats.messaged > 0) {
    return {
      label: `${stats.messaged} contacté${stats.messaged > 1 ? 's' : ''} · ${stats.shortlisted} qualifié${stats.shortlisted > 1 ? 's' : ''}`,
      cta: 'Pipeline',
      targetTab: 'pipeline',
      urgency: 'low',
      icon: Briefcase,
    };
  }
  return null;
}

// Détermine quelle "section narrative" reçoit la mission
function getNarrativeBucket(
  project: UnifiedProject,
  step: NextStep | null,
): 'attention' | 'progress' | 'archive' {
  if (project.status === 'completed' || project.status === 'archived') return 'archive';
  if (step?.urgency === 'high') return 'attention';
  return 'progress';
}

// ── Mission Card ──

interface MissionCardProps {
  project: UnifiedProject;
  stats: ProjectStats;
  step: NextStep | null;
  onClick: (tab?: string) => void;
  onStatusChange: (status: SourcingProject['status']) => void;
  onDelete: () => void;
  canDelete: boolean;
}

const MissionCard: React.FC<MissionCardProps> = ({
  project, stats, step, onClick, onStatusChange, onDelete, canDelete,
}) => {
  const StepIcon = step?.icon || ArrowRight;
  const statusCfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.active;
  const isAttention = step?.urgency === 'high';

  const lastActivity = project.lastSearchAt || project.createdAt;
  const lastActivityLabel = formatDistanceToNow(new Date(lastActivity), { addSuffix: true, locale: fr });

  return (
    <div
      className={cn(
        'group bg-card border rounded-xl p-4 transition-all duration-200 cursor-pointer',
        'hover:border-foreground/30 hover:shadow-md hover:-translate-y-px',
        isAttention ? 'border-warning/40' : 'border-border',
      )}
      onClick={() => onClick()}
      style={isAttention ? { background: 'linear-gradient(135deg, hsl(var(--card)), hsl(var(--status-warning-muted) / 0.4))' } : undefined}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        {/* Icon */}
        <div
          className={cn(
            'h-10 w-10 rounded-lg grid place-items-center flex-shrink-0',
            isAttention ? '' : 'bg-muted',
          )}
          style={isAttention
            ? { background: 'hsl(var(--status-warning-muted))', color: 'hsl(var(--status-warning))' }
            : { color: 'hsl(var(--muted-foreground))' }
          }
        >
          <Briefcase className="w-4 h-4" strokeWidth={2} />
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-semibold text-[14px] truncate">{project.name}</h3>
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: `${statusCfg.color}1a`, color: statusCfg.color }}
            >
              <span className="h-1 w-1 rounded-full" style={{ background: statusCfg.color }} />
              {statusCfg.label}
            </span>
          </div>

          <p className="text-[12px] text-muted-foreground inline-flex items-center gap-2 flex-wrap mb-2">
            {project.clientName && (
              <>
                <span className="inline-flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> {project.clientName}
                </span>
                {project.location && <span className="text-muted-foreground/40">·</span>}
              </>
            )}
            {project.location && (
              <>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {project.location}
                </span>
                <span className="text-muted-foreground/40">·</span>
              </>
            )}
            <span className="text-[11px]">Mise à jour {lastActivityLabel}</span>
          </p>

          {/* Inline KPI strip */}
          {project.sourcingProject && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-3">
              <KpiInline label="Sourcés" value={stats.total} />
              <KpiInline label="Contactés" value={stats.messaged} />
              <KpiInline label="Réponses" value={stats.shortlisted} highlight={stats.shortlisted > 0} />
            </div>
          )}

          {/* Next-step row */}
          {step && (
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 text-[11px]',
                  isAttention ? 'font-medium' : 'text-muted-foreground',
                )}
                style={isAttention ? { color: 'hsl(var(--status-warning))' } : undefined}
              >
                {isAttention && <AlertCircle className="w-3 h-3" />}
                {step.label}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick(step.targetTab);
                }}
                className={cn(
                  'h-7 px-3 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 transition-colors ml-auto',
                  isAttention
                    ? 'bg-foreground text-background hover:opacity-90'
                    : 'bg-card border border-border hover:bg-accent text-foreground',
                )}
              >
                <StepIcon className="w-3 h-3" />
                {step.cta}
                <ArrowRight className="w-3 h-3" strokeWidth={2.5} />
              </button>
            </div>
          )}
        </div>

        {/* More menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              aria-label="Plus d'actions"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {project.status !== 'active' && (
              <DropdownMenuItem onClick={() => onStatusChange('active')}>
                <Play className="w-3.5 h-3.5 mr-2" /> Activer
              </DropdownMenuItem>
            )}
            {project.status !== 'paused' && (
              <DropdownMenuItem onClick={() => onStatusChange('paused')}>
                <Pause className="w-3.5 h-3.5 mr-2" /> Mettre en pause
              </DropdownMenuItem>
            )}
            {project.status !== 'completed' && (
              <DropdownMenuItem onClick={() => onStatusChange('completed')}>
                <CheckCircle className="w-3.5 h-3.5 mr-2" /> Marquer terminée
              </DropdownMenuItem>
            )}
            {project.status !== 'archived' && (
              <DropdownMenuItem onClick={() => onStatusChange('archived')}>
                <Archive className="w-3.5 h-3.5 mr-2" /> Archiver
              </DropdownMenuItem>
            )}
            {canDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Supprimer
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

const KpiInline: React.FC<{ label: string; value: number; highlight?: boolean }> = ({
  label, value, highlight,
}) => (
  <span className="inline-flex items-baseline gap-1">
    <span
      className={cn(
        'font-display font-bold tabular-nums text-[13px] leading-none',
        highlight ? '' : value === 0 ? 'text-muted-foreground/40' : 'text-foreground',
      )}
      style={highlight && value > 0 ? { color: 'hsl(var(--status-success))' } : undefined}
    >
      {value}
    </span>
    <span className="text-[10px] text-muted-foreground">{label}</span>
  </span>
);

// ─────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────

export const ProjectsListV2: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projects: sourcingProjects, isLoading: spLoading, deleteProject, updateProject, createProject } = useSourcingProjects();
  const { data: notionJobs = [], isLoading: jobsLoading } = useNotionJobs();
  const { canCreateJob } = useQuotaGate();

  const [searchQuery, setSearchQuery] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createInitialTab, setCreateInitialTab] = useState<string | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<UnifiedProject | null>(null);

  // Honor ?create=mode deep links (rétrocompat)
  useEffect(() => {
    const createMode = searchParams.get('create');
    if (createMode && ['brief', 'import', 'manual'].includes(createMode)) {
      setCreateInitialTab(createMode);
      setShowCreateModal(true);
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.delete('create');
        return next;
      }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const unifiedProjects = useMemo(
    () => mergeProjectsAndJobs(notionJobs, sourcingProjects),
    [notionJobs, sourcingProjects],
  );

  const spIds = useMemo(
    () => unifiedProjects.map(p => p.sourcingProject?.id).filter((id): id is string => !!id),
    [unifiedProjects],
  );
  const { data: projectStats = {} } = useMultipleProjectStats(spIds);

  const getStats = (project: UnifiedProject): ProjectStats => {
    if (project.sourcingProject) {
      return projectStats[project.sourcingProject.id] || {
        total: project.sourcingProject.stats_total_found,
        scored: project.sourcingProject.stats_scored,
        messaged: project.sourcingProject.stats_messaged,
        shortlisted: project.sourcingProject.stats_shortlisted,
        dismissed: project.sourcingProject.stats_dismissed,
        untreated: 0,
      };
    }
    return { total: 0, scored: 0, messaged: 0, shortlisted: 0, dismissed: 0, untreated: 0 };
  };

  // Filter by search query
  const filtered = useMemo(() => unifiedProjects.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q)
      || p.clientName?.toLowerCase().includes(q)
      || p.location?.toLowerCase().includes(q)
      || p.skills.some(s => s.toLowerCase().includes(q))
    );
  }), [unifiedProjects, searchQuery]);

  // Group by narrative bucket
  const buckets = useMemo(() => {
    const attention: { project: UnifiedProject; stats: ProjectStats; step: NextStep | null }[] = [];
    const progress: typeof attention = [];
    const archive: typeof attention = [];

    filtered.forEach(p => {
      const stats = getStats(p);
      const step = computeNextStep(p, stats);
      const bucket = getNarrativeBucket(p, step);
      const entry = { project: p, stats, step };
      if (bucket === 'attention') attention.push(entry);
      else if (bucket === 'progress') progress.push(entry);
      else archive.push(entry);
    });

    // Sort each bucket by recency
    const byRecency = (a: typeof attention[0], b: typeof attention[0]) => {
      const aDate = a.project.lastSearchAt || a.project.createdAt;
      const bDate = b.project.lastSearchAt || b.project.createdAt;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    };
    attention.sort(byRecency);
    progress.sort(byRecency);
    archive.sort(byRecency);

    return { attention, progress, archive };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, projectStats]);

  // Global KPIs
  const globalKpis = useMemo(() => {
    let activeMissions = 0;
    let totalSourced = 0;
    let totalToContact = 0;
    let totalResponses = 0;
    unifiedProjects.forEach(p => {
      if (p.status === 'active') activeMissions++;
      const s = getStats(p);
      totalSourced += s.total;
      totalToContact += s.untreated;
      totalResponses += s.shortlisted;
    });
    return { activeMissions, totalSourced, totalToContact, totalResponses };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unifiedProjects, projectStats]);

  // Navigate
  const navigateToWorkspace = useCallback(async (project: UnifiedProject, tab?: string) => {
    let spId = project.sourcingProject?.id;

    if (!spId && project.source === 'notion' && project.job) {
      try {
        const newProject = await createProject({
          name: project.job.title,
          job_id: project.job.id,
          job_title: project.job.title,
          client_name: project.job.client?.name,
          description: project.description || undefined,
        });
        spId = newProject?.id;
      } catch {
        const { toast } = await import('sonner');
        toast.error('Impossible de créer la mission');
        return;
      }
    }

    if (!spId) return;
    navigate(`/missions/${spId}${tab ? `?tab=${tab}` : ''}`);
  }, [createProject, navigate]);

  const handleStatusChange = (project: UnifiedProject) => async (newStatus: SourcingProject['status']) => {
    if (project.sourcingProject) {
      await updateProject({ id: project.sourcingProject.id, status: newStatus });
    }
  };

  const isLoading = spLoading || jobsLoading;

  // Empty state if no missions at all
  if (!isLoading && unifiedProjects.length === 0) {
    return (
      <>
        <EmptyMissionState
          onCreateAI={() => { setCreateInitialTab('brief'); setShowCreateModal(true); }}
          onCreateManual={() => { setCreateInitialTab('manual'); setShowCreateModal(true); }}
        />
        {showCreateModal && (
          <CreateProjectModal
            isOpen={showCreateModal}
            onClose={() => { setShowCreateModal(false); setCreateInitialTab(undefined); }}
            initialTab={createInitialTab}
          />
        )}
      </>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto w-full">
      {/* ── Hero header ── */}
      <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">
            Tableau de bord
          </p>
          <h1 className="font-display text-[26px] sm:text-[30px] font-bold leading-tight">
            Tes missions{' '}
            <span className="font-editorial italic font-normal text-muted-foreground">
              en cours
            </span>
          </h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            {globalKpis.activeMissions} mission{globalKpis.activeMissions > 1 ? 's' : ''} active{globalKpis.activeMissions > 1 ? 's' : ''}
            {buckets.attention.length > 0 && (
              <>
                <span className="mx-1.5">·</span>
                <span className="font-medium" style={{ color: 'hsl(var(--status-warning))' }}>
                  {buckets.attention.length} demande{buckets.attention.length > 1 ? 'nt' : ''} ton attention
                </span>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!canCreateJob) {
              import('sonner').then(({ toast }) => toast.error("Quota de missions atteint"));
              return;
            }
            setCreateInitialTab('brief');
            setShowCreateModal(true);
          }}
          className="h-10 px-5 rounded-full text-[13px] font-semibold text-white inline-flex items-center gap-2 konekt-skalr-bg konekt-shine transition-transform active:scale-[0.97] flex-shrink-0"
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          Nouvelle mission
        </button>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Missions actives" value={globalKpis.activeMissions} />
        <KpiCard label="Sourcés au total" value={globalKpis.totalSourced} />
        <KpiCard label="À contacter" value={globalKpis.totalToContact} highlight={globalKpis.totalToContact > 0 ? 'warning' : undefined} />
        <KpiCard label="Réponses reçues" value={globalKpis.totalResponses} highlight={globalKpis.totalResponses > 0 ? 'success' : undefined} />
      </div>

      {/* ── Search bar ── */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Rechercher une mission, un client, un poste…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 pl-9 bg-card border-border"
        />
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-card border border-border rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* ── Section : Demandent ton attention ── */}
      {!isLoading && buckets.attention.length > 0 && (
        <Section
          title="Demandent ton attention"
          subtitle={`${buckets.attention.length} mission${buckets.attention.length > 1 ? 's' : ''} avec une action urgente`}
          icon="⚡"
        >
          {buckets.attention.map(({ project, stats, step }) => (
            <MissionCard
              key={project.key}
              project={project}
              stats={stats}
              step={step}
              onClick={(tab) => navigateToWorkspace(project, tab)}
              onStatusChange={handleStatusChange(project)}
              onDelete={() => setDeleteTarget(project)}
              canDelete={!!project.sourcingProject}
            />
          ))}
        </Section>
      )}

      {/* ── Section : En cours ── */}
      {!isLoading && buckets.progress.length > 0 && (
        <Section
          title="En cours"
          subtitle={`${buckets.progress.length} mission${buckets.progress.length > 1 ? 's' : ''} active${buckets.progress.length > 1 ? 's' : ''}`}
          icon="📍"
        >
          {buckets.progress.map(({ project, stats, step }) => (
            <MissionCard
              key={project.key}
              project={project}
              stats={stats}
              step={step}
              onClick={(tab) => navigateToWorkspace(project, tab)}
              onStatusChange={handleStatusChange(project)}
              onDelete={() => setDeleteTarget(project)}
              canDelete={!!project.sourcingProject}
            />
          ))}
        </Section>
      )}

      {/* ── Section : Archive (collapsable) ── */}
      {!isLoading && buckets.archive.length > 0 && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowArchive(s => !s)}
            className="w-full flex items-center justify-between text-left mb-3 hover:bg-muted/40 px-2 py-1.5 rounded-md transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-base">📦</span>
              <div>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
                  Terminées · archivées
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  {buckets.archive.length} mission{buckets.archive.length > 1 ? 's' : ''}
                </p>
              </div>
            </div>
            {showArchive ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {showArchive && (
            <div className="space-y-2">
              {buckets.archive.map(({ project, stats, step }) => (
                <MissionCard
                  key={project.key}
                  project={project}
                  stats={stats}
                  step={step}
                  onClick={(tab) => navigateToWorkspace(project, tab)}
                  onStatusChange={handleStatusChange(project)}
                  onDelete={() => setDeleteTarget(project)}
                  canDelete={!!project.sourcingProject}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* No results after filtering */}
      {!isLoading && filtered.length === 0 && unifiedProjects.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <Search className="w-8 h-8 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm font-medium mb-1">Aucune mission trouvée</p>
          <p className="text-xs text-muted-foreground">
            Essaye avec d'autres mots-clés ou efface la recherche.
          </p>
        </div>
      )}

      {/* ── Modals ── */}
      {showCreateModal && (
        <CreateProjectModal
          isOpen={showCreateModal}
          onClose={() => { setShowCreateModal(false); setCreateInitialTab(undefined); }}
          initialTab={createInitialTab}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette mission ?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" sera supprimée définitivement avec tous ses candidats sourcés et messages.
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deleteTarget?.sourcingProject) {
                  await deleteProject(deleteTarget.sourcingProject.id);
                }
                setDeleteTarget(null);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ─── Sub-components ──────────────────────────────────────────────

const Section: React.FC<{
  title: string;
  subtitle: string;
  icon: string;
  children: React.ReactNode;
}> = ({ title, subtitle, icon, children }) => (
  <div className="mb-6">
    <div className="flex items-center gap-2 mb-3">
      <span className="text-base">{icon}</span>
      <div>
        <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
          {title}
        </p>
        <p className="text-[10px] text-muted-foreground/70">{subtitle}</p>
      </div>
    </div>
    <div className="space-y-2">{children}</div>
  </div>
);

const KpiCard: React.FC<{
  label: string;
  value: number;
  highlight?: 'success' | 'warning';
}> = ({ label, value, highlight }) => {
  const highlightColor =
    highlight === 'success' ? 'hsl(var(--status-success))'
    : highlight === 'warning' ? 'hsl(var(--status-warning))'
    : undefined;

  return (
    <div className="bg-card border border-border rounded-lg px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <p
        className="font-display text-[22px] font-bold tabular-nums leading-none"
        style={highlightColor && value > 0 ? { color: highlightColor } : undefined}
      >
        {value}
      </p>
    </div>
  );
};
