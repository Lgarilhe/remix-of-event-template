/**
 * useCandidateAvatars — batch-fetch des photos de profil pour un petit set
 * de candidats (typiquement le feed d'activité du Dashboard, max 8-10).
 *
 * Pourquoi : `useATSData` exclut `linkedin_profile_data` du SELECT (JSONB
 * lourd, ralentirait toutes les vues ATS pour 99% du temps inutile). Mais
 * pour l'activity feed, on a besoin de la photo de quelques candidats.
 *
 * Stratégie : 1 query ciblée sur les `sourceId` des candidats à afficher,
 * avec extraction `->>'profile_picture_url'` pour ne ramener que cette
 * propriété, pas tout le JSONB. React Query cache 5min.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface AvatarRow {
  id: string;
  picture_url: string | null;
}

const fetchAvatars = async (sourceIds: string[]): Promise<Map<string, string | null>> => {
  if (sourceIds.length === 0) return new Map();

  // Note: Supabase ne supporte pas l'opérateur ->> dans .select() directement
  // → on récupère le JSONB et on extract côté client. Limité à 10 IDs donc
  // payload reste léger même avec linkedin_profile_data complet.
  const { data, error } = await supabase
    .from('job_candidate_status')
    .select('id, linkedin_profile_data')
    .in('id', sourceIds);

  if (error || !data) {
    console.warn('[useCandidateAvatars] fetch error:', error);
    return new Map();
  }

  const map = new Map<string, string | null>();
  for (const row of data) {
    const profileData = row.linkedin_profile_data as Record<string, unknown> | null;
    const url =
      (profileData?.profile_picture_url as string | undefined) ||
      (profileData?.profile_picture_url_large as string | undefined) ||
      null;
    map.set(row.id, url || null);
  }
  return map;
};

/**
 * Returns Map<sourceId, pictureUrl|null>. Loading is silent (no isLoading
 * exposed) — l'UI utilise le fallback initiales en attendant.
 */
export function useCandidateAvatars(sourceIds: string[]): Map<string, string | null> {
  // Stable key from sorted IDs (don't trigger refetch on reorder)
  const sortedKey = [...sourceIds].sort().join(',');

  const { data } = useQuery({
    queryKey: ['candidate-avatars', sortedKey],
    queryFn: () => fetchAvatars(sourceIds),
    enabled: sourceIds.length > 0,
    staleTime: 5 * 60 * 1000, // 5min
  });

  return data || new Map();
}
