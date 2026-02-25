import { useQuery } from '@tanstack/react-query';
import type { ShortlistEntry, Candidate } from '@/pages/Candidates';

// Cache configuration - aggressive caching for Notion data
const STALE_TIME = 30 * 60 * 1000; // 30 minutes
const GC_TIME = 60 * 60 * 1000; // 1 hour

function extractItems<T>(response: unknown, key: 'shortlist' | 'candidates'): T[] {
  if (!response || typeof response !== 'object') {
    console.error(`[Notion] Invalid ${key} response type`, typeof response);
    return [];
  }

  const payload = response as Record<string, unknown>;
  const value = payload[key];

  if (Array.isArray(value)) return value as T[];
  if (Array.isArray(payload.data)) return payload.data as T[];
  if (Array.isArray(payload.items)) return payload.items as T[];
  if (Array.isArray(payload.results)) return payload.results as T[];

  if (payload.data && typeof payload.data === 'object') {
    const nested = payload.data as Record<string, unknown>;
    if (Array.isArray(nested.items)) return nested.items as T[];
    if (Array.isArray(nested.results)) return nested.results as T[];
    if (Array.isArray(nested[key])) return nested[key] as T[];
  }

  console.error(`[Notion] Unknown ${key} response structure`, Object.keys(payload));
  return [];
}

async function fetchNotionPayload<T>(type: 'shortlist' | 'candidates'): Promise<T[]> {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-notion-candidates?type=${type}`,
    {
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const data = await response.json();
  if (!data?.success) throw new Error(data?.error || `Failed to fetch ${type}`);

  return extractItems<T>(data, type);
}

async function fetchShortlist(): Promise<ShortlistEntry[]> {
  return fetchNotionPayload<ShortlistEntry>('shortlist');
}

async function fetchCandidates(): Promise<Candidate[]> {
  return fetchNotionPayload<Candidate>('candidates');
}

export function useNotionShortlist() {
  return useQuery({
    queryKey: ['notion-shortlist'],
    queryFn: fetchShortlist,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retryOnMount: false,
    retry: 2,
  });
}

export function useNotionCandidates() {
  return useQuery({
    queryKey: ['notion-candidates'],
    queryFn: fetchCandidates,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retryOnMount: false,
    retry: 2,
  });
}
