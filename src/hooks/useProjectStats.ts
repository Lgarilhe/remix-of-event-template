import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ProjectStats {
  total: number;
  scored: number;
  messaged: number;
  shortlisted: number;
  dismissed: number;
  untreated: number;
}

/**
 * Hook to calculate project stats dynamically from job_candidate_status table.
 * This provides accurate, real-time stats instead of relying on manual counter updates.
 */
export const useProjectStats = (projectId: string | null) => {
  return useQuery({
    queryKey: ['project-stats', projectId],
    queryFn: async (): Promise<ProjectStats> => {
      if (!projectId) {
        return { total: 0, scored: 0, messaged: 0, shortlisted: 0, dismissed: 0, untreated: 0 };
      }

      const { data, error } = await (supabase.rpc as any)('get_project_stats', {
        p_project_id: projectId,
      });

      if (error) throw error;

      const row = data?.[0];
      if (!row) {
        return { total: 0, scored: 0, messaged: 0, shortlisted: 0, dismissed: 0, untreated: 0 };
      }

      return {
        total: Number(row.total) || 0,
        scored: Number(row.scored) || 0,
        messaged: Number(row.messaged) || 0,
        shortlisted: Number(row.shortlisted) || 0,
        dismissed: Number(row.dismissed) || 0,
        untreated: Number(row.untreated) || 0,
      };
    },
    enabled: !!projectId,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};


/**
 * Hook to get stats for multiple projects at once (for list views).
 * Returns a map of projectId -> stats.
 */
export const useMultipleProjectStats = (projectIds: string[]) => {
  return useQuery({
    queryKey: ['projects-stats-batch', projectIds.join(',')],
    queryFn: async (): Promise<Record<string, ProjectStats>> => {
      if (projectIds.length === 0) {
        return {};
      }

      const { data, error } = await (supabase.rpc as any)('get_multiple_project_stats', {
        p_project_ids: projectIds,
      });

      const statsByProject: Record<string, ProjectStats> = {};

      // Initialize all projects with empty stats
      for (const projectId of projectIds) {
        statsByProject[projectId] = {
          total: 0, scored: 0, messaged: 0, shortlisted: 0, dismissed: 0, untreated: 0,
        };
      }

      if (error) {
        console.warn('[useMultipleProjectStats] RPC unavailable, fallback to empty stats:', error.message);
        return statsByProject;
      }

      // Fill in from RPC results
      if (data) {
        for (const row of data) {
          if (row.project_id && statsByProject[row.project_id]) {
            statsByProject[row.project_id] = {
              total: Number(row.total) || 0,
              scored: Number(row.scored) || 0,
              messaged: Number(row.messaged) || 0,
              shortlisted: Number(row.shortlisted) || 0,
              dismissed: Number(row.dismissed) || 0,
              untreated: Number(row.untreated) || 0,
            };
          }
        }
      }

      return statsByProject;
    },
    enabled: projectIds.length > 0,
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
};

