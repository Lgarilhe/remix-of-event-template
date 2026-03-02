import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Job } from '@/types/jobs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, Target, X, Wand2, Search, Sparkles, RefreshCw, ChevronDown, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';

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
  const [popoverOpen, setPopoverOpen] = useState(false);
  const isMobile = useIsMobile();
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
        setSearchQuery('');
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPopoverOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [popoverOpen]);

  // If the selected job comes from a stale cache (or from a project resume with a minimal job object),
  // hydrate it with the freshest version from the jobs list so ALL fields are present.
  useEffect(() => {
    if (!selectedJob?.id || jobs.length === 0) return;

    const fresh = jobs.find((j) => j.id === selectedJob.id);
    if (!fresh) return;

    // Check if the selected job is missing important fields that the fresh one has
    const needsHydration =
      // Core fields for auto-fill
      (!selectedJob.description && Boolean(fresh.description)) ||
      ((selectedJob.skills?.length || 0) === 0 && (fresh.skills?.length || 0) > 0) ||
      (selectedJob.xpMin === undefined && fresh.xpMin !== undefined) ||
      (selectedJob.xpMax === undefined && fresh.xpMax !== undefined) ||
      (!selectedJob.location && Boolean(fresh.location)) ||
      (!selectedJob.seniority && Boolean(fresh.seniority)) ||
      // Scoring criteria
      (!(selectedJob as any).mustHave && Boolean((fresh as any).mustHave)) ||
      (!(selectedJob as any).shouldHave && Boolean((fresh as any).shouldHave)) ||
      (!(selectedJob as any).niceToHave && Boolean((fresh as any).niceToHave)) ||
      (!(selectedJob as any).sourcingCriteria && Boolean((fresh as any).sourcingCriteria)) ||
      // Remote policy
      (!(selectedJob as any).remote && Boolean((fresh as any).remote)) ||
      // Accompagnement
      ((selectedJob as any).accompagnement?.length === 0 && ((fresh as any).accompagnement?.length || 0) > 0) ||
      // Transversal criteria
      (!(selectedJob as any).transversalCriteria && Boolean((fresh as any).transversalCriteria));

    if (needsHydration) {
      console.log('[JobSelector] Hydrating job with fresh data:', fresh.title);
      onJobChange(fresh);
    }
  }, [jobs, onJobChange, selectedJob]);

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
      <div className="bg-brutal-accent/10 border border-brutal-accent p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-brutal-accent" />
          <span className="text-xs font-medium text-foreground uppercase tracking-wide">Scoring Job</span>
        </div>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="bg-brutal-accent/10 border border-brutal-accent p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-brutal-accent" />
        <label className="text-xs font-medium text-foreground uppercase tracking-wide">
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
                  className="h-6 px-2 text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Synchroniser avec Notion</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {selectedJob && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onJobChange(null)}
              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
      
      {isMobile ? (
        <select
          value={selectedJob?.id || 'none'}
          onChange={(e) => handleChange(e.target.value)}
          className="flex h-10 w-full items-center border border-foreground/30 bg-background px-3 py-2 text-sm focus:outline-none focus:border-foreground"
        >
          <option value="none">Pas de scoring job</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.title}{job.client?.name ? ` @ ${job.client.name}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            className={cn(
              "flex h-10 w-full items-center justify-between border border-foreground/30 bg-background px-3 py-2 text-sm",
              "focus:outline-none focus:border-foreground"
            )}
            onClick={() => setPopoverOpen((prev) => !prev)}
          >
            <span className={cn("truncate", !selectedJob && "text-muted-foreground")}>
              {selectedJob ? selectedJob.title : "Sélectionner un poste pour le scoring"}
            </span>
            <ChevronDown className={cn("h-4 w-4 opacity-50 shrink-0 ml-2 transition-transform", popoverOpen && "rotate-180")} />
          </button>

          {popoverOpen && (
            <div className="absolute left-0 right-0 mt-1 z-[70] border border-border bg-popover text-popover-foreground shadow-md" onPointerDown={(e) => e.stopPropagation()}>
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Rechercher un poste..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-8 text-sm"
                    autoFocus
                  />
                </div>
              </div>

              <div className="max-h-[300px] overflow-y-auto">
                <button
                  type="button"
                  className={cn(
                    "relative flex w-full items-center rounded-sm py-2 pl-8 pr-2 text-sm text-left hover:bg-accent hover:text-accent-foreground",
                    !selectedJob && "bg-accent"
                  )}
                  onClick={() => {
                    handleChange('none');
                    setPopoverOpen(false);
                    setSearchQuery('');
                  }}
                >
                  {!selectedJob && <Check className="absolute left-2 h-4 w-4" />}
                  <span className="text-muted-foreground">Pas de scoring job</span>
                </button>

                {filteredJobs.length === 0 && searchQuery && (
                  <div className="p-3 text-center text-sm text-muted-foreground">
                    Aucun poste trouvé pour "{searchQuery}"
                  </div>
                )}

                {filteredJobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    className={cn(
                      "relative flex w-full items-center rounded-sm py-2 pl-8 pr-2 text-sm text-left hover:bg-accent hover:text-accent-foreground",
                      selectedJob?.id === job.id && "bg-accent"
                    )}
                    onClick={() => {
                      handleChange(job.id);
                      setPopoverOpen(false);
                      setSearchQuery('');
                    }}
                  >
                    {selectedJob?.id === job.id && <Check className="absolute left-2 h-4 w-4" />}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate max-w-[200px]">{job.title}</span>
                      {job.client?.name && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">@ {job.client.name}</span>
                      )}
                      {job.skills?.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground whitespace-nowrap flex-shrink-0">
                          {job.skills.length} skills
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedJob && (
        <div className="flex flex-wrap gap-1 pt-1">
          {selectedJob.skills?.slice(0, 5).map((skill, i) => (
            <span 
              key={i} 
              className="text-[10px] px-1.5 py-0.5 bg-muted border border-foreground/20 text-foreground/70 font-medium"
            >
              {skill}
            </span>
          ))}
          {(selectedJob.skills?.length || 0) > 5 && (
            <span className="text-[10px] text-muted-foreground">
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
      className="bg-foreground text-background hover:bg-foreground/90"
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
