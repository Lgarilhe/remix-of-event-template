import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Job } from '@/pages/JobSpace';

// Cache configuration - aggressive caching for Notion data
const STALE_TIME = 30 * 60 * 1000; // 30 minutes
const GC_TIME = 60 * 60 * 1000; // 1 hour

async function fetchJobs(): Promise<Job[]> {
  const { data, error } = await supabase.functions.invoke('fetch-notion-jobs', {
    body: {},
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
  });
}
