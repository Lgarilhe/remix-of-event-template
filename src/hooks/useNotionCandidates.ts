import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ShortlistEntry, Candidate } from '@/pages/Candidates';

// Cache configuration - aggressive caching for Notion data
const STALE_TIME = 30 * 60 * 1000; // 30 minutes
const GC_TIME = 60 * 60 * 1000; // 1 hour

async function fetchShortlist(): Promise<ShortlistEntry[]> {
  const { data, error } = await supabase.functions.invoke('fetch-notion-candidates', {
    body: {},
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Failed to fetch shortlist');

  return data.shortlist || [];
}

async function fetchCandidates(): Promise<Candidate[]> {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-notion-candidates?type=candidates`,
    {
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const data = await response.json();
  if (!data?.success) throw new Error(data?.error || 'Failed to fetch candidates');

  return data.candidates || [];
}

export function useNotionShortlist() {
  return useQuery({
    queryKey: ['notion-shortlist'],
    queryFn: fetchShortlist,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: false,
  });
}

export function useNotionCandidates() {
  return useQuery({
    queryKey: ['notion-candidates'],
    queryFn: fetchCandidates,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: false,
  });
}
