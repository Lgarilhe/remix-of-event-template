import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { Navbar } from '@/components/Navbar';
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
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { LayoutGrid, Table, Clock, Bell, Users, RefreshCw, BarChart3 } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useATSData, ATSCandidate, ATS_STAGES } from '@/hooks/useATSData';
import { cn } from '@/lib/utils';

export type { ATSCandidate };
export { ATS_STAGES };

const viewTabs = [
  { value: 'kanban', label: 'Kanban', icon: LayoutGrid },
  { value: 'table', label: 'Table', icon: Table },
  { value: 'timeline', label: 'Timeline', icon: Clock },
  { value: 'analytics', label: 'Analytics', icon: BarChart3 },
] as const;

export default function ATS() {
  const [user, setUser] = useState<User | null>(null);
  const [activeView, setActiveView] = useState<'kanban' | 'table' | 'timeline' | 'analytics'>('kanban');
  const [showReminders, setShowReminders] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);
  
  const { candidates, loading, isFetching, isFromCache, error, refetch, handleStageChange, handleTagsChange } = useATSData();

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
        title="ATS - Suivi des candidats | Konekt"
        description="Centralisez et gérez toutes vos interactions avec les candidats"
      />
      <Navbar />

      <main className="pt-16 sm:pt-20 pb-8">
        <div className="max-w-[1800px] mx-auto px-3 sm:px-6 lg:px-8">
          {/* Header — compact single row */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-8 w-8 bg-foreground text-background flex items-center justify-center shrink-0">
                <Users className="w-4 h-4" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground uppercase tracking-tight">ATS</h1>
              {isFromCache && !isFetching && (
                <span className="text-[9px] text-emerald-600 border border-emerald-300 px-1.5 py-0.5 uppercase tracking-wider font-medium hidden sm:inline">
                  Cache
                </span>
              )}
              {isFetching && !loading && (
                <span className="text-[9px] text-blue-600 border border-blue-300 px-1.5 py-0.5 uppercase tracking-wider font-medium animate-pulse hidden sm:inline">
                  Sync...
                </span>
              )}
            </div>

            <div className="flex items-center gap-0 shrink-0">
              <button
                onClick={refetch}
                disabled={loading}
                className="relative overflow-hidden h-8 px-3 flex items-center gap-1.5 border border-foreground text-foreground text-[10px] font-medium uppercase tracking-wider group disabled:opacity-30"
              >
                <RefreshCw className={`w-3 h-3 relative z-10 ${loading ? 'animate-spin' : ''}`} />
                <span className="relative z-10 hidden sm:inline">Actualiser</span>
                <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              </button>
              <button
                onClick={() => setShowReminders(!showReminders)}
                className={cn(
                  "relative overflow-hidden h-8 px-3 flex items-center gap-1.5 border border-l-0 border-foreground text-foreground text-[10px] font-medium uppercase tracking-wider group",
                  showReminders && "bg-brutal-accent"
                )}
              >
                <Bell className="w-3 h-3 relative z-10" />
                <span className="relative z-10 hidden sm:inline">Rappels</span>
                {!showReminders && (
                  <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                )}
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
                {/* Brutal tabs */}
                <div className="flex gap-0 overflow-x-auto scrollbar-hide">
                  {viewTabs.map((tab, index) => {
                    const Icon = tab.icon;
                    const isActive = activeView === tab.value;
                    return (
                      <button
                        key={tab.value}
                        onClick={() => setActiveView(tab.value as any)}
                        className={cn(
                          "relative overflow-hidden flex items-center gap-1.5 h-[34px] px-4 text-[11px] font-medium uppercase tracking-wider border border-foreground transition-colors duration-200 group shrink-0",
                          index > 0 && "border-l-0",
                          isActive ? "bg-brutal-accent text-foreground" : "bg-background text-foreground"
                        )}
                      >
                        <Icon className="w-3.5 h-3.5 shrink-0 relative z-10" />
                        <span className="relative z-10">{tab.label}</span>
                        {!isActive && (
                          <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                        )}
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
                <div className="bg-destructive/10 border border-destructive/30 p-6 text-center">
                  <p className="text-destructive">{error}</p>
                  <button
                    onClick={refetch}
                    className="relative overflow-hidden h-[34px] px-6 mt-4 border border-foreground text-foreground text-[11px] font-medium uppercase tracking-wider group"
                  >
                    <span className="relative z-10">Réessayer</span>
                    <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-6">
                  <div className="flex-1 min-w-0">
                    {!loading && candidates.length === 0 ? (
                      <EmptyState
                        icon={<Users className="w-7 h-7" />}
                        title="Aucun candidat dans l'ATS"
                        description="Les candidats apparaîtront ici automatiquement lorsque vous les contacterez via Outreach ou les ajouterez manuellement."
                        actionLabel="Aller sur Outreach"
                        actionHref="/outreach"
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
                            />
                          )}
                        </TabsContent>

                        <TabsContent value="timeline" className="mt-0">
                          <ATSTimeline
                            candidates={filteredCandidates}
                            onCandidateClick={handleCandidateClick}
                          />
                        </TabsContent>

                        <TabsContent value="analytics" className="mt-0">
                          <ATSPipelineAnalytics candidates={filteredCandidates} />
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
      </main>

      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onStageChange={handleStageChange}
          onTagsChange={handleTagsChange}
          onRefresh={refetch}
        />
      )}
    </div>
  );
}
