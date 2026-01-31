import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { ATSKanban } from '@/components/ats/ATSKanban';
import { ATSTable } from '@/components/ats/ATSTable';
import { ATSTimeline } from '@/components/ats/ATSTimeline';
import { ATSFilters } from '@/components/ats/ATSFilters';
import { ATSStats } from '@/components/ats/ATSStats';
import { ATSKanbanSkeleton } from '@/components/ats/ATSKanbanSkeleton';
import { ATSTableSkeleton } from '@/components/ats/ATSTableSkeleton';
import { ATSStatsSkeleton } from '@/components/ats/ATSStatsSkeleton';
import { RemindersSidebar } from '@/components/ats/RemindersSidebar';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { LayoutGrid, Table, Clock, Bell, Users, RefreshCw } from 'lucide-react';
import { useATSData, ATSCandidate, ATS_STAGES } from '@/hooks/useATSData';

export type { ATSCandidate };
export { ATS_STAGES };

export default function ATS() {
  const [user, setUser] = useState<User | null>(null);
  const [activeView, setActiveView] = useState<'kanban' | 'table' | 'timeline'>('kanban');
  const [showReminders, setShowReminders] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);
  
  // Use our optimized hook
  const { 
    candidates, 
    loading, 
    loadingState,
    error, 
    refetch, 
    handleStageChange 
  } = useATSData();

  // Filters
  const [filters, setFilters] = useState({
    search: '',
    stage: [] as string[],
    source: [] as string[],
    job: [] as string[],
    hasReminder: false,
  });

  // Check auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Trigger data fetch when user is available
  useEffect(() => {
    if (user) {
      refetch();
    }
  }, [user, refetch]);

  // Get unique values for filters
  const filterOptions = useMemo(() => {
    const stages = new Set<string>();
    const sources = new Set<string>();
    const jobsMap = new Map<string, string>();

    candidates.forEach(candidate => {
      stages.add(candidate.stage);
      sources.add(candidate.source);
      if (candidate.jobId && candidate.jobTitle) {
        jobsMap.set(candidate.jobId, candidate.jobTitle);
      }
    });

    return {
      stages: Array.from(stages),
      sources: Array.from(sources),
      jobs: Array.from(jobsMap.entries()).map(([id, title]) => ({ id, title })),
    };
  }, [candidates]);

  // Filter candidates
  const filteredCandidates = useMemo(() => {
    return candidates.filter(candidate => {
      // Search filter
      if (filters.search) {
        const search = filters.search.toLowerCase();
        const matchName = candidate.name?.toLowerCase().includes(search);
        const matchEmail = candidate.email?.toLowerCase().includes(search);
        const matchHeadline = candidate.headline?.toLowerCase().includes(search);
        const matchJob = candidate.jobTitle?.toLowerCase().includes(search);
        if (!matchName && !matchEmail && !matchHeadline && !matchJob) return false;
      }

      // Stage filter
      if (filters.stage.length > 0 && !filters.stage.includes(candidate.stage)) {
        return false;
      }

      // Source filter
      if (filters.source.length > 0 && !filters.source.includes(candidate.source)) {
        return false;
      }

      // Job filter
      if (filters.job.length > 0 && candidate.jobId && !filters.job.includes(candidate.jobId)) {
        return false;
      }

      // Reminder filter
      if (filters.hasReminder && !candidate.hasReminder) {
        return false;
      }

      return true;
    });
  }, [candidates, filters]);

  // Group by stage for Kanban
  const kanbanData = useMemo(() => {
    const grouped: Record<string, ATSCandidate[]> = {};
    ATS_STAGES.forEach(stage => {
      grouped[stage.key] = [];
    });

    filteredCandidates.forEach(candidate => {
      const stage = candidate.stage || 'Nouveau';
      if (grouped[stage]) {
        grouped[stage].push(candidate);
      } else {
        grouped['Nouveau'].push(candidate);
      }
    });

    return grouped;
  }, [filteredCandidates]);

  const handleCandidateClick = (candidate: ATSCandidate) => {
    setSelectedCandidate(candidate);
  };

  // Loading count indicator
  const loadedSourcesCount = [
    !loadingState.shortlist,
    !loadingState.sequences,
    !loadingState.inmails,
  ].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <SEOHead
        title="ATS - Suivi des candidats | Konekt"
        description="Centralisez et gérez toutes vos interactions avec les candidats"
      />
      <Navbar />

      <main className="pt-20 pb-12">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <Users className="w-8 h-8 text-[#1A1A1A]" />
                  <h1 className="text-3xl font-bold text-[#1A1A1A]">ATS</h1>
                  {loading && (
                    <span className="text-sm text-[#1A1A1A]/50 animate-pulse">
                      Chargement ({loadedSourcesCount}/3)...
                    </span>
                  )}
                </div>
                <p className="text-[#1A1A1A]/60">
                  {candidates.length} candidat{candidates.length > 1 ? 's' : ''} • Toutes sources confondues
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refetch}
                  disabled={loading}
                  className="gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  Actualiser
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowReminders(!showReminders)}
                  className={showReminders ? 'bg-amber-50 border-amber-300' : ''}
                >
                  <Bell className="w-4 h-4 mr-2" />
                  Rappels
                </Button>
              </div>
            </div>
          </div>

          {/* Stats - Show skeleton while loading, real data progressively */}
          {loading && candidates.length === 0 ? (
            <ATSStatsSkeleton />
          ) : (
            <ATSStats candidates={filteredCandidates} stages={ATS_STAGES} />
          )}

          {/* Filters and View Toggle */}
          <div className="mb-6">
            <Tabs value={activeView} onValueChange={(v) => setActiveView(v as any)}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <TabsList className="bg-white border border-[#1A1A1A]/10">
                  <TabsTrigger value="kanban" className="gap-2 data-[state=active]:bg-[#1A1A1A] data-[state=active]:text-white">
                    <LayoutGrid className="w-4 h-4" />
                    Kanban
                  </TabsTrigger>
                  <TabsTrigger value="table" className="gap-2 data-[state=active]:bg-[#1A1A1A] data-[state=active]:text-white">
                    <Table className="w-4 h-4" />
                    Table
                  </TabsTrigger>
                  <TabsTrigger value="timeline" className="gap-2 data-[state=active]:bg-[#1A1A1A] data-[state=active]:text-white">
                    <Clock className="w-4 h-4" />
                    Timeline
                  </TabsTrigger>
                </TabsList>

                <ATSFilters
                  filters={filters}
                  onFiltersChange={setFilters}
                  options={filterOptions}
                />
              </div>

              {error ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                  <p className="text-red-600">{error}</p>
                  <Button variant="outline" onClick={refetch} className="mt-4">
                    Réessayer
                  </Button>
                </div>
              ) : (
                <div className="flex gap-6">
                  <div className="flex-1 min-w-0">
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

      {/* Candidate Detail Modal */}
      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onStageChange={handleStageChange}
          onRefresh={refetch}
        />
      )}
    </div>
  );
}
