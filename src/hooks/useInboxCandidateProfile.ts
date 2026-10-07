import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyLinkedInAccountId } from '@/hooks/useMyLinkedInAccountId';
import { supabase } from '@/integrations/supabase/client';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { emitQuotaAction } from '@/lib/quotaEvents';
import { candidateLinkedInSlug, normalizeCandidateProfile } from '@/lib/candidateProfile';

export interface CandidateProfileIdentity {
  profileId: string | null;
  profileUrl?: string | null;
  profileName?: string;
  aliases?: string[];
}

export async function fetchInboxCandidateProfile(organizationId: string, ids: string[], profileUrl: string | null, name: string, accountId: string | null, refresh = false) {
  const slug = candidateLinkedInSlug(profileUrl);
  if (!refresh) {
    const columns = 'candidate_id, linkedin_profile_url, linkedin_profile_data, updated_at';
    const requests = [];
    if (ids.length) requests.push(supabase.from('job_candidate_status').select(columns).eq('organization_id', organizationId).in('candidate_id', ids).not('linkedin_profile_data', 'is', null).order('updated_at', { ascending: false }).limit(20));
    if (slug) requests.push(supabase.from('job_candidate_status').select(columns).eq('organization_id', organizationId).ilike('linkedin_profile_url', `%/in/${slug.replace(/[\\%_]/g, '\\$&')}%`).not('linkedin_profile_data', 'is', null).order('updated_at', { ascending: false }).limit(20));
    const results = await Promise.all(requests);
    const rows = results.flatMap(result => result.data ?? []).filter(row => ids.includes(row.candidate_id) || (slug && candidateLinkedInSlug(row.linkedin_profile_url) === slug));
    // Un instantané de recherche récent ne doit pas masquer un profil détaillé déjà enregistré.
    const richness = (value: unknown) => {
      const data = normalizeCandidateProfile(value, '');
      return (data.summary ? 10 : 0) + (data.work_experience?.length ?? 0) * 3 + (data.education?.length ?? 0) * 2 + (data.skills?.length ?? 0);
    };
    const stored = rows.sort((a, b) => richness(b.linkedin_profile_data) - richness(a.linkedin_profile_data)).find(row => row.linkedin_profile_data);
    if (stored) return normalizeCandidateProfile(stored.linkedin_profile_data, ids[0] || stored.candidate_id, name);
    if (results.some(result => result.error) && !accountId) throw new Error('Le profil enregistré est temporairement indisponible.');
  }
  if (!accountId || (!slug && !ids.length)) return null;
  const { data } = await invokeUnipile({ body: { action: 'get_profile', organization_id: organizationId, account_id: accountId, profile_id: slug || ids[0], ...(slug ? { profile_url: profileUrl } : {}) } });
  if (!data.success || !data.profile) throw new Error('Le profil LinkedIn est temporairement indisponible.');
  emitQuotaAction('profileVisits', 1, accountId);
  return normalizeCandidateProfile(data.profile, ids[0] || slug!, name);
}

/** Cache isolé par personne connectée, organisation, candidat et compte personnel. */
export function useInboxCandidateProfile({ profileId, profileUrl = null, profileName = '', aliases = [] }: CandidateProfileIdentity) {
  const { user, isReady } = useAuthReady();
  const { organizationId } = useOrganization();
  const accountId = useMyLinkedInAccountId();
  const queryClient = useQueryClient();
  const ids = [...new Set([profileId, ...aliases].filter((id): id is string => !!id))].sort();
  const queryKey = ['inbox-candidate-profile', user?.id, organizationId, accountId, ids.join('|'), profileUrl];
  const query = useQuery({ queryKey, queryFn: () => fetchInboxCandidateProfile(organizationId!, ids, profileUrl, profileName, accountId), enabled: isReady && !!user && !!organizationId && (!!ids.length || !!profileUrl), staleTime: 5 * 60_000, retry: false });
  const refresh = useMutation({
    mutationFn: async () => {
      // La clé part avec la requête : un changement d'organisation pendant
      // l'actualisation ne doit jamais déposer le résultat dans le nouveau cache.
      const scopeKey = queryKey;
      const profile = await fetchInboxCandidateProfile(organizationId!, ids, profileUrl, profileName, accountId, true);
      return { profile, scopeKey };
    },
    onSuccess: result => { queryClient.setQueryData(result.scopeKey, result.profile); },
  });
  return { ...query, canRefresh: !!accountId && !!organizationId && !!user && (!!ids.length || !!profileUrl), refresh };
}
