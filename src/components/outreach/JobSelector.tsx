import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2 } from 'lucide-react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Job } from '@/types/jobs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Loader2, Target, X, Wand2, Search, Sparkles, RefreshCw, ChevronDown, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNotionJobs } from '@/hooks/useNotionJobs';

// Re-export useNotionJobs as useJobs for backward compatibility
export const useJobs = useNotionJobs;

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

// Hook to force refresh jobs from Notion
export const useRefreshJobs = () => {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ jobs?: Job[] }>('fetch-notion-jobs', { all: true, refresh: true });
      
      if (error) throw error;
      if (!data?.success) throw new Error('Failed to refresh jobs');
      
      // Update React Query cache with fresh data (both possible query keys)
      queryClient.setQueryData(['notion-jobs-all'], data.jobs || []);
      const orgKeys = queryClient.getQueryCache().findAll({ queryKey: ['notion-jobs'] });
      orgKeys.forEach(q => queryClient.setQueryData(q.queryKey, data.jobs || []));
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
  // Ref to avoid re-triggering the hydration effect when onJobChange identity changes
  const onJobChangeRef = useRef(onJobChange);
  onJobChangeRef.current = onJobChange;

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
      onJobChangeRef.current(fresh);
    }
  }, [jobs, selectedJob?.id]);

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
      const { data, error } = await invokeEdgeFunction<{ filters?: any }>('generate-search-filters', { job: selectedJob });

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
      <div className="border border-border bg-background p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">🎯</span>
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">Scoring Job</span>
        </div>
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  return (
    <div className="border border-border bg-background p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm">🎯</span>
        <label className="text-xs font-bold text-foreground uppercase tracking-wider">
          Scoring Job
        </label>
        <div className="ml-auto flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={refreshJobs}
                  disabled={isRefreshing}
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className={cn('w-3.5 h-3.5', isRefreshing && 'animate-spin')} />
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
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
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
          className="flex h-9 w-full items-center border border-border bg-background px-3 py-2 text-sm focus:outline-none"
        >
          <option value="none">Pas de scoring job</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.title}{job.client?.name ? ` — ${job.client.name}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            className={cn(
              "flex h-9 w-full items-center justify-between border border-border bg-background px-3 py-1.5 text-sm transition-shadow",
              "hover:shadow-sm",
              "focus:outline-none focus:shadow-sm",
              selectedJob && "border-accent"
            )}
            onClick={() => setPopoverOpen((prev) => !prev)}
          >
            {selectedJob ? (
              <div className="flex items-center gap-2 min-w-0">
                {selectedJob.client?.website ? (
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${new URL(selectedJob.client.website.startsWith('http') ? selectedJob.client.website : 'https://' + selectedJob.client.website).hostname}&sz=32`}
                    alt={selectedJob.client?.name || ''}
                    className="w-4 h-4 shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : null}
                <span className="truncate font-medium">{selectedJob.title}</span>
                {selectedJob.client?.name && (
                  <span className="text-xs text-muted-foreground shrink-0">— {selectedJob.client.name}</span>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground">Sélectionner un poste…</span>
            )}
            <ChevronDown className={cn("h-4 w-4 opacity-50 shrink-0 ml-2 transition-transform", popoverOpen && "rotate-180")} />
          </button>

          {popoverOpen && (
            <div
              className="absolute left-0 right-0 mt-1 z-[70] border border-border bg-background shadow-md"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Rechercher un poste..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-8 text-sm border-border rounded-lg"
                    autoFocus
                  />
                </div>
              </div>

              <div className="max-h-[300px] overflow-y-auto">
                {/* No scoring option */}
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-sm text-left border-b border-border transition-colors",
                    "hover:bg-accent/50",
                    !selectedJob && "bg-accent/50 font-medium"
                  )}
                  onClick={() => {
                    handleChange('none');
                    setPopoverOpen(false);
                    setSearchQuery('');
                  }}
                >
                  {!selectedJob ? (
                    <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  <span className="text-muted-foreground">Aucun poste</span>
                </button>

                {filteredJobs.length === 0 && searchQuery && (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Aucun poste trouvé pour « {searchQuery} »
                  </div>
                )}

                {filteredJobs.map((job) => {
                  const isSelected = selectedJob?.id === job.id;
                  const faviconUrl = job.client?.website
                    ? `https://www.google.com/s2/favicons?domain=${new URL(job.client.website.startsWith('http') ? job.client.website : 'https://' + job.client.website).hostname}&sz=32`
                    : null;

                  return (
                    <button
                      key={job.id}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-left border-b border-border/5 transition-colors",
                        "hover:bg-accent/50",
                        isSelected && "bg-accent/10 border-l-2 border-l-primary"
                      )}
                      onClick={() => {
                        handleChange(job.id);
                        setPopoverOpen(false);
                        setSearchQuery('');
                      }}
                    >
                      {/* Check / favicon column */}
                      {isSelected ? (
                        <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                      ) : faviconUrl ? (
                        <img
                          src={faviconUrl}
                          alt={job.client?.name || ''}
                          className="w-4 h-4 shrink-0"
                          onError={(e) => { 
                            const el = e.target as HTMLImageElement;
                            el.style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-4 h-4 border border-border bg-muted flex items-center justify-center shrink-0">
                          <Building2 className="w-2.5 h-2.5 text-muted-foreground" />
                        </div>
                      )}

                      {/* Job info */}
                      <div className="flex flex-col min-w-0">
                        <span className={cn("font-medium truncate leading-tight", isSelected && "text-foreground")}>
                          {job.title}
                        </span>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground leading-tight">
                          {job.client?.name && <span className="truncate">{job.client.name}</span>}
                          {job.skills?.length > 0 && (
                            <>
                              {job.client?.name && <span className="text-foreground/20">·</span>}
                              <span>{job.skills.length} compétence{job.skills.length > 1 ? 's' : ''}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Selected job skills preview */}
      {selectedJob && selectedJob.skills?.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {selectedJob.skills.slice(0, 5).map((skill, i) => (
            <span 
              key={i} 
              className="text-xs px-1.5 py-0.5 border border-border bg-accent/50 text-foreground/70 font-medium uppercase tracking-wide"
            >
              {skill}
            </span>
          ))}
          {(selectedJob.skills.length) > 5 && (
            <span className="text-xs text-muted-foreground font-medium">
              +{selectedJob.skills.length - 5}
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
