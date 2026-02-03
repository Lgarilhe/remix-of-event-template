import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SourcingProject {
  id: string;
  name: string;
  description: string | null;
  job_id: string | null;
  job_title: string | null;
  client_name: string | null;
  filters_snapshot: Record<string, any>;
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
}

export const useSourcingProjects = () => {
  const queryClient = useQueryClient();

  // Fetch all projects
  const { data: projects = [], isLoading, error, refetch } = useQuery({
    queryKey: ['sourcing-projects'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('sourcing_projects')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data as SourcingProject[];
    },
  });

  // Create project mutation
  const createMutation = useMutation({
    mutationFn: async (input: CreateProjectInput) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('sourcing_projects')
        .insert({
          ...input,
          created_by: user.id,
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
      const { data, error } = await supabase
        .from('sourcing_projects')
        .update(input)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as SourcingProject;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
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
  });
};
