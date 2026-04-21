import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import type { Job } from '@/types/jobs';
import { toast } from 'sonner';
import { useOrganization } from './useOrganization';

// Cache configuration — generous to avoid repeated cold-start edge function calls
const STALE_TIME = 10 * 60 * 1000; // 10 minutes
const GC_TIME = 60 * 60 * 1000; // 1 hour
const REFETCH_INTERVAL = 10 * 60 * 1000; // 10 minutes polling

async function fetchJobs(refresh = false, organizationId?: string | null): Promise<Job[]> {
  const { data, error } = await invokeEdgeFunction<{ jobs?: Job[] }>('fetch-notion-jobs', {
    all: true, refresh, organization_id: organizationId,
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Failed to fetch jobs');

  return data.jobs || [];
}

export function useNotionJobs() {
  const { organizationId, isLoading } = useOrganization();

  return useQuery({
    queryKey: ['notion-jobs', organizationId],
    queryFn: () => fetchJobs(false, organizationId),
    enabled: !isLoading && !!organizationId,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: false,
    refetchInterval: organizationId ? REFETCH_INTERVAL : false,
    // Si NOTION_API_KEY n'est pas configuré ou l'edge function plante,
    // on retry pas 3x (backoff exponentiel qui bloque l'UI). On remonte
    // l'erreur immédiatement et le consumer affiche [] (jobs optionnels).
    retry: 0,
  });
}

/**
 * Mutation hook to update a Notion job field and sync back.
 * Optimistically updates the local cache, then forces a fresh refetch from Notion.
 */
export function useUpdateNotionJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ pageId, updates }: { pageId: string; updates: Record<string, any> }) => {
      const { data, error } = await invokeEdgeFunction('update-notion-job', {
        pageId, updates,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to update');

      return { pageId, updates };
    },
    onMutate: async ({ pageId, updates }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['notion-jobs'] });

      // Snapshot previous value
      const previousJobs = queryClient.getQueryData<Job[]>(['notion-jobs']);

      // Optimistically update the cache
      if (previousJobs) {
        queryClient.setQueryData<Job[]>(['notion-jobs'], (old) =>
          (old || []).map((job) => {
            if (job.id !== pageId) return job;
            const updated = { ...job };
            for (const [field, value] of Object.entries(updates)) {
              (updated as any)[field] = value;
            }
            return updated;
          })
        );
      }

      return { previousJobs };
    },
    onError: (err: Error, _vars, context) => {
      // Roll back on error
      if (context?.previousJobs) {
        queryClient.setQueryData(['notion-jobs'], context.previousJobs);
      }
      toast.error(`Erreur Notion: ${err.message}`);
    },
    onSuccess: () => {
      toast.success('Modifié dans Notion ✓');
    },
    onSettled: () => {
      // Force a fresh refetch from Notion (bypass cache)
      queryClient.fetchQuery({
        queryKey: ['notion-jobs'],
        queryFn: () => fetchJobs(true),
        staleTime: 0,
      });
    },
  });
}
