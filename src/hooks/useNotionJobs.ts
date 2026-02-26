import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Job } from '@/types/jobs';
import { toast } from 'sonner';

// Cache configuration
const STALE_TIME = 5 * 60 * 1000; // 5 minutes
const GC_TIME = 60 * 60 * 1000; // 1 hour
const REFETCH_INTERVAL = 5 * 60 * 1000; // 5 minutes polling

async function fetchJobs(): Promise<Job[]> {
  const { data, error } = await supabase.functions.invoke('fetch-notion-jobs', {
    body: { all: true, refresh: false },
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Failed to fetch jobs');

  return data.jobs || [];
}

export function useNotionJobs() {
  return useQuery({
    queryKey: ['notion-jobs'],
    queryFn: fetchJobs,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: false,
    refetchInterval: REFETCH_INTERVAL,
  });
}

/**
 * Mutation hook to update a Notion job field and sync back.
 * Invalidates the jobs cache on success so the UI refreshes.
 */
export function useUpdateNotionJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ pageId, updates }: { pageId: string; updates: Record<string, any> }) => {
      const { data, error } = await supabase.functions.invoke('update-notion-job', {
        body: { pageId, updates },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to update');

      return data;
    },
    onSuccess: () => {
      // Invalidate jobs cache so polling picks up changes immediately
      queryClient.invalidateQueries({ queryKey: ['notion-jobs'] });
      toast.success('Modifié dans Notion ✓');
    },
    onError: (err: Error) => {
      toast.error(`Erreur Notion: ${err.message}`);
    },
  });
}
