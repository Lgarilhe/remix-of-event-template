import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import type { JobDetails } from '@/types/jobDetails';

export interface SourcingProject {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  job_id: string | null;
  job_title: string | null;
  client_name: string | null;
  /** Only present when fetched individually (not in list query) */
  filters_snapshot?: Record<string, any>;
  notes: string | null;
  status: 'active' | 'paused' | 'completed' | 'archived';
  created_by: string;
  created_at: string;
  updated_at: string;
  last_search_at: string | null;
  stats_total_found: number;
  stats_scored: number;
  stats_messaged: number;
  stats_dismissed: number;
  stats_shortlisted: number;
  calendly_link: string | null;
  /** Only present when fetched individually (not in list query) */
  job_details?: JobDetails;
  hunt_mode: boolean;
  hunt_bounty_percent: number | null;
  hunt_max_recruiters: number | null;
  hunt_deadline: string | null;
  hunt_status: 'draft' | 'published' | 'in_progress' | 'filled' | 'cancelled' | null;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  job_id?: string;
  job_title?: string;
  client_name?: string;
  filters_snapshot?: Record<string, any>;
}

export interface UpdateProjectInput {
  id: string;
  name?: string;
  description?: string;
  notes?: string;
  status?: SourcingProject['status'];
  filters_snapshot?: Record<string, any>;
  last_search_at?: string;
  stats_total_found?: number;
  stats_scored?: number;
  stats_messaged?: number;
  stats_dismissed?: number;
  stats_shortlisted?: number;
  calendly_link?: string | null;
  job_details?: JobDetails;
  hunt_mode?: boolean;
  hunt_bounty_percent?: number | null;
  hunt_max_recruiters?: number | null;
  hunt_deadline?: string | null;
  hunt_status?: string | null;
}

export const useSourcingProjects = () => {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { isReady, user } = useAuthReady();

  // Fetch all projects — excludes heavy JSONB columns (job_details, filters_snapshot)
  // Use useSourcingProject(id) to fetch a single project with all fields.
  const { data: projects = [], isLoading, error, refetch } = useQuery({
    queryKey: ['sourcing-projects', organizationId, user?.id],
    queryFn: async () => {
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('sourcing_projects')
        .select('id, name, status, created_at, updated_at, created_by, organization_id, job_id, job_title, client_name, description, notes, last_search_at, stats_total_found, stats_scored, stats_messaged, stats_dismissed, stats_shortlisted, calendly_link, hunt_mode, hunt_bounty_percent, hunt_max_recruiters, hunt_deadline, hunt_status')
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data as SourcingProject[];
    },
    enabled: isReady && !!user && !!organizationId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes cache
  });

  // Create project mutation
  const createMutation = useMutation({
    mutationFn: async (input: CreateProjectInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!organizationId) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('sourcing_projects')
        .insert({
          ...input,
          created_by: user.id,
          organization_id: organizationId,
          filters_snapshot: input.filters_snapshot || {},
        })
        .select()
        .single();

      if (error) throw error;
      return data as SourcingProject;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      toast.success('Projet créé avec succès');
    },
    onError: (err: Error) => {
      toast.error(`Erreur: ${err.message}`);
    },
  });

  // Update project mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...input }: UpdateProjectInput) => {
      const { job_details, ...rest } = input;
      const payload: Record<string, any> = { ...rest };
      if (job_details !== undefined) payload.job_details = job_details as any;
      const { data, error } = await supabase
        .from('sourcing_projects')
        .update(payload)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;
      return (data || { id, ...payload }) as SourcingProject;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      if (data?.id) {
        queryClient.invalidateQueries({ queryKey: ['sourcing-project', data.id] });
      }
    },
    onError: (err: Error) => {
      toast.error(`Erreur: ${err.message}`);
    },
  });

  // Delete project mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('sourcing_projects')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      toast.success('Projet supprimé');
    },
    onError: (err: Error) => {
      toast.error(`Erreur: ${err.message}`);
    },
  });

  // Find or create project for a job
  const findOrCreateForJob = useCallback(async (jobId: string, jobTitle: string, clientName?: string): Promise<SourcingProject> => {
    // Check if project already exists for this job
    const existing = projects.find(p => p.job_id === jobId);
    if (existing) return existing;

    // Create new project
    const result = await createMutation.mutateAsync({
      name: jobTitle,
      job_id: jobId,
      job_title: jobTitle,
      client_name: clientName,
    });

    return result;
  }, [projects, createMutation]);

  // Update project stats
  const updateStats = useCallback(async (projectId: string, stats: Partial<Pick<SourcingProject, 'stats_total_found' | 'stats_scored' | 'stats_messaged' | 'stats_dismissed' | 'stats_shortlisted'>>) => {
    await updateMutation.mutateAsync({
      id: projectId,
      ...stats,
    });
  }, [updateMutation]);

  // Get project by job_id
  const getProjectByJobId = useCallback((jobId: string): SourcingProject | undefined => {
    return projects.find(p => p.job_id === jobId);
  }, [projects]);

  return {
    projects,
    isLoading,
    error,
    refetch,
    createProject: createMutation.mutateAsync,
    updateProject: updateMutation.mutateAsync,
    deleteProject: deleteMutation.mutateAsync,
    findOrCreateForJob,
    updateStats,
    getProjectByJobId,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
};

// Hook to get a single project with all fields (including job_details and filters_snapshot)
export const useSourcingProject = (projectId: string | null | undefined) => {
  const { isReady, user } = useAuthReady();

  return useQuery({
    queryKey: ['sourcing-project', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('sourcing_projects')
        .select('*')
        .eq('id', projectId)
        .maybeSingle();

      if (error) throw error;
      return data as SourcingProject | null;
    },
    enabled: isReady && !!user && !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes cache
  });
};

// Hook to get candidates for a specific project
export const useProjectCandidates = (projectId: string | null) => {
  return useQuery({
    queryKey: ['project-candidates', projectId],
    queryFn: async () => {
      if (!projectId) return [];

      const { data, error } = await supabase
        .from('job_candidate_status')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes cache
  });
};
