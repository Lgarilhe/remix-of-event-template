import { useMemo, useState, useEffect, useRef } from 'react';
import { LinkedInFiltersState, LinkedInProfile } from '@/components/outreach/types';
import { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import { Job } from '@/types/jobs';
import { JobCandidateStatus } from '@/hooks/useJobCandidateStatus';
import { calculatePreScore } from '@/hooks/linkedin/preScoring';

export type ScoredSortBy = 'score_desc' | 'score_asc' | 'recent' | 'name'
  | 'tech_desc' | 'xp_desc' | 'domain_desc' | 'fit_desc' | 'soft_desc';

interface FilteredResultsOptions {
  results: LinkedInProfile[];
  jobScores: Record<string, JobMatchResult>;
  sortByScore: boolean;
  selectedJob: Job | null;
  autoHideTreated: boolean;
  showDismissed: boolean;
  statusFilter: 'all' | 'untreated' | 'scored' | 'scored_go' | 'scored_maybe' | 'scored_investigate' | 'scored_not_contacted' | 'messaged' | 'dismissed' | 'known';
  candidateStatus: {
    treatedIds: Set<string>;
    dismissedIds: Set<string>;
    getStatus: (id: string) => { status: string } | undefined;
    statuses?: Map<string, JobCandidateStatus>;
  };
  selectedProfiles: Set<string>;
  calculatedExperienceMin?: number | null;
  calculatedExperienceMax?: number | null;
  showPoolView?: boolean;
  scoredSortBy?: ScoredSortBy;
}

// Rehydrate a LinkedInProfile from stored DB data
function rehydrateProfile(status: JobCandidateStatus): LinkedInProfile & { _fromPool?: boolean } {
  const data = status.linkedin_profile_data as Record<string, any> | null;
  return {
    id: status.candidate_id,
    name: status.candidate_name || data?.name || 'Inconnu',
    first_name: data?.first_name,
    last_name: data?.last_name,
    headline: status.candidate_headline || data?.headline || '',
    profile_url: status.linkedin_profile_url || data?.profile_url || '',
    public_profile_url: data?.public_profile_url || status.linkedin_profile_url || '',
    location: data?.location || undefined,
    summary: data?.summary,
    skills: data?.skills || [],
    work_experience: data?.work_experience || [],
    education: data?.education || [],
    current_positions: data?.current_positions,
    past_positions: data?.past_positions,
    profile_picture_url: data?.profile_picture_url,
    network_distance: data?.network_distance,
    connections_count: data?.connections_count,
    industry: data?.industry,
    open_to_work: data?.open_to_work,
    _fromPool: true,
  } as LinkedInProfile & { _fromPool?: boolean };
}

// Check if a status has enough data to be rehydrated into a visible profile
function canRehydrate(status: JobCandidateStatus): boolean {
  return !!(status.linkedin_profile_data || status.candidate_name || status.linkedin_profile_url);
}

export function useFilteredResults({
  results,
  jobScores,
  sortByScore,
  selectedJob,
  autoHideTreated,
  showDismissed,
  statusFilter,
  candidateStatus,
  selectedProfiles,
  showPoolView = true,
  scoredSortBy = 'score_desc',
}: FilteredResultsOptions) {
  const { treatedIds, dismissedIds, getStatus, statuses } = candidateStatus;

  // Merge search results with pool profiles from DB
  // Cap pool profiles to avoid freezing the main thread with large candidate pools
  const MAX_POOL_PROFILES = 500;

  const mergedResults = useMemo(() => {
    if (!showPoolView || !statuses || statuses.size === 0) return results;

    // Index current search results by ID
    const byId = new Map<string, LinkedInProfile>();
    for (const r of results) {
      byId.set(r.id, r);
    }

    // Add DB profiles not in current search (pool profiles) — WITHOUT pre-score (deferred)
    // Cap to MAX_POOL_PROFILES to avoid blocking the main thread
    let poolAdded = 0;
    for (const [candidateId, status] of statuses) {
      if (poolAdded >= MAX_POOL_PROFILES) break;
      if (!byId.has(candidateId) && canRehydrate(status)) {
        const rehydrated = rehydrateProfile(status);
        byId.set(candidateId, rehydrated);
        poolAdded++;
      }
    }

    return Array.from(byId.values());
  }, [results, statuses, showPoolView]);

  // Deferred pre-scoring: calculate pre-scores in chunks to avoid freezing the main thread
  const [preScores, setPreScores] = useState<Map<string, any>>(new Map());
  const preScoreGenRef = useRef(0);
  // Track which IDs have already been scored to avoid stale closure issues
  const scoredIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedJob || mergedResults.length === 0) {
      setPreScores(new Map());
      scoredIdsRef.current = new Set();
      return;
    }

    // Use ref to check already-scored IDs (avoids stale closure on preScores)
    const profilesToScore = mergedResults.filter(p => !scoredIdsRef.current.has(p.id));
    
    if (profilesToScore.length === 0) return;

    const gen = ++preScoreGenRef.current;
    const jobSkills = selectedJob.skills || [];

    let cancelled = false;
    const CHUNK_SIZE = 20;

    (async () => {
      const batchScores = new Map<string, any>();
      for (let i = 0; i < profilesToScore.length; i += CHUNK_SIZE) {
        if (cancelled || gen !== preScoreGenRef.current) return;
        const chunk = profilesToScore.slice(i, i + CHUNK_SIZE);
        for (const p of chunk) {
          batchScores.set(p.id, calculatePreScore(p, selectedJob, jobSkills));
          scoredIdsRef.current.add(p.id);
        }
        // Yield to main thread between chunks
        if (i + CHUNK_SIZE < profilesToScore.length) {
          await new Promise(r => setTimeout(r, 0));
        }
      }
      if (!cancelled && gen === preScoreGenRef.current) {
        setPreScores(prev => {
          const next = new Map(prev);
          for (const [id, score] of batchScores) {
            next.set(id, score);
          }
          return next;
        });
      }
    })();

    return () => { cancelled = true; };
  }, [mergedResults, selectedJob]);

  // Count pool-only profiles
  const poolCount = useMemo(() => {
    if (!statuses) return 0;
    const searchIds = new Set(results.map(r => r.id));
    let count = 0;
    for (const [candidateId, status] of statuses) {
      if (!searchIds.has(candidateId) && canRehydrate(status)) {
        count++;
      }
    }
    return count;
  }, [results, statuses]);

  // Filter and sort results
  const filteredAndSortedResults = useMemo(() => {
    let filtered = mergedResults;

    // Apply status filter
    if (selectedJob && statusFilter !== 'all') {
      filtered = filtered.filter(p => {
        const status = getStatus(p.id);
        switch (statusFilter) {
          case 'untreated':
            // discovered is functionally "untreated"
            return !status || status.status === 'discovered';
          case 'scored':
            return status?.status === 'scored' || ((status?.status === 'messaged' || status?.status === 'replied') && !!(jobScores[p.id] || (statuses?.get(p.id)?.score != null)));
          case 'scored_go': {
            const isScored = status?.status === 'scored' || ((status?.status === 'messaged' || status?.status === 'replied') && !!(jobScores[p.id] || (statuses?.get(p.id)?.score != null)));
            if (!isScored) return false;
            const rec = jobScores[p.id]?.recommendation || statuses?.get(p.id)?.recommendation;
            return rec === 'go';
          }
          case 'scored_maybe': {
            const isScored = status?.status === 'scored' || ((status?.status === 'messaged' || status?.status === 'replied') && !!(jobScores[p.id] || (statuses?.get(p.id)?.score != null)));
            if (!isScored) return false;
            const rec = jobScores[p.id]?.recommendation || statuses?.get(p.id)?.recommendation;
            return rec === 'maybe';
          }
          case 'scored_investigate': {
            // Sprint UI-2 : profils que le LLM a flagués investigationNeeded
            // (fitScore ≥ 60 mais confidenceScore < 70). Profil prometteur
            // mais signal faible — à confirmer en call court.
            const isScored = status?.status === 'scored' || ((status?.status === 'messaged' || status?.status === 'replied') && !!(jobScores[p.id] || (statuses?.get(p.id)?.score != null)));
            if (!isScored) return false;
            const score = jobScores[p.id];
            return score?.investigationNeeded === true;
          }
          case 'scored_not_contacted':
            return status?.status === 'scored';
          case 'messaged':
            return status?.status === 'messaged' || status?.status === 'replied';
          case 'dismissed':
            return status?.status === 'dismissed';
          default:
            return true;
        }
      });
    }

    // Determine if we're in a "scored" view
    const inScoredView = statusFilter === 'scored' || statusFilter === 'scored_go' || statusFilter === 'scored_maybe' || statusFilter === 'scored_not_contacted';

    if (inScoredView && scoredSortBy) {
      filtered = [...filtered].sort((a, b) => {
        switch (scoredSortBy) {
          case 'score_desc': {
            const scoreA = jobScores[a.id]?.match_score ?? statuses?.get(a.id)?.score ?? -1;
            const scoreB = jobScores[b.id]?.match_score ?? statuses?.get(b.id)?.score ?? -1;
            return scoreB - scoreA;
          }
          case 'score_asc': {
            const scoreA = jobScores[a.id]?.match_score ?? statuses?.get(a.id)?.score ?? -1;
            const scoreB = jobScores[b.id]?.match_score ?? statuses?.get(b.id)?.score ?? -1;
            return scoreA - scoreB;
          }
          case 'recent': {
            const dateA = statuses?.get(a.id)?.updated_at || statuses?.get(a.id)?.created_at || '';
            const dateB = statuses?.get(b.id)?.updated_at || statuses?.get(b.id)?.created_at || '';
            return dateB.localeCompare(dateA);
          }
          case 'name': {
            const nameA = (a.name || `${a.first_name || ''} ${a.last_name || ''}`).trim().toLowerCase();
            const nameB = (b.name || `${b.first_name || ''} ${b.last_name || ''}`).trim().toLowerCase();
            return nameA.localeCompare(nameB);
          }
          case 'tech_desc': {
            const dimA = jobScores[a.id]?.dimensions?.tech_stack?.score ?? jobScores[a.id]?.dimensions?.tech_fit_llm?.score ?? -1;
            const dimB = jobScores[b.id]?.dimensions?.tech_stack?.score ?? jobScores[b.id]?.dimensions?.tech_fit_llm?.score ?? -1;
            return dimB - dimA;
          }
          case 'xp_desc': {
            const dimA = jobScores[a.id]?.dimensions?.seniority?.score ?? -1;
            const dimB = jobScores[b.id]?.dimensions?.seniority?.score ?? -1;
            return dimB - dimA;
          }
          case 'domain_desc': {
            const dimA = jobScores[a.id]?.dimensions?.domain?.score ?? -1;
            const dimB = jobScores[b.id]?.dimensions?.domain?.score ?? -1;
            return dimB - dimA;
          }
          case 'fit_desc': {
            const dimA = jobScores[a.id]?.dimensions?.company_fit?.score ?? -1;
            const dimB = jobScores[b.id]?.dimensions?.company_fit?.score ?? -1;
            return dimB - dimA;
          }
          case 'soft_desc': {
            const dimA = jobScores[a.id]?.dimensions?.soft_skills?.score ?? jobScores[a.id]?.dimensions?.soft_skills_llm?.score ?? -1;
            const dimB = jobScores[b.id]?.dimensions?.soft_skills?.score ?? jobScores[b.id]?.dimensions?.soft_skills_llm?.score ?? -1;
            return dimB - dimA;
          }
          default:
            return 0;
        }
      });
    } else if (sortByScore && Object.keys(jobScores).length > 0) {
      filtered = [...filtered].sort((a, b) => {
        const scoreA = jobScores[a.id]?.match_score ?? -1;
        const scoreB = jobScores[b.id]?.match_score ?? -1;
        return scoreB - scoreA;
      });
    } else {
      // Default sort by pre-score (descending) — uses deferred preScores map
      filtered = [...filtered].sort((a, b) => {
        const preA = preScores.get(a.id)?.preScore ?? (a as any)._preScore?.preScore ?? 50;
        const preB = preScores.get(b.id)?.preScore ?? (b as any)._preScore?.preScore ?? 50;
        return preB - preA;
      });
    }

    return filtered;
  }, [mergedResults, jobScores, sortByScore, selectedJob, showDismissed, autoHideTreated, treatedIds, dismissedIds, getStatus, statusFilter, scoredSortBy, statuses, preScores]);

  // Calculate selectable profiles (exclude "peu adapté")
  const selectableProfiles = useMemo(() => {
    return filteredAndSortedResults.filter(p => {
      const score = jobScores[p.id];
      return !score || score.recommendation !== 'skip';
    });
  }, [filteredAndSortedResults, jobScores]);

  // Check if all selectable profiles are selected
  const allSelectableSelected = useMemo(() => {
    if (selectableProfiles.length === 0) return false;
    return selectableProfiles.every(p => selectedProfiles.has(p.id));
  }, [selectableProfiles, selectedProfiles]);

  return {
    filteredAndSortedResults,
    selectableProfiles,
    allSelectableSelected,
    poolCount,
    mergedResults,
    preScores,
  };
}

// Check if filters have any active values
export function hasActiveFilters(filters: LinkedInFiltersState): boolean {
  return Boolean(
    filters.keywords ||
    filters.location.length > 0 ||
    filters.company.length > 0 ||
    filters.company_keywords.length > 0 ||
    filters.industry.length > 0 ||
    filters.school.length > 0 ||
    filters.job_title.length > 0 ||
    filters.skills.length > 0 ||
    filters.role.length > 0 ||
    filters.function.length > 0 ||
    filters.degree.length > 0 ||
    filters.groups.length > 0 ||
    filters.seniority.length > 0 ||
    filters.network_distance.length > 0 ||
    filters.profile_language.length > 0 ||
    filters.years_of_experience_min !== null ||
    filters.years_of_experience_max !== null ||
    filters.tenure_at_company_min !== null ||
    filters.tenure_at_company_max !== null ||
    filters.open_to_work === true ||
    filters.open_to.length > 0 ||
    filters.hiring_project !== null ||
    filters.spotlight !== null ||
    filters.past_company.length > 0 ||
    filters.past_job_title.length > 0 ||
    filters.company_headcount.length > 0 ||
    filters.company_type.length > 0 ||
    filters.company_location.length > 0 ||
    filters.activity_messages !== null ||
    filters.activity_notes !== null ||
    filters.tags.length > 0
  );
}
