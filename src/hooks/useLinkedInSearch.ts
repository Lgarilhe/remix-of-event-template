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
  statusFilter: 'all' | 'untreated' | 'scored' | 'scored_go' | 'scored_maybe' | 'scored_investigate' | 'scored_not_contacted' | 'messaged' | 'dismissed' | 'known';
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

  // Load filters from active project's filters_snapshot
  const filtersSnapshotRef = useRef<string | null>(null);
  // Track whether cache was hydrated so we skip snapshot reload on remount
  const cacheHydratedRef = useRef(false);
  useEffect(() => {
    // If cache was just hydrated, the in-memory filters are more recent than DB — skip
    if (cacheHydratedRef.current) {
      cacheHydratedRef.current = false;
      // Still set the ref so future snapshot changes are detected
      const savedFilters = activeProject?.filters_snapshot;
      if (savedFilters) {
        filtersSnapshotRef.current = savedFilters.last_manual_edit || savedFilters.generated_at || JSON.stringify(savedFilters).slice(0, 100);
      }
      return;
    }
    if (!activeProject) return;
    const savedFilters = activeProject.filters_snapshot;
    if (!savedFilters || Object.keys(savedFilters).length === 0) return;

    // Avoid re-applying the same filters (check by timestamp)
    const snapshotKey = savedFilters.last_manual_edit || savedFilters.generated_at || JSON.stringify(savedFilters).slice(0, 100);
    if (filtersSnapshotRef.current === snapshotKey) return;
    filtersSnapshotRef.current = snapshotKey;

    // If filters were manually edited (UI format already), load directly
    if (savedFilters.last_manual_edit) {
      const { last_manual_edit, generated_at, suggestions, skills_keywords, location_keywords, years_of_experience_min, years_of_experience_max, ...uiFilters } = savedFilters;
      // Mark as initial load so the save effect skips this change
      initialFilterLoadRef.current = true;
      // Don't restore api from snapshot — it must match the current search source toggle
      const { api: _savedApi, ...safeUiFilters } = uiFilters as any;
      setFilters({ ...INITIAL_FILTERS, ...safeUiFilters });
      return;
    }

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
    // Mark as initial load so the save effect skips this filter change
    initialFilterLoadRef.current = true;
    toast.info(`Filtres du projet "${activeProject.name}" chargés`);
  }, [activeProject?.id, activeProject?.filters_snapshot]); // Re-run when filters are generated

  // Build synthetic job from project brief for scoring
  useEffect(() => {
    if (!activeProject) return;
    const jd = (activeProject as any).job_details || {};

    // Helper: build complete job fields from job_details brief
    const buildJobFromBrief = (base: Record<string, any>): Record<string, any> => {
      const job = { ...base };
      // Skills
      job.skills = [...(jd.skills_must_have || []), ...(jd.skills_should_have || [])];
      // Description: combine mission + context for richer scoring
      const descParts = [jd.mission_description, jd.context].filter(Boolean);
      if (descParts.length) job.description = descParts.join('\n\n');
      // Must/should/nice-to-have
      if (jd.skills_must_have?.length) job.mustHave = jd.skills_must_have.join(', ');
      if (jd.skills_should_have?.length) job.shouldHave = jd.skills_should_have.join(', ');
      if (jd.skills_nice_to_have?.length) job.niceToHave = jd.skills_nice_to_have.join(', ');
      // Basic fields
      if (jd.seniority) job.seniority = jd.seniority;
      if (jd.location) job.location = jd.location;
      if (jd.experience_min != null) job.xpMin = jd.experience_min;
      if (jd.experience_max != null) job.xpMax = jd.experience_max;
      // Fields that were missing from the brief mapping
      if (jd.remote_policy) job.remote = jd.remote_policy;
      if (jd.contract_type) job.contractType = jd.contract_type;
      if (jd.salary_min != null) job.salaryMin = jd.salary_min;
      if (jd.salary_max != null) job.salaryMax = jd.salary_max;
      if (jd.salary_type === 'daily' && jd.salary_min != null) job.tjmMin = jd.salary_min;
      // Certifications & requirements as extra context
      const reqParts: string[] = [];
      if (jd.certifications?.length) reqParts.push(`Certifications requises : ${jd.certifications.join(', ')}`);
      if (jd.languages?.length) reqParts.push(`Langues : ${jd.languages.map((l: any) => `${l.language} (${l.level})`).join(', ')}`);
      if (reqParts.length) job.requirements = reqParts.join('. ');
      // Evaluation criteria from the brief → bodyContent for the LLM
      if (jd.evaluation_criteria?.length && Array.isArray(jd.evaluation_criteria)) {
        const criteriaText = jd.evaluation_criteria
          .filter((c: any) => c && c.label)
          .slice(0, 15) // max 15 criteria to limit token usage
          .map((c: any) => `[${c.category || '?'}${c.deal_breaker ? ' DEAL-BREAKER' : ''} poids:${c.weight || 1}] ${c.label}: ${(c.description || '').slice(0, 150)}${c.level_10 ? ` (10/10: ${c.level_10.slice(0, 80)})` : ''}${c.level_1 ? ` (rédhibitoire: ${c.level_1.slice(0, 80)})` : ''}`)
          .join('\n');
        job.bodyContent = (job.bodyContent ? job.bodyContent + '\n\n' : '') + `=== CRITÈRES D'ÉVALUATION DU MANAGER ===\n${criteriaText}`;
      }
      // Raw brief : TOUJOURS transmis dans son propre field (séparé de
      // bodyContent qui sert pour les criteria). Le LLM scoring l'utilise
      // pour récupérer toutes les nuances que l'extraction IA a pu rater
      // (ex: "passé par une scale-up santé", "anglais courant requis", etc.)
      if (jd.raw_brief) {
        // 4000 chars couvre une fiche WTTJ / LinkedIn complète sans trop
        // bloater le prompt LLM (~1k tokens).
        job.originalBriefText = jd.raw_brief.slice(0, 4000);
      }
      // Safety: cap bodyContent total length (criteria seulement)
      if (job.bodyContent && job.bodyContent.length > 3000) {
        job.bodyContent = job.bodyContent.slice(0, 3000);
      }
      // Target companies as transversal context
      if (jd.target_companies?.length) {
        const companies = jd.target_companies.flatMap((cat: any) => cat.companies?.map((c: any) => c.name) || []).filter(Boolean);
        if (companies.length && !job.transversalCriteria) {
          job.transversalCriteria = { context: `Entreprises cibles / feeders : ${companies.join(', ')}` };
        }
      }
      // ⭐ Outreach config (incarnation IA pour les messages générés sur cette mission).
      // Forward direct depuis job_details vers le synthetic job pour que
      // OutreachMessageModal puisse le passer à generate-outreach-message.
      if ((jd as any).outreach_config) {
        (job as any).outreachConfig = (jd as any).outreach_config;
      }
      // ─── Sprint D : best-in-class context — fields structurés ───────
      // Avant : on sérialisait evaluation_criteria en TEXTE dans bodyContent.
      // Maintenant : on transmet aussi la structure brute pour que le LLM
      // voie explicitement les deal-breakers, weights, level_10/level_1.
      const jdAny = jd as any;
      if (jd.evaluation_criteria?.length) {
        (job as any).evaluationCriteria = jd.evaluation_criteria.slice(0, 12).map((c: any) => ({
          label: c.label,
          description: c.description,
          category: c.category,
          weight: c.weight,
          dealBreaker: !!c.deal_breaker,
          level10: c.level_10,
          level1: c.level_1,
          interviewStage: c.interview_stage,
        }));
      }
      if (jdAny.evaluation_weights) {
        (job as any).evaluationWeights = jdAny.evaluation_weights;
      }
      if (jd.target_companies?.length) {
        (job as any).targetCompanies = jd.target_companies.slice(0, 6).map((cat: any) => ({
          category: cat.category,
          companies: (cat.companies || []).slice(0, 8).map((c: any) => c.name).filter(Boolean),
        }));
      }
      if (jd.calibration_profiles?.length) {
        (job as any).calibrationProfiles = jd.calibration_profiles.slice(0, 5).map((p: any) => ({
          name: p.name,
          headline: p.headline,
          linkedinUrl: p.linkedin_url,
          whyGoodFit: p.why_good_fit,
          areasOfImprovement: p.areas_of_improvement,
        }));
      }
      if (jd.skills_to_avoid?.length) {
        (job as any).skillsToAvoid = jd.skills_to_avoid;
      }
      if (jd.languages?.length) {
        (job as any).requiredLanguages = jd.languages.map((l: any) => ({
          language: l.language, level: l.level,
        }));
      }
      if (jd.certifications?.length) {
        (job as any).requiredCertifications = jd.certifications;
      }
      if (jd.client?.size || jd.client?.culture_notes) {
        const existingClient = job.client || (jd.client?.name ? { name: jd.client.name, sector: jd.client.sector } : null);
        if (existingClient) {
          job.client = {
            ...existingClient,
            size: jd.client?.size,
            cultureNotes: jd.client?.culture_notes,
          } as any;
        }
      }
      if (jdAny.urgency) (job as any).urgency = jdAny.urgency;
      if (jd.team_size) (job as any).teamSize = jd.team_size;
      if (jd.reports_to) (job as any).reportsTo = jd.reports_to;
      if (jd.manages) (job as any).manages = jd.manages;
      return job;
    };

    if (activeProject.job_id && activeProject.job_title) {
      const enriched = buildJobFromBrief({
        id: activeProject.job_id,
        title: jd.title || activeProject.job_title,
        client: activeProject.client_name ? { name: activeProject.client_name, sector: jd.client?.sector } : undefined,
      });
      setSelectedJob(enriched as Job);
    } else {
      const synthetic = buildJobFromBrief({
        id: `project:${activeProject.id}`,
        title: jd.title || activeProject.name || 'Mission sans titre',
        description: activeProject.description || '',
        client: activeProject.client_name ? { name: activeProject.client_name, sector: jd.client?.sector } : undefined,
      });
      setSelectedJob(synthetic as Job);
    }
  }, [activeProject?.id, activeProject?.job_details]); // Re-run when brief data changes

  // Deferred location resolution: when selectedAccount becomes available and we have a pending location
  useEffect(() => {
    if (selectedAccount && pendingLocationRef.current) {
      resolveLocation(pendingLocationRef.current, selectedAccount);
    }
  }, [selectedAccount, resolveLocation]);

  // ── Auto-persist filter changes to filters_snapshot (debounced) ──
  const filterSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialFilterLoadRef = useRef(true);

  // Reset initial-load guard when project changes
  useEffect(() => {
    initialFilterLoadRef.current = true;
  }, [activeProject?.id]);

  // Keep latest values in refs so pending edits survive tab changes/unmounts
  const latestFiltersForSaveRef = useRef(filters);
  const latestProjectIdRef = useRef<string | null>(activeProject?.id ?? null);
  const latestProjectSnapshotRef = useRef<Record<string, any>>((activeProject?.filters_snapshot || {}) as Record<string, any>);

  useEffect(() => {
    latestFiltersForSaveRef.current = filters;
  }, [filters]);

  useEffect(() => {
    latestProjectIdRef.current = activeProject?.id ?? null;
    latestProjectSnapshotRef.current = (activeProject?.filters_snapshot || {}) as Record<string, any>;
  }, [activeProject?.id, activeProject?.filters_snapshot]);

  const mergeProjectSnapshotMeta = useCallback((patch: Record<string, any>) => {
    latestProjectSnapshotRef.current = {
      ...latestProjectSnapshotRef.current,
      ...patch,
    };
  }, []);

  const persistFiltersSnapshot = useCallback((filtersToPersist: LinkedInFiltersState) => {
    const projectId = latestProjectIdRef.current;
    if (!projectId) return;
    if (JSON.stringify(filtersToPersist) === JSON.stringify(INITIAL_FILTERS)) return;

    const ts = new Date().toISOString();
    filtersSnapshotRef.current = ts;

    const nextSnapshot = {
      ...latestProjectSnapshotRef.current,
      ...filtersToPersist,
      last_manual_edit: ts,
    };

    latestProjectSnapshotRef.current = nextSnapshot;
    updateProject({
      id: projectId,
      filters_snapshot: nextSnapshot,
    });
  }, [updateProject]);

  useEffect(() => {
    // Skip the first render (initial load from filters_snapshot)
    if (initialFilterLoadRef.current) {
      initialFilterLoadRef.current = false;
      return;
    }
    if (!activeProject?.id) return;
    // Don't save default/empty filters
    if (JSON.stringify(filters) === JSON.stringify(INITIAL_FILTERS)) return;

    if (filterSaveTimerRef.current) clearTimeout(filterSaveTimerRef.current);
    filterSaveTimerRef.current = setTimeout(() => {
      filterSaveTimerRef.current = null;
      persistFiltersSnapshot(latestFiltersForSaveRef.current);
    }, 2000);

    return () => {
      if (filterSaveTimerRef.current) {
        clearTimeout(filterSaveTimerRef.current);
        filterSaveTimerRef.current = null;
      }
    };
  }, [filters, activeProject?.id, persistFiltersSnapshot]);

  // Flush pending save when leaving the mission/tab before the debounce completes
  useEffect(() => {
    return () => {
      if (!filterSaveTimerRef.current) return;
      clearTimeout(filterSaveTimerRef.current);
      filterSaveTimerRef.current = null;
      persistFiltersSnapshot(latestFiltersForSaveRef.current);
    };
  }, [activeProject?.id, persistFiltersSnapshot]);

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

    // Snapshot metadata
    mergeProjectSnapshotMeta,
    
    // Cache coordination
    cacheHydratedRef,
  };
}
