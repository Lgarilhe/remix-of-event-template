import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInAccount } from '@/pages/Outreach';
import { LinkedInFilters } from './LinkedInFilters';
import { LinkedInResultCard } from './LinkedInResultCard';
import { JobSelector, BatchScoreButton } from './JobSelector';
import { JobMatchResult } from './JobScoreDisplay';
import { QuotaDisplay } from './QuotaDisplay';
import { BulkInMailModal } from './BulkInMailModal';
import { useUnipileQuota } from '@/hooks/useUnipileQuota';
import { Job } from '@/pages/JobSpace';
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
import { Search, Loader2, ChevronRight, ChevronLeft, AlertTriangle, Lock, Users, Sparkles, Mail, GitBranch } from 'lucide-react';
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
  const [results, setResults] = useState<LinkedInProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]); // Stack of cursors for pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const RESULTS_PER_PAGE = 20;
  const [hasSearched, setHasSearched] = useState(false);
  
  // Quota tracking
  const quota = useUnipileQuota(selectedAccount);
  
  // Job scoring state
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());
  const [jobScores, setJobScores] = useState<Record<string, JobMatchResult>>({});
  const [scoringInProgress, setScoringInProgress] = useState(false);
  const [sortByScore, setSortByScore] = useState(false);
  
  // Bulk InMail modal state
  const [showBulkInMailModal, setShowBulkInMailModal] = useState(false);
  
  // Debounce ref for auto-search on filter change
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);
  const hasAccountBeenSelected = useRef(false); // Track if account was already selected once
  
  // Update API mode based on selected filter
  useEffect(() => {
    quota.setApiMode(filters.api);
  }, [filters.api]);
  
  // Serialize filters to JSON for stable dependency tracking (for debounce)
  const filtersJson = useMemo(() => JSON.stringify(filters), [filters]);

  // Sort results by score if enabled
  const sortedResults = useMemo(() => {
    if (!sortByScore || Object.keys(jobScores).length === 0) return results;
    
    return [...results].sort((a, b) => {
      const scoreA = jobScores[a.id]?.match_score ?? -1;
      const scoreB = jobScores[b.id]?.match_score ?? -1;
      return scoreB - scoreA; // Descending order
    });
  }, [results, jobScores, sortByScore]);

  // Check if selected account needs reconnection or has subscription issues
  const selectedAccountData = useMemo(() => 
    accounts.find(a => a.id === selectedAccount),
    [accounts, selectedAccount]
  );
  const needsReconnection = selectedAccountData && selectedAccountData.status !== 'OK';
  
  // Check subscription availability for current API mode
  const subscriptions = selectedAccountData?.subscriptions;
  const isApiModeAvailable = useMemo(() => {
    if (!subscriptions) return true; // Default to available if no subscription info
    switch (filters.api) {
      case 'recruiter': return subscriptions.recruiter;
      case 'sales_navigator': return subscriptions.sales_navigator;
      case 'classic': return subscriptions.classic;
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
      const searchParams: Record<string, unknown> = {
        action: 'search',
        account_id: selectedAccount,
        api: filters.api,
        category: filters.category,
        limit: RESULTS_PER_PAGE,
      };

      // Keywords
      if (filters.keywords) searchParams.keywords = filters.keywords;

      // Location - Recruiter uses full objects with priority/scope, others use IDs
      if (filters.location.length) {
        if (filters.api === 'recruiter') {
          // Send full location objects with priority and scope
          searchParams.location = filters.location.map(f => ({
            id: f.id,
            priority: f.priority || 'MUST_HAVE',
            scope: f.scope || 'CURRENT_OR_OPEN_TO_RELOCATE',
          }));
          // Add location radius if set
          if (filters.location_within_area !== null) {
            searchParams.location_within_area = filters.location_within_area;
          }
        } else {
          // Classic and Sales Navigator use simple ID arrays
          searchParams.location = filters.location.map(f => f.id);
        }
      }
      
      // School - Recruiter uses priority format, others use simple ID array
      if (filters.school.length) {
        if (filters.api === 'recruiter') {
          searchParams.school = filters.school.map(f => ({
            id: f.id,
            priority: f.priority || 'MUST_HAVE',
          }));
        } else {
          searchParams.school = filters.school.map(f => f.id);
        }
      }
      
      // Industry - structure with include for Recruiter/Sales Nav
      if (filters.industry.length) {
        searchParams.industry = { include: filters.industry.map(f => f.id) };
      }
      
      // Company - ID-based with include structure
      if (filters.company.length) {
        searchParams.company = { include: filters.company.map(f => f.id) };
      }
      
      // Company keywords (Recruiter only) - keywords-based with priority/scope
      if (filters.api === 'recruiter' && filters.company_keywords.length) {
        searchParams.company_keywords = filters.company_keywords.map(c => ({
          keywords: c.keywords,
          priority: c.priority,
          scope: c.scope,
        }));
      }
      
      // Function/Department
      if (filters.function.length) {
        // Doc (Unipile): function = array of strings (IDs) (type DEPARTMENT)
        searchParams.function = filters.function.map((f) => f.id);
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
          searchParams.degree = {
            ...(includeIds.length > 0 && { include: includeIds }),
            ...(excludeIds.length > 0 && { exclude: excludeIds }),
          };
        }
      }
      
      // Groups (Sales Navigator)
      if (filters.groups.length && filters.api === 'sales_navigator') {
        searchParams.groups = filters.groups.map(f => f.id);
      }
      
      // Company location (Sales Navigator)
      if (filters.company_location.length && filters.api === 'sales_navigator') {
        searchParams.company_location = { include: filters.company_location.map(f => f.id) };
      }

      // Job title - use current_job_title for Recruiter API with priority
      if (filters.job_title.length) {
        // Recruiter uses current_job_title, edge function handles the mapping
        searchParams.job_title = filters.job_title.map(item => ({
          id: item.id,
          priority: item.priority,
        }));
      }

      // Skills - with priority
      if (filters.skills.length) {
        searchParams.skills = filters.skills.map(item => ({
          id: item.id,
          priority: item.priority,
        }));
      }

      // Role - with keywords, priority, scope
      // NOTE: The backend ignores `seniority` for PEOPLE searches (Unipile limitation),
      // so we approximate seniority by injecting title keywords into the Recruiter `role` filter.
      // Important UX rule: if user selects multiple seniority levels, we combine them with OR.
      const seniorityDerivedRole: Array<{ keywords: string; priority: 'MUST_HAVE' | 'DOESNT_HAVE'; scope: 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST' }> = [];

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

        const mergedTitles = Array.from(
          new Set(
            filters.seniority.flatMap((level) => titlesByLevel[level] ?? [])
          )
        );

        if (mergedTitles.length) {
          seniorityDerivedRole.push({
            keywords: mergedTitles.join(' OR '),
            priority: 'MUST_HAVE',
            scope: 'CURRENT',
          });
        }
      }

      // Combine user-defined roles with seniority-derived role approximation
      const allRoles = [
        ...filters.role.map(r => ({
          keywords: r.keywords,
          priority: r.priority as 'MUST_HAVE' | 'DOESNT_HAVE',
          scope: r.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST',
        })),
        ...seniorityDerivedRole,
      ];
      
      if (allRoles.length) {
        searchParams.role = allRoles;
      }
      if (filters.network_distance.length) searchParams.network_distance = filters.network_distance;
      if (filters.profile_language.length) searchParams.profile_language = filters.profile_language;

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
            searchParams.years_of_experience = yearsExp;
          }
        } else if (filters.api === 'sales_navigator') {
          // Sales Navigator uses `tenure` ranges
          const tenure: Record<string, number> = {};
          if (explicitMin !== null) tenure.min = explicitMin;
          if (explicitMax !== null) tenure.max = explicitMax;
          if (Object.keys(tenure).length) {
            searchParams.tenure = [tenure];
          }
        }
      }

      // Tenure filters
      if (filters.tenure_at_company_min !== null || filters.tenure_at_company_max !== null) {
        const tenure: Record<string, number> = {};
        if (filters.tenure_at_company_min !== null) tenure.min = filters.tenure_at_company_min;
        if (filters.tenure_at_company_max !== null) tenure.max = filters.tenure_at_company_max;
        searchParams.tenure = [tenure];
      }

      // Boolean filters
      if (filters.open_to_work === true) searchParams.open_to_work = true;
      if (filters.open_to.length) searchParams.open_to = filters.open_to;

      // Recruiter specific
      if (filters.hiring_project) searchParams.hiring_project = filters.hiring_project;
      if (filters.talent_pool) searchParams.talent_pool = filters.talent_pool;
      if (filters.spotlight) searchParams.spotlight = filters.spotlight;
      
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
        searchParams.recruiting_activity = recruitingActivity;
      }

      // Company filters (Sales Navigator)
      if (filters.company_headcount.length) searchParams.company_headcount = filters.company_headcount;
      if (filters.company_type.length) searchParams.company_type = filters.company_type;

      // Past filters
      if (filters.past_company.length) {
        searchParams.past_company = { include: filters.past_company.map(f => f.id) };
      }
      if (filters.past_job_title.length) {
        searchParams.past_job_title = filters.past_job_title.map(item => ({
          id: item.id,
          priority: item.priority,
        }));
      }

      // Pagination - use provided cursor for page navigation
      if (!newSearch && paginationCursor) {
        searchParams.cursor = paginationCursor;
      }

      console.log('Search params:', searchParams);

      const response = await supabase.functions.invoke('unipile-search', {
        body: searchParams,
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      const newResults = response.data.results || [];

      // Don't apply client-side skill filtering - trust the API to filter correctly
      // The API already applies skill filters on the server side with proper matching logic
      const displayedResults = newResults;

      // Track quota usage
      quota.recordAction('searchResultsFetched', newResults.length);
      
      // Warn if near limit
      if (quota.isNearLimit('searchResultsFetched')) {
        toast.warning('Attention: vous approchez de la limite quotidienne de résultats de recherche');
      }

      // Replace results (pagination mode, not append)
      setResults(displayedResults);

      // Store current cursor for next page navigation
      const newCursor = response.data.cursor || null;
      setCursor(newCursor);
      setTotal(response.data.total || null);
      setHasSearched(true);

      if (newResults.length === 0 && newSearch) {
        toast.info('Aucun résultat trouvé');
      }
    } catch (error) {
      console.error('Search error:', error);
      toast.error(error instanceof Error ? error.message : 'Erreur de recherche');
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, filters]);

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

  // Pagination handlers
  const handleNextPage = useCallback(() => {
    if (!cursor) return;
    // Store current cursor before navigating
    setCursors(prev => [...prev, cursor]);
    setCurrentPage(prev => prev + 1);
    handleSearch(false, cursor);
  }, [cursor, handleSearch]);

  const handlePreviousPage = useCallback(() => {
    if (currentPage <= 1) return;
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
  }, [currentPage, cursors, handleSearch]);

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

  // Select/deselect all visible profiles
  const toggleSelectAll = useCallback(() => {
    if (selectedProfiles.size === results.length) {
      setSelectedProfiles(new Set());
    } else {
      setSelectedProfiles(new Set(results.map(p => p.id)));
    }
  }, [results, selectedProfiles.size]);

  // Build profile data for scoring
  const buildProfileData = useCallback((profile: LinkedInProfile) => {
    const workExperience = profile.work_experience || [];
    const currentJob = workExperience.find(exp => !exp.end) || workExperience[0];
    const pastJobs = workExperience.filter(exp => exp.end).slice(0, 5);
    
    return {
      name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
      headline: profile.headline,
      currentRole: currentJob?.role,
      currentCompany: currentJob?.company,
      location: profile.location,
      skills: profile.skills?.map((s: any) => s.name || s).slice(0, 15) || [],
      pastPositions: pastJobs.map(p => `${p.role} chez ${p.company}`),
      education: profile.education?.map((e: any) => `${e.degree || ''} - ${e.school}`) || [],
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
          }
        }
      });

      if (error) throw error;
      
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
        toast.success(`${data.results.length} profils scorés avec succès`);
      }
    } catch (err) {
      console.error('Batch score error:', err);
      toast.error('Erreur lors du scoring par lot');
    } finally {
      setScoringInProgress(false);
    }
  }, [selectedJob, selectedProfiles, results, buildProfileData]);

  return (
    <div className="grid lg:grid-cols-[320px_1fr] gap-6">
      {/* Filters sidebar */}
      <div className="space-y-4">
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
            <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
              Compte LinkedIn
            </label>
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
                  const isAvailable = !subscriptions || 
                    (option.value === 'classic' && subscriptions.classic) ||
                    (option.value === 'recruiter' && subscriptions.recruiter) ||
                    (option.value === 'sales_navigator' && subscriptions.sales_navigator);
                  
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
                            Votre compte LinkedIn n'a pas de licence {option.label}. 
                            Connectez un compte avec cette licence pour utiliser ce mode.
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

        {/* Job Selector for scoring */}
        <JobSelector 
          selectedJob={selectedJob}
          onJobChange={setSelectedJob}
        />

        {/* Quota Display */}
        <QuotaDisplay
          searchResultsFetched={quota.quotas.searchResultsFetched}
          profileVisits={quota.quotas.profileVisits}
          messagesSent={quota.quotas.messagesSent}
          invitationsSent={quota.quotas.invitationsSent}
          inmailsSent={quota.quotas.inmailsSent}
          apiMode={quota.apiMode}
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
      <div className="bg-white rounded-xl border border-[#1A1A1A]/10 flex flex-col min-h-[500px] max-h-[calc(100vh-220px)]">
        {/* Results header with batch actions */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A1A1A]/10 shrink-0">
          <div className="flex items-center gap-4">
            {/* Select all checkbox when job is selected */}
            {selectedJob && results.length > 0 && (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selectedProfiles.size === results.length && results.length > 0}
                  onCheckedChange={toggleSelectAll}
                  id="select-all"
                />
                <label htmlFor="select-all" className="text-xs text-[#1A1A1A]/60 cursor-pointer">
                  Tout
                </label>
              </div>
            )}
            
            <div className="text-base font-semibold text-[#1A1A1A]">
              {hasSearched ? (
                total !== null ? (
                  <span>{total.toLocaleString()} profil{total > 1 ? 's' : ''}</span>
                ) : (
                  <span>{results.length} profil{results.length > 1 ? 's' : ''}</span>
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
                
                {/* Sequence enrollment button */}
                {selectedAccount && (
                  <SequenceEnrollButton
                    selectedProfiles={results.filter(p => selectedProfiles.has(p.id))}
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
        <ScrollArea className="flex-1">
          {loading && results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-10 h-10 animate-spin text-[#0077B5] mb-4" />
              <p className="text-sm text-[#1A1A1A]/50">Recherche en cours...</p>
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
                <div className="bg-gradient-to-r from-[#0077B5]/5 to-transparent rounded-lg p-3 mb-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#0077B5]/10 flex items-center justify-center">
                    <Users className="w-5 h-5 text-[#0077B5]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#1A1A1A]">
                      {total.toLocaleString()} candidats correspondent à vos critères
                    </p>
                    <p className="text-xs text-[#1A1A1A]/50">
                      Cliquez sur un profil pour voir plus de détails
                    </p>
                  </div>
                </div>
              )}

              {/* Profile cards */}
              {sortedResults.map((profile, index) => (
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

              {/* Pagination */}
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
      
      {/* Bulk InMail Modal */}
      <BulkInMailModal
        isOpen={showBulkInMailModal}
        onClose={() => setShowBulkInMailModal(false)}
        recipients={results
          .filter(p => selectedProfiles.has(p.id))
          .map(p => ({
            id: p.id,
            name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            headline: p.headline,
            profile_id: p.id,
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
