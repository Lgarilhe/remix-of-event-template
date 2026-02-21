import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInFiltersState, LinkedInProfile, INITIAL_FILTERS } from '@/components/outreach/types';
import { useUnipileQuota } from '@/hooks/useUnipileQuota';
import { useJobCandidateStatus } from '@/hooks/useJobCandidateStatus';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';

import { Job } from '@/pages/JobSpace';
import { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import { filterByCalculatedExperience } from '@/components/outreach/calculateExperience';
import { toast } from 'sonner';

export const RESULTS_PER_BATCH = 25;

interface UseLinkedInSearchOptions {
  selectedAccount: string | null;
  activeProject?: SourcingProject | null;
  onProjectChange?: (project: SourcingProject | null) => void;
}

export function useLinkedInSearch({
  selectedAccount,
  activeProject,
  onProjectChange,
}: UseLinkedInSearchOptions) {
  // Filters state
  const [filters, setFilters] = useState<LinkedInFiltersState>(INITIAL_FILTERS);
  const filtersRef = useRef<LinkedInFiltersState>(INITIAL_FILTERS);

  // Results state
  const [results, setResults] = useState<LinkedInProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMoreResults, setHasMoreResults] = useState(true);
  const [total, setTotal] = useState<number | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Job & Scoring state
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());
  const [jobScores, setJobScores] = useState<Record<string, JobMatchResult>>({});
  const [scoringInProgress, setScoringInProgress] = useState(false);
  const [sortByScore, setSortByScore] = useState(false);

  // View state
  const [showDismissed, setShowDismissed] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'untreated' | 'messaged' | 'dismissed'>('all');
  const [autoHideTreated, setAutoHideTreated] = useState(true);
  const autoHideTreatedRef = useRef(true);

  // Modal state
  const [showBulkInMailModal, setShowBulkInMailModal] = useState(false);
  const [showFilterWizard, setShowFilterWizard] = useState(false);

  // Hooks
  const quota = useUnipileQuota(selectedAccount);
  const candidateStatus = useJobCandidateStatus(selectedJob?.id || null);
  const { updateProject, findOrCreateForJob } = useSourcingProjects();
  

  // Sync refs
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    autoHideTreatedRef.current = autoHideTreated;
  }, [autoHideTreated]);

  // Update API mode based on selected filter
  useEffect(() => {
    quota.setApiMode(filters.api);
  }, [filters.api]);

  // Load filters from active project
  useEffect(() => {
    if (activeProject) {
      const savedFilters = activeProject.filters_snapshot;
      if (savedFilters && Object.keys(savedFilters).length > 0) {
        setFilters({ ...INITIAL_FILTERS, ...savedFilters });
        toast.info(`Filtres du projet "${activeProject.name}" chargés`);
      }
      if (activeProject.job_id && activeProject.job_title) {
        setSelectedJob({
          id: activeProject.job_id,
          title: activeProject.job_title,
          client: activeProject.client_name ? { name: activeProject.client_name } : undefined,
        } as Job);
      }
    }
  }, [activeProject?.id]);

  // Reset filters & results when selected job changes
  const prevSelectedJobRef = useRef<string | null>(null);
  useEffect(() => {
    const jobId = selectedJob?.id || null;
    if (prevSelectedJobRef.current !== null && prevSelectedJobRef.current !== jobId) {
      // Job actually changed → reset filters and results
      setFilters(INITIAL_FILTERS);
      setResults([]);
      setHasSearched(false);
      setCursor(null);
      setHasMoreResults(true);
      setTotal(null);
      setSelectedProfiles(new Set());
      setJobScores({});
    }
    setStatusFilter('all');
    setShowDismissed(false);
    prevSelectedJobRef.current = jobId;
  }, [selectedJob?.id]);

  // Clear filters
  const handleClearFilters = useCallback(() => {
    setFilters(INITIAL_FILTERS);
    setResults([]);
    setHasSearched(false);
    setCursor(null);
    setHasMoreResults(true);
    setTotal(null);
    setSelectedProfiles(new Set());
    setJobScores({});
  }, []);

  // Toggle profile selection
  const toggleProfileSelection = useCallback((profileId: string) => {
    setSelectedProfiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(profileId)) {
        newSet.delete(profileId);
      } else {
        newSet.add(profileId);
      }
      return newSet;
    });
  }, []);

  // Select/deselect all visible profiles
  const toggleSelectAll = useCallback(() => {
    const selectableProfiles = results.filter(p => {
      const score = jobScores[p.id];
      return !score || score.recommendation !== 'skip';
    });
    
    const currentlySelected = selectableProfiles.filter(p => selectedProfiles.has(p.id));
    
    if (currentlySelected.length === selectableProfiles.length && selectableProfiles.length > 0) {
      setSelectedProfiles(new Set());
    } else {
      setSelectedProfiles(new Set(selectableProfiles.map(p => p.id)));
    }
  }, [results, selectedProfiles, jobScores]);

  return {
    // Filters
    filters,
    setFilters,
    filtersRef,
    handleClearFilters,
    
    // Results
    results,
    setResults,
    loading,
    setLoading,
    loadingMore,
    setLoadingMore,
    cursor,
    setCursor,
    hasMoreResults,
    setHasMoreResults,
    total,
    setTotal,
    hasSearched,
    setHasSearched,
    
    // Job & Scoring
    selectedJob,
    setSelectedJob,
    selectedProfiles,
    setSelectedProfiles,
    jobScores,
    setJobScores,
    scoringInProgress,
    setScoringInProgress,
    sortByScore,
    setSortByScore,
    
    // View state
    showDismissed,
    setShowDismissed,
    statusFilter,
    setStatusFilter,
    autoHideTreated,
    setAutoHideTreated,
    autoHideTreatedRef,
    
    // Modals
    showBulkInMailModal,
    setShowBulkInMailModal,
    showFilterWizard,
    setShowFilterWizard,
    
    // Hooks/Utils
    quota,
    candidateStatus,
    updateProject,
    findOrCreateForJob,
    
    // Actions
    toggleProfileSelection,
    toggleSelectAll,
    
    // Project
    activeProject,
    onProjectChange,
  };
}
