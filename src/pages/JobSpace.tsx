import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { Navbar } from '@/components/Navbar';
import { JobList } from '@/components/jobs/JobList';
import { JobFilters } from '@/components/jobs/JobFilters';
import { SEOHead } from '@/components/SEOHead';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

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

const JobSpace = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [allJobs, setAllJobs] = useState<Job[]>([]); // For filtering
  const [jobsLoading, setJobsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // Apply filters and pagination
  const filteredJobs = filterJobs(allJobs);
  const totalFiltered = filteredJobs.length;
  const totalPages = Math.ceil(totalFiltered / pagination.limit);
  const startIndex = (pagination.page - 1) * pagination.limit;
  const paginatedJobs = filteredJobs.slice(startIndex, startIndex + pagination.limit);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPagination(prev => ({ ...prev, page: 1 }));
  }, [filters]);

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

          {/* Content */}
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
              <JobList jobs={paginatedJobs} />
              
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
