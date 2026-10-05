/**
 * /pipeline — le pipeline global : tous les candidats, toutes missions
 * confondues (revue design, lot 7a).
 *
 * Quatre affichages : colonnes (glisser-déposer, au clavier aussi, et menu
 * « Déplacer vers… » sur chaque carte), tableau, chronologie et analyse.
 * Chaque affichage a ses états : squelette, erreur avec « Réessayer », vide
 * avec l'action qui le remplit, vide dû aux filtres avec « Effacer les
 * filtres » (01-direction, § 8).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, Bell, Columns3, History, RefreshCw, Rows3, SearchX } from 'lucide-react';
import { toast } from 'sonner';
import { SEOHead } from '@/components/SEOHead';
import { EmptyState, ErrorState, PageHeader, PageLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ATSKanban } from '@/components/ats/ATSKanban';
import { ATSTable } from '@/components/ats/ATSTable';
import { ATSTimeline, ATSTimelineSkeleton } from '@/components/ats/ATSTimeline';
import { ATSPipelineAnalytics, ATSPipelineAnalyticsSkeleton } from '@/components/ats/ATSPipelineAnalytics';
import { ATSFilters, type ATSFiltersValue } from '@/components/ats/ATSFilters';
import { ATSStats } from '@/components/ats/ATSStats';
import { ATSKanbanSkeleton } from '@/components/ats/ATSKanbanSkeleton';
import { ATSTableSkeleton } from '@/components/ats/ATSTableSkeleton';
import { ATSStatsSkeleton } from '@/components/ats/ATSStatsSkeleton';
import { RemindersSidebar } from '@/components/ats/RemindersSidebar';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { JobDetailSheet } from '@/components/ats/JobDetailSheet';
import { BulkActionsBar, type BulkMoveResult } from '@/components/ats/BulkActionsBar';
import { useATSData, ATS_STAGES, type ATSCandidate } from '@/hooks/useATSData';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/plural';

type PipelineView = 'kanban' | 'table' | 'timeline' | 'analytics';

/** Affichages de la page ; la valeur est celle de `?view=` (liens et favoris existants). */
const VIEWS: { value: PipelineView; label: string; icon: React.ElementType }[] = [
  { value: 'kanban', label: 'Colonnes', icon: Columns3 },
  { value: 'table', label: 'Tableau', icon: Rows3 },
  { value: 'timeline', label: 'Chronologie', icon: History },
  { value: 'analytics', label: 'Analyse', icon: BarChart3 },
];

const parseView = (value: string | null): PipelineView =>
  VIEWS.some((v) => v.value === value) ? (value as PipelineView) : 'kanban';

const EMPTY_FILTERS: ATSFiltersValue = { search: '', stage: [], source: [], job: [], tag: [], hasReminder: false };

export default function ATS() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeView, _setActiveView] = useState<PipelineView>(() => parseView(searchParams.get('view')));

  // Deep-link support : ?candidate=ID (+ optionnel ?tab=evaluation&prepareInterview=1)
  // pour ouvrir la modale d'un candidat depuis le calendar/inbox/dashboard.
  const deepLinkCandidateId = searchParams.get('candidate');
  const deepLinkTab = searchParams.get('tab');
  const deepLinkPrepare = searchParams.get('prepareInterview') === '1';

  // Sync view → URL pour bookmark / partage de lien direct
  const setActiveView = useCallback(
    (next: PipelineView) => {
      _setActiveView(next);
      const params = new URLSearchParams(searchParams);
      if (next === 'kanban') params.delete('view');
      else params.set('view', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobSheetOpen, setJobSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const {
    candidates, loading, error, refetch, handleStageChange, moveCandidates, undoStageMoves, refreshStageReaders, handleTagsChange,
  } = useATSData();

  // Poste d'un candidat : la fiche de sa mission, lue par son id (lot 0c-4) quel
  // que soit la forme du job_id de la ligne ; sinon le poste tel quel.
  const handleJobClick = (jobId: string) => {
    const projectId = candidates.find((c) => c.jobId === jobId && c.projectId)?.projectId;
    setSelectedJobId(projectId ? `project:${projectId}` : jobId);
    setJobSheetOpen(true);
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  // Sélection groupée (cases des cartes en colonnes)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Déplacement groupé : un seul geste pour tous les candidats cochés (une lecture
  // de l'état d'avant, un appel par lot de 200 lignes, un seul « Stage Change »),
  // sans toast par candidat ; la barre en affiche un seul pour le lot (E-23).
  // Un doublon est écrit avec tout son groupe. L'annulation remet l'état d'avant
  // lu en base juste avant le geste (lot 0c-4), par undo_candidate_stages.
  const handleBulkStageChange = useCallback(async (ids: string[], newStage: string): Promise<BulkMoveResult> => {
    const result = await moveCandidates(ids, newStage);
    // Les candidats non déplacés, ou dont une ligne en double n'a pas été écrite, restent cochés, pour réessayer.
    setSelectedIds(new Set([...result.failedIds, ...result.partialIds]));
    if (result.moved > 0 || result.partial > 0) {
      refreshStageReaders().catch((e) => console.error('[ATS] relecture après déplacement groupé :', e));
    }
    const groups = result.undoGroups;
    const undo = async () => {
      try {
        await undoStageMoves(groups);
      } catch (e) {
        console.error('[ATS] annulation impossible :', e);
        toast.error("L'annulation n'a pas été enregistrée. Réessayez.");
      }
    };
    return {
      moved: result.moved,
      unchanged: result.unchanged,
      partial: result.partial,
      failed: result.failedIds.length,
      undo: groups.length > 0 ? undo : undefined,
    };
  }, [moveCandidates, undoStageMoves, refreshStageReaders]);

  const [filters, setFilters] = useState<ATSFiltersValue>(EMPTY_FILTERS);

  // Deep-link : ?candidate=ID → résout dans la liste et ouvre la modale.
  // Re-run quand la liste candidates est chargée (sinon on rate la 1re fois)
  // ou quand le query param change.
  useEffect(() => {
    if (!deepLinkCandidateId || candidates.length === 0) return;
    if (selectedCandidate?.candidateId === deepLinkCandidateId) return; // déjà ouvert
    const found = candidates.find(c => c.candidateId === deepLinkCandidateId);
    if (found) {
      setSelectedCandidate(found);
    }
  }, [deepLinkCandidateId, candidates, selectedCandidate?.candidateId]);

  // Quand l'user ferme la modale, on retire les query params de deep-link
  // pour pas que ça re-trigger à chaque navigation
  const handleCloseCandidate = useCallback(() => {
    setSelectedCandidate(null);
    if (deepLinkCandidateId || deepLinkTab || deepLinkPrepare) {
      const params = new URLSearchParams(searchParams);
      params.delete('candidate');
      params.delete('tab');
      params.delete('prepareInterview');
      setSearchParams(params, { replace: true });
    }
  }, [deepLinkCandidateId, deepLinkTab, deepLinkPrepare, searchParams, setSearchParams]);

  // Get unique values for filters
  const filterOptions = useMemo(() => {
    const stages = new Set<string>();
    const sources = new Set<ATSCandidate['source']>();
    const jobsMap = new Map<string, string>();
    const tagsSet = new Set<string>();
    candidates.forEach(candidate => {
      stages.add(candidate.stage);
      sources.add(candidate.source);
      // Filtre Mission sur la mission (project_id), titre de la mission (lot 0c-4) :
      // le nom d'une ligne de mission l'emporte sur le libellé d'une séquence ou d'un InMail.
      if (candidate.projectId && candidate.jobTitle && (candidate.source === 'local' || !jobsMap.has(candidate.projectId))) {
        jobsMap.set(candidate.projectId, candidate.jobTitle);
      }
      (candidate.tags || []).forEach(t => tagsSet.add(t));
    });
    return {
      stages: ATS_STAGES.filter(s => stages.has(s.key)),
      sources: Array.from(sources),
      jobs: Array.from(jobsMap.entries()).map(([id, title]) => ({ id, title })),
      tags: Array.from(tagsSet).sort(),
    };
  }, [candidates]);

  // Filter candidates
  const filteredCandidates = useMemo(() => {
    return candidates.filter(candidate => {
      if (filters.search) {
        const search = filters.search.toLowerCase();
        if (!candidate.name?.toLowerCase().includes(search) &&
            !candidate.email?.toLowerCase().includes(search) &&
            !candidate.headline?.toLowerCase().includes(search) &&
            !candidate.jobTitle?.toLowerCase().includes(search)) return false;
      }
      if (filters.stage.length > 0 && !filters.stage.includes(candidate.stage)) return false;
      if (filters.source.length > 0 && !filters.source.includes(candidate.source)) return false;
      if (filters.job.length > 0 && !(candidate.projectId && filters.job.includes(candidate.projectId))) return false;
      if (filters.tag.length > 0) {
        const candidateTags = candidate.tags || [];
        if (!filters.tag.some(t => candidateTags.includes(t))) return false;
      }
      if (filters.hasReminder && !candidate.hasReminder) return false;
      return true;
    });
  }, [candidates, filters]);

  // Group by stage for Kanban
  const kanbanData = useMemo(() => {
    const grouped: Record<string, ATSCandidate[]> = {};
    ATS_STAGES.forEach(stage => { grouped[stage.key] = []; });
    filteredCandidates.forEach(candidate => (grouped[candidate.stage] ?? grouped.Nouveau).push(candidate));
    return grouped;
  }, [filteredCandidates]);

  // La fiche reçoit le candidat tel qu'il est en base (étape comprise).
  const handleCandidateClick = (candidate: ATSCandidate) =>
    setSelectedCandidate(candidates.find(c => c.id === candidate.id) ?? candidate);

  const handleReminderClick = (candidateId: string) => {
    const candidate = candidates.find(c => c.candidateId === candidateId);
    if (!candidate) {
      toast.info("Ce candidat n'apparaît pas dans le pipeline.");
      return;
    }
    // La fiche remplace le panneau des rappels au lieu de s'empiler dessus.
    setRemindersOpen(false);
    setSelectedCandidate(candidate);
  };

  const hasCandidates = candidates.length > 0;
  const showError = !!error && !hasCandidates;

  const renderSkeleton = () => {
    switch (activeView) {
      case 'table': return <ATSTableSkeleton />;
      case 'timeline': return <ATSTimelineSkeleton />;
      case 'analytics': return <ATSPipelineAnalyticsSkeleton />;
      default: return <ATSKanbanSkeleton />;
    }
  };

  const renderPipeline = () => {
    if (loading) return renderSkeleton();
    if (showError) {
      return (
        <ErrorState
          title="Impossible de charger le pipeline"
          description="Vérifiez votre connexion, puis réessayez. Vos candidats ne sont pas perdus."
          detail={error}
          onRetry={refresh}
          retrying={refreshing}
        />
      );
    }
    if (!hasCandidates) {
      return (
        <EmptyState
          illustration="recherche"
          title="Aucun candidat pour l'instant"
          headingLevel={2}
          description="Les candidats apparaissent ici dès que vous les triez dans une mission ou que vous les contactez. Les profils trouvés par une recherche restent dans le Sourcing de la mission tant qu'ils ne sont pas triés."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/missions">Aller aux missions</Link>
            </Button>
          }
        />
      );
    }
    if (filteredCandidates.length === 0) {
      return (
        <EmptyState
          icon={SearchX}
          title="Aucun candidat ne correspond aux filtres"
          headingLevel={2}
          description={`${plural(candidates.length, 'candidat masqué', 'candidats masqués')} par les filtres.`}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              Effacer les filtres
            </Button>
          }
        />
      );
    }
    switch (activeView) {
      case 'table':
        return <ATSTable candidates={filteredCandidates} onCandidateClick={handleCandidateClick} onJobClick={handleJobClick} resetKey={filters} />;
      case 'timeline':
        return <ATSTimeline candidates={filteredCandidates} onCandidateClick={handleCandidateClick} onJobClick={handleJobClick} resetKey={filters} />;
      case 'analytics':
        return <ATSPipelineAnalytics candidates={filteredCandidates} />;
      default:
        return (
          <ATSKanban
            data={kanbanData}
            stages={ATS_STAGES}
            onStageChange={handleStageChange}
            onCandidateClick={handleCandidateClick}
            onJobClick={handleJobClick}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
        );
    }
  };

  return (
    <PageLayout>
      <SEOHead
        title="Pipeline | Konekt"
        description="Suivez vos candidats d'une étape à l'autre, toutes missions confondues."
      />

      <PageHeader
        title="Pipeline"
        subtitle="Tous vos candidats, toutes missions confondues."
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={refresh}
                  disabled={refreshing || loading}
                  aria-label="Actualiser le pipeline"
                  className="max-md:h-11 max-md:w-11"
                >
                  <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Actualiser</TooltipContent>
            </Tooltip>
            <Button type="button" variant="outline" onClick={() => setRemindersOpen(true)} className="max-md:h-11">
              <Bell aria-hidden="true" />
              Rappels
            </Button>
          </>
        }
      />

      {loading ? <ATSStatsSkeleton /> : hasCandidates && <ATSStats candidates={filteredCandidates} />}

      <div className="mb-3">
        <SegmentedControl
          aria-label="Affichage du pipeline"
          value={activeView}
          onValueChange={setActiveView}
          options={VIEWS}
          className="hidden xl:inline-flex"
        />
        <Select value={activeView} onValueChange={(value) => setActiveView(value as PipelineView)}>
          <SelectTrigger aria-label="Affichage du pipeline" className="w-full sm:w-56 xl:hidden max-md:h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VIEWS.map(({ value, label, icon: Icon }) => (
              <SelectItem key={value} value={value}>
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {hasCandidates && (
        <div className="mb-4">
          <ATSFilters filters={filters} onFiltersChange={setFilters} options={filterOptions} />
        </div>
      )}

      {error && hasCandidates && (
        <ErrorState
          variant="compact"
          className="mb-4"
          title="Impossible d'actualiser le pipeline"
          description="Les candidats affichés peuvent dater de la dernière lecture réussie."
          detail={error}
          onRetry={refresh}
          retrying={refreshing}
        />
      )}

      {renderPipeline()}

      <RemindersSidebar open={remindersOpen} onOpenChange={setRemindersOpen} onReminderClick={handleReminderClick} />

      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={handleCloseCandidate}
          onStageChange={handleStageChange}
          onTagsChange={handleTagsChange}
          onRefresh={refetch}
          initialTab={deepLinkTab || undefined}
          autoGenerateScorecard={deepLinkPrepare}
        />
      )}

      <JobDetailSheet
        jobId={selectedJobId}
        open={jobSheetOpen}
        onOpenChange={setJobSheetOpen}
      />

      {/* Barre d'actions groupées : visible dès qu'un candidat est coché en colonnes */}
      <BulkActionsBar
        selectedIds={selectedIds}
        onClearSelection={clearSelection}
        onBulkStageChange={handleBulkStageChange}
      />
    </PageLayout>
  );
}
