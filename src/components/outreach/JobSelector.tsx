import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Job } from '@/pages/JobSpace';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, Target, X, Wand2, Search, Sparkles, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';

interface JobSelectorProps {
  selectedJob: Job | null;
  onJobChange: (job: Job | null) => void;
  onAutoFillFilters?: (filters: GeneratedFilters) => void;
}

export interface GeneratedFilters {
  keywords: string;
  role: Array<{ keywords: string; priority: string; scope: string }>;
  seniority: string[];
  years_of_experience_min: number | null;
  years_of_experience_max: number | null;
  skills_keywords: string[];
  industry_keywords: string[];
  location_keywords: string[];
  location_within_area: number | null;
  company_keywords: Array<{ 
    keywords: string; 
    priority: 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE'; 
    scope: 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST' | 'PAST_NOT_CURRENT';
  }>;
  school: Array<{ 
    id: string; 
    name: string; 
    priority: 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE';
  }>;
  spotlight: string;
  open_to_work: boolean;
}

// Custom hook to fetch and cache jobs
export const useJobs = () => {
  return useQuery({
    queryKey: ['notion-jobs-all'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fetch-notion-jobs', {
        body: { all: true },
      });
      
      if (error) throw error;
      if (!data?.success) throw new Error('Failed to fetch jobs');
      
      return (data.jobs || []) as Job[];
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false,
  });
};

// Hook to force refresh jobs from Notion
export const useRefreshJobs = () => {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Force refresh from Notion (bypass cache)
      const { data, error } = await supabase.functions.invoke('fetch-notion-jobs', {
        body: { all: true, refresh: true },
      });
      
      if (error) throw error;
      if (!data?.success) throw new Error('Failed to refresh jobs');
      
      // Update React Query cache with fresh data
      queryClient.setQueryData(['notion-jobs-all'], data.jobs || []);
      toast.success(`${data.jobs?.length || 0} postes synchronisés depuis Notion`);
    } catch (err) {
      console.error('Failed to refresh jobs:', err);
      toast.error('Erreur lors de la synchronisation');
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  return { refresh, isRefreshing };
};

export const JobSelector: React.FC<JobSelectorProps> = ({ selectedJob, onJobChange, onAutoFillFilters }) => {
  const { data: jobs = [], isLoading: loading } = useJobs();
  const { refresh: refreshJobs, isRefreshing } = useRefreshJobs();
  const [autoFillLoading, setAutoFillLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // If the selected job comes from a stale cache (or from a project resume with a minimal job object),
  // hydrate it with the freshest version from the jobs list so fields like `accompagnement` are present.
  useEffect(() => {
    if (!selectedJob?.id || jobs.length === 0) return;

    const fresh = jobs.find((j) => j.id === selectedJob.id);
    if (!fresh) return;

    const selectedAcc = Array.isArray((selectedJob as any).accompagnement)
      ? ((selectedJob as any).accompagnement as string[])
      : [];
    const freshAcc = Array.isArray((fresh as any).accompagnement)
      ? ((fresh as any).accompagnement as string[])
      : [];

    const needsHydration =
      (selectedAcc.length === 0 && freshAcc.length > 0) ||
      (!selectedJob.description && Boolean(fresh.description)) ||
      ((selectedJob.skills?.length || 0) === 0 && (fresh.skills?.length || 0) > 0);

    if (needsHydration) {
      onJobChange(fresh);
    }
  }, [jobs, onJobChange, selectedJob?.id]);

  // Filter jobs based on search query
  const filteredJobs = useMemo(() => {
    if (!searchQuery.trim()) return jobs;
    const query = searchQuery.toLowerCase();
    return jobs.filter(job => 
      job.title.toLowerCase().includes(query) ||
      job.client?.name?.toLowerCase().includes(query) ||
      job.skills?.some(skill => skill.toLowerCase().includes(query))
    );
  }, [jobs, searchQuery]);

  const handleChange = useCallback((jobId: string) => {
    if (jobId === 'none') {
      onJobChange(null);
    } else {
      const job = jobs.find(j => j.id === jobId);
      onJobChange(job || null);
    }
  }, [jobs, onJobChange]);

  const handleAutoFillFilters = useCallback(async () => {
    if (!selectedJob || !onAutoFillFilters) return;

    setAutoFillLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-search-filters', {
        body: { job: selectedJob },
      });

      if (error) throw error;
      
      if (data?.success && data?.filters) {
        onAutoFillFilters(data.filters);
        toast.success('Filtres générés par l\'IA !');
      } else {
        throw new Error(data?.error || 'Erreur lors de la génération');
      }
    } catch (err: any) {
      console.error('Error generating filters:', err);
      if (err?.message?.includes('429') || err?.status === 429) {
        toast.error('Limite IA atteinte, réessayez plus tard');
      } else if (err?.message?.includes('402') || err?.status === 402) {
        toast.error('Crédits IA épuisés');
      } else {
        toast.error('Erreur lors de la génération des filtres');
      }
    } finally {
      setAutoFillLoading(false);
    }
  }, [selectedJob, onAutoFillFilters]);

  // Show skeleton while loading
  if (loading) {
    return (
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200/50 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-purple-600" />
          <span className="text-sm font-medium text-purple-800">Scoring Job</span>
        </div>
        <Skeleton className="h-10 w-full bg-purple-100/50" />
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200/50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-purple-600" />
        <label className="text-sm font-medium text-purple-800">
          Scoring Job
        </label>
        <div className="ml-auto flex items-center gap-1">
          {/* Sync from Notion button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={refreshJobs}
                  disabled={isRefreshing}
                  className="h-6 px-2 text-purple-600 hover:text-purple-800 hover:bg-purple-100"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Synchroniser avec Notion</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Auto-fill button */}
          {selectedJob && onAutoFillFilters && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleAutoFillFilters}
                    disabled={autoFillLoading}
                    className="h-6 px-2 text-purple-600 hover:text-purple-800 hover:bg-purple-100"
                  >
                    {autoFillLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="w-3.5 h-3.5" />
                    )}
                    <span className="ml-1 text-xs">Auto-filtres</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">L'IA génère automatiquement les filtres de recherche basés sur ce poste</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {selectedJob && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onJobChange(null)}
              className="h-5 w-5 p-0 text-purple-400 hover:text-purple-600 hover:bg-purple-100"
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
      
      <Select 
        value={selectedJob?.id || 'none'} 
        onValueChange={handleChange}
      >
        <SelectTrigger className="w-full bg-white border-purple-200 focus:ring-purple-500">
          <SelectValue placeholder="Sélectionner un poste pour le scoring" />
        </SelectTrigger>
        <SelectContent className="bg-white max-h-[400px] z-50">
          {/* Search input inside dropdown */}
          <div className="p-2 border-b border-gray-100 sticky top-0 bg-white z-10">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input
                placeholder="Rechercher un poste..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-sm"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          
          <SelectItem value="none">
            <span className="text-gray-400">Pas de scoring job</span>
          </SelectItem>
          
          {filteredJobs.length === 0 && searchQuery && (
            <div className="p-3 text-center text-sm text-gray-500">
              Aucun poste trouvé pour "{searchQuery}"
            </div>
          )}
          
          {filteredJobs.map((job) => (
            <SelectItem key={job.id} value={job.id}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium truncate max-w-[200px]">{job.title}</span>
                {job.client?.name && (
                  <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">@ {job.client.name}</span>
                )}
                {job.skills?.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 whitespace-nowrap flex-shrink-0">
                    {job.skills.length} skills
                  </span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedJob && (
        <div className="flex flex-wrap gap-1 pt-1">
          {selectedJob.skills?.slice(0, 5).map((skill, i) => (
            <span 
              key={i} 
              className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-purple-200 text-purple-700"
            >
              {skill}
            </span>
          ))}
          {(selectedJob.skills?.length || 0) > 5 && (
            <span className="text-[10px] text-purple-400">
              +{(selectedJob.skills?.length || 0) - 5}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

interface BatchScoreButtonProps {
  selectedCount: number;
  onScore: () => void;
  loading: boolean;
  disabled: boolean;
}

export const BatchScoreButton: React.FC<BatchScoreButtonProps> = ({
  selectedCount,
  onScore,
  loading,
  disabled,
}) => {
  if (selectedCount === 0) return null;

  return (
    <Button
      onClick={onScore}
      disabled={disabled || loading}
      className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white shadow-lg"
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
      ) : (
        <Sparkles className="w-4 h-4 mr-2" />
      )}
      Scorer {selectedCount} profil{selectedCount > 1 ? 's' : ''}
    </Button>
  );
};
