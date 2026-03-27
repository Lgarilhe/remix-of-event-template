import { useCallback, useRef, useEffect, useReducer, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInFiltersState, LinkedInProfile, INITIAL_FILTERS } from '@/components/outreach/types';
import { useUnipileQuota } from '@/hooks/useUnipileQuota';
import { useJobCandidateStatus } from '@/hooks/useJobCandidateStatus';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { invokeUnipile } from '@/lib/invokeUnipile';

import { Job } from '@/types/jobs';
import { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import { filterByCalculatedExperience } from '@/components/outreach/calculateExperience';
import { toast } from 'sonner';

export const RESULTS_PER_BATCH = 25;

interface UseLinkedInSearchOptions {
  selectedAccount: string | null;
  activeProject?: SourcingProject | null;
  onProjectChange?: (project: SourcingProject | null) => void;
}

// ── Reducer: Search State ───────────────────────────────
interface SearchState {
  filters: LinkedInFiltersState;
  results: LinkedInProfile[];
  loading: boolean;
  loadingMore: boolean;
  cursor: string | null;
  hasMoreResults: boolean;
  total: number | null;
  hasSearched: boolean;
  selectedJob: Job | null;
  selectedProfiles: Set<string>;
  jobScores: Record<string, JobMatchResult>;
  scoringInProgress: boolean;
  sortByScore: boolean;
}

type SearchAction =
  | { type: 'SET_FILTERS'; filters: LinkedInFiltersState }
  | { type: 'UPDATE_FILTERS'; updater: (prev: LinkedInFiltersState) => LinkedInFiltersState }
  | { type: 'SET_RESULTS'; results: LinkedInProfile[] }
  | { type: 'UPDATE_RESULTS'; updater: (prev: LinkedInProfile[]) => LinkedInProfile[] }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_LOADING_MORE'; loading: boolean }
  | { type: 'SET_CURSOR'; cursor: string | null }
  | { type: 'SET_HAS_MORE_RESULTS'; hasMore: boolean }
  | { type: 'SET_TOTAL'; total: number | null }
  | { type: 'SET_HAS_SEARCHED'; searched: boolean }
  | { type: 'SET_SELECTED_JOB'; job: Job | null }
  | { type: 'SET_SELECTED_PROFILES'; profiles: Set<string> }
  | { type: 'UPDATE_SELECTED_PROFILES'; updater: (prev: Set<string>) => Set<string> }
  | { type: 'SET_JOB_SCORES'; scores: Record<string, JobMatchResult> }
  | { type: 'UPDATE_JOB_SCORES'; updater: (prev: Record<string, JobMatchResult>) => Record<string, JobMatchResult> }
  | { type: 'SET_SCORING_IN_PROGRESS'; inProgress: boolean }
  | { type: 'SET_SORT_BY_SCORE'; sort: boolean }
  | { type: 'RESET_SEARCH' };

function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case 'SET_FILTERS': return { ...state, filters: action.filters };
    case 'UPDATE_FILTERS': return { ...state, filters: action.updater(state.filters) };
    case 'SET_RESULTS': return { ...state, results: action.results };
    case 'UPDATE_RESULTS': return { ...state, results: action.updater(state.results) };
    case 'SET_LOADING': return { ...state, loading: action.loading };
    case 'SET_LOADING_MORE': return { ...state, loadingMore: action.loading };
    case 'SET_CURSOR': return { ...state, cursor: action.cursor };
    case 'SET_HAS_MORE_RESULTS': return { ...state, hasMoreResults: action.hasMore };
    case 'SET_TOTAL': return { ...state, total: action.total };
    case 'SET_HAS_SEARCHED': return { ...state, hasSearched: action.searched };
    case 'SET_SELECTED_JOB': return { ...state, selectedJob: action.job };
    case 'SET_SELECTED_PROFILES': return { ...state, selectedProfiles: action.profiles };
    case 'UPDATE_SELECTED_PROFILES': return { ...state, selectedProfiles: action.updater(state.selectedProfiles) };
    case 'SET_JOB_SCORES': return { ...state, jobScores: action.scores };
    case 'UPDATE_JOB_SCORES': return { ...state, jobScores: action.updater(state.jobScores) };
    case 'SET_SCORING_IN_PROGRESS': return { ...state, scoringInProgress: action.inProgress };
    case 'SET_SORT_BY_SCORE': return { ...state, sortByScore: action.sort };
    // Batched reset: replaces 8 separate set* calls (1 render instead of 8)
    case 'RESET_SEARCH': return {
      ...state,
      filters: INITIAL_FILTERS,
      results: [],
      hasSearched: false,
      cursor: null,
      hasMoreResults: true,
      total: null,
      selectedProfiles: new Set(),
      jobScores: {},
    };
    default: return state;
  }
}

// ── Reducer: View State ─────────────────────────────────
interface ViewState {
  showDismissed: boolean;
  statusFilter: 'all' | 'untreated' | 'scored' | 'scored_go' | 'scored_maybe' | 'scored_not_contacted' | 'messaged' | 'dismissed' | 'known';
  autoHideTreated: boolean;
  showBulkInMailModal: boolean;
  showFilterWizard: boolean;
}

type ViewAction =
  | { type: 'SET_SHOW_DISMISSED'; value: boolean }
  | { type: 'SET_STATUS_FILTER'; value: ViewState['statusFilter'] }
  | { type: 'SET_AUTO_HIDE_TREATED'; value: boolean }
  | { type: 'SET_SHOW_BULK_INMAIL_MODAL'; value: boolean }
  | { type: 'SET_SHOW_FILTER_WIZARD'; value: boolean };

function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'SET_SHOW_DISMISSED': return { ...state, showDismissed: action.value };
    case 'SET_STATUS_FILTER': return { ...state, statusFilter: action.value };
    case 'SET_AUTO_HIDE_TREATED': return { ...state, autoHideTreated: action.value };
    case 'SET_SHOW_BULK_INMAIL_MODAL': return { ...state, showBulkInMailModal: action.value };
    case 'SET_SHOW_FILTER_WIZARD': return { ...state, showFilterWizard: action.value };
    default: return state;
  }
}

export function useLinkedInSearch({
  selectedAccount,
  activeProject,
  onProjectChange,
}: UseLinkedInSearchOptions) {
  // ── Search state (useReducer #1) ──
  const [searchState, searchDispatch] = useReducer(searchReducer, {
    filters: INITIAL_FILTERS,
    results: [],
    loading: false,
    loadingMore: false,
    cursor: null,
    hasMoreResults: true,
    total: null,
    hasSearched: false,
    selectedJob: null,
    selectedProfiles: new Set<string>(),
    jobScores: {},
    scoringInProgress: false,
    sortByScore: false,
  });
  const { filters, results, loading, loadingMore, cursor, hasMoreResults, total, hasSearched, selectedJob, selectedProfiles, jobScores, scoringInProgress, sortByScore } = searchState;
  const filtersRef = useRef<LinkedInFiltersState>(INITIAL_FILTERS);
  const pendingLocationRef = useRef<string | null>(null);


  // Backward-compatible wrappers for search state (support both direct values and updater functions)
  const setFilters = useCallback((fOrUpdater: LinkedInFiltersState | ((prev: LinkedInFiltersState) => LinkedInFiltersState)) => {
    if (typeof fOrUpdater === 'function') {
      searchDispatch({ type: 'UPDATE_FILTERS', updater: fOrUpdater });
    } else {
      searchDispatch({ type: 'SET_FILTERS', filters: fOrUpdater });
    }
  }, []);

  // Helper: resolve a location keyword string to a LinkedIn location ID
  const resolveLocation = useCallback(async (keyword: string, accountId: string) => {
    try {
      const { data } = await invokeUnipile({
        body: {
          action: 'get_parameters',
          account_id: accountId,
          type: 'LOCATION',
          keywords: keyword,
          service: 'RECRUITER',
        },
      });
      if (!data?.success || !Array.isArray(data?.items) || data.items.length === 0) return;
      const normalized = keyword.toLowerCase();
      const best =
        data.items.find((it: any) => String(it.title || '').toLowerCase() === normalized) ||
        data.items.find((it: any) => String(it.title || '').toLowerCase().includes(normalized)) ||
        data.items[0];
      if (!best?.id || !best?.title) return;
      pendingLocationRef.current = null;
      setFilters(curr => ({
        ...curr,
        location: curr.location.length ? curr.location : [{
          id: String(best.id),
          name: String(best.title),
          priority: 'MUST_HAVE' as const,
          scope: 'CURRENT_OR_OPEN_TO_RELOCATE' as const,
        }],
      }));
    } catch (e) {
      console.error('[ProjectFilters] Failed to resolve location:', e);
    }
  }, [setFilters]);

  const setResults = useCallback((rOrUpdater: LinkedInProfile[] | ((prev: LinkedInProfile[]) => LinkedInProfile[])) => {
    if (typeof rOrUpdater === 'function') {
      searchDispatch({ type: 'UPDATE_RESULTS', updater: rOrUpdater });
    } else {
      searchDispatch({ type: 'SET_RESULTS', results: rOrUpdater });
    }
  }, []);
  const setLoading = useCallback((v: boolean) => searchDispatch({ type: 'SET_LOADING', loading: v }), []);
  const setLoadingMore = useCallback((v: boolean) => searchDispatch({ type: 'SET_LOADING_MORE', loading: v }), []);
  const setCursor = useCallback((c: string | null) => searchDispatch({ type: 'SET_CURSOR', cursor: c }), []);
  const setHasMoreResults = useCallback((v: boolean) => searchDispatch({ type: 'SET_HAS_MORE_RESULTS', hasMore: v }), []);
  const setTotal = useCallback((t: number | null) => searchDispatch({ type: 'SET_TOTAL', total: t }), []);
  const setHasSearched = useCallback((v: boolean) => searchDispatch({ type: 'SET_HAS_SEARCHED', searched: v }), []);
  const setSelectedJob = useCallback((j: Job | null) => searchDispatch({ type: 'SET_SELECTED_JOB', job: j }), []);
  const setSelectedProfiles = useCallback((sOrUpdater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    if (typeof sOrUpdater === 'function') {
      searchDispatch({ type: 'UPDATE_SELECTED_PROFILES', updater: sOrUpdater });
    } else {
      searchDispatch({ type: 'SET_SELECTED_PROFILES', profiles: sOrUpdater });
    }
  }, []);
  const setJobScores = useCallback((sOrUpdater: Record<string, JobMatchResult> | ((prev: Record<string, JobMatchResult>) => Record<string, JobMatchResult>)) => {
    if (typeof sOrUpdater === 'function') {
      searchDispatch({ type: 'UPDATE_JOB_SCORES', updater: sOrUpdater });
    } else {
      searchDispatch({ type: 'SET_JOB_SCORES', scores: sOrUpdater });
    }
  }, []);
  const setScoringInProgress = useCallback((v: boolean) => searchDispatch({ type: 'SET_SCORING_IN_PROGRESS', inProgress: v }), []);
  const setSortByScore = useCallback((v: boolean) => searchDispatch({ type: 'SET_SORT_BY_SCORE', sort: v }), []);

  // ── View state (useReducer #2) ──
  const [viewState, viewDispatch] = useReducer(viewReducer, {
    showDismissed: false,
    statusFilter: 'all' as const,
    autoHideTreated: true,
    showBulkInMailModal: false,
    showFilterWizard: false,
  });
  const { showDismissed, statusFilter, autoHideTreated, showBulkInMailModal, showFilterWizard } = viewState;
  const autoHideTreatedRef = useRef(true);

  // Backward-compatible wrappers for view state
  const setShowDismissed = useCallback((v: boolean) => viewDispatch({ type: 'SET_SHOW_DISMISSED', value: v }), []);
  const setStatusFilter = useCallback((v: ViewState['statusFilter']) => viewDispatch({ type: 'SET_STATUS_FILTER', value: v }), []);
  const setAutoHideTreated = useCallback((v: boolean) => viewDispatch({ type: 'SET_AUTO_HIDE_TREATED', value: v }), []);
  const setShowBulkInMailModal = useCallback((v: boolean) => viewDispatch({ type: 'SET_SHOW_BULK_INMAIL_MODAL', value: v }), []);
  const setShowFilterWizard = useCallback((v: boolean) => viewDispatch({ type: 'SET_SHOW_FILTER_WIZARD', value: v }), []);

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
        // Detect AI-generated format (has skills_keywords / location_keywords / role array)
        // and transform to LinkedInFiltersState format
        const isAIFormat = savedFilters.skills_keywords || savedFilters.location_keywords || (Array.isArray(savedFilters.role) && savedFilters.role[0]?.keywords);
        
        if (isAIFormat) {
          const transformed: Partial<typeof INITIAL_FILTERS> = {
            keywords: savedFilters.keywords || '',
            role: Array.isArray(savedFilters.role) ? savedFilters.role.map((r: any) => ({
              keywords: r.keywords,
              priority: r.priority || 'MUST_HAVE',
              scope: r.scope || 'CURRENT',
            })) : [],
            calculated_experience_min: savedFilters.years_of_experience_min ?? null,
            calculated_experience_max: savedFilters.years_of_experience_max ?? null,
            years_of_experience_min: null,
            years_of_experience_max: null,
            company_keywords: Array.isArray(savedFilters.company_keywords) ? savedFilters.company_keywords.map((c: any) => ({
              keywords: c.keywords,
              priority: c.priority || 'DOESNT_HAVE',
              scope: c.scope || 'CURRENT_OR_PAST',
            })) : [],
            school: Array.isArray(savedFilters.school) ? savedFilters.school.map((s: any) => ({
              id: s.id,
              name: s.name,
              priority: s.priority || 'CAN_HAVE',
            })) : [],
            location_within_area: savedFilters.location_within_area ?? null,
            spotlight: savedFilters.spotlight || '',
            open_to_work: savedFilters.open_to_work ?? null,
          };
          setFilters({ ...INITIAL_FILTERS, ...transformed });
          
          // Store pending location for deferred resolution
          const locationKeyword = savedFilters.location_keywords?.[0]?.trim();
          if (locationKeyword) {
            pendingLocationRef.current = locationKeyword;
            // Try resolving now if account is available
            if (selectedAccount) {
              resolveLocation(locationKeyword, selectedAccount);
            }
          }
        } else {
          setFilters({ ...INITIAL_FILTERS, ...savedFilters });
        }
        toast.info(`Filtres du projet "${activeProject.name}" chargés`);
      }
      
      // Build synthetic job from project + job_details for scoring
      const jd = (activeProject as any).job_details || {};
      if (activeProject.job_id && activeProject.job_title) {
        // Real job linked — use it as base, enrich with job_details
        const enriched: Record<string, any> = {
          id: activeProject.job_id,
          title: jd.title || activeProject.job_title,
          client: activeProject.client_name ? { name: activeProject.client_name } : undefined,
          skills: [...(jd.skills_must_have || []), ...(jd.skills_should_have || [])],
        };
        // Only add fields if they have actual values (avoid sending undefined)
        if (jd.mission_description || jd.context) enriched.description = jd.mission_description || jd.context;
        if (jd.skills_must_have?.length) enriched.mustHave = jd.skills_must_have.join(', ');
        if (jd.skills_should_have?.length) enriched.shouldHave = jd.skills_should_have.join(', ');
        if (jd.skills_nice_to_have?.length) enriched.niceToHave = jd.skills_nice_to_have.join(', ');
        if (jd.seniority) enriched.seniority = jd.seniority;
        if (jd.location) enriched.location = jd.location;
        if (jd.experience_min != null) enriched.xpMin = jd.experience_min;
        if (jd.experience_max != null) enriched.xpMax = jd.experience_max;
        setSelectedJob(enriched as Job);
      } else if (activeProject.name) {
        // Brief-based project without a real job
        const synthetic: Record<string, any> = {
          id: `project:${activeProject.id}`,
          title: jd.title || activeProject.name,
          description: jd.mission_description || jd.context || activeProject.description || '',
          client: activeProject.client_name ? { name: activeProject.client_name } : undefined,
          skills: [...(jd.skills_must_have || []), ...(jd.skills_should_have || [])],
        };
        if (jd.skills_must_have?.length) synthetic.mustHave = jd.skills_must_have.join(', ');
        if (jd.skills_should_have?.length) synthetic.shouldHave = jd.skills_should_have.join(', ');
        if (jd.seniority) synthetic.seniority = jd.seniority;
        if (jd.location) synthetic.location = jd.location;
        if (jd.experience_min != null) synthetic.xpMin = jd.experience_min;
        if (jd.experience_max != null) synthetic.xpMax = jd.experience_max;
        setSelectedJob(synthetic as Job);
      }
    }
  }, [activeProject?.id]);

  // Deferred location resolution: when selectedAccount becomes available and we have a pending location
  useEffect(() => {
    if (selectedAccount && pendingLocationRef.current) {
      resolveLocation(pendingLocationRef.current, selectedAccount);
    }
  }, [selectedAccount, resolveLocation]);

  // Seed jobScores from DB statuses (so pool profiles show their scores without re-scoring)
  useEffect(() => {
    if (!candidateStatus.statuses || candidateStatus.statuses.size === 0) return;
    
    setJobScores(prev => {
      const next = { ...prev };
      let added = 0;
      for (const [candidateId, status] of candidateStatus.statuses) {
        if (!next[candidateId] && status.score != null && status.recommendation) {
          next[candidateId] = {
            profile_name: status.candidate_name || '',
            match_score: status.score,
            recommendation: status.recommendation as 'go' | 'maybe' | 'skip',
            matching_skills: [],
            missing_skills: [],
            experience_match: 'incertain',
            location_match: false,
            summary: '',
          };
          added++;
        }
      }
      return added > 0 ? next : prev;
    });
  }, [candidateStatus.statuses]);

  // Reset filters & results when selected job changes
  const prevSelectedJobRef = useRef<string | null>(null);
  useEffect(() => {
    const jobId = selectedJob?.id || null;
    if (prevSelectedJobRef.current !== null && prevSelectedJobRef.current !== jobId) {
      // Job actually changed → single batched reset (1 render instead of 8)
      searchDispatch({ type: 'RESET_SEARCH' });
    }
    setStatusFilter('all');
    setShowDismissed(false);
    prevSelectedJobRef.current = jobId;
  }, [selectedJob?.id]);

  // Clear filters — single batched dispatch (1 render instead of 8)
  const handleClearFilters = useCallback(() => {
    searchDispatch({ type: 'RESET_SEARCH' });
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

  // Select/deselect all visible profiles (accepts filtered list from caller)
  const toggleSelectAll = useCallback((filteredSelectableProfiles?: LinkedInProfile[]) => {
    const selectable = filteredSelectableProfiles || results.filter(p => {
      const score = jobScores[p.id];
      return !score || score.recommendation !== 'skip';
    });
    
    const currentlySelected = selectable.filter(p => selectedProfiles.has(p.id));
    
    if (currentlySelected.length === selectable.length && selectable.length > 0) {
      setSelectedProfiles(new Set());
    } else {
      setSelectedProfiles(new Set(selectable.map(p => p.id)));
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
