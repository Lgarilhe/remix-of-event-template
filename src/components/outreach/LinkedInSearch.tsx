import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInAccount } from '@/pages/Outreach';
import { LinkedInFilters } from './LinkedInFilters';
import { LinkedInResultCard } from './LinkedInResultCard';
import { JobSelector, BatchScoreButton, GeneratedFilters } from './JobSelector';
import { FilterAssistantModal } from './FilterAssistantModal';
import { JobMatchResult } from './JobScoreDisplay';
import { QuotaDisplay } from './QuotaDisplay';
import { BulkInMailModal } from './BulkInMailModal';
import { useUnipileQuota } from '@/hooks/useUnipileQuota';
import { useJobCandidateStatus } from '@/hooks/useJobCandidateStatus';
import { Job } from '@/pages/JobSpace';
import { filterByCalculatedExperience } from './calculateExperience';
import { useCopilotActions } from '@/hooks/useCopilotActions';
import {
  LinkedInFiltersState,
  LinkedInProfile,
  INITIAL_FILTERS,
  SENIORITY_LEVELS,
  API_TYPE_OPTIONS,
  LinkedInApiType,
} from './types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, ChevronRight, ChevronLeft, AlertTriangle, Lock, Users, Sparkles, Mail, GitBranch, Archive, Eye, EyeOff } from 'lucide-react';
import { SequenceEnrollButton } from './SequenceEnrollButton';
import { toast } from 'sonner';

interface LinkedInSearchProps {
  accounts: LinkedInAccount[];
  selectedAccount: string | null;
  onAccountChange: (accountId: string | null) => void;
}

export const LinkedInSearch: React.FC<LinkedInSearchProps> = ({
  accounts,
  selectedAccount,
  onAccountChange,
}) => {
  const [filters, setFilters] = useState<LinkedInFiltersState>(INITIAL_FILTERS);
  const filtersRef = useRef<LinkedInFiltersState>(INITIAL_FILTERS);
  const [results, setResults] = useState<LinkedInProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]); // Stack of cursors for pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  // UX requirement: 100 profiles per page for efficient bulk operations
  const RESULTS_PER_PAGE = 100;
  const [hasSearched, setHasSearched] = useState(false);
  
  // Quota tracking
  const quota = useUnipileQuota(selectedAccount);
  
  // Job scoring state
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());
  const [jobScores, setJobScores] = useState<Record<string, JobMatchResult>>({});
  const [scoringInProgress, setScoringInProgress] = useState(false);
  const [sortByScore, setSortByScore] = useState(false);
  
  // Candidate status tracking per job (dismissed, messaged, etc.)
  const candidateStatus = useJobCandidateStatus(selectedJob?.id || null);
  const [showDismissed, setShowDismissed] = useState(false); // Toggle to show/hide dismissed candidates
  const [statusFilter, setStatusFilter] = useState<'all' | 'untreated' | 'messaged' | 'dismissed'>('all');
  
  // Copilot context sync
  const { updateJobContext, updateProfilesContext, updateFiltersContext } = useCopilotActions();
  
  // Bulk InMail modal state
  const [showBulkInMailModal, setShowBulkInMailModal] = useState(false);
  
  // Debounce ref for auto-search on filter change
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);
  const hasAccountBeenSelected = useRef(false); // Track if account was already selected once
  const scrollAreaRef = useRef<HTMLDivElement>(null); // Ref for scrolling to top on pagination
  const shouldScrollToTop = useRef(false); // Flag to scroll after pagination load completes

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);
  
  // Sync selected job to Copilot context and reset status filter
  useEffect(() => {
    if (selectedJob) {
      updateJobContext({
        id: selectedJob.id,
        title: selectedJob.title,
        client: selectedJob.client?.name || '',
        skills: selectedJob.skills,
        requirements: selectedJob.requirements,
        description: selectedJob.description,
        remote: selectedJob.remote,
        salaryMin: selectedJob.salaryMin,
        salaryMax: selectedJob.salaryMax,
      });
      // Reset status filter when job changes
      setStatusFilter('all');
      setShowDismissed(false);
    } else {
      updateJobContext(null);
      setStatusFilter('all');
      setShowDismissed(false);
    }
  }, [selectedJob, updateJobContext]);
  
  // Sync selected profiles to Copilot context
  useEffect(() => {
    const selectedProfilesData = results
      .filter(p => selectedProfiles.has(p.id))
      .map(p => ({
        id: p.id,
        name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
        headline: p.headline,
        profileUrl: p.public_profile_url || p.profile_url,
        location: p.location,
        summary: p.summary,
        currentCompany: p.work_experience?.[0]?.company,
        workExperience: p.work_experience,
        education: p.education,
        skills: p.skills,
        network_distance: p.network_distance,
      }));
    updateProfilesContext(selectedProfilesData);
  }, [selectedProfiles, results, updateProfilesContext]);
  
  // Sync current filters to Copilot context
  useEffect(() => {
    updateFiltersContext(filters);
  }, [filters, updateFiltersContext]);
  
  // Handler for AI-generated filter auto-fill
  const handleAutoFillFilters = useCallback((generatedFilters: GeneratedFilters) => {
    setFilters(prev => ({
      ...prev,
      // Keywords
      keywords: generatedFilters.keywords || prev.keywords,
      // Role filters (for Recruiter mode)
      role: generatedFilters.role?.length > 0 ? generatedFilters.role.map(r => ({
        keywords: r.keywords,
        priority: r.priority as 'MUST_HAVE' | 'DOESNT_HAVE',
        scope: r.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST',
      })) : prev.role,
      // Seniority
      seniority: generatedFilters.seniority?.length > 0 ? generatedFilters.seniority : prev.seniority,
      // Years of experience - use calculated experience filter (client-side, more reliable)
      calculated_experience_min: generatedFilters.years_of_experience_min ?? prev.calculated_experience_min,
      calculated_experience_max: generatedFilters.years_of_experience_max ?? prev.calculated_experience_max,
      // Keep LinkedIn API filter cleared since we use calculated
      years_of_experience_min: null,
      years_of_experience_max: null,
      // Company keywords exclusions (e.g., exclude client company)
      company_keywords: generatedFilters.company_keywords?.length > 0 
        ? generatedFilters.company_keywords.map(c => ({
            keywords: c.keywords,
            priority: c.priority as 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE',
            scope: c.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST' | 'PAST_NOT_CURRENT',
          }))
        : prev.company_keywords,
      // School filters with CAN_HAVE priority (TOP schools)
      school: generatedFilters.school?.length > 0
        ? generatedFilters.school.map(s => ({
            id: s.id,
            name: s.name,
            priority: s.priority as 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE',
          }))
        : prev.school,
      // Location radius based on remote policy
      location_within_area: generatedFilters.location_within_area ?? prev.location_within_area,
      // Spotlight for Open to Work (cast to proper type)
      spotlight: (generatedFilters.spotlight || prev.spotlight) as typeof prev.spotlight,
      // Open to work flag
      open_to_work: generatedFilters.open_to_work ?? prev.open_to_work,
    }));

    // Resolve location keywords → location IDs (required by Recruiter API)
    // If we don't resolve IDs, the UI looks empty and the API can't apply the location filter.
    const locationKeyword = generatedFilters.location_keywords?.[0]?.trim();
    if (locationKeyword && selectedAccount) {
      void (async () => {
        try {
          // Don't overwrite a location the user already chose
          if (filtersRef.current.location.length > 0) return;

          const { data, error } = await supabase.functions.invoke('unipile-search', {
            body: {
              action: 'get_parameters',
              account_id: selectedAccount,
              type: 'LOCATION',
              keywords: locationKeyword,
              service: 'RECRUITER',
            },
          });

          if (error) throw error;
          if (!data?.success || !Array.isArray(data?.items) || data.items.length === 0) {
            console.warn('[AutoFill] Location could not be resolved from keyword:', locationKeyword);
            return;
          }

          const normalized = locationKeyword.toLowerCase();
          const best =
            data.items.find((it: any) => String(it.title || '').toLowerCase() === normalized) ||
            data.items.find((it: any) => String(it.title || '').toLowerCase().includes(normalized)) ||
            data.items[0];

          if (!best?.id || !best?.title) return;

          setFilters((curr) => ({
            ...curr,
            location: curr.location.length
              ? curr.location
              : [
                  {
                    id: String(best.id),
                    name: String(best.title),
                    priority: 'MUST_HAVE',
                    scope: 'CURRENT_OR_OPEN_TO_RELOCATE',
                  },
                ],
          }));

          console.log('[AutoFill] Resolved location:', { keyword: locationKeyword, id: best.id, title: best.title });
        } catch (e) {
          console.error('[AutoFill] Failed to resolve location keyword:', locationKeyword, e);
        }
      })();
    }
    
    // Log what was applied
    console.log('[AutoFill] Applied filters:', {
      keywords: generatedFilters.keywords,
      roles: generatedFilters.role?.length,
      seniority: generatedFilters.seniority,
      calculatedXp: `${generatedFilters.years_of_experience_min}-${generatedFilters.years_of_experience_max}`,
      companyExclusions: generatedFilters.company_keywords?.length,
      schools: generatedFilters.school?.length,
      locationKeywords: generatedFilters.location_keywords,
      locationRadius: generatedFilters.location_within_area,
      spotlight: generatedFilters.spotlight,
      openToWork: generatedFilters.open_to_work,
    });
  }, [selectedAccount]);
  
  // Update API mode based on selected filter
  useEffect(() => {
    quota.setApiMode(filters.api);
  }, [filters.api]);
  
  // Serialize filters to JSON for stable dependency tracking (for debounce)
  const filtersJson = useMemo(() => JSON.stringify(filters), [filters]);

  // Sort by score if enabled AND filter out dismissed candidates (unless showDismissed is true)
  const filteredAndSortedResults = useMemo(() => {
    let filtered = results;
    
    // Filter out dismissed candidates for this job (unless user wants to see them)
    if (selectedJob && !showDismissed) {
      filtered = filtered.filter(p => !candidateStatus.isDismissed(p.id));
    }
    
    // Apply status filter
    if (selectedJob && statusFilter !== 'all') {
      filtered = filtered.filter(p => {
        const status = candidateStatus.getStatus(p.id);
        switch (statusFilter) {
          case 'untreated':
            // No status = not treated yet
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
        return scoreB - scoreA; // Descending order
      });
    }
    
    return filtered;
  }, [results, jobScores, sortByScore, filters.calculated_experience_min, filters.calculated_experience_max, selectedJob, showDismissed, candidateStatus, statusFilter]);

  // Calculate selectable profiles (exclude "peu adapté" with recommendation: skip)
  // Use filtered results so client-side filters apply
  const selectableProfiles = useMemo(() => {
    return filteredAndSortedResults.filter(p => {
      const score = jobScores[p.id];
      // If no score yet, allow selection
      // If scored and recommendation is 'skip', exclude
      return !score || score.recommendation !== 'skip';
    });
  }, [filteredAndSortedResults, jobScores]);

  // Check if all selectable profiles are selected
  const allSelectableSelected = useMemo(() => {
    if (selectableProfiles.length === 0) return false;
    return selectableProfiles.every(p => selectedProfiles.has(p.id));
  }, [selectableProfiles, selectedProfiles]);

  // Check if selected account needs reconnection or has subscription issues
  const selectedAccountData = useMemo(() => 
    accounts.find(a => a.id === selectedAccount),
    [accounts, selectedAccount]
  );
  const needsReconnection = selectedAccountData && selectedAccountData.status !== 'OK';
  
  // Check subscription availability for current API mode
  const subscriptions = selectedAccountData?.subscriptions;
  
  // Auto-select the best available API mode based on subscriptions
  useEffect(() => {
    if (!subscriptions) return;
    
    const hasPremiumLicense = subscriptions.recruiter || subscriptions.sales_navigator;
    
    // If user has premium license, ensure they're not on Classic mode
    if (hasPremiumLicense && filters.api === 'classic') {
      // Auto-switch to the available premium mode
      if (subscriptions.recruiter) {
        setFilters(f => ({ ...f, api: 'recruiter' }));
      } else if (subscriptions.sales_navigator) {
        setFilters(f => ({ ...f, api: 'sales_navigator' }));
      }
    }
    // If user doesn't have the currently selected premium license, switch to available one
    else if (filters.api === 'recruiter' && !subscriptions.recruiter && subscriptions.sales_navigator) {
      setFilters(f => ({ ...f, api: 'sales_navigator' }));
    } else if (filters.api === 'sales_navigator' && !subscriptions.sales_navigator && subscriptions.recruiter) {
      setFilters(f => ({ ...f, api: 'recruiter' }));
    }
    // If no premium license, ensure Classic is selected
    else if (!hasPremiumLicense && filters.api !== 'classic') {
      setFilters(f => ({ ...f, api: 'classic' }));
    }
  }, [subscriptions, selectedAccount]);
  
  const isApiModeAvailable = useMemo(() => {
    if (!subscriptions) return true; // Default to available if no subscription info
    
    const hasPremiumLicense = subscriptions.recruiter || subscriptions.sales_navigator;
    
    switch (filters.api) {
      case 'recruiter': return subscriptions.recruiter;
      case 'sales_navigator': return subscriptions.sales_navigator;
      case 'classic': return !hasPremiumLicense; // Classic unavailable if premium exists
      default: return true;
    }
  }, [subscriptions, filters.api]);

  const handleSearch = useCallback(async (newSearch = true, paginationCursor?: string | null) => {
    if (!selectedAccount) {
      toast.error('Sélectionnez un compte LinkedIn');
      return;
    }

    // Check quota before searching
    if (!quota.canPerformAction('searchResultsFetched', RESULTS_PER_PAGE)) {
      toast.error('Quota de recherche journalier atteint. Réessayez demain.');
      return;
    }

    setLoading(true);
    try {
      // Base params - pagination/limit are injected per fetch iteration
      const baseParams: Record<string, unknown> = {
        action: 'search',
        account_id: selectedAccount,
        api: filters.api,
        category: filters.category,
      };

      // Keywords
      if (filters.keywords) baseParams.keywords = filters.keywords;

      // Location - Recruiter uses full objects with priority/scope, others use IDs
      if (filters.location.length) {
        if (filters.api === 'recruiter') {
          // Send full location objects with priority and scope
          baseParams.location = filters.location.map(f => ({
            id: f.id,
            priority: f.priority || 'MUST_HAVE',
            scope: f.scope || 'CURRENT_OR_OPEN_TO_RELOCATE',
          }));
          // Add location radius if set
          if (filters.location_within_area !== null) {
            baseParams.location_within_area = filters.location_within_area;
          }
        } else {
          // Classic and Sales Navigator use simple ID arrays
          baseParams.location = filters.location.map(f => f.id);
        }
      }
      
      // School - Recruiter uses priority format, others use simple ID array
      // IMPORTANT: On the Unipile Recruiter endpoint, multiple school filters with MUST_HAVE
      // are AND'ed together, meaning candidates must have attended ALL schools = 0 results!
      // 
      // Strategy:
      // - CAN_HAVE: UI-only signal, not sent to API
      // - MUST_HAVE / SHOULD_HAVE: Keep only ONE filter with CAN_HAVE priority to create OR logic
      //   (LinkedIn will return candidates from ANY of the listed schools)
      // - DOESNT_HAVE: Exclusions can be sent as-is
      const effectiveSchool =
        filters.api === 'recruiter'
          ? filters.school.filter((f) => (f.priority || 'MUST_HAVE') !== 'CAN_HAVE')
          : filters.school;

      if (effectiveSchool.length) {
        if (filters.api === 'recruiter') {
          // Group by intent: schools to include vs exclude
          const includeSchools = effectiveSchool.filter(f => f.priority !== 'DOESNT_HAVE');
          const excludeSchools = effectiveSchool.filter(f => f.priority === 'DOESNT_HAVE');
          
          // For include schools: send them all with CAN_HAVE to create OR logic
          // This way LinkedIn returns candidates who attended ANY of these schools
          const schoolFilters = [
            ...includeSchools.map(f => ({
              id: f.id,
              priority: 'CAN_HAVE' as const, // OR logic between schools
            })),
            ...excludeSchools.map(f => ({
              id: f.id,
              priority: 'DOESNT_HAVE' as const,
            })),
          ];
          
          if (schoolFilters.length > 0) {
            baseParams.school = schoolFilters;
          }
        } else {
          baseParams.school = effectiveSchool.map(f => f.id);
        }
      }
      
      // Industry - structure with include for Recruiter/Sales Nav
      if (filters.industry.length) {
        baseParams.industry = { include: filters.industry.map(f => f.id) };
      }
      
      // Company - ID-based with include structure
      if (filters.company.length) {
        baseParams.company = { include: filters.company.map(f => f.id) };
      }
      
      // Company keywords (Recruiter only) - keywords-based with priority/scope
      if (filters.api === 'recruiter' && filters.company_keywords.length) {
        baseParams.company_keywords = filters.company_keywords.map(c => ({
          keywords: c.keywords,
          priority: c.priority,
          scope: c.scope,
        }));
      }
      
      // Function/Department
      if (filters.function.length) {
        // Doc (Unipile): function = array of strings (IDs) (type DEPARTMENT)
        baseParams.function = filters.function.map((f) => f.id);
      }
      
      // Degree (Recruiter) - Doc: { include: string[], exclude: string[] }
      if (filters.degree.length && filters.api === 'recruiter') {
        const sanitiseDegreeIds = (ids: string[]) => {
          const kept = ids.filter((id) => {
            const n = Number(id);
            // Legacy UI used placeholder IDs 1-6; real IDs are returned by DEGREE parameters (e.g. 500 for Master)
            return Number.isFinite(n) && n > 10;
          });
          if (kept.length !== ids.length) {
            console.warn('[Outreach] Degree IDs dropped (likely legacy placeholders). Please reselect degree from autocomplete.', {
              dropped: ids.filter((id) => !kept.includes(id)),
              kept,
            });
          }
          return kept;
        };

        const includeIds = sanitiseDegreeIds(
          filters.degree
          .filter(d => d.priority !== 'DOESNT_HAVE')
          .map(d => d.id)
        );
        const excludeIds = sanitiseDegreeIds(
          filters.degree
          .filter(d => d.priority === 'DOESNT_HAVE')
          .map(d => d.id)
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

      // Job title - use current_job_title for Recruiter API with priority
      if (filters.job_title.length) {
        // Recruiter uses current_job_title, edge function handles the mapping
        baseParams.job_title = filters.job_title.map(item => ({
          id: item.id,
          priority: item.priority,
        }));
      }

      // Skills - with priority
      if (filters.skills.length) {
        baseParams.skills = filters.skills.map(item => ({
          id: item.id,
          priority: item.priority,
        }));
      }

      // Role - with keywords, priority, scope
      // NOTE: The backend ignores `seniority` for PEOPLE searches (Unipile limitation),
      // so we approximate seniority by injecting title keywords into the Recruiter `role` filter.
      // IMPORTANT: Multiple MUST_HAVE role filters are AND'ed by LinkedIn, returning 0 results!
      // We must COMBINE seniority keywords into an existing role filter, not add a separate one.
      
      // Start with user-defined roles
      let allRoles = filters.role.map(r => ({
        keywords: r.keywords,
        priority: r.priority as 'MUST_HAVE' | 'DOESNT_HAVE',
        scope: r.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST',
      }));

      // If seniority is selected and we're in recruiter mode, we need to handle it carefully
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
          new Set(
            filters.seniority.flatMap((level) => titlesByLevel[level] ?? [])
          )
        ).join(' OR ');

        if (seniorityKeywords) {
          // If there's already a MUST_HAVE role filter, DON'T add seniority as separate filter
          // Instead, we rely on years_of_experience to filter seniority
          // Only add seniority keywords if there's NO existing role filter
          const hasMustHaveRole = allRoles.some(r => r.priority === 'MUST_HAVE');
          
          if (!hasMustHaveRole) {
            // No existing role filter, we can add seniority as a role filter
            allRoles.push({
              keywords: seniorityKeywords,
              priority: 'MUST_HAVE',
              scope: 'CURRENT',
            });
          }
          // If there's already a MUST_HAVE role filter (e.g., from AI auto-fill),
          // we skip adding seniority keywords to avoid AND conflict
          // The years_of_experience filter will handle seniority filtering instead
        }
      }
      
      if (allRoles.length) {
        baseParams.role = allRoles;
      }
      if (filters.network_distance.length) baseParams.network_distance = filters.network_distance;
      if (filters.profile_language.length) baseParams.profile_language = filters.profile_language;

      // Years of experience (Recruiter) / Tenure (Sales Navigator)
      // Only use explicit years_of_experience filters (seniority now mapped to role/title keywords)
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
          // Sales Navigator uses `tenure` ranges
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
      // NOTE: Recruiter "Open to work" is exposed by the Unipile schema as `spotlights: string[]`.
      // The API does NOT expect `spotlight` (singular).
      if (filters.open_to.length) baseParams.open_to = filters.open_to;

      // Recruiter specific
      if (filters.hiring_project) baseParams.hiring_project = filters.hiring_project;
      if (filters.talent_pool) baseParams.talent_pool = filters.talent_pool;

      // Spotlights (Recruiter)
      if (filters.api === 'recruiter') {
        const spotlights = Array.from(
          new Set(
            [
              ...(filters.open_to_work === true ? ['OPEN_TO_WORK'] : []),
              ...(filters.spotlight ? [filters.spotlight] : []),
            ].filter(Boolean)
          )
        ) as string[];

        if (spotlights.length) {
          baseParams.spotlights = spotlights;
        }
      }
      
      // Recruiting activity (messages, notes, tags, etc.)
      const recruitingActivity: Array<{
        id: 'messages' | 'tags' | 'notes' | 'projects' | 'resumes' | 'reviews';
        priority: 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE';
        timespan?: number;
      }> = [];
      
      // Messages filter - timespan is REQUIRED by API, default to 3650 days (10 years) for "all time"
      if (filters.activity_messages) {
        recruitingActivity.push({
          id: 'messages',
          priority: filters.activity_messages === 'with_message' ? 'MUST_HAVE' : 'DOESNT_HAVE',
          timespan: filters.activity_messages_days ?? 3650, // Default 10 years for "all time"
        });
      }
      
      // Notes filter - timespan is REQUIRED by API
      if (filters.activity_notes) {
        recruitingActivity.push({
          id: 'notes',
          priority: filters.activity_notes === 'with_note' ? 'MUST_HAVE' : 'DOESNT_HAVE',
          timespan: filters.activity_notes_days ?? 3650, // Default 10 years for "all time"
        });
      }
      
      // Tags filter
      if (filters.tags.length) {
        recruitingActivity.push({
          id: 'tags',
          priority: 'MUST_HAVE',
          timespan: 3650, // Required by API
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

      // Always return exactly RESULTS_PER_PAGE profiles after XP filtering and dismissed exclusion.
      // We fetch iteratively using the cursor until we have enough results.
      // With 100 profiles target and potential filtering, we need more iterations
      const desiredCount = RESULTS_PER_PAGE;
      const maxFetchIterations = 15; // Increased to handle heavy filtering for 100 results
      const collected: LinkedInProfile[] = [];
      const seen = new Set<string>();
      
      // Get dismissed IDs to exclude during fetch (optimization)
      const dismissedIds = candidateStatus.dismissedIds;

      let nextCursor: string | null = (!newSearch && paginationCursor) ? paginationCursor : null;
      let lastCursorFromApi: string | null = null;
      let fetchedTotal: number | null = null;

      for (let i = 0; i < maxFetchIterations && collected.length < desiredCount; i++) {
        const remaining = desiredCount - collected.length;

        // quota check per batch (avoid over-fetching)
        if (!quota.canPerformAction('searchResultsFetched', remaining)) {
          break;
        }

        const params: Record<string, unknown> = {
          ...baseParams,
          limit: remaining,
          ...(nextCursor ? { cursor: nextCursor } : {}),
        };

        console.log('[LinkedInSearch] Search params (batch):', params);

        const response = await supabase.functions.invoke('unipile-search', {
          body: params,
        });

        if (response.error) throw response.error;
        if (!response.data?.success) throw new Error(response.data?.error);

        const batch: LinkedInProfile[] = response.data.results || [];
        const batchCursor: string | null = response.data.cursor || null;
        fetchedTotal = fetchedTotal ?? (response.data.total || null);

        quota.recordAction('searchResultsFetched', batch.length);

        // Debug: Log first result structure to see available fields for messaging
        if (batch.length > 0 && i === 0) {
          const firstResult: any = batch[0];
          console.log('[LinkedInSearch] First result structure:', {
            id: firstResult.id,
            member_urn: firstResult.member_urn,
            recruiter_candidate_id: firstResult.recruiter_candidate_id,
            public_identifier: firstResult.public_identifier,
            profile_url: firstResult.profile_url,
            name: firstResult.name,
            availableKeys: Object.keys(firstResult),
          });
        }

        // Apply calculated XP filter on the batch to guarantee 10 displayed profiles
        const filteredBatch = filterByCalculatedExperience(
          batch,
          filters.calculated_experience_min,
          filters.calculated_experience_max
        );

        for (const p of filteredBatch) {
          if (!p?.id) continue;
          if (seen.has(p.id)) continue;
          // Skip dismissed candidates during fetch (if job selected and not showing dismissed)
          if (selectedJob && !showDismissed && dismissedIds.has(p.id)) continue;
          seen.add(p.id);
          collected.push(p);
          if (collected.length >= desiredCount) break;
        }

        lastCursorFromApi = batchCursor;
        nextCursor = batchCursor;

        // No more pages
        if (!batchCursor || batch.length === 0) break;
      }

      // Warn if near limit
      if (quota.isNearLimit('searchResultsFetched')) {
        toast.warning('Attention: vous approchez de la limite quotidienne de résultats de recherche');
      }

      // Replace results (pagination mode, not append)
      setResults(collected);

      // Store current cursor for next page navigation
      setCursor(lastCursorFromApi);
      setTotal(fetchedTotal);
      setHasSearched(true);
      
      if (collected.length === 0 && newSearch) {
        toast.info('Aucun résultat trouvé');
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error(error instanceof Error ? error.message : 'Erreur de recherche');
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, filters, selectedJob, showDismissed, candidateStatus.dismissedIds]);

  // Check if filters have any active search criteria
  const hasActiveFilters = useMemo(() => {
    return (
      filters.keywords.trim() !== '' ||
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
  }, [filters]);

  // Auto-search with 2s debounce when filters change - only if filters are not empty
  useEffect(() => {
    // Skip initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    
    if (!selectedAccount) return;
    
    // Track when account gets selected for the first time (don't trigger search on initial account selection)
    if (!hasAccountBeenSelected.current) {
      hasAccountBeenSelected.current = true;
      return;
    }
    
    // Don't auto-search if no filters are set
    if (!hasActiveFilters) return;

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      handleSearch(true);
    }, 2000);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [filtersJson, selectedAccount, handleSearch, hasActiveFilters]);

  const handleClearFilters = () => {
    setFilters(INITIAL_FILTERS);
    setResults([]);
    setHasSearched(false);
    setCursor(null);
    setCursors([]);
    setCurrentPage(1);
    setTotal(null);
    setSelectedProfiles(new Set());
    setJobScores({});
  };

  // Scroll to top of results
  const scrollToTop = useCallback(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = 0;
      }
    }
  }, []);

  // Scroll to top when loading finishes after pagination (removed - now scroll immediately)
  // useEffect removed since we scroll immediately

  // Pagination handlers
  const handleNextPage = useCallback(() => {
    if (!cursor) return;
    // Scroll immediately for instant feedback
    scrollToTop();
    setCursors(prev => [...prev, cursor]);
    setCurrentPage(prev => prev + 1);
    handleSearch(false, cursor);
  }, [cursor, handleSearch, scrollToTop]);

  const handlePreviousPage = useCallback(() => {
    if (currentPage <= 1) return;
    // Scroll immediately for instant feedback
    scrollToTop();
    const newPage = currentPage - 1;
    setCurrentPage(newPage);
    
    if (newPage === 1) {
      // Go back to first page
      setCursors([]);
      handleSearch(true);
    } else {
      // Use stored cursor for previous page
      const previousCursor = cursors[newPage - 2]; // -2 because page 1 has no cursor
      setCursors(prev => prev.slice(0, newPage - 1));
      handleSearch(false, previousCursor);
    }
  }, [currentPage, cursors, handleSearch, scrollToTop]);

  // Reset pagination when filters change
  useEffect(() => {
    setCursors([]);
    setCurrentPage(1);
  }, [filtersJson]);

  // Toggle profile selection for batch scoring
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

  // Select/deselect all visible profiles (excluding "peu adapté" candidates with score < 40)
  const toggleSelectAll = useCallback(() => {
    // Get selectable profiles (exclude those with recommendation: 'skip')
    const selectableProfiles = results.filter(p => {
      const score = jobScores[p.id];
      // If no score yet, allow selection
      // If scored and recommendation is 'skip', exclude
      return !score || score.recommendation !== 'skip';
    });
    
    const currentlySelected = selectableProfiles.filter(p => selectedProfiles.has(p.id));
    
    if (currentlySelected.length === selectableProfiles.length && selectableProfiles.length > 0) {
      // All selectable are selected, deselect all
      setSelectedProfiles(new Set());
    } else {
      // Select all selectable profiles
      setSelectedProfiles(new Set(selectableProfiles.map(p => p.id)));
    }
  }, [results, selectedProfiles, jobScores]);

  // Build profile data for scoring - enriched with summary + detailed work experience
  const buildProfileData = useCallback((profile: LinkedInProfile) => {
    const workExperience = profile.work_experience || [];
    const currentJob = workExperience.find(exp => !exp.end) || workExperience[0];
    const pastJobs = workExperience.filter(exp => exp.end).slice(0, 5);
    const education = profile.education || [];
    
    // Calculate years of experience from diploma end date (same logic as card)
    const calculateYearsFromDiploma = () => {
      const relevantDegreeKeywords = [
        'bachelor', 'licence', 'bac+3',
        'master', 'msc', 'bac+5', 'maîtrise',
        'mba', 'ingénieur', 'engineer', 'engineering',
        'phd', 'doctorat', 'bac+8',
        'diplôme', 'degree', 'graduate', 'grande école'
      ];
      
      const relevantEdu = education
        .filter((edu: any) => {
          if (!edu.end?.year) return false;
          const combined = `${edu.degree || ''} ${edu.school || ''} ${edu.field_of_study || ''}`.toLowerCase();
          return relevantDegreeKeywords.some(kw => combined.includes(kw));
        })
        .sort((a: any, b: any) => (b.end?.year || 0) - (a.end?.year || 0));
      
      const diplomaToUse = relevantEdu[0] || education.filter((edu: any) => edu.end?.year).sort((a: any, b: any) => (b.end?.year || 0) - (a.end?.year || 0))[0];
      
      if (!diplomaToUse?.end?.year) return null;
      const years = new Date().getFullYear() - diplomaToUse.end.year;
      return years > 0 ? years : null;
    };
    
    // Helper to calculate duration string from start/end dates
    const calculateDuration = (start?: { year?: number; month?: number }, end?: { year?: number; month?: number }): string | undefined => {
      if (!start?.year) return undefined;
      const endYear = end?.year || new Date().getFullYear();
      const endMonth = end?.month || new Date().getMonth() + 1;
      const startYear = start.year;
      const startMonth = start.month || 1;
      
      const totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth);
      const years = Math.floor(totalMonths / 12);
      const months = totalMonths % 12;
      
      if (years === 0) return `${months} mois`;
      if (months === 0) return `${years} an${years > 1 ? 's' : ''}`;
      return `${years} an${years > 1 ? 's' : ''} ${months} mois`;
    };
    
    // Build enriched work experience (max 3 positions, with descriptions truncated to 200 chars)
    const recentPositions = workExperience.slice(0, 3);
    const enrichedWorkExperience = recentPositions.map(exp => ({
      role: exp.role || '',
      company: exp.company || '',
      duration: calculateDuration(exp.start, exp.end),
      description: exp.description?.slice(0, 200) || undefined,
      skills: exp.skills?.slice(0, 5).map(s => s.name || String(s)) || undefined,
    }));
    
    return {
      name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
      headline: profile.headline,
      currentRole: currentJob?.role,
      currentCompany: currentJob?.company,
      location: profile.location,
      skills: profile.skills?.map((s: any) => s.name || s).slice(0, 15) || [],
      // NEW: Summary (About section) - truncated to 300 chars
      summary: profile.summary?.slice(0, 300) || undefined,
      // NEW: Enriched work experience with descriptions
      workExperience: enrichedWorkExperience.length > 0 ? enrichedWorkExperience : undefined,
      // Keep legacy format for backward compatibility
      pastPositions: pastJobs.map(p => `${p.role} chez ${p.company}`),
      education: education.map((e: any) => {
        const degree = e.degree || '';
        const school = e.school || '';
        const year = e.end?.year ? ` (${e.end.year})` : '';
        return `${degree} - ${school}${year}`;
      }) || [],
      yearsOfExperience: calculateYearsFromDiploma(),
    };
  }, []);

  // Score a single profile against selected job
  const scoreProfile = useCallback(async (profile: LinkedInProfile) => {
    if (!selectedJob) {
      toast.error('Sélectionnez un poste pour le scoring');
      return;
    }

    try {
      const profileData = buildProfileData(profile);
      
      const { data, error } = await supabase.functions.invoke('score-profile-job', {
        body: { 
          profile: profileData, 
          job: {
            id: selectedJob.id,
            title: selectedJob.title,
            client: selectedJob.client,
            skills: selectedJob.skills || [],
            requirements: selectedJob.requirements,
            description: selectedJob.description,
            seniority: selectedJob.seniority,
            location: selectedJob.location,
            remote: selectedJob.remote,
            xpMin: selectedJob.xpMin,
            xpMax: selectedJob.xpMax,
            // Salary information for adequacy analysis
            salaryMin: selectedJob.salaryMin,
            salaryMax: selectedJob.salaryMax,
            tjmMin: selectedJob.tjm, // TJM stored as single value
            contractType: selectedJob.contractType,
          }
        }
      });

      if (error) throw error;
      if (data?.result) {
        setJobScores(prev => ({ ...prev, [profile.id]: data.result }));
      }
    } catch (err) {
      console.error('Score error:', err);
      toast.error('Erreur lors du scoring');
    }
  }, [selectedJob, buildProfileData]);

  // Batch score selected profiles
  const handleBatchScore = useCallback(async () => {
    if (!selectedJob) {
      toast.error('Sélectionnez un poste pour le scoring');
      return;
    }

    if (selectedProfiles.size === 0) {
      toast.error('Sélectionnez au moins un profil');
      return;
    }

    setScoringInProgress(true);
    const profilesToScore = results.filter(p => selectedProfiles.has(p.id));
    
    try {
      const profilesData = profilesToScore.map(buildProfileData);
      
      const { data, error } = await supabase.functions.invoke('score-profile-job', {
        body: { 
          profiles: profilesData, 
          job: {
            id: selectedJob.id,
            title: selectedJob.title,
            client: selectedJob.client,
            skills: selectedJob.skills || [],
            requirements: selectedJob.requirements,
            description: selectedJob.description,
            seniority: selectedJob.seniority,
            location: selectedJob.location,
            remote: selectedJob.remote,
            xpMin: selectedJob.xpMin,
            xpMax: selectedJob.xpMax,
            // Salary information for adequacy analysis
            salaryMin: selectedJob.salaryMin,
            salaryMax: selectedJob.salaryMax,
            tjmMin: selectedJob.tjm, // TJM stored as single value
            contractType: selectedJob.contractType,
          }
        }
      });

      if (error) {
        // Check for specific error types from edge function
        if (error.message?.includes('CREDITS_EXHAUSTED') || error.message?.includes('402')) {
          toast.error('Crédits IA épuisés. Veuillez ajouter des crédits dans Settings → Workspace → Usage.', {
            duration: 8000,
          });
          return;
        }
        if (error.message?.includes('RATE_LIMITED') || error.message?.includes('429')) {
          toast.error('Limite de requêtes IA atteinte. Réessayez dans quelques instants.', {
            duration: 5000,
          });
          return;
        }
        throw error;
      }
      
      if (data?.results) {
        const newScores: Record<string, JobMatchResult> = {};
        data.results.forEach((result: JobMatchResult, index: number) => {
          const profile = profilesToScore[index];
          if (profile) {
            newScores[profile.id] = result;
          }
        });
        setJobScores(prev => ({ ...prev, ...newScores }));
        setSortByScore(true); // Auto-enable sorting after batch score
        
        // Auto-archive candidates with recommendation 'skip' (score < 40)
        const candidatesToDismiss = profilesToScore
          .filter((profile, index) => {
            const result = data.results[index];
            return result?.recommendation === 'skip';
          })
          .map((profile, index) => {
            const result = data.results[profilesToScore.indexOf(profile)];
            return {
              id: profile.id,
              name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
              headline: profile.headline,
              profileUrl: profile.public_profile_url || profile.profile_url,
              score: result?.match_score,
              recommendation: result?.recommendation,
              skipReason: result?.analysis,
            };
          });
        
        if (candidatesToDismiss.length > 0) {
          await candidateStatus.batchDismiss(candidatesToDismiss);
          // Show separate toast for dismissed count
          toast.info(`${candidatesToDismiss.length} profil${candidatesToDismiss.length > 1 ? 's' : ''} non pertinent${candidatesToDismiss.length > 1 ? 's' : ''} masqué${candidatesToDismiss.length > 1 ? 's' : ''} (score < 40). Cliquez sur l'icône Archive pour les voir.`, {
            duration: 5000,
          });
        }
        
        const keptCount = data.results.length - candidatesToDismiss.length;
        toast.success(`${data.results.length} profils scorés • ${keptCount} pertinent${keptCount > 1 ? 's' : ''} conservé${keptCount > 1 ? 's' : ''}`);
      }
    } catch (err) {
      console.error('Batch score error:', err);
      toast.error('Erreur lors du scoring par lot');
    } finally {
      setScoringInProgress(false);
    }
  }, [selectedJob, selectedProfiles, results, buildProfileData, candidateStatus]);

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-6 items-start">
      {/* Filters sidebar */}
      <div className="space-y-4 sticky top-24">
        {/* Reconnection alert */}
        {needsReconnection && (
          <Alert variant="destructive" className="bg-amber-50 border-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-800">Reconnexion requise</AlertTitle>
            <AlertDescription className="text-amber-700">
              Le compte <strong>{selectedAccountData?.name || selectedAccountData?.identifier}</strong> est déconnecté. 
              Rendez-vous dans l'onglet <strong>Comptes</strong> pour le reconnecter.
            </AlertDescription>
          </Alert>
        )}

        {/* Account selector */}
        <div className="bg-white rounded-lg border border-[#1A1A1A]/10 p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[#1A1A1A]">
                Compte LinkedIn
              </label>
              {/* Compact quota display on hover */}
              <QuotaDisplay
                searchResultsFetched={quota.quotas.searchResultsFetched}
                profileVisits={quota.quotas.profileVisits}
                messagesSent={quota.quotas.messagesSent}
                invitationsSent={quota.quotas.invitationsSent}
                inmailsSent={quota.quotas.inmailsSent}
                apiMode={quota.apiMode}
                compact={true}
              />
            </div>
            <Select value={selectedAccount || ''} onValueChange={onAccountChange}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un compte" />
              </SelectTrigger>
              <SelectContent className="bg-white">
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    <div className="flex items-center gap-2">
                      <span>{account.name || account.identifier}</span>
                      <div className="flex gap-1">
                        {account.subscriptions?.recruiter && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#0077B5]/10 text-[#0077B5] font-medium">
                            R
                          </span>
                        )}
                        {account.subscriptions?.sales_navigator && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium">
                            SN
                          </span>
                        )}
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {/* Show selected account licenses */}
            {selectedAccountData?.subscriptions && (
              <div className="flex gap-1.5 mt-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                  Classic
                </span>
                {selectedAccountData.subscriptions.recruiter && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0077B5]/10 text-[#0077B5] font-medium">
                    Recruiter
                  </span>
                )}
                {selectedAccountData.subscriptions.sales_navigator && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                    Sales Nav
                  </span>
                )}
              </div>
            )}
          </div>

          {/* API Type selector */}
          <div>
            <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
              Mode de recherche
            </label>
            <TooltipProvider>
              <div className="grid grid-cols-3 gap-1 p-1 bg-gray-100 rounded-lg">
                {API_TYPE_OPTIONS.map((option) => {
                  // Check if premium licenses are available
                  const hasPremiumLicense = subscriptions?.recruiter || subscriptions?.sales_navigator;
                  
                  // Determine availability:
                  // - Classic is disabled if Recruiter OR Sales Navigator is available
                  // - Recruiter/Sales Navigator are available based on their respective licenses
                  let isAvailable: boolean;
                  if (option.value === 'classic') {
                    // Classic is only available if NO premium license exists
                    isAvailable = !hasPremiumLicense;
                  } else if (option.value === 'recruiter') {
                    isAvailable = !!subscriptions?.recruiter;
                  } else if (option.value === 'sales_navigator') {
                    isAvailable = !!subscriptions?.sales_navigator;
                  } else {
                    isAvailable = true;
                  }
                  
                  // Tooltip message varies by case
                  const getTooltipMessage = () => {
                    if (option.value === 'classic' && hasPremiumLicense) {
                      return 'Mode Classic désactivé car vous avez une licence premium. Utilisez Recruiter ou Sales Navigator.';
                    }
                    return `Votre compte LinkedIn n'a pas de licence ${option.label}. Connectez un compte avec cette licence pour utiliser ce mode.`;
                  };
                  
                  const button = (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => isAvailable && setFilters(f => ({ ...f, api: option.value as LinkedInApiType }))}
                      disabled={!isAvailable}
                      className={`px-2 py-1.5 text-xs font-medium rounded-md transition-all relative ${
                        !isAvailable 
                          ? 'text-[#1A1A1A]/30 cursor-not-allowed'
                          : filters.api === option.value
                            ? 'bg-white text-[#0077B5] shadow-sm'
                            : 'text-[#1A1A1A]/60 hover:text-[#1A1A1A] hover:bg-white/50'
                      }`}
                    >
                      <span className="flex items-center justify-center gap-1">
                        {!isAvailable && <Lock className="w-3 h-3" />}
                        {option.label}
                      </span>
                    </button>
                  );
                  
                  if (!isAvailable) {
                    return (
                      <Tooltip key={option.value}>
                        <TooltipTrigger asChild>
                          {button}
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[200px]">
                          <p className="text-xs">
                            {getTooltipMessage()}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  }
                  
                  return button;
                })}
              </div>
            </TooltipProvider>
            <p className="text-[10px] text-[#1A1A1A]/50 mt-1.5">
              {filters.api === 'recruiter' && 'Accès aux filtres avancés de recrutement'}
              {filters.api === 'sales_navigator' && 'Filtres orientés vente et prospection'}
              {filters.api === 'classic' && 'Recherche LinkedIn standard'}
            </p>
          </div>

          {/* License warning */}
          {!isApiModeAvailable && (
            <Alert variant="destructive" className="bg-red-50 border-red-200">
              <Lock className="h-4 w-4 text-red-600" />
              <AlertTitle className="text-red-800">Licence non disponible</AlertTitle>
              <AlertDescription className="text-red-700">
                Votre compte LinkedIn n'a pas de licence {filters.api === 'recruiter' ? 'Recruiter' : 'Sales Navigator'}. 
                Sélectionnez le mode <strong>LinkedIn Classic</strong> ou connectez un compte avec la licence appropriée.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Job Selector for scoring + AI Assistant */}
        <div className="space-y-3">
          <JobSelector 
            selectedJob={selectedJob}
            onJobChange={setSelectedJob}
            onAutoFillFilters={handleAutoFillFilters}
          />
          
          {/* AI Filter Assistant - conversational */}
          <div className="flex items-center justify-between bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg border border-indigo-200/50 p-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-indigo-700">💬 Décris le profil et je remplis les filtres</span>
            </div>
            <FilterAssistantModal
              currentFilters={filters}
              onApplyFilters={(update) => setFilters(prev => ({ ...prev, ...update }))}
              accountId={selectedAccount || undefined}
              selectedJob={selectedJob}
            />
          </div>
        </div>

        {/* Search input */}
        <div className="bg-white rounded-lg border border-[#1A1A1A]/10 p-4">
          <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
            Mots-clés
          </label>
          <div className="flex gap-2">
            <Input
              value={filters.keywords}
              onChange={(e) => setFilters(f => ({ ...f, keywords: e.target.value }))}
              placeholder="Ex: Product Manager, React..."
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
        </div>

        {/* Filters */}
        <LinkedInFilters
          filters={filters}
          onChange={setFilters}
          accountId={selectedAccount}
        />


        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            onClick={() => handleSearch()}
            disabled={loading || !selectedAccount || needsReconnection || !isApiModeAvailable}
            className="flex-1 bg-[#0077B5] hover:bg-[#005E93]"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Search className="w-4 h-4 mr-2" />
            )}
            Rechercher
          </Button>
          <Button
            variant="outline"
            onClick={handleClearFilters}
            disabled={loading}
          >
            Effacer
          </Button>
        </div>
      </div>

      {/* Results */}
      <div className="bg-white rounded-xl border border-[#1A1A1A]/10 flex flex-col h-[calc(100vh-120px)] sticky top-24">
        {/* Results header with batch actions */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A1A1A]/10 shrink-0">
          <div className="flex items-center gap-4">
            {/* Select all checkbox when job is selected */}
            {selectedJob && results.length > 0 && (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={allSelectableSelected && selectableProfiles.length > 0}
                  onCheckedChange={toggleSelectAll}
                  id="select-all"
                />
                <label htmlFor="select-all" className="text-xs text-[#1A1A1A]/60 cursor-pointer">
                  Tout {selectableProfiles.length < filteredAndSortedResults.length && (
                    <span className="text-[10px] text-amber-600">
                      ({selectableProfiles.length}/{filteredAndSortedResults.length})
                    </span>
                  )}
                </label>
              </div>
            )}
            
            <div className="text-base font-semibold text-[#1A1A1A]">
              {hasSearched ? (
                total !== null ? (
                  <>
                    <span>{filteredAndSortedResults.length}</span>
                    {filteredAndSortedResults.length !== results.length && (
                      <span className="text-[#1A1A1A]/40 font-normal">/{results.length}</span>
                    )}
                    <span className="font-normal text-[#1A1A1A]/60"> profil{filteredAndSortedResults.length > 1 ? 's' : ''}</span>
                  </>
                ) : (
                  <span>{filteredAndSortedResults.length} profil{filteredAndSortedResults.length > 1 ? 's' : ''}</span>
                )
              ) : (
                <span>Résultats de recherche</span>
              )}
            </div>
            {hasSearched && total !== null && (
              <span className="text-xs text-[#1A1A1A]/40 bg-[#1A1A1A]/5 px-2 py-1 rounded">
                Page {currentPage} • {results.length}/{RESULTS_PER_PAGE}
              </span>
            )}
            
            {/* Status filter pills (only show when job is selected) */}
            {selectedJob && hasSearched && (
              <div className="flex items-center gap-1.5 ml-2">
                <Button
                  variant={statusFilter === 'all' ? 'default' : 'ghost'}
                  size="sm"
                  className={`h-7 px-2.5 text-xs ${statusFilter === 'all' ? 'bg-[#0077B5]' : ''}`}
                  onClick={() => setStatusFilter('all')}
                >
                  Tous
                </Button>
                <Button
                  variant={statusFilter === 'untreated' ? 'default' : 'ghost'}
                  size="sm"
                  className={`h-7 px-2.5 text-xs ${statusFilter === 'untreated' ? 'bg-[#0077B5]' : ''}`}
                  onClick={() => setStatusFilter('untreated')}
                >
                  <Eye className="w-3 h-3 mr-1" />
                  Non traités
                </Button>
                <Button
                  variant={statusFilter === 'messaged' ? 'default' : 'ghost'}
                  size="sm"
                  className={`h-7 px-2.5 text-xs ${statusFilter === 'messaged' ? 'bg-[#0077B5]' : ''}`}
                  onClick={() => setStatusFilter('messaged')}
                >
                  <Mail className="w-3 h-3 mr-1" />
                  Contactés
                </Button>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={showDismissed ? 'default' : 'ghost'}
                        size="sm"
                        className={`h-7 px-2.5 text-xs ${showDismissed ? 'bg-red-500 hover:bg-red-600' : 'text-red-500'}`}
                        onClick={() => setShowDismissed(!showDismissed)}
                      >
                        <Archive className="w-3 h-3 mr-1" />
                        {candidateStatus.dismissedIds.size > 0 && (
                          <span>{candidateStatus.dismissedIds.size}</span>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{showDismissed ? 'Masquer' : 'Voir'} les profils écartés pour ce poste</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
          </div>
          
          {/* Batch score button + sort toggle + filter summary */}
          <div className="flex items-center gap-3">
            {/* Sort by score toggle */}
            {Object.keys(jobScores).length > 0 && (
              <Button
                variant={sortByScore ? "default" : "outline"}
                size="sm"
                onClick={() => setSortByScore(!sortByScore)}
                className={sortByScore ? "bg-[#0077B5] hover:bg-[#005E93]" : ""}
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                Tri par score
              </Button>
            )}
            
            {selectedProfiles.size > 0 && (
              <>
                {selectedJob && (
                  <BatchScoreButton
                    selectedCount={selectedProfiles.size}
                    onScore={handleBatchScore}
                    loading={scoringInProgress}
                    disabled={!selectedJob}
                  />
                )}
                
                {/* Bulk InMail button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowBulkInMailModal(true)}
                  className="border-[#0077B5] text-[#0077B5] hover:bg-[#0077B5]/10"
                >
                  <Mail className="w-3.5 h-3.5 mr-1.5" />
                  InMail ({selectedProfiles.size})
                </Button>
                
                {/* Sequence enrollment button - excludes candidates with recommendation 'skip' */}
                {selectedAccount && (
                  <SequenceEnrollButton
                    selectedProfiles={results
                      .filter(p => selectedProfiles.has(p.id))
                      .filter(p => {
                        const score = jobScores[p.id];
                        return !score || score.recommendation !== 'skip';
                      })
                    }
                    accountId={selectedAccount}
                    selectedJob={selectedJob}
                    onSuccess={() => {
                      setSelectedProfiles(new Set());
                      toast.success('Candidats inscrits dans la séquence');
                    }}
                  />
                )}
              </>
            )}
            
            {/* Compact quota display */}
            <QuotaDisplay
              searchResultsFetched={quota.quotas.searchResultsFetched}
              profileVisits={quota.quotas.profileVisits}
              messagesSent={quota.quotas.messagesSent}
              invitationsSent={quota.quotas.invitationsSent}
              inmailsSent={quota.quotas.inmailsSent}
              apiMode={quota.apiMode}
              compact
            />
            
            {hasSearched && (
              <div className="flex items-center gap-2 text-xs text-[#1A1A1A]/50">
                <span className="hidden md:inline">Mode:</span>
                <span className="font-medium text-[#0077B5]">
                  {filters.api === 'recruiter' ? 'Recruiter' : filters.api === 'sales_navigator' ? 'Sales Nav' : 'Classic'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Results list */}
        <ScrollArea className="flex-1" ref={scrollAreaRef}>
          {loading && results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-[#0077B5] mb-4" />
              <p className="text-sm text-[#1A1A1A]/50">Recherche en cours...</p>
            </div>
          ) : loading && results.length > 0 ? (
            // Loading new page - show skeleton cards
            <div className="p-4 space-y-3">
              <div className="bg-gradient-to-r from-[#0077B5]/5 to-transparent rounded-lg p-3 mb-4 flex items-center gap-3 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-[#0077B5]/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-[#1A1A1A]/10 rounded w-48" />
                  <div className="h-3 bg-[#1A1A1A]/5 rounded w-32" />
                </div>
              </div>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="bg-white rounded-lg border border-[#1A1A1A]/10 p-4 animate-pulse">
                  <div className="flex gap-4">
                    <div className="w-14 h-14 rounded-full bg-[#1A1A1A]/10" />
                    <div className="flex-1 space-y-2">
                      <div className="h-5 bg-[#1A1A1A]/10 rounded w-40" />
                      <div className="h-4 bg-[#1A1A1A]/5 rounded w-64" />
                      <div className="h-3 bg-[#1A1A1A]/5 rounded w-32" />
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex justify-center pt-4">
                <Loader2 className="w-6 h-6 animate-spin text-[#0077B5]" />
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#1A1A1A]/40 px-8">
              {hasSearched ? (
                // No results found after search
                <>
                  <div className="w-20 h-20 rounded-full bg-[#1A1A1A]/5 flex items-center justify-center mb-6">
                    <Search className="w-10 h-10" />
                  </div>
                  <p className="text-lg font-medium text-[#1A1A1A]/60 mb-2">
                    Aucun profil trouvé
                  </p>
                  <p className="text-sm text-center max-w-md">
                    Essayez d'ajuster vos filtres pour élargir votre recherche
                  </p>
                </>
              ) : (
                // Welcome message - no search performed yet
                <div className="w-full max-w-lg">
                  <div className="text-center mb-8">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#0077B5]/20 to-[#0077B5]/5 flex items-center justify-center mx-auto mb-4">
                      <Search className="w-8 h-8 text-[#0077B5]" />
                    </div>
                    <h3 className="text-xl font-semibold text-[#1A1A1A] mb-2">
                      Recherche LinkedIn
                    </h3>
                    <p className="text-sm text-[#1A1A1A]/60">
                      Trouvez des candidats qualifiés en utilisant les filtres avancés
                    </p>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="bg-[#0077B5]/5 rounded-xl p-4 border border-[#0077B5]/10">
                      <h4 className="font-medium text-[#1A1A1A] mb-3 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-[#0077B5] text-white text-xs flex items-center justify-center">1</span>
                        Configurez vos filtres
                      </h4>
                      <ul className="text-sm text-[#1A1A1A]/70 space-y-2 ml-8">
                        <li>• <strong>Mots-clés</strong> : titres de poste, compétences...</li>
                        <li>• <strong>Localisation</strong> : ville, région, pays</li>
                        <li>• <strong>Entreprise</strong> : nom ou secteur d'activité</li>
                        <li>• <strong>Expérience</strong> : années, séniorité, fonctions</li>
                      </ul>
                    </div>
                    
                    <div className="bg-[#1A1A1A]/5 rounded-xl p-4 border border-[#1A1A1A]/10">
                      <h4 className="font-medium text-[#1A1A1A] mb-3 flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-[#1A1A1A] text-white text-xs flex items-center justify-center">2</span>
                        Lancez la recherche
                      </h4>
                      <p className="text-sm text-[#1A1A1A]/70 ml-8">
                        Cliquez sur <strong>Rechercher</strong> ou attendez 2 secondes après avoir modifié un filtre pour lancer une recherche automatique.
                      </p>
                    </div>
                    
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4 border border-amber-200/50">
                      <h4 className="font-medium text-amber-800 mb-3 flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-amber-600" />
                        Astuce : Scoring IA
                      </h4>
                      <p className="text-sm text-amber-700/80 ml-7">
                        Sélectionnez un <strong>poste de référence</strong> dans le panneau de gauche pour scorer automatiquement les candidats selon leur adéquation au job.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {/* Results stats banner */}
              {hasSearched && total !== null && total > 0 && (
                <div className="bg-gradient-to-r from-[#0077B5]/5 to-transparent rounded-lg p-3 mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#0077B5]/10 flex items-center justify-center">
                      <Users className="w-5 h-5 text-[#0077B5]" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[#1A1A1A]">
                        {total.toLocaleString()} candidats correspondent à vos critères
                      </p>
                      <p className="text-xs text-[#1A1A1A]/50">
                        {RESULTS_PER_PAGE * (currentPage - 1) + 1} - {Math.min(RESULTS_PER_PAGE * currentPage, total)} affichés
                      </p>
                    </div>
                  </div>
                  
                  {/* Top pagination */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handlePreviousPage}
                      disabled={loading || currentPage <= 1}
                      className="gap-1 h-8"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span className="hidden sm:inline">Préc.</span>
                    </Button>
                    
                    <span className="px-3 py-1.5 text-xs font-medium text-[#1A1A1A] bg-white rounded-md border border-[#1A1A1A]/10">
                      {currentPage}
                    </span>
                    
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleNextPage}
                      disabled={loading || !cursor}
                      className="gap-1 h-8"
                    >
                      <span className="hidden sm:inline">Suiv.</span>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Profile cards */}
              {filteredAndSortedResults.map((profile, index) => (
                <LinkedInResultCard 
                  key={profile.id || `profile-${index}`} 
                  profile={profile}
                  selectedJob={selectedJob}
                  isSelected={selectedProfiles.has(profile.id)}
                  onToggleSelect={() => toggleProfileSelection(profile.id)}
                  jobScore={jobScores[profile.id]}
                  onScoreProfile={() => scoreProfile(profile)}
                  accountId={selectedAccount || undefined}
                  onMessageSent={() => quota.recordAction('messagesSent')}
                />
              ))}

              {/* Bottom Pagination */}
              {hasSearched && (results.length > 0 || currentPage > 1) && (
                <div className="pt-6 pb-4 flex flex-col items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePreviousPage}
                      disabled={loading || currentPage <= 1}
                      className="gap-1"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Précédent
                    </Button>
                    
                    <span className="px-4 py-2 text-sm font-medium text-[#1A1A1A] bg-[#1A1A1A]/5 rounded-md min-w-[80px] text-center">
                      Page {currentPage}
                    </span>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleNextPage}
                      disabled={loading || !cursor}
                      className="gap-1"
                    >
                      Suivant
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  {total !== null && (
                    <p className="text-xs text-[#1A1A1A]/40">
                      {RESULTS_PER_PAGE * (currentPage - 1) + 1} - {Math.min(RESULTS_PER_PAGE * currentPage, total)} sur {total.toLocaleString()} profils
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </div>
      
      {/* Bulk InMail Modal - excludes candidates with recommendation 'skip' */}
      <BulkInMailModal
        isOpen={showBulkInMailModal}
        onClose={() => setShowBulkInMailModal(false)}
        recipients={results
          .filter(p => selectedProfiles.has(p.id))
          // Double-check: exclude candidates with recommendation 'skip' (score < 40)
          .filter(p => {
            const score = jobScores[p.id];
            return !score || score.recommendation !== 'skip';
          })
          .map(p => ({
            id: p.id,
            name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            headline: p.headline,
            // For Recruiter InMails, use the main 'id' field which contains the LinkedIn URN (AEM..., ACo..., etc.)
            // DO NOT use recruiter_candidate_id which is a numeric internal ID that causes 422 errors
            profile_id: p.id,
            // Pass network distance for smart message routing (1=DM, 2/3=InMail)
            network_distance: p.network_distance,
            profile: p,
          }))
        }
        accountId={selectedAccount || ''}
        selectedJob={selectedJob}
      />
    </div>
  );
};

// Re-export types for backward compatibility
export type { LinkedInFiltersState, LinkedInProfile } from './types';
