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

      const { data, error } = await supabase
        .from('job_candidate_status')
        .select('status, score')
        .eq('project_id', projectId);

      if (error) throw error;

      const candidates = data || [];
      
      return {
        total: candidates.length,
        scored: candidates.filter(c => c.score !== null).length,
        messaged: candidates.filter(c => c.status === 'messaged').length,
        shortlisted: candidates.filter(c => c.status === 'shortlisted').length,
        dismissed: candidates.filter(c => c.status === 'dismissed').length,
        untreated: candidates.filter(c => c.status === 'untreated').length,
      };
    },
    enabled: !!projectId,
    staleTime: 30 * 1000, // 30 seconds - refresh frequently for accurate counts
    gcTime: 5 * 60 * 1000, // 5 minutes cache
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

      const { data, error } = await supabase
        .from('job_candidate_status')
        .select('project_id, status, score')
        .in('project_id', projectIds);

      if (error) throw error;

      const candidates = data || [];
      
      // Group by project
      const statsByProject: Record<string, ProjectStats> = {};
      
      // Initialize all projects with empty stats
      for (const projectId of projectIds) {
        statsByProject[projectId] = {
          total: 0,
          scored: 0,
          messaged: 0,
          shortlisted: 0,
          dismissed: 0,
          untreated: 0,
        };
      }
      
      // Aggregate stats
      for (const candidate of candidates) {
        if (!candidate.project_id) continue;
        
        const stats = statsByProject[candidate.project_id];
        if (!stats) continue;
        
        stats.total++;
        if (candidate.score !== null) stats.scored++;
        
        switch (candidate.status) {
          case 'messaged':
            stats.messaged++;
            break;
          case 'shortlisted':
            stats.shortlisted++;
            break;
          case 'dismissed':
            stats.dismissed++;
            break;
          case 'untreated':
            stats.untreated++;
            break;
        }
      }
      
      return statsByProject;
    },
    enabled: projectIds.length > 0,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
};
