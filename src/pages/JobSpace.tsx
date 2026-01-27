import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { Navbar } from '@/components/Navbar';
import { JobList } from '@/components/jobs/JobList';
import { JobFilters } from '@/components/jobs/JobFilters';
import { SEOHead } from '@/components/SEOHead';
import { Loader2, ChevronLeft, ChevronRight, ArrowUpDown, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFavoriteJobs } from '@/hooks/useFavoriteJobs';
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
  // Detailed fields
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
  // Candidate counts by stage
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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [allJobs, setAllJobs] = useState<Job[]>([]); // For filtering
  const [jobsLoading, setJobsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    if (user) {
      fetchAllJobs();
    }
  }, [user]);

  const fetchAllJobs = async () => {
    setJobsLoading(true);
    setError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('fetch-notion-jobs', {
        body: {},
      });
      
      if (error) throw error;
      
      if (data.success) {
        setAllJobs(data.jobs);
        setPagination(prev => ({
          ...prev,
          total: data.jobs.length,
          totalPages: Math.ceil(data.jobs.length / prev.limit),
          hasMore: data.jobs.length > prev.limit,
        }));
      } else {
        throw new Error(data.error || 'Failed to fetch jobs');
      }
    } catch (err: any) {
      console.error('Error fetching jobs:', err);
      setError(err.message);
    } finally {
      setJobsLoading(false);
    }
  };

  const filterJobs = useCallback((jobList: Job[]) => {
    return jobList.filter(job => {
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchesSearch = 
          job.title?.toLowerCase().includes(searchLower) ||
          job.client?.name?.toLowerCase().includes(searchLower) ||
          job.location?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (filters.status.length > 0 && !filters.status.includes(job.status)) {
        return false;
      }

      // Contract type filter
      if (filters.contractType.length > 0 && !filters.contractType.includes(job.contractType)) {
        return false;
      }

      // Location filter
      if (filters.location && !job.location?.toLowerCase().includes(filters.location.toLowerCase())) {
        return false;
      }

      // Remote filter
      if (filters.remote.length > 0 && !filters.remote.includes(job.remote)) {
        return false;
      }

      // Sector filter
      if (filters.sector.length > 0 && !filters.sector.includes(job.client?.sector || '')) {
        return false;
      }

      // Priority filter
      if (filters.priority.length > 0 && !filters.priority.includes(job.priority)) {
        return false;
      }

      // Seniority filter
      if (filters.seniority.length > 0 && !filters.seniority.includes(job.seniority)) {
        return false;
      }

      // Skills filter
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

  // Sort jobs
  const sortJobs = useCallback((jobList: Job[]) => {
    return [...jobList].sort((a, b) => {
      switch (sortBy) {
        case 'favorites': {
          const aFav = favorites.has(a.id) ? 0 : 1;
          const bFav = favorites.has(b.id) ? 0 : 1;
          return aFav - bFav;
        }
        case 'priority': {
          const priorityOrder: Record<string, number> = { 
            'haute': 0, 'high': 0, 
            'moyenne': 1, 'medium': 1, 
            'basse': 2, 'low': 2 
          };
          const aOrder = priorityOrder[a.priority?.toLowerCase()] ?? 3;
          const bOrder = priorityOrder[b.priority?.toLowerCase()] ?? 3;
          return aOrder - bOrder;
        }
        case 'salary_desc': {
          const aMax = a.salaryMax || a.salaryMin || 0;
          const bMax = b.salaryMax || b.salaryMin || 0;
          return bMax - aMax;
        }
        case 'salary_asc': {
          const aMin = a.salaryMin || a.salaryMax || Infinity;
          const bMin = b.salaryMin || b.salaryMax || Infinity;
          return aMin - bMin;
        }
        case 'date_desc': {
          const aDate = a.openingDate ? new Date(a.openingDate).getTime() : 0;
          const bDate = b.openingDate ? new Date(b.openingDate).getTime() : 0;
          return bDate - aDate;
        }
        case 'date_asc': {
          const aDate = a.openingDate ? new Date(a.openingDate).getTime() : Infinity;
          const bDate = b.openingDate ? new Date(b.openingDate).getTime() : Infinity;
          return aDate - bDate;
        }
        default:
          return 0;
      }
    });
  }, [sortBy, favorites]);

  // Apply filters, sorting, and pagination
  const filteredJobs = useMemo(() => filterJobs(allJobs), [filterJobs, allJobs]);
  const sortedJobs = useMemo(() => sortJobs(filteredJobs), [sortJobs, filteredJobs]);
  const totalFiltered = sortedJobs.length;
  const totalPages = Math.ceil(totalFiltered / pagination.limit);
  const startIndex = (pagination.page - 1) * pagination.limit;
  const paginatedJobs = sortedJobs.slice(startIndex, startIndex + pagination.limit);

  // Reset to page 1 when filters or sort change
  useEffect(() => {
    setPagination(prev => ({ ...prev, page: 1 }));
  }, [filters, sortBy]);

  const goToPage = (page: number) => {
    setPagination(prev => ({ ...prev, page }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#1A1A1A]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5]">
      <SEOHead 
        title="Job Space - Postes disponibles"
        description="Consultez les postes disponibles et trouvez votre prochaine opportunité"
      />
      <Navbar />
      
      <main className="pt-24 pb-12 px-4 md:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl md:text-5xl font-medium text-[#1A1A1A] tracking-[-0.02em]">
              Job Space
            </h1>
            <p className="mt-2 text-[#1A1A1A]/60">
              {totalFiltered} poste{totalFiltered > 1 ? 's' : ''} disponible{totalFiltered > 1 ? 's' : ''}
              {totalFiltered !== allJobs.length && ` (sur ${allJobs.length} au total)`}
            </p>
          </div>

          {/* Filters */}
          <JobFilters filters={filters} setFilters={setFilters} jobs={allJobs} />

          {/* Sort selector and favorites count */}
          <div className="flex items-center justify-between mb-4">
            {favoritesCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-[#1A1A1A]/60">
                <Heart className="w-4 h-4 text-red-400 fill-red-400" />
                <span>{favoritesCount} favori{favoritesCount > 1 ? 's' : ''}</span>
              </div>
            )}
            <div className={`flex items-center gap-2 ${favoritesCount === 0 ? 'ml-auto' : ''}`}>
              <ArrowUpDown className="w-4 h-4 text-[#1A1A1A]/40" />
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                <SelectTrigger className="w-[160px] h-8 text-xs border-[#1A1A1A]/10 bg-white">
                  <SelectValue placeholder="Trier par" />
                </SelectTrigger>
                <SelectContent className="bg-white">
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
              <Loader2 className="w-8 h-8 animate-spin text-[#1A1A1A]" />
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
              <p className="text-red-600">{error}</p>
              <button 
                onClick={fetchAllJobs}
                className="mt-4 px-4 py-2 bg-[#1A1A1A] text-white text-sm uppercase tracking-wide hover:bg-[#1A1A1A]/90 transition-colors"
              >
                Réessayer
              </button>
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
                <div className="mt-8 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToPage(pagination.page - 1)}
                    disabled={pagination.page === 1}
                    className="border-[#1A1A1A]/20"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  
                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => {
                      // Show first, last, current and neighbors
                      const showPage = page === 1 || 
                        page === totalPages || 
                        Math.abs(page - pagination.page) <= 1;
                      
                      const showEllipsis = (page === 2 && pagination.page > 3) ||
                        (page === totalPages - 1 && pagination.page < totalPages - 2);
                      
                      if (showEllipsis && !showPage) {
                        return <span key={page} className="px-2 text-[#1A1A1A]/40">...</span>;
                      }
                      
                      if (!showPage) return null;
                      
                      return (
                        <Button
                          key={page}
                          variant={page === pagination.page ? "default" : "outline"}
                          size="sm"
                          onClick={() => goToPage(page)}
                          className={page === pagination.page 
                            ? "bg-[#1A1A1A] text-white" 
                            : "border-[#1A1A1A]/20"
                          }
                        >
                          {page}
                        </Button>
                      );
                    })}
                  </div>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToPage(pagination.page + 1)}
                    disabled={pagination.page === totalPages}
                    className="border-[#1A1A1A]/20"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
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
