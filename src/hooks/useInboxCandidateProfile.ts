import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyLinkedInAccountId } from '@/hooks/useMyLinkedInAccountId';
import { supabase } from '@/integrations/supabase/client';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { emitQuotaAction } from '@/lib/quotaEvents';
import { candidateLinkedInSlug, hasCandidateProfileDetails, mergeCandidateProfileDetails, normalizeCandidateProfile } from '@/lib/candidateProfile';
import type { LinkedInProfile } from '@/components/outreach/types';

export interface CandidateProfileIdentity {
  profileId: string | null;
  profileUrl?: string | null;
  profileName?: string;
  aliases?: string[];
}

type ProfileErrorKind = 'session' | 'access' | 'quota' | 'not-found' | 'unavailable' | 'stored';
const PROFILE_ERRORS: Record<ProfileErrorKind, string> = {
  session: 'Votre session a expiré. Reconnectez-vous pour consulter ce profil.',
  access: 'Votre compte ne permet pas de consulter ce profil LinkedIn. Vérifiez votre connexion dans les paramètres.',
  quota: 'La limite de consultation des profils LinkedIn est atteinte. Réessayez plus tard.',
  'not-found': 'Ce profil est introuvable sur LinkedIn. Vérifiez le lien du candidat.',
  unavailable: 'LinkedIn ne répond pas pour le moment. Réessayez dans quelques instants.',
  stored: 'Le profil enregistré est temporairement indisponible. Réessayez dans quelques instants.',
};

export class InboxCandidateProfileError extends Error {
  constructor(public readonly kind: ProfileErrorKind, public readonly httpStatus?: number) {
    super(PROFILE_ERRORS[kind]);
    this.name = 'InboxCandidateProfileError';
  }
}

function profileError(data: { error?: string; errorType?: string }, httpStatus?: number) {
  // Seule une absence de profil explicitement identifiée par le serveur
  // autorise une recherche par son URL publique, jamais un 502 générique.
  const notFound = httpStatus === 404 && data.errorType === 'PROFILE_NOT_FOUND';
  const kind: ProfileErrorKind = httpStatus === 401 ? 'session'
    : httpStatus === 403 ? 'access'
    : httpStatus === 429 ? 'quota'
    : notFound ? 'not-found' : 'unavailable';
  return new InboxCandidateProfileError(kind, httpStatus);
}

export async function fetchInboxCandidateProfile(organizationId: string, ids: string[], profileUrl: string | null, name: string, accountId: string | null, refresh = false) {
  const slug = candidateLinkedInSlug(profileUrl);
  let storedProfile: LinkedInProfile | undefined;
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
      return (data.summary ? 10 : 0) + (data.work_experience?.length ?? 0) * 3 + (data.education?.length ?? 0) * 2 + (data.skills?.length ?? 0) + (data.languages?.length ?? 0);
    };
    const stored = rows.sort((a, b) => richness(b.linkedin_profile_data) - richness(a.linkedin_profile_data)).find(row => row.linkedin_profile_data);
    if (stored) {
      storedProfile = normalizeCandidateProfile(stored.linkedin_profile_data, ids[0] || stored.candidate_id, name);
      if (hasCandidateProfileDetails(storedProfile) || !accountId) return storedProfile;
    }
    if (results.some(result => result.error) && !accountId) throw new InboxCandidateProfileError('stored');
  }
  if (!accountId || (!slug && !ids.length)) return null;
  const targets = [...new Set([ids[0], slug].filter((id): id is string => !!id))];
  for (const [index, target] of targets.entries()) {
    const { data, httpStatus } = await invokeUnipile({ body: { action: 'get_profile', organization_id: organizationId, account_id: accountId, profile_id: target, include_details: true, ...(slug ? { profile_url: profileUrl } : {}) } });
    if (data.success && data.profile) {
      emitQuotaAction('profileVisits', 1, accountId);
      return mergeCandidateProfileDetails(storedProfile, normalizeCandidateProfile(data.profile, ids[0] || slug!, name));
    }
    const error = profileError(data, httpStatus);
    if (error.kind !== 'not-found' || index === targets.length - 1) throw error;
  }
  return null;
}

/** Cache isolé par personne connectée, organisation, candidat et compte personnel. */
export function useInboxCandidateProfile({ profileId, profileUrl = null, profileName = '', aliases = [] }: CandidateProfileIdentity) {
  const { user, isReady } = useAuthReady();
  const { organizationId } = useOrganization();
  const accountId = useMyLinkedInAccountId();
  const queryClient = useQueryClient();
  // L'identifiant du profil est prioritaire ; les alias servent à retrouver
  // les instantanés, sans remplacer cette identité par ordre alphabétique.
  const ids = [...new Set([profileId, ...aliases].filter((id): id is string => !!id))];
  const queryKey = ['inbox-candidate-profile', user?.id, organizationId, accountId, ids.join('|'), profileUrl];
  const query = useQuery({ queryKey, queryFn: async () => {
    const previous = queryClient.getQueryData<LinkedInProfile>(queryKey);
    const profile = await fetchInboxCandidateProfile(organizationId!, ids, profileUrl, profileName, accountId);
    return mergeCandidateProfileDetails(previous, profile);
  }, enabled: isReady && !!user && !!organizationId && (!!ids.length || !!profileUrl), staleTime: 5 * 60_000, retry: false });
  const refresh = useMutation({
    mutationFn: async () => {
      // La clé part avec la requête : un changement d'organisation pendant
      // l'actualisation ne doit jamais déposer le résultat dans le nouveau cache.
      const scopeKey = queryKey;
      const previous = queryClient.getQueryData<LinkedInProfile>(scopeKey);
      const profile = await fetchInboxCandidateProfile(organizationId!, ids, profileUrl, profileName, accountId, true);
      return { profile: mergeCandidateProfileDetails(previous, profile), scopeKey };
    },
    onSuccess: result => { queryClient.setQueryData(result.scopeKey, result.profile); },
  });
  return { ...query, canRefresh: !!accountId && !!organizationId && !!user && (!!ids.length || !!profileUrl), refresh };
}
