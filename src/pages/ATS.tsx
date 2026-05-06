import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { SEOHead } from '@/components/SEOHead';
import { ATSKanban } from '@/components/ats/ATSKanban';
import { ATSTable } from '@/components/ats/ATSTable';
import { ATSTimeline } from '@/components/ats/ATSTimeline';
import { ATSPipelineAnalytics } from '@/components/ats/ATSPipelineAnalytics';
import { ATSFilters } from '@/components/ats/ATSFilters';
import { ATSStats } from '@/components/ats/ATSStats';
import { ATSKanbanSkeleton } from '@/components/ats/ATSKanbanSkeleton';
import { ATSTableSkeleton } from '@/components/ats/ATSTableSkeleton';
import { ATSStatsSkeleton } from '@/components/ats/ATSStatsSkeleton';
import { RemindersSidebar } from '@/components/ats/RemindersSidebar';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { JobDetailSheet } from '@/components/ats/JobDetailSheet';
import { BulkActionsBar } from '@/components/ats/BulkActionsBar';
import { CandidatePipeline } from '@/components/candidates/CandidatePipeline';
import { CandidateList } from '@/components/candidates/CandidateList';
import { CandidateFilters } from '@/components/candidates/CandidateFilters';
import { PipelineStats } from '@/components/candidates/PipelineStats';
import { useNotionShortlist, useNotionCandidates } from '@/hooks/useNotionCandidates';
import { PIPELINE_STAGES, type ShortlistEntry } from '@/pages/Candidates';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Bell, Users, RefreshCw, Loader2, LayoutGrid, List } from 'lucide-react';
import iconAts3d from '@/assets/icon-ats-3d.webp';
import iconKanban3d from '@/assets/icon-kanban-3d.webp';
import iconTable3d from '@/assets/icon-table-3d.webp';
import iconTimeline3d from '@/assets/icon-timeline-3d.webp';
import iconAnalytics3d from '@/assets/icon-analytics-3d.webp';
import { EmptyState } from '@/components/ui/EmptyState';
import { useATSData, ATSCandidate, ATS_STAGES } from '@/hooks/useATSData';
import { cn } from '@/lib/utils';
import { AnimatedFunnel } from '@/components/ui/AnimatedFunnel';

export type { ATSCandidate };
export { ATS_STAGES };

const viewTabs = [
  { value: 'kanban', label: 'Kanban', icon3d: iconKanban3d },
  { value: 'table', label: 'Table', icon3d: iconTable3d },
  { value: 'timeline', label: 'Timeline', icon3d: iconTimeline3d },
  { value: 'shortlist', label: 'Shortlist Client', icon3d: iconTimeline3d },
  { value: 'analytics', label: 'Analytics', icon3d: iconAnalytics3d },
] as const;

export default function ATS() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialView = (searchParams.get('view') as any) || 'kanban';
  const [user, setUser] = useState<User | null>(null);
  const [activeView, _setActiveView] = useState<'kanban' | 'table' | 'timeline' | 'shortlist' | 'analytics'>(
    ['kanban', 'table', 'timeline', 'shortlist', 'analytics'].includes(initialView) ? initialView : 'kanban'
  );

  // Sync view → URL pour bookmark / partage de lien direct
  const setActiveView = useCallback(
    (next: 'kanban' | 'table' | 'timeline' | 'shortlist' | 'analytics') => {
      _setActiveView(next);
      const params = new URLSearchParams(searchParams);
      if (next === 'kanban') params.delete('view');
      else params.set('view', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const [showReminders, setShowReminders] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobSheetOpen, setJobSheetOpen] = useState(false);

  const handleJobClick = (jobId: string) => {
    setSelectedJobId(jobId);
    setJobSheetOpen(true);
  };
  
  const { candidates, loading, isFetching, isFromCache, error, refetch, handleStageChange, handleTagsChange } = useATSData();

  // Bulk selection (B1 — Opus UX audit)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelect = React.useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = React.useCallback(() => setSelectedIds(new Set()), []);
  const handleBulkStageChange = React.useCallback(async (ids: string[], newStage: string) => {
    // Exécute séquentiellement (pour ne pas flooder la DB) mais optimistic update instantané
    for (const id of ids) {
      await handleStageChange(id, newStage);
    }
  }, [handleStageChange]);

  // Notion shortlist data
  const { data: shortlistData = [], isLoading: shortlistLoading } = useNotionShortlist();
  const { data: candidatesNotionData = [] } = useNotionCandidates();
  const [shortlist, setShortlist] = useState<ShortlistEntry[]>([]);
  useEffect(() => { if (shortlistData.length > 0) setShortlist(shortlistData); }, [shortlistData]);

  const [shortlistViewMode, setShortlistViewMode] = useState<'pipeline' | 'list'>('pipeline');
  const [shortlistFilters, setShortlistFilters] = useState({ search: '', stage: [] as string[], expertise: [] as string[], entity: [] as string[], position: [] as string[] });

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

  const [filters, setFilters] = useState({
    search: '',
    stage: [] as string[],
    source: [] as string[],
    job: [] as string[],
    tag: [] as string[],
    hasReminder: false,
  });

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  // Get unique values for filters
  const filterOptions = useMemo(() => {
    const stages = new Set<string>();
    const sources = new Set<string>();
    const jobsMap = new Map<string, string>();
    const tagsSet = new Set<string>();
    candidates.forEach(candidate => {
      stages.add(candidate.stage);
      sources.add(candidate.source);
      if (candidate.jobId && candidate.jobTitle) jobsMap.set(candidate.jobId, candidate.jobTitle);
      (candidate.tags || []).forEach(t => tagsSet.add(t));
    });
    return {
      stages: Array.from(stages),
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
      if (filters.job.length > 0 && candidate.jobId && !filters.job.includes(candidate.jobId)) return false;
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
    filteredCandidates.forEach(candidate => {
      const stage = candidate.stage || 'Nouveau';
      if (grouped[stage]) grouped[stage].push(candidate);
      else grouped['Nouveau'].push(candidate);
    });
    return grouped;
  }, [filteredCandidates]);

  const handleCandidateClick = (candidate: ATSCandidate) => setSelectedCandidate(candidate);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="ATS - Suivi des candidats | Skalr"
        description="Centralisez et gérez toutes vos interactions avec les candidats"
      />

      <div className="py-6 pb-8">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
          {/* Header — compact single row */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <AnimatedFunnel size={32} speed={0.8} />
              <h1 className="font-display text-xl sm:text-2xl font-bold text-foreground tracking-tight">Pipeline</h1>
              {isFetching && !loading && (
                <span className="inline-flex items-center text-[10px] text-info border border-info/30 bg-info/10 rounded-full px-2 py-0.5 uppercase tracking-wider font-semibold animate-pulse hidden sm:inline">
                  Sync…
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={refetch}
                disabled={loading}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-background hover:bg-accent text-[11.5px] font-medium text-foreground transition-colors disabled:opacity-30"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Actualiser</span>
              </button>
              <button
                onClick={() => setShowReminders(!showReminders)}
                className={cn(
                  "inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[11.5px] font-medium transition-colors",
                  showReminders
                    ? "bg-foreground text-background border-foreground"
                    : "border-border bg-background hover:bg-accent text-foreground",
                )}
              >
                <Bell className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Rappels</span>
              </button>
            </div>
          </div>

          {/* Stats — inline strip */}
          {loading && candidates.length === 0 ? (
            <ATSStatsSkeleton />
          ) : (
            <ATSStats candidates={filteredCandidates} stages={ATS_STAGES} />
          )}

          {/* Filters and View Toggle */}
          <div className="mb-4">
            <Tabs value={activeView} onValueChange={(v) => setActiveView(v as any)}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                {/* View tabs — pill segmented control */}
                <div className="inline-flex items-center bg-muted/40 p-0.5 rounded-full border border-border overflow-x-auto scrollbar-hide">
                  {viewTabs.map((tab) => {
                    const isActive = activeView === tab.value;
                    return (
                      <button
                        key={tab.value}
                        onClick={() => setActiveView(tab.value as any)}
                        className={cn(
                          "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-medium transition-all shrink-0",
                          isActive
                            ? "bg-foreground text-background shadow-sm"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        )}
                      >
                        <img src={tab.icon3d} alt="" aria-hidden="true" className="w-4 h-4 object-contain shrink-0" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <ATSFilters
                  filters={filters}
                  onFiltersChange={setFilters}
                  options={filterOptions}
                />
              </div>

              {error ? (
                <div className="rounded-xl bg-destructive/5 border border-destructive/30 p-6 text-center">
                  <p className="text-destructive">{error}</p>
                  <button
                    onClick={refetch}
                    className="inline-flex items-center justify-center gap-1.5 h-9 px-5 mt-4 rounded-full border border-border bg-background hover:bg-accent text-foreground text-[12px] font-medium transition-colors"
                  >
                    Réessayer
                  </button>
                </div>
              ) : (
                <div className="flex gap-6">
                  <div className="flex-1 min-w-0">
                    {!loading && candidates.length === 0 ? (
                      <EmptyState
                        icon={<img src={iconAts3d} alt="" aria-hidden="true" className="w-7 h-7 object-contain" />}
                        title="Aucun candidat dans l'ATS"
                        description="Les candidats apparaîtront ici automatiquement lorsque vous les contacterez via Outreach ou les ajouterez manuellement."
                        actionLabel="Aller sur Outreach"
                        actionHref="/missions"
                      />
                    ) : (
                      <>
                        <TabsContent value="kanban" className="mt-0">
                          {loading && candidates.length === 0 ? (
                            <ATSKanbanSkeleton />
                          ) : (
                            <ATSKanban
                              data={kanbanData}
                              stages={ATS_STAGES}
                              onStageChange={handleStageChange}
                              onCandidateClick={handleCandidateClick}
                              onJobClick={handleJobClick}
                              selectedIds={selectedIds}
                              onToggleSelect={toggleSelect}
                            />
                          )}
                        </TabsContent>

                        <TabsContent value="table" className="mt-0">
                          {loading && candidates.length === 0 ? (
                            <ATSTableSkeleton />
                          ) : (
                            <ATSTable
                              candidates={filteredCandidates}
                              onCandidateClick={handleCandidateClick}
                              onJobClick={handleJobClick}
                            />
                          )}
                        </TabsContent>

                        <TabsContent value="timeline" className="mt-0">
                          <ATSTimeline
                            candidates={filteredCandidates}
                            onCandidateClick={handleCandidateClick}
                            onJobClick={handleJobClick}
                          />
                        </TabsContent>

                        <TabsContent value="analytics" className="mt-0">
                          <ATSPipelineAnalytics candidates={filteredCandidates} />
                        </TabsContent>

                        <TabsContent value="shortlist" className="mt-0">
                          {shortlistLoading && shortlist.length === 0 ? (
                            <div className="flex items-center justify-center py-20">
                              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                            </div>
                          ) : shortlist.length === 0 ? (
                            <EmptyState
                              icon={<Users className="w-7 h-7" />}
                              title="Aucune shortlist client"
                              description="Connectez Notion dans les paramètres pour synchroniser votre base candidats."
                              actionLabel="Paramètres"
                              actionHref="/settings?tab=integrations"
                            />
                          ) : (
                            <>
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                                <div className="inline-flex items-center bg-muted/40 p-0.5 rounded-full border border-border shrink-0">
                                  {[
                                    { value: 'pipeline' as const, label: 'Pipeline', Icon: LayoutGrid },
                                    { value: 'list' as const, label: 'Liste', Icon: List },
                                  ].map((tab) => {
                                    const isActive = shortlistViewMode === tab.value;
                                    return (
                                      <button
                                        key={tab.value}
                                        onClick={() => setShortlistViewMode(tab.value)}
                                        className={cn(
                                          "inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-medium transition-all shrink-0",
                                          isActive
                                            ? "bg-foreground text-background shadow-sm"
                                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                                        )}
                                      >
                                        <tab.Icon className="w-3.5 h-3.5 shrink-0" />
                                        {tab.label}
                                      </button>
                                    );
                                  })}
                                </div>
                                <CandidateFilters filters={shortlistFilters} onFiltersChange={setShortlistFilters} options={shortlistFilterOptions} />
                              </div>
                              <PipelineStats data={shortlistPipelineData} stages={PIPELINE_STAGES} />
                              {shortlistViewMode === 'pipeline' ? (
                                <CandidatePipeline data={shortlistPipelineData} stages={PIPELINE_STAGES} onStageChange={handleShortlistStageChange} />
                              ) : (
                                <CandidateList entries={filteredShortlist} />
                              )}
                            </>
                          )}
                        </TabsContent>
                      </>
                    )}
                  </div>

                  {showReminders && (
                    <RemindersSidebar
                      onClose={() => setShowReminders(false)}
                      onReminderClick={(candidateId) => {
                        const candidate = candidates.find(c => c.candidateId === candidateId);
                        if (candidate) setSelectedCandidate(candidate);
                      }}
                    />
                  )}
                </div>
              )}
            </Tabs>
          </div>
        </div>
      </div>

      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onStageChange={handleStageChange}
          onTagsChange={handleTagsChange}
          onRefresh={refetch}
        />
      )}

      <JobDetailSheet
        jobId={selectedJobId}
        open={jobSheetOpen}
        onOpenChange={setJobSheetOpen}
      />

      {/* Bulk actions bar — visible quand >= 1 candidat coché en kanban */}
      <BulkActionsBar
        selectedIds={selectedIds}
        onClearSelection={clearSelection}
        onBulkStageChange={handleBulkStageChange}
      />
    </div>
  );
}
