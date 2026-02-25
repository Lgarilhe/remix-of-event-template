import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { Navbar } from '@/components/Navbar';
import { JobList } from '@/components/jobs/JobList';
import { JobFilters } from '@/components/jobs/JobFilters';
import { SEOHead } from '@/components/SEOHead';
import { Loader2, ChevronLeft, ChevronRight, ArrowUpDown, Heart, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFavoriteJobs } from '@/hooks/useFavoriteJobs';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface CandidateCounts {
  cv: number;
  itw: number;
  offre: number;
  total: number;
}

export interface Job {
  id: string;
  title: string;
  client: {
    id: string;
    name: string;
    sector: string;
    size: string;
    website: string;
    linkedin: string;
  } | null;
  status: string;
  seniority: string;
  contractType: string;
  location: string;
  remote: string;
  salaryMin: number;
  salaryMax: number;
  priority: string;
  skills: string[];
  description: string;
  interviewProcess: string;
  requirements: string;
  openingDate: string;
  startDate: string;
  channel: string;
  sourcingCriteria: string;
  teamInfo: string;
  xpMin: number;
  xpMax: number;
  tjm: number;
  accompagnement: string[];
  jobUrl: string;
  candidateCounts: CandidateCounts;
}

export interface JobFiltersState {
  search: string;
  status: string[];
  contractType: string[];
  location: string;
  remote: string[];
  sector: string[];
  priority: string[];
  seniority: string[];
  skills: string[];
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

type SortOption = 'priority' | 'salary_desc' | 'salary_asc' | 'date_desc' | 'date_asc' | 'favorites';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'priority', label: 'Priorité' },
  { value: 'favorites', label: 'Favoris' },
  { value: 'salary_desc', label: 'Salaire (décroissant)' },
  { value: 'salary_asc', label: 'Salaire (croissant)' },
  { value: 'date_desc', label: 'Plus récent' },
  { value: 'date_asc', label: 'Plus ancien' },
];

const JobSpace = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>('priority');
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 12,
    total: 0,
    totalPages: 0,
    hasMore: false,
  });
  const [filters, setFilters] = useState<JobFiltersState>({
    search: '',
    status: [],
    contractType: [],
    location: '',
    remote: [],
    sector: [],
    priority: [],
    seniority: [],
    skills: [],
  });
  const navigate = useNavigate();
  
  const { data: allJobs = [], isLoading: jobsLoading, error: jobsError } = useNotionJobs();
  const { favorites, toggleFavorite, isFavorite, favoritesCount } = useFavoriteJobs(user?.id);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate('/auth');
      } else {
        setUser(session.user);
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        navigate('/auth');
      } else {
        setUser(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (allJobs.length > 0) {
      setPagination(prev => ({
        ...prev,
        total: allJobs.length,
        totalPages: Math.ceil(allJobs.length / prev.limit),
        hasMore: allJobs.length > prev.limit,
      }));
    }
  }, [allJobs]);

  const filterJobs = useCallback((jobList: Job[]) => {
    return jobList.filter(job => {
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchesSearch = 
          job.title?.toLowerCase().includes(searchLower) ||
          job.client?.name?.toLowerCase().includes(searchLower) ||
          job.location?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }
      if (filters.status.length > 0 && !filters.status.includes(job.status)) return false;
      if (filters.contractType.length > 0 && !filters.contractType.includes(job.contractType)) return false;
      if (filters.location && !job.location?.toLowerCase().includes(filters.location.toLowerCase())) return false;
      if (filters.remote.length > 0 && !filters.remote.includes(job.remote)) return false;
      if (filters.sector.length > 0 && !filters.sector.includes(job.client?.sector || '')) return false;
      if (filters.priority.length > 0 && !filters.priority.includes(job.priority)) return false;
      if (filters.seniority.length > 0 && !filters.seniority.includes(job.seniority)) return false;
      if (filters.skills.length > 0) {
        const jobSkills = job.skills || [];
        const hasMatchingSkill = filters.skills.some(skill => 
          jobSkills.some(jobSkill => jobSkill.toLowerCase().includes(skill.toLowerCase()))
        );
        if (!hasMatchingSkill) return false;
      }
      return true;
    });
  }, [filters]);

  const sortJobs = useCallback((jobList: Job[]) => {
    return [...jobList].sort((a, b) => {
      switch (sortBy) {
        case 'favorites': {
          const aFav = favorites.has(a.id) ? 0 : 1;
          const bFav = favorites.has(b.id) ? 0 : 1;
          return aFav - bFav;
        }
        case 'priority': {
          const priorityOrder: Record<string, number> = { 'haute': 0, 'high': 0, 'moyenne': 1, 'medium': 1, 'basse': 2, 'low': 2 };
          return (priorityOrder[a.priority?.toLowerCase()] ?? 3) - (priorityOrder[b.priority?.toLowerCase()] ?? 3);
        }
        case 'salary_desc': return (b.salaryMax || b.salaryMin || 0) - (a.salaryMax || a.salaryMin || 0);
        case 'salary_asc': return (a.salaryMin || a.salaryMax || Infinity) - (b.salaryMin || b.salaryMax || Infinity);
        case 'date_desc': return (b.openingDate ? new Date(b.openingDate).getTime() : 0) - (a.openingDate ? new Date(a.openingDate).getTime() : 0);
        case 'date_asc': return (a.openingDate ? new Date(a.openingDate).getTime() : Infinity) - (b.openingDate ? new Date(b.openingDate).getTime() : Infinity);
        default: return 0;
      }
    });
  }, [sortBy, favorites]);

  const filteredJobs = useMemo(() => filterJobs(allJobs), [filterJobs, allJobs]);
  const sortedJobs = useMemo(() => sortJobs(filteredJobs), [sortJobs, filteredJobs]);
  const totalFiltered = sortedJobs.length;
  const totalPages = Math.ceil(totalFiltered / pagination.limit);
  const startIndex = (pagination.page - 1) * pagination.limit;
  const paginatedJobs = sortedJobs.slice(startIndex, startIndex + pagination.limit);

  useEffect(() => {
    setPagination(prev => ({ ...prev, page: 1 }));
  }, [filters, sortBy]);

  const goToPage = (page: number) => {
    setPagination(prev => ({ ...prev, page }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="Job Space - Postes disponibles"
        description="Consultez les postes disponibles et trouvez votre prochaine opportunité"
      />
      <Navbar />
      
      <main className="pt-24 pb-12 px-4 md:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="h-10 w-10 bg-foreground text-background flex items-center justify-center border border-foreground">
                <Briefcase className="w-5 h-5" />
              </div>
              <h1 className="text-4xl md:text-5xl font-medium text-foreground tracking-[-0.02em] uppercase">
                Job Space
              </h1>
            </div>
            <p className="mt-2 text-muted-foreground ml-[52px]">
              {totalFiltered} poste{totalFiltered > 1 ? 's' : ''} disponible{totalFiltered > 1 ? 's' : ''}
              {totalFiltered !== allJobs.length && ` (sur ${allJobs.length} au total)`}
            </p>
          </div>

          {/* Filters */}
          <JobFilters filters={filters} setFilters={setFilters} jobs={allJobs} />

          {/* Sort selector and favorites count */}
          <div className="flex items-center justify-between mb-4">
            {favoritesCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Heart className="w-4 h-4 text-red-400 fill-red-400" />
                <span>{favoritesCount} favori{favoritesCount > 1 ? 's' : ''}</span>
              </div>
            )}
            <div className={`flex items-center gap-2 ${favoritesCount === 0 ? 'ml-auto' : ''}`}>
              <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                <SelectTrigger className="w-[160px] h-8 text-xs border-foreground/20 bg-background">
                  <SelectValue placeholder="Trier par" />
                </SelectTrigger>
                <SelectContent className="bg-background">
                  {SORT_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value} className="text-xs">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {jobsLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-foreground" />
            </div>
          ) : jobsError ? (
            <div className="bg-destructive/10 border border-destructive/30 p-6 text-center">
              <p className="text-destructive">{jobsError instanceof Error ? jobsError.message : 'Error loading jobs'}</p>
            </div>
          ) : (
            <>
              <JobList 
                jobs={paginatedJobs} 
                onToggleFavorite={toggleFavorite}
                isFavorite={isFavorite}
              />
              
              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-0">
                  <button
                    onClick={() => goToPage(pagination.page - 1)}
                    disabled={pagination.page === 1}
                    className="relative overflow-hidden h-[34px] w-[34px] flex items-center justify-center border border-foreground text-foreground disabled:opacity-30 group"
                  >
                    <ChevronLeft className="w-4 h-4 relative z-10" />
                    <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                  </button>
                  
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => {
                    const showPage = page === 1 || page === totalPages || Math.abs(page - pagination.page) <= 1;
                    const showEllipsis = (page === 2 && pagination.page > 3) ||
                      (page === totalPages - 1 && pagination.page < totalPages - 2);
                    
                    if (showEllipsis && !showPage) {
                      return <span key={page} className="px-2 text-muted-foreground">...</span>;
                    }
                    if (!showPage) return null;
                    
                    return (
                      <button
                        key={page}
                        onClick={() => goToPage(page)}
                        className={`relative overflow-hidden h-[34px] min-w-[34px] px-2 flex items-center justify-center border border-l-0 border-foreground text-xs font-medium uppercase group ${
                          page === pagination.page 
                            ? "bg-foreground text-background" 
                            : "bg-background text-foreground"
                        }`}
                      >
                        <span className="relative z-10">{page}</span>
                        {page !== pagination.page && (
                          <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                        )}
                      </button>
                    );
                  })}
                  
                  <button
                    onClick={() => goToPage(pagination.page + 1)}
                    disabled={pagination.page === totalPages}
                    className="relative overflow-hidden h-[34px] w-[34px] flex items-center justify-center border border-l-0 border-foreground text-foreground disabled:opacity-30 group"
                  >
                    <ChevronRight className="w-4 h-4 relative z-10" />
                    <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default JobSpace;
