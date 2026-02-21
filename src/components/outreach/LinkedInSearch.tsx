import React, { useCallback, useMemo, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LinkedInAccount } from '@/pages/Outreach';
import { SearchFiltersPanel } from './search/SearchFiltersPanel';
import { SearchResultsPanel } from './search/SearchResultsPanel';
import { useLinkedInSearch } from '@/hooks/useLinkedInSearch';
import { useLinkedInSearchActions, buildSearchParams } from '@/hooks/useLinkedInSearchActions';
import { useLinkedInScoring } from '@/hooks/useLinkedInScoring';
import { useFilteredResults } from '@/hooks/useFilteredResults';
import { useAutoFillFilters } from '@/hooks/useAutoFillFilters';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { LinkedInProfile } from './types';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { SlidersHorizontal } from 'lucide-react';

interface LinkedInSearchProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  onAccountChange: (accountId: string | null) => void;
  activeProject?: SourcingProject | null;
  onProjectChange?: (project: SourcingProject | null) => void;
}

export const LinkedInSearch: React.FC<LinkedInSearchProps> = ({
  accounts,
  selectedAccount,
  onAccountChange,
  activeProject,
  onProjectChange,
}) => {
  const queryClient = useQueryClient();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

  // Main search state hook
  const search = useLinkedInSearch({
    selectedAccount,
    activeProject,
    onProjectChange,
  });

  // Search history (must be after search hook)
  const searchHistory = useSearchHistory(search.selectedJob?.id || null);


  // Search actions hook
  const { handleSearch, handleLoadMore } = useLinkedInSearchActions(
    {
      selectedAccount,
      selectedJob: search.selectedJob,
      filters: search.filters,
      cursor: search.cursor,
      results: search.results,
      activeProject,
      autoHideTreatedRef: search.autoHideTreatedRef,
      quota: {
        canPerformAction: search.quota.canPerformAction,
        recordAction: search.quota.recordAction,
        isNearLimit: search.quota.isNearLimit,
      },
      candidateStatus: {
        treatedIds: search.candidateStatus.treatedIds,
        dismissedIds: search.candidateStatus.dismissedIds,
      },
    },
    {
      setLoading: search.setLoading,
      setLoadingMore: search.setLoadingMore,
      setResults: search.setResults,
      setCursor: search.setCursor,
      setHasMoreResults: search.setHasMoreResults,
      setTotal: search.setTotal,
      setHasSearched: search.setHasSearched,
    }
  );

  // Scoring hook
  const scoring = useLinkedInScoring({
    selectedJob: search.selectedJob,
    selectedProfiles: search.selectedProfiles,
    results: search.results,
    jobScores: search.jobScores,
    setJobScores: search.setJobScores,
    setScoringInProgress: search.setScoringInProgress,
    setSortByScore: search.setSortByScore,
    setResults: search.setResults,
    setSelectedProfiles: search.setSelectedProfiles,
    autoHideTreatedRef: search.autoHideTreatedRef,
    candidateStatus: {
      batchDismiss: search.candidateStatus.batchDismiss,
    },
  });

  // Filtered results hook
  const { filteredAndSortedResults, selectableProfiles, allSelectableSelected } = useFilteredResults({
    results: search.results,
    jobScores: search.jobScores,
    sortByScore: search.sortByScore,
    selectedJob: search.selectedJob,
    autoHideTreated: search.autoHideTreated,
    showDismissed: search.showDismissed,
    statusFilter: search.statusFilter,
    candidateStatus: {
      treatedIds: search.candidateStatus.treatedIds,
      dismissedIds: search.candidateStatus.dismissedIds,
      getStatus: search.candidateStatus.getStatus,
    },
    selectedProfiles: search.selectedProfiles,
    calculatedExperienceMin: search.filters.calculated_experience_min,
    calculatedExperienceMax: search.filters.calculated_experience_max,
  });

  // Auto-fill filters hook
  const { handleAutoFillFilters } = useAutoFillFilters({
    selectedAccount,
    filtersRef: search.filtersRef,
    setFilters: search.setFilters,
  });

  // Account data helpers
  const selectedAccountData = useMemo(() => 
    accounts.find(a => a.id === selectedAccount),
    [accounts, selectedAccount]
  );
  const needsReconnection = selectedAccountData && !['OK', 'CONNECTED', 'CONNECTING'].includes(selectedAccountData.status);
  const subscriptions = selectedAccountData?.subscriptions;

  // Check API mode availability
  const isApiModeAvailable = useMemo(() => {
    if (!subscriptions) return true;
    const hasPremiumLicense = subscriptions.recruiter || subscriptions.sales_navigator;
    
    switch (search.filters.api) {
      case 'recruiter': return !!subscriptions.recruiter;
      case 'sales_navigator': return !!subscriptions.sales_navigator;
      case 'classic': return !hasPremiumLicense;
      default: return true;
    }
  }, [subscriptions, search.filters.api]);

  // Auto-select API mode based on subscriptions
  useEffect(() => {
    if (!subscriptions) return;
    
    const hasPremiumLicense = subscriptions.recruiter || subscriptions.sales_navigator;
    
    if (hasPremiumLicense && search.filters.api === 'classic') {
      if (subscriptions.recruiter) {
        search.setFilters(f => ({ ...f, api: 'recruiter' }));
      } else if (subscriptions.sales_navigator) {
        search.setFilters(f => ({ ...f, api: 'sales_navigator' }));
      }
    } else if (search.filters.api === 'recruiter' && !subscriptions.recruiter && subscriptions.sales_navigator) {
      search.setFilters(f => ({ ...f, api: 'sales_navigator' }));
    } else if (search.filters.api === 'sales_navigator' && !subscriptions.sales_navigator && subscriptions.recruiter) {
      search.setFilters(f => ({ ...f, api: 'recruiter' }));
    } else if (!hasPremiumLicense && search.filters.api !== 'classic') {
      search.setFilters(f => ({ ...f, api: 'classic' }));
    }
  }, [subscriptions, selectedAccount]);

  // Treated/dismissed counts
  const treatedCount = useMemo(() => {
    return search.results.filter(p => search.candidateStatus.treatedIds.has(p.id)).length;
  }, [search.results, search.candidateStatus.treatedIds]);

  const dismissedCount = useMemo(() => {
    return search.results.filter(p => search.candidateStatus.dismissedIds.has(p.id)).length;
  }, [search.results, search.candidateStatus.dismissedIds]);

  // Auto-save search history when job changes (captures the previous session)
  const prevJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentJobId = search.selectedJob?.id || null;
    if (prevJobIdRef.current && prevJobIdRef.current !== currentJobId && search.hasSearched && search.results.length > 0) {
      searchHistory.saveSearch({
        jobId: prevJobIdRef.current,
        jobTitle: search.selectedJob?.title || null,
        clientName: (search.selectedJob as any)?.client?.name || null,
        filters: search.filters,
        resultsCount: search.results.length,
        treatedCount: treatedCount,
        dismissedCount: dismissedCount,
        messagedCount: 0,
        shortlistedCount: 0,
        searchApi: search.filters.api,
        projectId: activeProject?.id || null,
      });
    }
    prevJobIdRef.current = currentJobId;
  }, [search.selectedJob?.id]);

  // Bulk actions
  const handleBulkDismiss = useCallback(async () => {
    if (!search.selectedJob) return;
    
    const profilesToDismiss = Array.from(search.selectedProfiles)
      .map(id => search.results.find(p => p.id === id))
      .filter((p): p is LinkedInProfile => !!p)
      .map(profile => ({
        id: profile.id,
        name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
        headline: profile.headline,
        profileUrl: profile.public_profile_url || profile.profile_url,
      }));
    
    await search.candidateStatus.batchDismiss(profilesToDismiss);
    search.setSelectedProfiles(new Set());
    toast.success(`${profilesToDismiss.length} profil(s) archivé(s)`);
  }, [search.selectedJob, search.selectedProfiles, search.results, search.candidateStatus, search.setSelectedProfiles]);

  const handleBulkAddToProject = useCallback(async () => {
    if (!activeProject || !search.selectedJob) return;
    
    const profilesToAdd = Array.from(search.selectedProfiles)
      .map(id => search.results.find(p => p.id === id))
      .filter((p): p is LinkedInProfile => !!p);
    
    for (const profile of profilesToAdd) {
      await search.candidateStatus.dismissCandidate(profile.id, {
        name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
        headline: profile.headline,
        profileUrl: profile.public_profile_url || profile.profile_url,
      });
    }
    
    search.setSelectedProfiles(new Set());
    queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
    toast.success(`${profilesToAdd.length} profil(s) ajouté(s) au projet`);
  }, [activeProject, search.selectedJob, search.selectedProfiles, search.results, search.candidateStatus, search.setSelectedProfiles, queryClient]);

  // Handle archive for single profile
  const handleArchive = useCallback(async (profile: LinkedInProfile) => {
    if (!search.selectedJob) return;
    
    await search.candidateStatus.dismissCandidate(profile.id, {
      name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
      headline: profile.headline,
      profileUrl: profile.public_profile_url || profile.profile_url,
    });
    
    toast.success('Profil archivé');
  }, [search.selectedJob, search.candidateStatus]);

  // Handle profile treated (messaged, sequenced, etc.)
  const handleProfileTreated = useCallback((profileId: string) => {
    queryClient.invalidateQueries({ queryKey: ['job-candidate-status'] });
  }, [queryClient]);

  // Handle message sent
  const handleMessageSent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['job-candidate-status'] });
  }, [queryClient]);

  // Handle sequence enrollment success
  const handleSequenceEnrollSuccess = useCallback(() => {
    search.setSelectedProfiles(new Set());
    queryClient.invalidateQueries({ queryKey: ['job-candidate-status'] });
    toast.success('Profils inscrits à la séquence');
  }, [search.setSelectedProfiles, queryClient]);

  // Refine search state and handler
  const [refineLoading, setRefineLoading] = useState(false);

  const handleRefineSearch = useCallback(async (direction: 'expand' | 'narrow') => {
    if (!selectedAccount || !search.selectedJob) return;
    setRefineLoading(true);
    try {
      const currentSearchParams = buildSearchParams(search.filters, selectedAccount);
      const { data, error } = await supabase.functions.invoke('refine-search-filters', {
        body: {
          currentFilters: currentSearchParams,
          internalFilters: {
            calculated_experience_min: search.filters.calculated_experience_min,
            calculated_experience_max: search.filters.calculated_experience_max,
            years_of_experience_min: search.filters.years_of_experience_min,
            years_of_experience_max: search.filters.years_of_experience_max,
            location_within_area: search.filters.location_within_area,
            degree: search.filters.degree,
            skills: search.filters.skills,
          },
          totalResults: search.total,
          resultCount: search.results.length,
          jobTitle: search.selectedJob.title,
          jobLocation: search.selectedJob.location,
          direction,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur inconnue');

      // Apply adjustments
      const adjustments = data.adjustments || [];
      if (adjustments.length === 0) {
        toast.info('Aucun ajustement suggéré');
        return;
      }

      // Fields that MUST remain arrays in the filter state
      const arrayFields = new Set([
        'role', 'location', 'school', 'company', 'industry', 'function',
        'degree', 'skills', 'job_title', 'seniority', 'network_distance',
        'profile_language', 'open_to', 'groups', 'company_location',
        'past_company', 'past_job_title', 'company_headcount', 'company_type',
        'company_keywords', 'tags',
      ]);

      search.setFilters(prev => {
        const updated = { ...prev };
        for (const adj of adjustments) {
          const field = adj.field as string;
          const value = adj.value;

          // Special case: years_of_experience as {min, max} → split into two fields
          if (field === 'years_of_experience' && value && typeof value === 'object' && !Array.isArray(value)) {
            if ('min' in value) (updated as any).years_of_experience_min = value.min;
            if ('max' in value) (updated as any).years_of_experience_max = value.max;
            continue;
          }

          // Special case: skills_keywords (string[]) → convert to skills (PriorityFilterItem[])
          if (field === 'skills_keywords') {
            if (Array.isArray(value)) {
              updated.skills = value.map((s: string) => ({
                id: s.toLowerCase().replace(/\s+/g, '-'),
                name: s,
                keywords: s,
                priority: 'CAN_HAVE' as const,
              }));
            }
            continue;
          }

          if (!(field in updated)) continue;
          
          // Ensure array fields stay arrays
          if (arrayFields.has(field)) {
            if (Array.isArray(value)) {
              (updated as any)[field] = value;
            } else if (value && typeof value === 'object') {
              // AI returned a single object instead of an array — wrap it
              (updated as any)[field] = [value];
            }
          } else {
            (updated as any)[field] = value;
          }
        }
        return updated;
      });

      // Reset search state for new search
      search.setResults([]);
      search.setCursor(null);
      search.setHasMoreResults(true);
      search.setHasSearched(false);
      search.setTotal(null);

      const reasons = adjustments.map((a: any) => `• ${a.reason}`).join('\n');
      toast.success(data.summary || `${adjustments.length} filtre(s) ajusté(s)`, {
        description: reasons,
        duration: 6000,
      });
    } catch (err: any) {
      console.error('[RefineSearch] Error:', err);
      toast.error(err.message || 'Erreur lors de l\'affinage');
    } finally {
      setRefineLoading(false);
    }
  }, [selectedAccount, search.selectedJob, search.filters, search.total, search.results.length, search.setFilters, search.setResults, search.setCursor, search.setHasMoreResults, search.setHasSearched, search.setTotal]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          search.hasMoreResults &&
          !search.loading &&
          !search.loadingMore &&
          search.cursor
        ) {
          handleLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreTriggerRef.current) {
      observer.observe(loadMoreTriggerRef.current);
    }

    return () => observer.disconnect();
  }, [search.hasMoreResults, search.loading, search.loadingMore, search.cursor, handleLoadMore]);

  const [filtersOpen, setFiltersOpen] = useState(false);

  const filtersPanel = (
    <SearchFiltersPanel
      accounts={accounts}
      selectedAccount={selectedAccount}
      onAccountChange={onAccountChange}
      filters={search.filters}
      setFilters={search.setFilters}
      selectedJob={search.selectedJob}
      onJobChange={search.setSelectedJob}
      onAutoFillFilters={handleAutoFillFilters}
      loading={search.loading}
      needsReconnection={!!needsReconnection}
      isApiModeAvailable={isApiModeAvailable}
      subscriptions={subscriptions}
      quota={{
        quotas: search.quota.quotas,
        apiMode: search.quota.apiMode,
      }}
      onSearch={() => {
        // Auto-save search to history
        if (search.selectedJob && search.hasSearched) {
          searchHistory.saveSearch({
            jobId: search.selectedJob.id,
            jobTitle: search.selectedJob.title,
            clientName: (search.selectedJob as any).client?.name || null,
            filters: search.filters,
            resultsCount: search.results.length,
            treatedCount: search.results.filter(p => search.candidateStatus.treatedIds.has(p.id)).length,
            dismissedCount: search.results.filter(p => search.candidateStatus.dismissedIds.has(p.id)).length,
            messagedCount: 0,
            shortlistedCount: 0,
            searchApi: search.filters.api,
            projectId: activeProject?.id || null,
          });
        }
        handleSearch(false);
        setFiltersOpen(false);
      }}
      onClearFilters={search.handleClearFilters}
      searchHistory={searchHistory.history}
      searchHistoryLoading={searchHistory.isLoading}
      onApplyHistoryFilters={(filters) => {
        search.setFilters(filters);
        search.setResults([]);
        search.setHasSearched(false);
        search.setCursor(null);
        search.setTotal(null);
      }}
      onDeleteHistoryEntry={searchHistory.deleteEntry}
    />
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 min-w-0">
      {/* Mobile: Filters button + Sheet */}
      <div className="lg:hidden">
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="w-full gap-2 border-[#0077B5] text-[#0077B5]">
              <SlidersHorizontal className="w-4 h-4" />
              Filtres de recherche
              {search.selectedJob && (
                <span className="text-xs bg-[#0077B5]/10 px-2 py-0.5 rounded-full">
                  {search.selectedJob.title}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[90vw] max-w-[400px] p-4 overflow-y-auto">
            {filtersPanel}
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop: Filters sidebar */}
      <div className="hidden lg:block lg:col-span-4 xl:col-span-3">
        {filtersPanel}
      </div>

      {/* Results panel */}
      <div className="lg:col-span-8 xl:col-span-9 min-w-0">
        <SearchResultsPanel
          results={search.results}
          filteredResults={filteredAndSortedResults}
          loading={search.loading}
          loadingMore={search.loadingMore}
          hasSearched={search.hasSearched}
          hasMoreResults={search.hasMoreResults}
          cursor={search.cursor}
          total={search.total}
          selectedJob={search.selectedJob}
          selectedProfiles={search.selectedProfiles}
          jobScores={search.jobScores}
          scoringInProgress={search.scoringInProgress}
          sortByScore={search.sortByScore}
          selectableProfiles={selectableProfiles}
          allSelectableSelected={allSelectableSelected}
          autoHideTreated={search.autoHideTreated}
          showDismissed={search.showDismissed}
          statusFilter={search.statusFilter}
          treatedCount={treatedCount}
          dismissedCount={dismissedCount}
          selectedAccount={selectedAccount}
          activeProject={activeProject}
          showBulkInMailModal={search.showBulkInMailModal}
          onSearch={() => handleSearch(false)}
          onLoadMore={handleLoadMore}
          onToggleProfileSelection={search.toggleProfileSelection}
          onToggleSelectAll={search.toggleSelectAll}
          onScoreProfile={scoring.scoreProfile}
          onBatchScore={scoring.handleBatchScore}
          onBulkDismiss={handleBulkDismiss}
          onBulkAddToProject={handleBulkAddToProject}
          onSetAutoHideTreated={search.setAutoHideTreated}
          onSetShowDismissed={search.setShowDismissed}
          onSetStatusFilter={search.setStatusFilter}
          onSetSortByScore={search.setSortByScore}
          onSetShowBulkInMailModal={search.setShowBulkInMailModal}
          onProfileTreated={handleProfileTreated}
          onArchive={handleArchive}
          onMessageSent={handleMessageSent}
          onSequenceEnrollSuccess={handleSequenceEnrollSuccess}
          onRefineSearch={handleRefineSearch}
          refineLoading={refineLoading}
          scrollAreaRef={scrollAreaRef}
          loadMoreTriggerRef={loadMoreTriggerRef}
        />
      </div>
    </div>
  );
};
