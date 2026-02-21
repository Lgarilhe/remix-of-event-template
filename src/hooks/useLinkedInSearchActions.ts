import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInFiltersState, LinkedInProfile, LinkedInApiType } from '@/components/outreach/types';
import { filterByCalculatedExperience } from '@/components/outreach/calculateExperience';
import { Job } from '@/pages/JobSpace';
import { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { toast } from 'sonner';

const RESULTS_PER_BATCH = 25;

interface SearchContext {
  selectedAccount: string | null;
  selectedJob: Job | null;
  filters: LinkedInFiltersState;
  cursor: string | null;
  results: LinkedInProfile[];
  activeProject?: SourcingProject | null;
  autoHideTreatedRef: React.MutableRefObject<boolean>;
  quota: {
    canPerformAction: (action: string, count: number) => boolean;
    recordAction: (action: string, count: number) => void;
    isNearLimit: (action: string) => boolean;
  };
  candidateStatus: {
    treatedIds: Set<string>;
    dismissedIds: Set<string>;
  };
}

interface SearchSetters {
  setLoading: (v: boolean) => void;
  setLoadingMore: (v: boolean) => void;
  setResults: React.Dispatch<React.SetStateAction<LinkedInProfile[]>>;
  setCursor: (v: string | null) => void;
  setHasMoreResults: (v: boolean) => void;
  setTotal: (v: number | null) => void;
  setHasSearched: (v: boolean) => void;
}

export function buildSearchParams(filters: LinkedInFiltersState, selectedAccount: string): Record<string, unknown> {
  const baseParams: Record<string, unknown> = {
    action: 'search',
    account_id: selectedAccount,
    api: filters.api,
    category: filters.category,
  };

  // Keywords
  if (filters.keywords) baseParams.keywords = filters.keywords;

  // Location
  if (filters.location.length) {
    if (filters.api === 'recruiter') {
      baseParams.location = filters.location.map(f => ({
        id: f.id,
        priority: f.priority || 'MUST_HAVE',
        scope: f.scope || 'CURRENT_OR_OPEN_TO_RELOCATE',
      }));
      if (filters.location_within_area !== null) {
        baseParams.location_within_area = filters.location_within_area;
      }
    } else {
      baseParams.location = filters.location.map(f => f.id);
    }
  }

  // School - with priority handling
  const effectiveSchool =
    filters.api === 'recruiter'
      ? filters.school.filter((f) => (f.priority || 'MUST_HAVE') !== 'CAN_HAVE')
      : filters.school;

  if (effectiveSchool.length) {
    if (filters.api === 'recruiter') {
      const includeSchools = effectiveSchool.filter(f => f.priority !== 'DOESNT_HAVE');
      const excludeSchools = effectiveSchool.filter(f => f.priority === 'DOESNT_HAVE');
      
      const schoolFilters = [
        ...includeSchools.map(f => ({ id: f.id, priority: 'CAN_HAVE' as const })),
        ...excludeSchools.map(f => ({ id: f.id, priority: 'DOESNT_HAVE' as const })),
      ];
      
      if (schoolFilters.length > 0) {
        baseParams.school = schoolFilters;
      }
    } else {
      baseParams.school = effectiveSchool.map(f => f.id);
    }
  }

  // Industry
  if (filters.industry.length) {
    baseParams.industry = { include: filters.industry.map(f => f.id) };
  }

  // Company
  if (filters.company.length) {
    baseParams.company = { include: filters.company.map(f => f.id) };
  }

  // Company keywords (Recruiter only)
  if (filters.api === 'recruiter' && filters.company_keywords.length) {
    baseParams.company_keywords = filters.company_keywords.map(c => ({
      keywords: c.keywords,
      priority: c.priority,
      scope: c.scope,
    }));
  }

  // Function/Department
  if (filters.function.length) {
    baseParams.function = filters.function.map((f) => f.id);
  }

  // Degree (Recruiter)
  if (filters.degree.length && filters.api === 'recruiter') {
    const sanitiseDegreeIds = (ids: string[]) => {
      return ids.filter((id) => {
        const n = Number(id);
        return Number.isFinite(n) && n > 10;
      });
    };

    const includeIds = sanitiseDegreeIds(
      filters.degree.filter(d => d.priority !== 'DOESNT_HAVE').map(d => d.id)
    );
    const excludeIds = sanitiseDegreeIds(
      filters.degree.filter(d => d.priority === 'DOESNT_HAVE').map(d => d.id)
    );

    if (includeIds.length > 0 || excludeIds.length > 0) {
      baseParams.degree = {
        ...(includeIds.length > 0 && { include: includeIds }),
        ...(excludeIds.length > 0 && { exclude: excludeIds }),
      };
    }
  }

  // Groups (Sales Navigator)
  if (filters.groups.length && filters.api === 'sales_navigator') {
    baseParams.groups = filters.groups.map(f => f.id);
  }

  // Company location (Sales Navigator)
  if (filters.company_location.length && filters.api === 'sales_navigator') {
    baseParams.company_location = { include: filters.company_location.map(f => f.id) };
  }

  // Job title
  if (filters.job_title.length) {
    baseParams.job_title = filters.job_title.map(item => ({
      id: item.id,
      priority: item.priority,
    }));
  }

  // Skills - support both ID-based (numeric) and keywords-based formats
  if (filters.skills.length) {
    baseParams.skills = filters.skills.map(item => {
      const isNumericId = Number.isFinite(Number(item.id)) && Number(item.id) > 0;
      if (isNumericId) {
        return { id: item.id, priority: item.priority };
      }
      // Keywords-based: use the name field
      return { keywords: item.name || item.id, priority: item.priority };
    });
  }

  // Role with seniority handling
  let allRoles = filters.role.map(r => ({
    keywords: r.keywords,
    priority: r.priority as 'MUST_HAVE' | 'DOESNT_HAVE',
    scope: r.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST',
  }));

  if (filters.api === 'recruiter' && filters.seniority.length) {
    const titlesByLevel: Record<string, string[]> = {
      '1': ['Intern', 'Internship', 'Stagiaire', 'Apprentice', 'Trainee', 'Graduate'],
      '2': ['Associate', 'Junior', 'Assistant', 'Consultant', 'Analyst'],
      '3': ['Intermediate', 'Confirmé', 'Confirmed', 'Mid', 'Middle'],
      '4': ['Senior', 'Sr', 'Principal', 'Staff', 'Lead'],
      '5': ['Manager', 'Team Lead', 'Head of', 'Engineering Manager', 'Product Manager'],
      '6': ['Director', 'Directeur', 'Head of', 'Senior Director'],
      '7': ['VP', 'Vice President', 'Vice-President', 'SVP', 'EVP'],
      '8': ['CEO', 'CTO', 'CFO', 'COO', 'CMO', 'CIO', 'CHRO', 'Chief', 'C-Level', 'President', 'Président', 'Managing Director'],
      '9': ['Partner', 'Associé', 'Principal', 'Managing Partner'],
      '10': ['Owner', 'Founder', 'Co-Founder', 'Fondateur', 'Propriétaire', 'Entrepreneur'],
    };

    const seniorityKeywords = Array.from(
      new Set(filters.seniority.flatMap((level) => titlesByLevel[level] ?? []))
    ).join(' OR ');

    if (seniorityKeywords) {
      const hasMustHaveRole = allRoles.some(r => r.priority === 'MUST_HAVE');
      if (!hasMustHaveRole) {
        allRoles.push({
          keywords: seniorityKeywords,
          priority: 'MUST_HAVE',
          scope: 'CURRENT',
        });
      }
    }
  }

  if (allRoles.length) {
    baseParams.role = allRoles;
  }

  if (filters.network_distance.length) baseParams.network_distance = filters.network_distance;
  if (filters.profile_language.length) baseParams.profile_language = filters.profile_language;

  // Years of experience
  const explicitMin = filters.years_of_experience_min;
  const explicitMax = filters.years_of_experience_max;

  if (explicitMin !== null || explicitMax !== null) {
    if (filters.api === 'recruiter') {
      const yearsExp: Record<string, number> = {};
      if (explicitMin !== null) yearsExp.min = explicitMin;
      if (explicitMax !== null) yearsExp.max = explicitMax;
      if (Object.keys(yearsExp).length) {
        baseParams.years_of_experience = yearsExp;
      }
    } else if (filters.api === 'sales_navigator') {
      const tenure: Record<string, number> = {};
      if (explicitMin !== null) tenure.min = explicitMin;
      if (explicitMax !== null) tenure.max = explicitMax;
      if (Object.keys(tenure).length) {
        baseParams.tenure = [tenure];
      }
    }
  }

  // Tenure filters
  if (filters.tenure_at_company_min !== null || filters.tenure_at_company_max !== null) {
    const tenure: Record<string, number> = {};
    if (filters.tenure_at_company_min !== null) tenure.min = filters.tenure_at_company_min;
    if (filters.tenure_at_company_max !== null) tenure.max = filters.tenure_at_company_max;
    baseParams.tenure = [tenure];
  }

  // Boolean filters
  if (filters.open_to.length) baseParams.open_to = filters.open_to;

  // Recruiter specific
  if (filters.hiring_project) baseParams.hiring_project = filters.hiring_project;
  if (filters.talent_pool) baseParams.talent_pool = filters.talent_pool;

  // Spotlights (Recruiter)
  if (filters.api === 'recruiter') {
    const spotlights = Array.from(
      new Set([
        ...(filters.open_to_work === true ? ['OPEN_TO_WORK'] : []),
        ...(filters.spotlight ? [filters.spotlight] : []),
      ].filter(Boolean))
    ) as string[];

    if (spotlights.length) {
      baseParams.spotlights = spotlights;
    }
  }

  // Recruiting activity
  const recruitingActivity: Array<{
    id: 'messages' | 'tags' | 'notes' | 'projects' | 'resumes' | 'reviews';
    priority: 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE';
    timespan?: number;
  }> = [];

  if (filters.activity_messages) {
    recruitingActivity.push({
      id: 'messages',
      priority: filters.activity_messages === 'with_message' ? 'MUST_HAVE' : 'DOESNT_HAVE',
      timespan: filters.activity_messages_days ?? 3650,
    });
  }

  if (filters.activity_notes) {
    recruitingActivity.push({
      id: 'notes',
      priority: filters.activity_notes === 'with_note' ? 'MUST_HAVE' : 'DOESNT_HAVE',
      timespan: filters.activity_notes_days ?? 3650,
    });
  }

  if (filters.tags.length) {
    recruitingActivity.push({
      id: 'tags',
      priority: 'MUST_HAVE',
      timespan: 3650,
    });
  }

  if (recruitingActivity.length) {
    baseParams.recruiting_activity = recruitingActivity;
  }

  // Company filters (Sales Navigator)
  if (filters.company_headcount.length) baseParams.company_headcount = filters.company_headcount;
  if (filters.company_type.length) baseParams.company_type = filters.company_type;

  // Past filters
  if (filters.past_company.length) {
    baseParams.past_company = { include: filters.past_company.map(f => f.id) };
  }
  if (filters.past_job_title.length) {
    baseParams.past_job_title = filters.past_job_title.map(item => ({
      id: item.id,
      priority: item.priority,
    }));
  }

  return baseParams;
}

export function useLinkedInSearchActions(
  context: SearchContext,
  setters: SearchSetters
) {
  const {
    selectedAccount,
    selectedJob,
    filters,
    cursor,
    results,
    activeProject,
    autoHideTreatedRef,
    quota,
    candidateStatus,
  } = context;

  const {
    setLoading,
    setLoadingMore,
    setResults,
    setCursor,
    setHasMoreResults,
    setTotal,
    setHasSearched,
  } = setters;

  const handleSearch = useCallback(async (appendMode = false, retryCount = 0) => {
    if (!selectedAccount) {
      toast.error('Sélectionnez un compte LinkedIn');
      return;
    }

    if (!selectedJob) {
      toast.error('Sélectionnez un poste pour lancer la recherche');
      return;
    }

    if (!quota.canPerformAction('searchResultsFetched', RESULTS_PER_BATCH)) {
      toast.error('Quota de recherche journalier atteint. Réessayez demain.');
      return;
    }

    if (appendMode) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const baseParams = buildSearchParams(filters, selectedAccount);
      const params: Record<string, unknown> = {
        ...baseParams,
        limit: RESULTS_PER_BATCH,
        ...(appendMode && cursor ? { cursor } : {}),
      };

      console.log('[LinkedInSearch] Search params:', params);

      const response = await supabase.functions.invoke('unipile-search', {
        body: params,
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      const batch: LinkedInProfile[] = response.data.results || [];
      const batchCursor: string | null = response.data.cursor || null;
      const fetchedTotal: number | null = response.data.total || null;

      quota.recordAction('searchResultsFetched', batch.length);

      // Apply client-side experience filter
      const filteredBatch = filterByCalculatedExperience(
        batch,
        filters.calculated_experience_min,
        filters.calculated_experience_max
      );

      // Dedupe and filter treated profiles
      const seen = new Set<string>();
      
      // In non-append mode, keep previously loaded profiles that were treated/dismissed
      // so the user can still see their work from prior searches on the same job
      const retainedFromPrevious: LinkedInProfile[] = [];
      if (!appendMode && results.length > 0) {
        for (const p of results) {
          if (!p?.id) continue;
          const isTreated = candidateStatus.treatedIds.has(p.id);
          const isDismissed = candidateStatus.dismissedIds.has(p.id);
          if (isTreated || isDismissed) {
            seen.add(p.id);
            retainedFromPrevious.push(p);
          }
        }
      }

      if (appendMode) {
        results.forEach((p) => p?.id && seen.add(p.id));
      }

      const shouldHideTreated = autoHideTreatedRef.current;
      const collected: LinkedInProfile[] = [];

      for (const p of filteredBatch) {
        if (!p?.id) continue;
        if (seen.has(p.id)) continue;
        if (selectedJob && shouldHideTreated && candidateStatus.treatedIds.has(p.id)) continue;
        if (selectedJob && !shouldHideTreated && candidateStatus.dismissedIds.has(p.id)) continue;
        seen.add(p.id);
        collected.push(p);
      }

      if (!batchCursor || batch.length === 0) {
        setHasMoreResults(false);
      }

      if (quota.isNearLimit('searchResultsFetched')) {
        toast.warning('Attention: vous approchez de la limite quotidienne de résultats de recherche');
      }

      if (appendMode) {
        setResults(prev => [...prev, ...collected]);
      } else {
        // Merge: new results first, then retained treated/dismissed profiles at the end
        setResults([...collected, ...retainedFromPrevious]);
        setHasSearched(true);
      }

      setCursor(batchCursor);
      if (!appendMode) {
        setTotal(fetchedTotal);
      }

    } catch (error: any) {
      console.error('[LinkedInSearch] Search error:', error);
      
      // Detect LinkedIn multiple sessions error and auto-retry
      const isMultipleSessionsError = error.message?.includes('multiple sessions') || error.message?.includes('unable to process');
      
      if (isMultipleSessionsError && retryCount < 2) {
        const delay = (retryCount + 1) * 5; // 5s, 10s
        toast.info(`Conflit de session LinkedIn détecté. Nouvelle tentative dans ${delay}s...`, { id: 'search-retry', duration: delay * 1000 });
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
        if (appendMode) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
        return handleSearch(appendMode, retryCount + 1);
      }
      
      if (isMultipleSessionsError) {
        toast.error('Conflit de session LinkedIn persistant. Fermez LinkedIn Recruiter dans votre navigateur puis réessayez.', { id: 'search-error', duration: 10000 });
      } else {
        toast.error(error.message || 'Erreur lors de la recherche', { id: 'search-error' });
      }
      // Stop infinite scroll from retrying on error
      setHasMoreResults(false);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [selectedAccount, selectedJob, filters, cursor, results, quota, candidateStatus, autoHideTreatedRef, setLoading, setLoadingMore, setResults, setCursor, setHasMoreResults, setTotal, setHasSearched]);

  const handleLoadMore = useCallback(() => {
    if (!cursor || context.quota.canPerformAction('searchResultsFetched', RESULTS_PER_BATCH)) {
      handleSearch(true);
    }
  }, [cursor, handleSearch, context.quota]);

  return {
    handleSearch,
    handleLoadMore,
  };
}
