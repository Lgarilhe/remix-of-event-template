/**
 * Appels téléphoniques d'un candidat, quel que soit l'opérateur relié
 * (table phone_calls, alimentée par le webhook de chaque fournisseur).
 *
 * Le rapprochement se fait ICI, à la lecture : on part des numéros connus du
 * candidat (candidate_contacts) et on cherche les appels qui portent ce numéro
 * en E.164. Un numéro corrigé se rapproche aussitôt, aucun rattachement n'est
 * figé à l'écriture. La RLS limite la lecture à l'organisation active.
 */
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { getActiveOrganizationId } from '@/lib/orgContext';
import { toE164 } from '@/lib/phone';

export type PhoneCallOutcome = 'done' | 'missed' | 'voicemail';

export interface PhoneCall {
  id: string;
  provider: string;
  direction: 'inbound' | 'outbound' | null;
  /** `missed` : personne n'a décroché (appel reçu manqué ou émis sans réponse). */
  outcome: PhoneCallOutcome;
  startedAt: string | null;
  /** Durée de conversation en secondes (sans la sonnerie). */
  talkSeconds: number;
  /** Numéro du correspondant tel que reçu, et en E.164 (null : masqué ou ambigu, jamais rapprochable). */
  contactNumber: string | null;
  numberE164: string | null;
  contactName: string | null;
  agentName: string | null;
  agentEmail: string | null;
  recordingUrl: string | null;
  voicemailUrl: string | null;
  tags: string[];
  notes: string | null;
}

const COLUMNS =
  'id, provider, direction, started_at, answered_at, talk_seconds, contact_number, contact_number_e164, contact_name, agent_name, agent_email, recording_url, voicemail_url, tags, notes';

type PhoneCallRow = Pick<
  Database['public']['Tables']['phone_calls']['Row'],
  'id' | 'provider' | 'direction' | 'started_at' | 'answered_at' | 'talk_seconds' | 'contact_number'
  | 'contact_number_e164' | 'contact_name' | 'agent_name' | 'agent_email' | 'recording_url' | 'voicemail_url'
  | 'tags' | 'notes'
>;

export function rowToPhoneCall(row: PhoneCallRow): PhoneCall {
  return {
    id: row.id,
    provider: row.provider,
    direction: row.direction === 'inbound' || row.direction === 'outbound' ? row.direction : null,
    outcome: row.voicemail_url ? 'voicemail' : row.answered_at ? 'done' : 'missed',
    startedAt: row.started_at,
    talkSeconds: row.talk_seconds ?? 0,
    contactNumber: row.contact_number,
    numberE164: row.contact_number_e164,
    contactName: row.contact_name,
    agentName: row.agent_name,
    agentEmail: row.agent_email,
    recordingUrl: row.recording_url,
    voicemailUrl: row.voicemail_url,
    tags: row.tags ?? [],
    notes: row.notes,
  };
}

/** Numéros enregistrés pour un candidat de l'organisation active (saisis ou enrichis). */
export async function fetchKnownCandidatePhones(candidateId: string | null | undefined): Promise<string[]> {
  if (!candidateId) return [];
  const organizationId = await getActiveOrganizationId();
  if (!organizationId) return [];
  const { data, error } = await supabase
    .from('candidate_contacts')
    .select('phone')
    .eq('organization_id', organizationId)
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (error) {
    console.warn('[phoneCalls] numéros du candidat illisibles:', error.message);
    return [];
  }
  return data?.phone ? [data.phone] : [];
}

/** Appels dont le numéro du correspondant est l'un de ces numéros (le plus récent d'abord). */
export async function fetchPhoneCallsForNumbers(
  rawNumbers: ReadonlyArray<string | null | undefined>,
  limit = 50,
): Promise<PhoneCall[]> {
  const numbers = Array.from(new Set(rawNumbers.map((n) => toE164(n)).filter((n): n is string => !!n)));
  if (numbers.length === 0) return [];
  const { data, error } = await supabase
    .from('phone_calls')
    .select(COLUMNS)
    .in('contact_number_e164', numbers)
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    console.warn('[phoneCalls] appels illisibles:', error.message);
    return [];
  }
  return (data ?? []).map(rowToPhoneCall);
}

/**
 * Appels d'un candidat : numéros connus de l'organisation, plus ceux que
 * l'appelant connaît déjà (ex. un numéro lu sur la fiche).
 */
export async function fetchPhoneCallsForCandidate(
  candidateId: string | null | undefined,
  extraNumbers: ReadonlyArray<string | null | undefined> = [],
): Promise<PhoneCall[]> {
  const known = await fetchKnownCandidatePhones(candidateId);
  return fetchPhoneCallsForNumbers([...known, ...extraNumbers]);
}

/** Les appels les plus récents de l'organisation active (la RLS fait le périmètre). */
export async function fetchRecentPhoneCalls(limit = 300): Promise<PhoneCall[]> {
  const { data, error } = await supabase
    .from('phone_calls')
    .select(COLUMNS)
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(rowToPhoneCall);
}

const CONTACTS_PAGE = 1000;

/**
 * Tous les numéros enregistrés pour les candidats de l'organisation active, en E.164.
 * Un numéro de la base qui ne se normalise pas sûrement est ignoré (jamais de faux rapprochement).
 */
export async function fetchOrgContactNumbers(): Promise<Set<string>> {
  return new Set((await fetchOrgContactMap()).keys());
}

/** Numéro E.164 → candidat de l'organisation active qui l'a enregistré (le premier, si deux candidats le partagent). */
export async function fetchOrgContactMap(): Promise<Map<string, string>> {
  const organizationId = await getActiveOrganizationId();
  const map = new Map<string, string>();
  if (!organizationId) return map;
  for (let from = 0; ; from += CONTACTS_PAGE) {
    const { data, error } = await supabase
      .from('candidate_contacts')
      .select('candidate_id, phone')
      .eq('organization_id', organizationId)
      .not('phone', 'is', null)
      .order('candidate_id', { ascending: true })
      .range(from, from + CONTACTS_PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const e164 = toE164(row.phone);
      if (e164 && !map.has(e164)) map.set(e164, row.candidate_id);
    }
    if ((data?.length ?? 0) < CONTACTS_PAGE) break;
  }
  return map;
}

const MAX_PERIOD_ROWS = 5000;

/** Les appels depuis `sinceIso` (le plus récent d'abord), 5 000 au plus : la RLS limite à l'organisation active. */
export async function fetchPhoneCallsSince(sinceIso: string): Promise<PhoneCall[]> {
  const calls: PhoneCall[] = [];
  for (let from = 0; from < MAX_PERIOD_ROWS; from += CONTACTS_PAGE) {
    const { data, error } = await supabase
      .from('phone_calls')
      .select(COLUMNS)
      .gte('started_at', sinceIso)
      .order('started_at', { ascending: false })
      .range(from, from + CONTACTS_PAGE - 1);
    if (error) throw error;
    calls.push(...(data ?? []).map(rowToPhoneCall));
    if ((data?.length ?? 0) < CONTACTS_PAGE) break;
  }
  return calls;
}

export interface AttachedCandidate {
  candidateId: string;
  /** Null : le candidat a un numéro enregistré mais aucune ligne de mission ou de recherche ne porte son nom. */
  name: string | null;
  avatarUrl: string | null;
}

const NAME_CHUNK = 200;

/** Nom et photo des candidats de l'organisation active, pour des identifiants donnés. */
export async function fetchCandidateNames(candidateIds: ReadonlyArray<string>): Promise<Map<string, { name: string | null; avatarUrl: string | null }>> {
  const organizationId = await getActiveOrganizationId();
  const names = new Map<string, { name: string | null; avatarUrl: string | null }>();
  if (!organizationId || candidateIds.length === 0) return names;
  const ids = Array.from(new Set(candidateIds));
  for (let i = 0; i < ids.length; i += NAME_CHUNK) {
    const { data, error } = await supabase
      .from('job_candidate_status')
      .select('candidate_id, candidate_name, linkedin_profile_data')
      .eq('organization_id', organizationId)
      .in('candidate_id', ids.slice(i, i + NAME_CHUNK))
      .not('candidate_name', 'is', null);
    if (error) throw error;
    for (const row of data ?? []) {
      if (names.has(row.candidate_id)) continue;
      const profile = (row.linkedin_profile_data ?? {}) as Record<string, unknown>;
      const picture = profile.profile_picture_url ?? profile.profile_picture_url_large;
      names.set(row.candidate_id, { name: row.candidate_name, avatarUrl: typeof picture === 'string' ? picture : null });
    }
  }
  return names;
}
