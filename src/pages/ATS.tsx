/**
 * /pipeline — le pipeline global : tous les candidats, toutes missions
 * confondues (revue design, lot 7a).
 *
 * Cinq affichages : colonnes (glisser-déposer, au clavier aussi, et menu
 * « Déplacer vers… » sur chaque carte), tableau, chronologie, analyse, et la
 * shortlist client (données Notion, tenues à part). Chaque affichage a ses
 * états : squelette, erreur avec « Réessayer », vide avec l'action qui le
 * remplit, vide dû aux filtres avec « Effacer les filtres » (01-direction, § 8).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, Bell, Columns3, History, List, ListChecks, RefreshCw, Rows3, SearchX, Users } from 'lucide-react';
import { toast } from 'sonner';
import { SEOHead } from '@/components/SEOHead';
import { EmptyState, ErrorState, PageHeader, PageLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
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
import { CandidatePipeline } from '@/components/candidates/CandidatePipeline';
import { CandidateList } from '@/components/candidates/CandidateList';
import { CandidateFilters } from '@/components/candidates/CandidateFilters';
import { PipelineStats } from '@/components/candidates/PipelineStats';
import { useNotionShortlist, useNotionCandidates } from '@/hooks/useNotionCandidates';
import { PIPELINE_STAGES, type ShortlistEntry } from '@/types/shortlist';
import { useATSData, ATS_STAGES, type ATSCandidate } from '@/hooks/useATSData';
import { cn } from '@/lib/utils';

type PipelineView = 'kanban' | 'table' | 'timeline' | 'analytics' | 'shortlist';

/** Affichages de la page ; la valeur est celle de `?view=` (liens et favoris existants). */
const VIEWS: { value: PipelineView; label: string; icon: React.ElementType }[] = [
  { value: 'kanban', label: 'Colonnes', icon: Columns3 },
  { value: 'table', label: 'Tableau', icon: Rows3 },
  { value: 'timeline', label: 'Chronologie', icon: History },
  { value: 'analytics', label: 'Analyse', icon: BarChart3 },
  { value: 'shortlist', label: 'Shortlist client', icon: ListChecks },
];

const SHORTLIST_VIEWS: SegmentedOption<'pipeline' | 'list'>[] = [
  { value: 'pipeline', label: 'Colonnes', icon: Columns3 },
  { value: 'list', label: 'Liste', icon: List },
];

const parseView = (value: string | null): PipelineView =>
  VIEWS.some((v) => v.value === value) ? (value as PipelineView) : 'kanban';

const STAGE_KEYS = new Set(ATS_STAGES.map((s) => s.key));

const plural = (n: number, singular: string, pluralForm = `${singular}s`) => `${n} ${n > 1 ? pluralForm : singular}`;

const EMPTY_FILTERS: ATSFiltersValue = { search: '', stage: [], source: [], job: [], tag: [], hasReminder: false };

const EMPTY_SHORTLIST_FILTERS = { search: '', stage: [] as string[], expertise: [] as string[], entity: [] as string[], position: [] as string[] };

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

  const handleJobClick = (jobId: string) => {
    setSelectedJobId(jobId);
    setJobSheetOpen(true);
  };

  const { candidates, loading, error, refetch, handleStageChange, handleTagsChange } = useATSData();

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  // Étape affichée : une étape que le pipeline global ne connaît pas (clé d'une
  // mission) se range dans « Nouveau », comme sa colonne, dans toutes les vues de
  // la page, au lieu d'afficher la clé brute (en attendant le module d'étapes, E-01).
  const pipelineCandidates = useMemo(
    () => candidates.map((c) => (STAGE_KEYS.has(c.stage) ? c : { ...c, stage: 'Nouveau' })),
    [candidates],
  );

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

  // Déplacement groupé : un candidat après l'autre (pour ne pas saturer la base),
  // sans toast par candidat ; la barre en affiche un seul pour le lot (E-23).
  const handleBulkStageChange = useCallback(async (ids: string[], newStage: string): Promise<BulkMoveResult> => {
    const previous = new Map(candidates.map((c) => [c.id, c.stage]));
    const moved: string[] = [];
    const failed: string[] = [];
    for (const id of ids) {
      if (await handleStageChange(id, newStage, { silent: true })) moved.push(id);
      else failed.push(id);
    }
    // Les candidats non déplacés restent cochés, pour réessayer.
    setSelectedIds(new Set(failed));
    const undo = async () => {
      let restored = 0;
      for (const id of moved) {
        const stage = previous.get(id);
        if (stage && (await handleStageChange(id, stage, { silent: true }))) restored++;
      }
      if (restored === moved.length) {
        toast.success(`Déplacement annulé\u00a0: ${plural(restored, 'candidat remis', 'candidats remis')} à leur étape précédente`);
      } else {
        toast.error(`Annulation incomplète\u00a0: ${restored} sur ${moved.length} candidats remis à leur étape. Réessayez pour les autres.`);
      }
    };
    return { moved: moved.length, failed: failed.length, undo: moved.length > 0 ? undo : undefined };
  }, [candidates, handleStageChange]);

  // Notion shortlist data
  const shortlistQuery = useNotionShortlist();
  const { data: shortlistData = [], isLoading: shortlistLoading } = shortlistQuery;
  useNotionCandidates();
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);
  useEffect(() => { if (shortlistData.length > 0) setShortlist(shortlistData); }, [shortlistData]);

  const [shortlistViewMode, setShortlistViewMode] = useState<'pipeline' | 'list'>('pipeline');
  const [shortlistFilters, setShortlistFilters] = useState(EMPTY_SHORTLIST_FILTERS);

  // Shortlist filter options
  const shortlistFilterOptions = useMemo(() => {
    const stages = new Set<string>();
    const expertise = new Set<string>();
    const entities = new Set<string>();
    const positionsMap = new Map<string, string>();
    shortlist.forEach(entry => {
      if (entry.stage) stages.add(entry.stage);
      if (entry.entity) entities.add(entry.entity);
      entry.candidate?.expertise?.forEach(e => expertise.add(e));
      entry.positions?.forEach(pos => { if (!positionsMap.has(pos.id)) positionsMap.set(pos.id, pos.name); });
    });
    return { stages: Array.from(stages), expertise: Array.from(expertise), entities: Array.from(entities), positions: Array.from(positionsMap.entries()).map(([id, name]) => ({ id, name })) };
  }, [shortlist]);

  // Filtered shortlist
  const filteredShortlist = useMemo(() => {
    return shortlist.filter(entry => {
      if (shortlistFilters.search) {
        const s = shortlistFilters.search.toLowerCase();
        if (!entry.name?.toLowerCase().includes(s) && !entry.candidate?.name?.toLowerCase().includes(s) && !entry.candidate?.email?.toLowerCase().includes(s) && !entry.positions?.some(p => p.name.toLowerCase().includes(s))) return false;
      }
      if (shortlistFilters.stage.length > 0 && entry.stage && !shortlistFilters.stage.includes(entry.stage)) return false;
      if (shortlistFilters.entity.length > 0 && entry.entity && !shortlistFilters.entity.includes(entry.entity)) return false;
      if (shortlistFilters.expertise.length > 0) { const ce = entry.candidate?.expertise || []; if (!shortlistFilters.expertise.some(e => ce.includes(e))) return false; }
      if (shortlistFilters.position.length > 0) { const ep = entry.positions?.map(p => p.id) || []; if (!shortlistFilters.position.some(pid => ep.includes(pid))) return false; }
      return true;
    });
  }, [shortlist, shortlistFilters]);

  // Shortlist pipeline data
  const shortlistPipelineData = useMemo(() => {
    const grouped: Record<string, ShortlistEntry[]> = {};
    PIPELINE_STAGES.forEach(stage => { grouped[stage.key] = []; });
    filteredShortlist.forEach(entry => { const stage = entry.stage || 'Pressenti'; if (grouped[stage]) grouped[stage].push(entry); else grouped['Pressenti'].push(entry); });
    return grouped;
  }, [filteredShortlist]);

  const handleShortlistStageChange = (entryId: string, newStage: string) => {
    setShortlist(prev => prev.map(entry => entry.id === entryId ? { ...entry, stage: newStage } : entry));
  };

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
    pipelineCandidates.forEach(candidate => {
      stages.add(candidate.stage);
      sources.add(candidate.source);
      if (candidate.jobId && candidate.jobTitle) jobsMap.set(candidate.jobId, candidate.jobTitle);
      (candidate.tags || []).forEach(t => tagsSet.add(t));
    });
    return {
      stages: ATS_STAGES.filter(s => stages.has(s.key)),
      sources: Array.from(sources),
      jobs: Array.from(jobsMap.entries()).map(([id, title]) => ({ id, title })),
      tags: Array.from(tagsSet).sort(),
    };
  }, [pipelineCandidates]);

  // Filter candidates
  const filteredCandidates = useMemo(() => {
    return pipelineCandidates.filter(candidate => {
      if (filters.search) {
        const search = filters.search.toLowerCase();
        if (!candidate.name?.toLowerCase().includes(search) &&
            !candidate.email?.toLowerCase().includes(search) &&
            !candidate.headline?.toLowerCase().includes(search) &&
            !candidate.jobTitle?.toLowerCase().includes(search)) return false;
      }
      if (filters.stage.length > 0 && !filters.stage.includes(candidate.stage)) return false;
      if (filters.source.length > 0 && !filters.source.includes(candidate.source)) return false;
      if (filters.job.length > 0 && candidate.jobId && !filters.job.includes(candidate.jobId)) return false;
      if (filters.tag.length > 0) {
        const candidateTags = candidate.tags || [];
        if (!filters.tag.some(t => candidateTags.includes(t))) return false;
      }
      if (filters.hasReminder && !candidate.hasReminder) return false;
      return true;
    });
  }, [pipelineCandidates, filters]);

  // Group by stage for Kanban
  const kanbanData = useMemo(() => {
    const grouped: Record<string, ATSCandidate[]> = {};
    ATS_STAGES.forEach(stage => { grouped[stage.key] = []; });
    filteredCandidates.forEach(candidate => grouped[candidate.stage].push(candidate));
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

  const isShortlist = activeView === 'shortlist';
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
          icon={Users}
          title="Aucun candidat pour l'instant"
          description="Les candidats apparaissent ici dès que vous les ajoutez à une mission ou que vous les contactez."
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
        return <ATSTable candidates={filteredCandidates} onCandidateClick={handleCandidateClick} onJobClick={handleJobClick} />;
      case 'timeline':
        return <ATSTimeline candidates={filteredCandidates} onCandidateClick={handleCandidateClick} onJobClick={handleJobClick} />;
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

  const shortlistFiltered = shortlist.length > 0 && filteredShortlist.length === 0;

  const renderShortlist = () => {
    if (shortlistLoading && shortlist.length === 0) return <ATSKanbanSkeleton columns={PIPELINE_STAGES.length} />;
    if (shortlistQuery.isError && shortlist.length === 0) {
      return (
        <ErrorState
          title="Impossible de charger la shortlist client"
          description="La synchronisation avec Notion n'a pas répondu. Réessayez dans un instant."
          detail={shortlistQuery.error instanceof Error ? shortlistQuery.error.message : null}
          onRetry={() => void shortlistQuery.refetch()}
          retrying={shortlistQuery.isFetching}
        />
      );
    }
    if (shortlist.length === 0) {
      return (
        <EmptyState
          icon={ListChecks}
          title="Aucune shortlist client"
          description="Connectez Notion dans les paramètres pour synchroniser votre base candidats."
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/settings/org/general#outils">Ouvrir les paramètres</Link>
            </Button>
          }
        />
      );
    }
    return (
      <>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Affichage de la shortlist"
            value={shortlistViewMode}
            onValueChange={(mode) => setShortlistViewMode(mode)}
            options={SHORTLIST_VIEWS}
          />
          <CandidateFilters filters={shortlistFilters} onFiltersChange={setShortlistFilters} options={shortlistFilterOptions} />
        </div>
        <PipelineStats data={shortlistPipelineData} />
        {shortlistFiltered ? (
          <EmptyState
            icon={SearchX}
            title="Aucune candidature ne correspond aux filtres"
            description={`${plural(shortlist.length, 'candidature masquée', 'candidatures masquées')} par les filtres.`}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => setShortlistFilters(EMPTY_SHORTLIST_FILTERS)}>
                Effacer les filtres
              </Button>
            }
          />
        ) : shortlistViewMode === 'pipeline' ? (
          <CandidatePipeline data={shortlistPipelineData} stages={PIPELINE_STAGES} onStageChange={handleShortlistStageChange} />
        ) : (
          <CandidateList entries={filteredShortlist} />
        )}
      </>
    );
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

      {!isShortlist && (loading ? <ATSStatsSkeleton /> : hasCandidates && <ATSStats candidates={filteredCandidates} />)}

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

      {!isShortlist && hasCandidates && (
        <div className="mb-4">
          <ATSFilters filters={filters} onFiltersChange={setFilters} options={filterOptions} />
        </div>
      )}

      {!isShortlist && error && hasCandidates && (
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

      {isShortlist ? renderShortlist() : renderPipeline()}

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
