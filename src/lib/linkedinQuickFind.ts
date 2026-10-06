/**
 * Ajouter un candidat depuis LinkedIn : recherche par nom, lecture du profil
 * complet, création de la ligne candidat. Les règles sont dans
 * linkedinQuickFindModel.ts.
 *
 * Une recherche et une lecture de profil comptent dans le quota LinkedIn du
 * compte (100 par jour pour chacune). Une seule de chaque par action de la
 * personne, jamais de pagination ni de relance ici.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { emitQuotaAction } from '@/lib/quotaEvents';
import {
  CALLS_SEARCH_NAME,
  buildCandidateRow,
  classifyQuickFindError,
  linkedinSlug,
  toPerson,
  type LinkedInPerson,
  type QuickFindError,
  type SearchApi,
} from '@/lib/linkedinQuickFindModel';

const RESULTS_SHOWN = 5;

/** Un candidat prêt à être choisi dans le sélecteur (même forme que SelectedCandidate). */
export interface AddedCandidate {
  candidateId: string;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  linkedinUrl: string | null;
}

export async function searchPeopleByName(input: {
  accountId: string;
  api: SearchApi;
  name: string;
}): Promise<{ status: 'ok'; people: LinkedInPerson[] } | { status: 'error'; error: QuickFindError }> {
  const { data, httpStatus } = await invokeUnipile({
    body: {
      action: 'search',
      account_id: input.accountId,
      api: input.api,
      category: 'people',
      keywords: input.name.trim().slice(0, 100),
      limit: RESULTS_SHOWN,
    },
  });
  if (!data?.success) return { status: 'error', error: classifyQuickFindError(data, httpStatus) };
  const items = Array.isArray(data.results) ? (data.results as unknown[]) : [];
  emitQuotaAction('searchResultsFetched', items.length, input.accountId);
  const people = items.map(toPerson).filter((p): p is LinkedInPerson => p !== null).slice(0, RESULTS_SHOWN);
  return { status: 'ok', people };
}

/** Le candidat est-il déjà dans l'organisation (même identifiant LinkedIn ou même adresse de profil) ? */
async function findExistingCandidate(organizationId: string, person: LinkedInPerson): Promise<AddedCandidate | null> {
  const slug = linkedinSlug(person.profileUrl);
  let query = supabase
    .from('job_candidate_status')
    .select('candidate_id, candidate_name, candidate_headline, linkedin_profile_url, linkedin_profile_data')
    .eq('organization_id', organizationId)
    .not('candidate_name', 'is', null)
    .limit(1);
  query = slug
    ? query.or(`candidate_id.eq."${person.id.replace(/"/g, '')}",linkedin_profile_url.ilike.%linkedin.com/in/${slug}%`)
    : query.eq('candidate_id', person.id);
  const { data, error } = await query;
  if (error) throw error;
  const row = data?.[0];
  if (!row?.candidate_name) return null;
  const profile = (row.linkedin_profile_data ?? {}) as Record<string, unknown>;
  const picture = profile.profile_picture_url ?? profile.profile_picture_url_large;
  return {
    candidateId: row.candidate_id,
    name: row.candidate_name,
    headline: row.candidate_headline,
    avatarUrl: typeof picture === 'string' ? picture : null,
    linkedinUrl: row.linkedin_profile_url,
  };
}

/** La recherche qui reçoit les candidats ajoutés depuis un appel, créée la première fois. */
async function ensureCallsSearchProject(organizationId: string, userId: string): Promise<string> {
  const { data: found, error: readError } = await supabase
    .from('sourcing_projects')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('kind', 'search')
    .eq('name', CALLS_SEARCH_NAME)
    .limit(1)
    .maybeSingle();
  if (readError) throw readError;
  if (found) return found.id;

  const { data: created, error: createError } = await supabase
    .from('sourcing_projects')
    .insert({ name: CALLS_SEARCH_NAME, kind: 'search', created_by: userId, organization_id: organizationId, filters_snapshot: {} })
    .select('id')
    .single();
  if (createError) throw createError;
  return created.id;
}

export interface AddFromLinkedInResult {
  candidate: AddedCandidate;
  /** Déjà dans l'app : rien n'a été créé ni lu chez LinkedIn. */
  existing: boolean;
  /** Le profil complet n'a pas pu être lu : le candidat est créé avec les données de la recherche. */
  partial: boolean;
}

export async function addCandidateFromLinkedIn(input: {
  organizationId: string;
  userId: string;
  accountId: string;
  person: LinkedInPerson;
}): Promise<AddFromLinkedInResult> {
  const { organizationId, userId, accountId, person } = input;

  const existing = await findExistingCandidate(organizationId, person);
  if (existing) return { candidate: existing, existing: true, partial: false };

  // Une visite de profil, pour avoir expériences, formations et compétences.
  // Un refus (quota, limite) ne bloque pas l'ajout : le candidat est créé avec la recherche.
  let fullProfile: Record<string, unknown> | null = null;
  const { data } = await invokeUnipile({
    body: {
      action: 'get_profile',
      account_id: accountId,
      ...(person.profileUrl ? { profile_url: person.profileUrl } : { profile_id: person.id }),
    },
  });
  if (data?.success && data.profile && typeof data.profile === 'object') {
    fullProfile = data.profile as Record<string, unknown>;
    emitQuotaAction('profileVisits', 1, accountId);
  }

  const projectId = await ensureCallsSearchProject(organizationId, userId);
  const row = buildCandidateRow({ projectId, organizationId, userId, person, fullProfile });
  // Champ par champ, jamais « ...row » : le garde-fou des écrivains de l'étape
  // (tests/c1/lot0b-ecrivains.test.mjs) relit cette charge et exige qu'elle ne pose
  // ni status, ni pipeline_stage, ni colonne du modèle d'étapes (le déclencheur
  // pose « À trier »).
  const { error } = await supabase
    .from('job_candidate_status')
    .upsert({
      job_id: row.job_id,
      project_id: row.project_id,
      organization_id: row.organization_id,
      created_by: row.created_by,
      candidate_id: row.candidate_id,
      candidate_name: row.candidate_name,
      candidate_headline: row.candidate_headline,
      linkedin_profile_url: row.linkedin_profile_url,
      linkedin_profile_data: row.linkedin_profile_data as Json,
    }, { onConflict: 'job_id,candidate_id,created_by', ignoreDuplicates: true });
  if (error) throw error;

  const picture = row.linkedin_profile_data.profile_picture_url;
  return {
    candidate: {
      candidateId: person.id,
      name: person.name,
      headline: row.candidate_headline,
      avatarUrl: typeof picture === 'string' ? picture : null,
      linkedinUrl: person.profileUrl,
    },
    existing: false,
    partial: fullProfile === null,
  };
}
