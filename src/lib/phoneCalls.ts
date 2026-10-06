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
  contactName: string | null;
  agentName: string | null;
  agentEmail: string | null;
  recordingUrl: string | null;
  voicemailUrl: string | null;
  tags: string[];
  notes: string | null;
}

const COLUMNS =
  'id, provider, direction, started_at, answered_at, talk_seconds, contact_name, agent_name, agent_email, recording_url, voicemail_url, tags, notes';

type PhoneCallRow = Pick<
  Database['public']['Tables']['phone_calls']['Row'],
  'id' | 'provider' | 'direction' | 'started_at' | 'answered_at' | 'talk_seconds' | 'contact_name'
  | 'agent_name' | 'agent_email' | 'recording_url' | 'voicemail_url' | 'tags' | 'notes'
>;

export function rowToPhoneCall(row: PhoneCallRow): PhoneCall {
  return {
    id: row.id,
    provider: row.provider,
    direction: row.direction === 'inbound' || row.direction === 'outbound' ? row.direction : null,
    outcome: row.voicemail_url ? 'voicemail' : row.answered_at ? 'done' : 'missed',
    startedAt: row.started_at,
    talkSeconds: row.talk_seconds ?? 0,
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
