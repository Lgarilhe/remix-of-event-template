/**
 * useCandidateAvatars — batch-fetch des photos de profil pour un petit set
 * de candidats (typiquement le feed d'activité du Dashboard, max 8-10).
 *
 * Pourquoi : `useATSData` exclut `linkedin_profile_data` du SELECT (JSONB
 * lourd, ralentirait toutes les vues ATS pour 99% du temps inutile). Mais
 * pour le feed et la page Tasks on a besoin de quelques photos.
 *
 * Stratégie : 1 query ciblée avec extraction `->>'profile_picture_url'` côté
 * client. React Query cache 5min.
 *
 * Deux variantes :
 * - `useCandidateAvatars(sourceIds)` : par job_candidate_status.id (source row id)
 * - `useCandidateAvatarsByCandidateId(candidateIds)` : par candidate_id
 *   (= LinkedIn profile_id)
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const extractAvatarFromProfileData = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const url = (obj.profile_picture_url as string | undefined) ||
    (obj.profile_picture_url_large as string | undefined) ||
    null;
  return url || null;
};

const fetchAvatarsBySourceId = async (sourceIds: string[]): Promise<Map<string, string | null>> => {
  if (sourceIds.length === 0) return new Map();
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
    map.set(row.id, extractAvatarFromProfileData(row.linkedin_profile_data));
  }
  return map;
};

const fetchAvatarsByCandidateId = async (candidateIds: string[]): Promise<Map<string, string | null>> => {
  if (candidateIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('job_candidate_status')
    .select('candidate_id, linkedin_profile_data')
    .in('candidate_id', candidateIds);
  if (error || !data) {
    console.warn('[useCandidateAvatarsByCandidateId] fetch error:', error);
    return new Map();
  }
  const map = new Map<string, string | null>();
  for (const row of data) {
    // Plusieurs job_candidate_status peuvent partager le même candidate_id
    // (1 candidat sur plusieurs missions). On garde la 1ère photo non-null
    // qu'on trouve.
    const url = extractAvatarFromProfileData((row as any).linkedin_profile_data);
    if (!map.has(row.candidate_id) || (url && !map.get(row.candidate_id))) {
      map.set(row.candidate_id, url);
    }
  }
  return map;
};

/**
 * Fetch by job_candidate_status.id. Returns Map<sourceId, pictureUrl|null>.
 */
export function useCandidateAvatars(sourceIds: string[]): Map<string, string | null> {
  const sortedKey = [...sourceIds].sort().join(',');
  const { data } = useQuery({
    queryKey: ['candidate-avatars', sortedKey],
    queryFn: () => fetchAvatarsBySourceId(sourceIds),
    enabled: sourceIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  return data || new Map();
}

/**
 * Fetch by candidate_id (= LinkedIn profile_id). Returns Map<candidateId, pictureUrl|null>.
 */
export function useCandidateAvatarsByCandidateId(
  candidateIds: string[],
): Map<string, string | null> {
  const sortedKey = [...candidateIds].sort().join(',');
  const { data } = useQuery({
    queryKey: ['candidate-avatars-by-cid', sortedKey],
    queryFn: () => fetchAvatarsByCandidateId(candidateIds),
    enabled: candidateIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  return data || new Map();
}
