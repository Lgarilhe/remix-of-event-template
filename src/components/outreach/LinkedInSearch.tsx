import React, { useCallback, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LinkedInAccount } from '@/pages/Outreach';
import { SearchFiltersPanel } from './search/SearchFiltersPanel';
import { SearchResultsPanel } from './search/SearchResultsPanel';
import { useLinkedInSearch } from '@/hooks/useLinkedInSearch';
import { useLinkedInSearchActions } from '@/hooks/useLinkedInSearchActions';
import { useLinkedInScoring } from '@/hooks/useLinkedInScoring';
import { useFilteredResults } from '@/hooks/useFilteredResults';
import { useAutoFillFilters } from '@/hooks/useAutoFillFilters';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { LinkedInProfile } from './types';
import { toast } from 'sonner';

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
  const needsReconnection = selectedAccountData && selectedAccountData.status !== 'OK';
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Left panel: Filters */}
      <div className="lg:col-span-4 xl:col-span-3">
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
          onSearch={() => handleSearch(false)}
          onClearFilters={search.handleClearFilters}
          showFilterWizard={search.showFilterWizard}
          setShowFilterWizard={search.setShowFilterWizard}
        />
      </div>

      {/* Right panel: Results */}
      <div className="lg:col-span-8 xl:col-span-9">
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
          scrollAreaRef={scrollAreaRef}
          loadMoreTriggerRef={loadMoreTriggerRef}
        />
      </div>
    </div>
  );
};
