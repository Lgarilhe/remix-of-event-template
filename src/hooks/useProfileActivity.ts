import { useQuery } from '@tanstack/react-query';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { supabase } from '@/integrations/supabase/client';
import { rowToPhoneCall } from '@/lib/phoneCalls';
import { toE164 } from '@/lib/phone';
import { enrollmentProfileFilter } from '@/lib/enrollmentDuplicates';
import { extractLinkedInSlug } from '@/lib/linkedinUtils';

export interface ActivityEvent {
  id: string;
  type: 'sequence_step' | 'booking' | 'aircall';
  timestamp: string;
  actionType: string;
  stepOrder: number;
  status: string;
  skipReason?: string | null;
  errorMessage?: string | null;
  finalSubject?: string | null;
  sequenceName?: string | null;
  finalMessage?: string | null;
  channel?: string | null;
  recipient?: string | null;
  // Booking-specific fields
  qualificationSessionId?: string | null;
  eventName?: string | null;
  eventLocation?: string | null;
  eventEndAt?: string | null;
  // Aircall-specific fields
  callDirection?: string | null;
  callDuration?: number | null;
  callUserName?: string | null;
}

/**
 * Nom utilisable pour rapprocher une conversation d'une inscription : un nom
 * complet (deux mots au moins), jamais un intitulé générique de repli de la
 * messagerie (« Conversation », « Conversation du … »). null sinon.
 */
export function usableProfileName(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  if (/^conversation(\s+du\s.*)?$/i.test(trimmed)) return null;
  if (trimmed.split(' ').filter(part => part.length >= 2).length < 2) return null;
  return trimmed;
}

const PAGE = 500;

async function readPages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return rows;
  }
}

/** L'URL est comparée par slug exact après la recherche, jamais par inclusion. */
function profileSlug(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname !== 'linkedin.com' && !url.hostname.endsWith('.linkedin.com')) return null;
    return extractLinkedInSlug(value);
  } catch { return null; }
}
const sameProfileUrl = (a: string | null, b: string | null) => {
  const slug = profileSlug(a);
  return !!slug && slug === profileSlug(b);
};

export async function fetchProfileActivity(organizationId: string, profileIds: string[], profileUrl?: string | null, profileName?: string | null): Promise<{ events: ActivityEvent[]; incomplete: boolean }> {
  if (!organizationId || (!profileIds.length && !profileUrl && !usableProfileName(profileName))) return { events: [], incomplete: false };
  const urlSlug = profileSlug(profileUrl);
  const exactName = usableProfileName(profileName);
  const enrollmentColumns = 'id, sequence_id, profile_id, provider_id, resolved_profile_id, profile_url, email_used, phone_used';
  const fetchSequenceEvents = async (): Promise<ActivityEvent[]> => {
    let enrollments = profileIds.length || profileUrl ? await readPages((from, to) => {
      let query = supabase.from('sequence_enrollments').select(enrollmentColumns).eq('organization_id', organizationId);
      if (profileIds.length) query = query.or(profileIds.map(enrollmentProfileFilter).join(','));
      else if (profileUrl) query = query.eq('profile_url', profileUrl);
      else query = query.eq('profile_name', exactName!);
      return query.order('id').range(from, to);
    }) : [];
    if (urlSlug) {
      const matches = await readPages((from, to) => supabase.from('sequence_enrollments').select(enrollmentColumns)
        .eq('organization_id', organizationId).ilike('profile_url', `%/in/${urlSlug}%`).order('id').range(from, to));
      enrollments = [...new Map([...enrollments, ...matches.filter(row => sameProfileUrl(profileUrl ?? null, row.profile_url))].map(row => [row.id, row])).values()];
    }
    if (!enrollments.length && !profileIds.length && !profileUrl && exactName) {
      const rows = await readPages((from, to) => supabase.from('sequence_enrollments').select(enrollmentColumns)
        .eq('organization_id', organizationId).eq('profile_name', exactName).order('id').range(from, to));
      const people = new Set(rows.map(row => row.resolved_profile_id || row.provider_id || row.profile_id));
      enrollments = people.size === 1 ? rows : [];
    }
    if (!enrollments.length) return [];
    const sequenceIds = [...new Set(enrollments.map(row => row.sequence_id))];
    const { data: sequences, error } = await supabase.from('outreach_sequences').select('id, name')
      .eq('organization_id', organizationId).in('id', sequenceIds);
    if (error) throw error;
    const sequenceNames = new Map((sequences ?? []).map(row => [row.id, row.name]));
    const result: ActivityEvent[] = [];
    for (let offset = 0; offset < enrollments.length; offset += 100) {
      const batch = enrollments.slice(offset, offset + 100);
      const executions = await readPages((from, to) => supabase.from('sequence_step_executions')
        .select('id, enrollment_id, step_id, step_order, status, executed_at, scheduled_at, skip_reason, error_message, final_subject, final_message, channel')
        .eq('organization_id', organizationId).in('enrollment_id', batch.map(row => row.id))
        .not('executed_at', 'is', null).order('executed_at').order('id').range(from, to));
      if (!executions.length) continue;
      const { data: steps, error: stepError } = await supabase.from('sequence_steps').select('id, action_type, step_channel')
        .eq('organization_id', organizationId).in('id', [...new Set(executions.map(row => row.step_id))]);
      if (stepError) throw stepError;
      const stepMap = new Map((steps ?? []).map(row => [row.id, row]));
      const enrollmentMap = new Map(batch.map(row => [row.id, row]));
      for (const row of executions) {
        const step = stepMap.get(row.step_id);
        const enrollment = enrollmentMap.get(row.enrollment_id);
        if (!row.executed_at || !step || !enrollment) continue;
        const channel = row.channel || step.step_channel || (step.action_type === 'email' ? 'email' : step.action_type === 'whatsapp_message' ? 'whatsapp' : 'linkedin');
        result.push({
          id: row.id, type: 'sequence_step', timestamp: row.executed_at,
          actionType: step.action_type, stepOrder: row.step_order, status: row.status,
          skipReason: row.skip_reason, errorMessage: row.error_message,
          finalSubject: row.final_subject, finalMessage: row.final_message, channel,
          recipient: channel === 'email' ? enrollment.email_used : channel === 'whatsapp' ? enrollment.phone_used : null,
          sequenceName: sequenceNames.get(enrollment.sequence_id) ?? null,
        });
      }
    }
    return result;
  };
  const fetchBookings = async (): Promise<ActivityEvent[]> => {
    const columns = 'id, event_start_at, event_end_at, event_name, event_location, status, candidate_profile_id, candidate_linkedin_url';
    const byId = profileIds.length ? await readPages((from, to) => supabase.from('qualification_sessions').select(columns)
      .eq('organization_id', organizationId).in('candidate_profile_id', profileIds).not('event_start_at', 'is', null).order('id').range(from, to)) : [];
    const byUrl = urlSlug ? await readPages((from, to) => supabase.from('qualification_sessions').select(columns)
      .eq('organization_id', organizationId).ilike('candidate_linkedin_url', `%/in/${urlSlug}%`).not('event_start_at', 'is', null).order('id').range(from, to)) : [];
    const sessions = new Map([...byId, ...byUrl.filter(row => sameProfileUrl(profileUrl ?? null, row.candidate_linkedin_url))].map(row => [row.id, row]));
    return [...sessions.values()].map(row => ({
      id: `booking-${row.id}`, type: 'booking', timestamp: row.event_start_at!, actionType: 'calendly_booking',
      stepOrder: 0, status: row.status, qualificationSessionId: row.id,
      eventName: row.event_name, eventLocation: row.event_location, eventEndAt: row.event_end_at,
    }));
  };
  const fetchCalls = async (): Promise<ActivityEvent[]> => {
    if (!profileIds.length) return [];
    const { data: contacts, error } = await supabase.from('candidate_contacts').select('phone')
      .eq('organization_id', organizationId).in('candidate_id', profileIds);
    if (error) throw error;
    const numbers = [...new Set((contacts ?? []).map(row => toE164(row.phone)).filter((number): number is string => !!number))];
    if (!numbers.length) return [];
    const rows = await readPages((from, to) => supabase.from('phone_calls').select('*')
      .eq('organization_id', organizationId).in('contact_number_e164', numbers).order('started_at').order('id').range(from, to));
    return rows.map(rowToPhoneCall).filter(call => call.startedAt).map(call => ({
      id: `aircall-${call.id}`, type: 'aircall', timestamp: call.startedAt!, actionType: 'aircall_call', stepOrder: 0,
      status: call.outcome === 'missed' ? 'missed' : 'done', callDirection: call.direction, callDuration: call.talkSeconds, callUserName: call.agentName,
    }));
  };
  const results = await Promise.allSettled([fetchSequenceEvents(), fetchBookings(), fetchCalls()]);
  const events: ActivityEvent[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') events.push(...result.value);
    else console.warn('[useProfileActivity] source unavailable:', result.reason);
  }
  return { events: events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)), incomplete: results.some(result => result.status === 'rejected') };
}

export function useProfileActivity(profileId: string | null, profileUrl?: string | null, profileName?: string | null, aliases: string[] = []) {
  const { organizationId } = useOrganization();
  const { user, isReady } = useAuthReady();
  const ids = [...new Set([profileId, ...aliases].filter((id): id is string => !!id))].sort();
  const query = useQuery({
    queryKey: ['profile-activity', user?.id, organizationId, ids.join('|'), profileUrl ?? '', usableProfileName(profileName)],
    queryFn: () => fetchProfileActivity(organizationId!, ids, profileUrl, profileName),
    enabled: isReady && !!user && !!organizationId && (!!ids.length || !!profileUrl || !!usableProfileName(profileName)),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  return { events: query.data?.events ?? [], loading: query.isLoading, error: query.isError || !!query.data?.incomplete, retry: () => void query.refetch() };
}
