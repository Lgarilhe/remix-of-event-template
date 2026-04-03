import React, { useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LinkedInAccount } from '@/pages/Outreach';
import { SearchFiltersPanel, type FilterSuggestions } from './search/SearchFiltersPanel';
import { SearchResultsPanel } from './search/SearchResultsPanel';
import { RefineSearchModal, RefineAdjustment, AdjustmentDecision } from './search/RefineSearchModal';
import { useLinkedInSearch } from '@/hooks/useLinkedInSearch';
import { useLinkedInSearchActions, buildSearchParams } from '@/hooks/useLinkedInSearchActions';
import { useLinkedInScoring } from '@/hooks/useLinkedInScoring';
import { useFilteredResults, type ScoredSortBy } from '@/hooks/useFilteredResults';
import { useAutoFillFilters } from '@/hooks/useAutoFillFilters';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { LinkedInProfile, LinkedInFiltersState, INITIAL_FILTERS } from './types';
import { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import { Job } from '@/types/jobs';
import { extractTraitsFromProfile, traitsToFilters } from '@/hooks/linkedin/extractSimilarFilters';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SlidersHorizontal } from 'lucide-react';
import { useState as useLocalState } from 'react';
import { AppliedFiltersBar } from './search/AppliedFiltersBar';
import { FilterWizard } from './filter-wizard';
import type { JobDetails } from '@/types/jobDetails';
import { SKILL_SYNONYMS } from '@/hooks/linkedin/skillSynonyms';

interface LinkedInSearchProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  onAccountChange: (accountId: string | null) => void;
  activeProject?: SourcingProject | null;
  onProjectChange?: (project: SourcingProject | null) => void;
  /** Search source: 'linkedin' (default) or 'database' (Base Konekt) */
  searchSource?: 'linkedin' | 'database';
}

type SearchStatusFilter = 'all' | 'untreated' | 'scored' | 'scored_go' | 'scored_maybe' | 'scored_not_contacted' | 'messaged' | 'dismissed' | 'known';

interface MissionSearchCacheEntry {
  filters: typeof INITIAL_FILTERS;
  results: LinkedInProfile[];
  hasSearched: boolean;
  total: number | null;
  cursor: string | null;
  hasMoreResults: boolean;
  selectedJob: Job | null;
  jobScores: Record<string, JobMatchResult>;
  sortByScore: boolean;
  statusFilter: SearchStatusFilter;
  showDismissed: boolean;
  selectedProfiles: string[];
  showPoolView: boolean;
  scoredSortBy: ScoredSortBy;
  searchSource: 'linkedin' | 'database';
  scrollTop: number;
  scoringInstructions: string;
}

const missionSearchCache = new Map<string, MissionSearchCacheEntry>();

const TITLE_SUGGESTION_RULES: Array<{ pattern: RegExp; suggestions: string[] }> = [
  { pattern: /(devops|site reliability|\bsre\b|platform)/i, suggestions: ['SRE', 'Platform Engineer', 'Cloud Engineer', 'DevOps Engineer'] },
  { pattern: /(architect|architecture)/i, suggestions: ['Solution Architect', 'Cloud Architect', 'Technical Architect'] },
  { pattern: /(cloud|infra|infrastructure)/i, suggestions: ['Cloud Engineer', 'Infrastructure Engineer', 'Platform Engineer'] },
  { pattern: /(full[\s-]?stack)/i, suggestions: ['Software Engineer', 'Backend Engineer', 'Frontend Engineer'] },
  { pattern: /(data)/i, suggestions: ['Data Engineer', 'Analytics Engineer', 'Data Platform Engineer'] },
];

const dedupeSuggestionValues = (values: Array<string | null | undefined>, limit: number): string[] => {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const value of values) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);

    if (items.length >= limit) break;
  }

  return items;
};

const buildFallbackSuggestions = (project?: SourcingProject | null): FilterSuggestions | null => {
  if (!project) return null;

  const jd = (project.job_details || {}) as Partial<JobDetails>;
  const title = jd.title || project.job_title || project.name || '';
  const baseSkills = [...(jd.skills_must_have || []), ...(jd.skills_should_have || [])];
  const skillSynonymSuggestions = baseSkills.flatMap((skill) => {
    const normalizedSkill = skill.toLowerCase().trim();
    const directSynonyms = SKILL_SYNONYMS[normalizedSkill] || [];
    const reverseSynonyms = Object.entries(SKILL_SYNONYMS)
      .filter(([key, synonyms]) => key === normalizedSkill || synonyms.some((synonym) => synonym.toLowerCase() === normalizedSkill))
      .flatMap(([key, synonyms]) => [key, ...synonyms]);

    return [...directSynonyms, ...reverseSynonyms].filter((candidate) => candidate.toLowerCase() !== normalizedSkill);
  });

  const titleSuggestions = TITLE_SUGGESTION_RULES
    .filter((rule) => rule.pattern.test(title))
    .flatMap((rule) => rule.suggestions);

  const nextSuggestions: FilterSuggestions = {
    alt_titles: dedupeSuggestionValues(titleSuggestions, 5),
    alt_skills: dedupeSuggestionValues([
      ...(jd.skills_nice_to_have || []),
      ...(jd.skills_should_have || []),
      ...skillSynonymSuggestions,
    ], 8),
    alt_locations: dedupeSuggestionValues([
      jd.remote_policy === 'full_remote' ? 'Remote France' : null,
      jd.remote_policy === 'hybrid' && jd.location ? `${jd.location} et périphérie` : null,
    ], 4),
    alt_companies: dedupeSuggestionValues(
      jd.target_companies?.flatMap((category) => category.companies?.map((company) => company.name) || []) || [],
      6,
    ),
    alt_certifications: dedupeSuggestionValues(jd.certifications || [], 5),
  };

  return Object.values(nextSuggestions).some((value) => Array.isArray(value) && value.length > 0)
    ? nextSuggestions
    : null;
};

const mergeSuggestions = (
  primary: FilterSuggestions | null,
  fallback: FilterSuggestions | null,
): FilterSuggestions | null => {
  const merged: FilterSuggestions = {
    alt_titles: dedupeSuggestionValues([...(primary?.alt_titles || []), ...(fallback?.alt_titles || [])], 5),
    alt_skills: dedupeSuggestionValues([...(primary?.alt_skills || []), ...(fallback?.alt_skills || [])], 8),
    alt_locations: dedupeSuggestionValues([...(primary?.alt_locations || []), ...(fallback?.alt_locations || [])], 4),
    alt_companies: dedupeSuggestionValues([...(primary?.alt_companies || []), ...(fallback?.alt_companies || [])], 6),
    alt_certifications: dedupeSuggestionValues([...(primary?.alt_certifications || []), ...(fallback?.alt_certifications || [])], 5),
  };

  return Object.values(merged).some((value) => Array.isArray(value) && value.length > 0)
    ? merged
    : null;
};

export const LinkedInSearch: React.FC<LinkedInSearchProps> = ({
  accounts,
  selectedAccount,
  onAccountChange,
  activeProject,
  onProjectChange,
  searchSource: initialSearchSource = 'database',
}) => {
  const queryClient = useQueryClient();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
  const [scoringInstructions, setScoringInstructions] = useLocalState('');
  const snapshotSuggestions = useMemo<FilterSuggestions | null>(() => {
    const nextSuggestions = (activeProject?.filters_snapshot as any)?.suggestions as FilterSuggestions | null | undefined;
    if (!nextSuggestions) return null;
    return Object.values(nextSuggestions).some(value => Array.isArray(value) && value.length > 0)
      ? nextSuggestions
      : null;
  }, [activeProject?.filters_snapshot]);
  const [inlineSuggestions, setInlineSuggestions] = useState<FilterSuggestions | null>(snapshotSuggestions);
  const inlineSuggestionsProjectRef = useRef<string | null>(activeProject?.id ?? null);
  const fallbackSuggestions = useMemo(
    () => buildFallbackSuggestions(activeProject),
    [activeProject?.id, activeProject?.job_details, activeProject?.job_title, activeProject?.name],
  );
  const effectiveSuggestions = useMemo(
    () => mergeSuggestions(inlineSuggestions, fallbackSuggestions),
    [inlineSuggestions, fallbackSuggestions],
  );

  // Internal search source toggle (Apollo vs LinkedIn)
  const [searchSource, setSearchSource] = useLocalState<'linkedin' | 'database'>(initialSearchSource);

  // Handler to toggle search source — preserves common filters, swaps api type
  const handleSearchSourceChange = useCallback((source: 'linkedin' | 'database') => {
    setSearchSource(source);
  }, []);

  // Track previous search source to auto-relaunch search on toggle
  const prevSearchSourceRef = useRef(searchSource);

  // Auto-generate scoring instructions from brief's evaluation criteria
  React.useEffect(() => {
    if (!activeProject || scoringInstructions.trim()) return; // Don't overwrite manual instructions
    const jd = (activeProject as any).job_details;
    if (!jd?.evaluation_criteria?.length) return;

    const lines: string[] = ['Critères du manager pour le scoring :'];
    if (jd.evaluation_weights) {
      const w = jd.evaluation_weights;
      lines.push(`Pondération : ${w.technical || 0}% technique, ${w.soft_skill || 0}% soft skills, ${w.culture_fit || 0}% culture fit, ${w.motivation || 0}% motivation, ${w.experience || 0}% expérience.`);
    }
    for (const c of jd.evaluation_criteria) {
      const weight = c.weight === 3 ? 'CRITIQUE' : c.weight === 2 ? 'important' : 'bonus';
      let line = `- ${c.label} (${weight}${c.deal_breaker ? ', DEAL BREAKER' : ''})`;
      if (c.level_10) line += ` — Excellence: "${c.level_10}"`;
      if (c.level_1) line += ` — Rédhibitoire: "${c.level_1}"`;
      lines.push(line);
    }
    setScoringInstructions(lines.join('\n'));
  }, [activeProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // Main search state hook
  const search = useLinkedInSearch({
    selectedAccount,
    activeProject,
    onProjectChange,
  });

  useEffect(() => {
    const currentProjectId = activeProject?.id ?? null;
    if (inlineSuggestionsProjectRef.current !== currentProjectId) {
      inlineSuggestionsProjectRef.current = currentProjectId;
      setInlineSuggestions(snapshotSuggestions);
      return;
    }

    if (snapshotSuggestions) {
      setInlineSuggestions(snapshotSuggestions);
    }
  }, [activeProject?.id, snapshotSuggestions]);

  const handleSuggestionsGenerated = useCallback((nextSuggestions: FilterSuggestions | null) => {
    setInlineSuggestions(nextSuggestions);
    search.mergeProjectSnapshotMeta({ suggestions: nextSuggestions });
  }, [search]);

  // Search history (must be after search hook)
  const searchHistory = useSearchHistory(search.selectedJob?.id || null);

  // Search actions hook
  const { handleSearch, handleLoadMore } = useLinkedInSearchActions(
    {
      selectedAccount,
      selectedJob: search.selectedJob,
      filters: search.filters,
      filtersRef: search.filtersRef,
      cursor: search.cursor,
      results: search.results,
      activeProject,
      autoHideTreatedRef: search.autoHideTreatedRef,
      searchSource,
      quota: {
        canPerformAction: search.quota.canPerformAction,
        recordAction: search.quota.recordAction,
        isNearLimit: search.quota.isNearLimit,
      },
      candidateStatus: {
        treatedIds: search.candidateStatus.treatedIds,
        dismissedIds: search.candidateStatus.dismissedIds,
        getStatus: search.candidateStatus.getStatus,
        batchDiscover: search.candidateStatus.batchDiscover,
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

  // Auto-relaunch search when source toggle changes
  useEffect(() => {
    if (prevSearchSourceRef.current !== searchSource) {
      prevSearchSourceRef.current = searchSource;
      // Small delay to let the api type effect fire first
      const timer = setTimeout(() => {
        handleSearch();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [searchSource, handleSearch]);

  // Ref for merged results (includes pool profiles) - used by scoring hook
  const allAvailableProfilesRef = useRef<LinkedInProfile[]>([]);

  // Scoring hook
  const scoring = useLinkedInScoring({
    selectedJob: search.selectedJob,
    selectedProfiles: search.selectedProfiles,
    results: search.results,
    allAvailableProfilesRef,
    jobScores: search.jobScores,
    setJobScores: search.setJobScores,
    setScoringInProgress: search.setScoringInProgress,
    setSortByScore: search.setSortByScore,
    setResults: search.setResults,
    setSelectedProfiles: search.setSelectedProfiles,
    autoHideTreatedRef: search.autoHideTreatedRef,
    candidateStatus: {
      batchDismiss: search.candidateStatus.batchDismiss,
      saveScore: search.candidateStatus.saveScore,
      batchSaveScores: search.candidateStatus.batchSaveScores,
    },
    customScoringInstructions: scoringInstructions.trim() || undefined,
    accountId: selectedAccount,
  });

  // Pool view toggle
  const [showPoolView, setShowPoolView] = useLocalState(false);

  // Scored sort
  const [scoredSortBy, setScoredSortBy] = useLocalState<ScoredSortBy>('score_desc');

  const missionCacheKey = activeProject?.id ? `mission-sourcing:${activeProject.id}` : null;
  const hydratedCacheKeyRef = useRef<string | null>(null);
  const restoredScrollKeyRef = useRef<string | null>(null);
  const skipNextCacheWriteRef = useRef(false);

  const cacheMissionState = useCallback((scrollTop?: number) => {
    if (!missionCacheKey) return;

    missionSearchCache.set(missionCacheKey, {
      filters: search.filters,
      results: search.results,
      hasSearched: search.hasSearched,
      total: search.total,
      cursor: search.cursor,
      hasMoreResults: search.hasMoreResults,
      selectedJob: search.selectedJob,
      jobScores: search.jobScores,
      sortByScore: search.sortByScore,
      statusFilter: search.statusFilter as SearchStatusFilter,
      showDismissed: search.showDismissed,
      selectedProfiles: Array.from(search.selectedProfiles),
      showPoolView,
      scoredSortBy,
      searchSource,
      scrollTop: scrollTop ?? scrollAreaRef.current?.scrollTop ?? missionSearchCache.get(missionCacheKey)?.scrollTop ?? 0,
      scoringInstructions,
    });
  }, [missionCacheKey, search.filters, search.results, search.hasSearched, search.total, search.cursor, search.hasMoreResults, search.selectedJob, search.jobScores, search.sortByScore, search.statusFilter, search.showDismissed, search.selectedProfiles, showPoolView, scoredSortBy, searchSource, scoringInstructions]);

  useEffect(() => {
    hydratedCacheKeyRef.current = null;
    restoredScrollKeyRef.current = null;
    skipNextCacheWriteRef.current = false;
  }, [missionCacheKey]);

  useLayoutEffect(() => {
    if (!missionCacheKey || hydratedCacheKeyRef.current === missionCacheKey) return;

    const cached = missionSearchCache.get(missionCacheKey);
    hydratedCacheKeyRef.current = missionCacheKey;

    if (!cached) return;

    skipNextCacheWriteRef.current = true;
    // Mark cache hydration before passive effects run so stale DB snapshot doesn't overwrite it
    search.cacheHydratedRef.current = true;
    setSearchSource(cached.searchSource ?? initialSearchSource);
    search.setFilters(cached.filters);
    search.filtersRef.current = cached.filters;
    search.setResults(cached.results);
    search.setHasSearched(cached.hasSearched);
    search.setTotal(cached.total);
    search.setCursor(cached.cursor);
    search.setHasMoreResults(cached.hasMoreResults);
    // Don't override job from cache when in mission context — the hook auto-creates it from brief
    if (!activeProject) {
      search.setSelectedJob(cached.selectedJob);
    }
    search.setJobScores(cached.jobScores);
    search.setSortByScore(cached.sortByScore);
    search.setStatusFilter(cached.statusFilter);
    search.setShowDismissed(cached.showDismissed);
    search.setSelectedProfiles(new Set(cached.selectedProfiles));
    setShowPoolView(cached.hasSearched ? cached.showPoolView : false);
    setScoredSortBy(cached.scoredSortBy);
    setScoringInstructions(cached.scoringInstructions);
  }, [missionCacheKey, search, activeProject, initialSearchSource]);

  useLayoutEffect(() => {
    if (!missionCacheKey || hydratedCacheKeyRef.current !== missionCacheKey) return;
    if (skipNextCacheWriteRef.current) {
      skipNextCacheWriteRef.current = false;
      return;
    }
    cacheMissionState();
  }, [missionCacheKey, cacheMissionState]);

  useEffect(() => {
    if (!missionCacheKey || !scrollAreaRef.current) return;

    const element = scrollAreaRef.current;
    const handleScroll = () => cacheMissionState(element.scrollTop);

    element.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      handleScroll();
      element.removeEventListener('scroll', handleScroll);
    };
  }, [missionCacheKey, cacheMissionState, search.results.length]);

  useEffect(() => {
    if (!missionCacheKey || restoredScrollKeyRef.current === missionCacheKey || search.results.length === 0) return;

    const cached = missionSearchCache.get(missionCacheKey);
    if (!cached || cached.scrollTop <= 0) return;

    restoredScrollKeyRef.current = missionCacheKey;
    requestAnimationFrame(() => {
      scrollAreaRef.current?.scrollTo({ top: cached.scrollTop });
    });
  }, [missionCacheKey, search.results.length]);

  // Filtered results hook
  const { filteredAndSortedResults, selectableProfiles, allSelectableSelected, poolCount, mergedResults } = useFilteredResults({
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
      statuses: search.candidateStatus.statuses,
    },
    selectedProfiles: search.selectedProfiles,
    calculatedExperienceMin: search.filters.calculated_experience_min,
    calculatedExperienceMax: search.filters.calculated_experience_max,
    showPoolView,
    scoredSortBy,
  });

  // Keep ref in sync with merged results so scoring hook can access pool profiles
  useEffect(() => {
    allAvailableProfilesRef.current = filteredAndSortedResults;
  }, [filteredAndSortedResults]);

  const { handleAutoFillFilters } = useAutoFillFilters({
    selectedAccount,
    filtersRef: search.filtersRef,
    setFilters: search.setFilters,
  });

  // Auto-fill trigger for readiness panel
  const [readinessAutoFillLoading, setReadinessAutoFillLoading] = useState(false);
  const handleReadinessAutoFill = useCallback(async () => {
    if (!search.selectedJob) {
      toast.error('Aucun poste sélectionné');
      return;
    }
    setReadinessAutoFillLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction<{
        filters?: any;
        suggestions?: FilterSuggestions | null;
        success?: boolean;
        error?: string;
      }>(
        'generate-search-filters',
        { job: search.selectedJob, search_source: searchSource || 'linkedin' }
      );
      if (error) throw error;
      if (!data?.success || !data?.filters) throw new Error(data?.error || 'Réponse invalide');
      handleAutoFillFilters(data.filters);
      handleSuggestionsGenerated(
        data.suggestions && Object.values(data.suggestions).some(value => Array.isArray(value) && value.length > 0)
          ? data.suggestions
          : null
      );
      toast.success('Filtres générés par l\'IA !');
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la génération des filtres');
    } finally {
      setReadinessAutoFillLoading(false);
    }
  }, [search.selectedJob, searchSource, handleAutoFillFilters, handleSuggestionsGenerated]);

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

  // Force API type to match searchSource toggle
  useEffect(() => {
    if (searchSource === 'database' && search.filters.api !== 'database') {
      search.setFilters(f => ({ ...f, api: 'database' }));
    } else if (searchSource === 'linkedin' && search.filters.api === 'database') {
      // When switching back to LinkedIn, restore appropriate API mode
      if (subscriptions?.recruiter) {
        search.setFilters(f => ({ ...f, api: 'recruiter' }));
      } else if (subscriptions?.sales_navigator) {
        search.setFilters(f => ({ ...f, api: 'sales_navigator' }));
      } else {
        search.setFilters(f => ({ ...f, api: 'classic' }));
      }
    }
  }, [searchSource, search.filters.api, subscriptions]);

  // Treated/dismissed counts
  const treatedCount = useMemo(() => {
    return search.results.filter(p => search.candidateStatus.treatedIds.has(p.id)).length;
  }, [search.results, search.candidateStatus.treatedIds]);

  const dismissedCount = useMemo(() => {
    return search.results.filter(p => search.candidateStatus.dismissedIds.has(p.id)).length;
  }, [search.results, search.candidateStatus.dismissedIds]);

  // NOTE: jobScores hydration from candidateStatus.statuses is handled in useLinkedInSearch (seedJobScores effect).
  // Do NOT duplicate it here — that causes redundant state updates and contributes to freeze on job selection.


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

  // Find Similar handler
  const handleFindSimilar = useCallback((profile: LinkedInProfile) => {
    const traits = extractTraitsFromProfile(profile);
    const newFilters = traitsToFilters(traits);

    search.setFilters(prev => ({
      ...prev,
      ...newFilters,
    }));

    const parts: string[] = [];
    if (traits.roleTitles[0]) parts.push(traits.roleTitles[0]);
    if (traits.location) parts.push(traits.location);
    if (traits.experienceYears) parts.push(`~${traits.experienceYears} ans`);
    const summary = parts.join(' · ') || profile.name || 'profil';

    toast.success(`Filtres appliqués : ${summary}`, {
      description: 'Cliquez sur Rechercher pour lancer',
      duration: 4000,
    });
  }, [search.setFilters]);

  // Refine search state and handler
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineModalOpen, setRefineModalOpen] = useState(false);
  const [refineDirection, setRefineDirection] = useState<'expand' | 'narrow'>('expand');
  const [refineAdjustments, setRefineAdjustments] = useState<RefineAdjustment[]>([]);
  const [refineSummary, setRefineSummary] = useState<string | null>(null);
  const [refineExpectedImpact, setRefineExpectedImpact] = useState<string | null>(null);

  const arrayFields = useMemo(() => new Set([
    'role', 'location', 'school', 'company', 'industry', 'function',
    'degree', 'skills', 'job_title', 'seniority', 'network_distance',
    'profile_language', 'open_to', 'groups', 'company_location',
    'past_company', 'past_job_title', 'company_headcount', 'company_type',
    'company_keywords', 'tags',
  ]), []);

  const fetchRefineSuggestions = useCallback(async () => {
    if (!selectedAccount || !search.selectedJob) return;
    setRefineLoading(true);
    setRefineAdjustments([]);
    setRefineSummary(null);
    setRefineExpectedImpact(null);
    try {
      const currentSearchParams = buildSearchParams(search.filters, selectedAccount);
      const { data, error } = await invokeEdgeFunction<{ adjustments?: any[]; summary?: string; expectedImpact?: any }>('refine-search-filters', {
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
        direction: refineDirection,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur inconnue');

      setRefineAdjustments(data.adjustments || []);
      setRefineSummary(data.summary || null);
      setRefineExpectedImpact(data.expectedImpact || null);

      if (!data.adjustments || data.adjustments.length === 0) {
        toast.info('Aucun ajustement suggéré');
      }
    } catch (err: any) {
      console.error('[RefineSearch] Error:', err);
      toast.error(err.message || 'Erreur lors de l\'analyse');
    } finally {
      setRefineLoading(false);
    }
  }, [selectedAccount, search.selectedJob, search.filters, search.total, search.results.length, refineDirection]);

  const handleOpenRefineModal = useCallback((direction: 'expand' | 'narrow') => {
    setRefineDirection(direction);
    setRefineAdjustments([]);
    setRefineSummary(null);
    setRefineExpectedImpact(null);
    setRefineModalOpen(true);
  }, []);

  const handleApplyRefinements = useCallback((decisions: Record<number, AdjustmentDecision>) => {
    const accepted = refineAdjustments.filter((_, i) => {
      const d = decisions[i];
      return d === 'accept' || d === 'cautious';
    });

    if (accepted.length === 0) {
      setRefineModalOpen(false);
      return;
    }

    const cautiousIndices = new Set(
      Object.entries(decisions)
        .filter(([, d]) => d === 'cautious')
        .map(([i]) => Number(i))
    );

    search.setFilters(prev => {
      const updated = { ...prev };
      for (let i = 0; i < refineAdjustments.length; i++) {
        const d = decisions[i];
        if (d !== 'accept' && d !== 'cautious') continue;

        const adj = refineAdjustments[i];
        const field = adj.field as string;
        let value = adj.value;

        if (cautiousIndices.has(i)) {
          if (typeof value === 'number' && field in prev) {
            const current = (prev as any)[field];
            if (typeof current === 'number') {
              value = Math.round(current + (value as number - current) * 0.5);
            }
          }
          if (typeof value === 'object' && value && !Array.isArray(value) && ('min' in (value as any) || 'max' in (value as any))) {
            const v = { ...(value as { min?: number; max?: number }) };
            const currentMin = (prev as any)[`${field}_min`] ?? (prev as any).calculated_experience_min;
            const currentMax = (prev as any)[`${field}_max`] ?? (prev as any).calculated_experience_max;
            if (v.min != null && typeof currentMin === 'number') v.min = Math.round(currentMin + (v.min - currentMin) * 0.5);
            if (v.max != null && typeof currentMax === 'number') v.max = Math.round(currentMax + (v.max - currentMax) * 0.5);
            value = v;
          }
        }

        if (field === 'years_of_experience' && value && typeof value === 'object' && !Array.isArray(value)) {
          const v = value as { min?: number; max?: number };
          if ('min' in v) (updated as any).years_of_experience_min = v.min;
          if ('max' in v) (updated as any).years_of_experience_max = v.max;
          continue;
        }

        if (field === 'skills_keywords') {
          if (Array.isArray(value)) {
            updated.skills = (value as string[]).map((s: string) => ({
              id: s.toLowerCase().replace(/\s+/g, '-'),
              name: s,
              keywords: s,
              priority: 'CAN_HAVE' as const,
            }));
          }
          continue;
        }

        if (!(field in updated)) continue;

        if (arrayFields.has(field)) {
          if (Array.isArray(value)) {
            (updated as any)[field] = value;
          } else if (value && typeof value === 'object') {
            (updated as any)[field] = [value];
          }
        } else {
          (updated as any)[field] = value;
        }
      }
      return updated;
    });

    search.setResults([]);
    search.setCursor(null);
    search.setHasMoreResults(true);
    search.setHasSearched(false);
    search.setTotal(null);

    const appliedCount = accepted.length;
    const cautiousCount = cautiousIndices.size;
    toast.success(
      `${appliedCount} ajustement${appliedCount > 1 ? 's' : ''} appliqué${appliedCount > 1 ? 's' : ''}${cautiousCount > 0 ? ` (${cautiousCount} avec prudence)` : ''}`,
      { duration: 4000 }
    );

    setRefineModalOpen(false);

    // Auto-trigger search with updated filters
    queueMicrotask(() => handleSearch(false));
  }, [refineAdjustments, search.setFilters, search.setResults, search.setCursor, search.setHasMoreResults, search.setHasSearched, search.setTotal, arrayFields, handleSearch]);

  // No auto-infinite scroll — batch workflow uses manual "Lot suivant" button
  // The loadMoreTriggerRef is kept for the button placement in SearchResultsPanel

  // Auto-switch to "Nouveaux" filter when new batch loads and there are untreated profiles
  const prevResultsLengthRef = useRef(0);
  useEffect(() => {
    if (search.results.length > prevResultsLengthRef.current && search.hasSearched) {
      // New batch loaded — switch to untreated view
      if (search.statusFilter !== 'untreated' && search.statusFilter !== 'all') {
        search.setStatusFilter('untreated');
      }
    }
    prevResultsLengthRef.current = search.results.length;
  }, [search.results.length, search.hasSearched]);

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
      activeProject={activeProject || null}
      searchSource={searchSource}
      onSearchSourceChange={handleSearchSourceChange}
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
      onApplyHistoryFilters={(historyFilters) => {
        const merged = { ...INITIAL_FILTERS, ...historyFilters };
        search.setFilters(merged);
        // Update ref immediately so handleSearch reads fresh filters
        search.filtersRef.current = merged;
        search.setResults([]);
        search.setHasSearched(false);
        search.setCursor(null);
        search.setTotal(null);
        search.setSelectedProfiles(new Set());
        search.setJobScores({});
        setFiltersOpen(false);
        // Trigger search on next tick (after state updates)
        queueMicrotask(() => handleSearch(false));
        toast.info('Filtres de l\'historique appliqués, recherche en cours...');
      }}
      onDeleteHistoryEntry={searchHistory.deleteEntry}
      scoringInstructions={scoringInstructions}
      onScoringInstructionsChange={setScoringInstructions}
      suggestions={activeProject ? effectiveSuggestions : null}
      onSuggestionsGenerated={handleSuggestionsGenerated}
    />
  );

  return (
    <div className="w-full max-w-full min-w-0 flex flex-col lg:h-[calc(100dvh-5rem)]">
      {/* Filters bar — always visible */}
      <AppliedFiltersBar
        filters={search.filters}
        selectedJob={search.selectedJob}
        searchSource={searchSource}
        onSearchSourceChange={handleSearchSourceChange}
        onOpenFilters={() => setFiltersOpen(true)}
        onSearch={() => handleSearch(false)}
        loading={search.loading}
        hasSearched={search.hasSearched}
      />

      {/* Filters modal — large overlay */}
      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="w-full h-full max-w-full max-h-full sm:max-w-[90vw] sm:w-[90vw] sm:max-h-[85vh] sm:h-auto overflow-y-auto p-0 gap-0 rounded-none sm:rounded-lg">
          <DialogTitle className="sr-only">Filtres de recherche</DialogTitle>
          <div className="p-4 sm:p-6">
            {filtersPanel}
          </div>
        </DialogContent>
      </Dialog>

      {/* Results panel — full width */}
      <div className="min-w-0 min-h-0 flex-1">
        <SearchResultsPanel
          results={search.results}
          mergedResults={mergedResults}
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
          searchSource={searchSource}
          onAutoFill={handleReadinessAutoFill}
          autoFillLoading={readinessAutoFillLoading}
          filtersReady={!!(search.filters.keywords?.trim() || (search.filters as any).role?.length > 0)}
          accountName={selectedAccountData?.name || selectedAccountData?.identifier || null}
          accountStatus={selectedAccountData?.status || null}
          treatedCandidates={search.candidateStatus.statuses}
          onRestoreCandidate={search.candidateStatus.restoreCandidate}
          showBulkInMailModal={search.showBulkInMailModal}
          poolCount={poolCount}
          showPoolView={showPoolView}
          onSetShowPoolView={setShowPoolView}
          onSearch={() => handleSearch(false)}
          onLoadMore={handleLoadMore}
          onToggleProfileSelection={search.toggleProfileSelection}
          onToggleSelectAll={() => search.toggleSelectAll(selectableProfiles)}
          onScoreProfile={scoring.scoreProfile}
          onBatchScore={scoring.handleBatchScore}
          onBulkDismiss={handleBulkDismiss}
          onBulkAddToProject={handleBulkAddToProject}
          onSetAutoHideTreated={search.setAutoHideTreated}
          onSetShowDismissed={search.setShowDismissed}
          onSetStatusFilter={search.setStatusFilter}
          onSetSortByScore={search.setSortByScore}
          scoredSortBy={scoredSortBy}
          onSetScoredSortBy={setScoredSortBy}
          onSetShowBulkInMailModal={search.setShowBulkInMailModal}
          onProfileTreated={handleProfileTreated}
          onArchive={handleArchive}
          onMessageSent={handleMessageSent}
          onSequenceEnrollSuccess={handleSequenceEnrollSuccess}
          onRefineSearch={handleOpenRefineModal}
          refineLoading={refineLoading}
          scrollAreaRef={scrollAreaRef}
          loadMoreTriggerRef={loadMoreTriggerRef}
          batchReport={scoring.batchReport}
          batchStats={scoring.batchStats}
          batchDurationMs={scoring.batchDurationMs}
          onClearBatchReport={scoring.clearBatchReport}
          onFindSimilar={handleFindSimilar}
        />
      </div>

      {search.selectedJob ? (
        <FilterWizard
          open={search.showFilterWizard}
          onOpenChange={search.setShowFilterWizard}
          job={search.selectedJob}
          accountId={selectedAccount ?? undefined}
          onApplyFilters={(nextFilters) => {
            search.setFilters((prev) => ({
              ...prev,
              ...nextFilters,
            }));
          }}
        />
      ) : null}

      {/* Refine Search Modal */}
      <RefineSearchModal
        open={refineModalOpen}
        onOpenChange={setRefineModalOpen}
        direction={refineDirection}
        loading={refineLoading}
        adjustments={refineAdjustments}
        summary={refineSummary}
        expectedImpact={refineExpectedImpact}
        onFetchSuggestions={fetchRefineSuggestions}
        onApply={handleApplyRefinements}
      />
    </div>
  );
};
