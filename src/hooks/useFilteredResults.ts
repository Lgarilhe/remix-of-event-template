import { useMemo } from 'react';
import { LinkedInFiltersState, LinkedInProfile } from '@/components/outreach/types';
import { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import { Job } from '@/pages/JobSpace';

interface FilteredResultsOptions {
  results: LinkedInProfile[];
  jobScores: Record<string, JobMatchResult>;
  sortByScore: boolean;
  selectedJob: Job | null;
  autoHideTreated: boolean;
  showDismissed: boolean;
  statusFilter: 'all' | 'untreated' | 'messaged' | 'dismissed';
  candidateStatus: {
    treatedIds: Set<string>;
    dismissedIds: Set<string>;
    getStatus: (id: string) => { status: string } | undefined;
  };
  selectedProfiles: Set<string>;
  calculatedExperienceMin?: number | null;
  calculatedExperienceMax?: number | null;
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
}: FilteredResultsOptions) {
  const { treatedIds, dismissedIds, getStatus } = candidateStatus;

  // Filter and sort results
  const filteredAndSortedResults = useMemo(() => {
    let filtered = results;

    // When autoHideTreated is ON, filter out ALL treated candidates
    if (selectedJob && autoHideTreated) {
      filtered = filtered.filter(p => !treatedIds.has(p.id));
    } else {
      // Legacy behavior: only filter out dismissed candidates
      if (selectedJob && !showDismissed) {
        filtered = filtered.filter(p => !dismissedIds.has(p.id));
      }
    }

    // Apply status filter (only when autoHideTreated is OFF)
    if (selectedJob && !autoHideTreated && statusFilter !== 'all') {
      filtered = filtered.filter(p => {
        const status = getStatus(p.id);
        switch (statusFilter) {
          case 'untreated':
            return !status;
          case 'messaged':
            return status?.status === 'messaged' || status?.status === 'replied';
          case 'dismissed':
            return status?.status === 'dismissed';
          default:
            return true;
        }
      });
    }

    // Sort by score if enabled
    if (sortByScore && Object.keys(jobScores).length > 0) {
      filtered = [...filtered].sort((a, b) => {
        const scoreA = jobScores[a.id]?.match_score ?? -1;
        const scoreB = jobScores[b.id]?.match_score ?? -1;
        return scoreB - scoreA;
      });
    }

    return filtered;
  }, [results, jobScores, sortByScore, selectedJob, showDismissed, autoHideTreated, treatedIds, dismissedIds, getStatus, statusFilter]);

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
    filters.talent_pool !== null ||
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
