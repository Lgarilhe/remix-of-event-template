import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
  // Booking-specific fields
  qualificationSessionId?: string | null;
  eventName?: string | null;
  eventLocation?: string | null;
  // Aircall-specific fields
  callDirection?: string | null;
  callDuration?: number | null;
  callUserName?: string | null;
}

export function useProfileActivity(profileId: string | null, profileUrl?: string | null, profileName?: string | null) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profileId && !profileUrl && !profileName) {
      setEvents([]);
      return;
    }

    let cancelled = false;
    const fetchActivity = async () => {
      console.log('[useProfileActivity] Fetching for:', { profileId, profileUrl, profileName });
      setLoading(true);
      try {
        // Get enrollments for this profile with progressive fallback:
        // 1) profile_id, 2) profile_url, 3) profile_name
        let enrollments: Array<{ id: string; sequence_id: string }> = [];

        if (profileId) {
          const { data } = await supabase
            .from('sequence_enrollments')
            .select('id, sequence_id')
            .eq('profile_id', profileId);
          enrollments = data || [];
        }

        if (!enrollments.length && profileUrl) {
          const { data } = await supabase
            .from('sequence_enrollments')
            .select('id, sequence_id')
            .eq('profile_url', profileUrl);
          enrollments = data || [];
        }

        if (!enrollments.length && profileName?.trim()) {
          const profileNameLike = `%${profileName.trim()}%`;
          const { data } = await supabase
            .from('sequence_enrollments')
            .select('id, sequence_id')
            .ilike('profile_name', profileNameLike);
          enrollments = data || [];
        }

        let mapped: ActivityEvent[] = [];

        if (enrollments.length && !cancelled) {
          // Get sequence names
          const sequenceIds = [...new Set(enrollments.map(e => e.sequence_id))];
          const { data: sequences } = await supabase
            .from('outreach_sequences')
            .select('id, name')
            .in('id', sequenceIds);
          const seqMap = new Map(sequences?.map(s => [s.id, s.name]) || []);

          // Get executions
          const enrollmentIds = enrollments.map(e => e.id);
          const { data: executions } = await supabase
            .from('sequence_step_executions')
            .select('id, enrollment_id, step_id, step_order, status, executed_at, scheduled_at, skip_reason, error_message, final_subject')
            .in('enrollment_id', enrollmentIds)
            .order('executed_at', { ascending: true, nullsFirst: false });

          if (executions?.length) {
            // Get step details for action types
            const stepIds = [...new Set(executions.map(e => e.step_id))];
            const { data: steps } = await supabase
              .from('sequence_steps')
              .select('id, action_type, sequence_id')
              .in('id', stepIds);
            const stepMap = new Map(steps?.map(s => [s.id, s]) || []);

            const enrollmentSeqMap = new Map(enrollments.map(e => [e.id, e.sequence_id]));

            mapped = executions
              .filter(ex => ex.executed_at)
              .map(ex => {
                const step = stepMap.get(ex.step_id);
                const seqId = enrollmentSeqMap.get(ex.enrollment_id);
                return {
                  id: ex.id,
                  type: 'sequence_step' as const,
                  timestamp: ex.executed_at!,
                  actionType: step?.action_type || 'unknown',
                  stepOrder: ex.step_order,
                  status: ex.status,
                  skipReason: ex.skip_reason,
                  errorMessage: ex.error_message,
                  finalSubject: ex.final_subject,
                  sequenceName: seqId ? seqMap.get(seqId) || null : null,
                };
              });
          }
        }

        // Fetch booking events (qualification sessions) for this candidate
        // Use multiple matching strategies: LinkedIn URL, profile_id, or name
        let bookingEvents: ActivityEvent[] = [];
        let sessions: any[] = [];

        if (profileUrl) {
          const normalizedPath = profileUrl.split('linkedin.com')[1]?.replace(/\/$/, '') || '';
          if (normalizedPath) {
            const { data } = await supabase
              .from('qualification_sessions')
              .select('id, event_start_at, event_name, event_location, status, candidate_linkedin_url')
              .ilike('candidate_linkedin_url', `%${normalizedPath}%`);
            sessions = data || [];
          }
        }

        // Fallback: match by candidate_profile_id
        if (!sessions.length && profileId) {
          const { data } = await supabase
            .from('qualification_sessions')
            .select('id, event_start_at, event_name, event_location, status, candidate_linkedin_url')
            .eq('candidate_profile_id', profileId);
          sessions = data || [];
        }

        // Fallback: match by candidate name
        if (!sessions.length && profileName?.trim()) {
          const normalizedName = profileName
            .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          const firstName = normalizedName.split(' ')[0]?.trim();
          const nameLike = normalizedName ? `%${normalizedName}%` : null;
          const firstNameLike = firstName ? `%${firstName}%` : null;

          if (nameLike && firstNameLike && nameLike !== firstNameLike) {
            const { data } = await supabase
              .from('qualification_sessions')
              .select('id, event_start_at, event_name, event_location, status, candidate_linkedin_url')
              .or(`candidate_name.ilike.${nameLike},candidate_name.ilike.${firstNameLike}`);
            sessions = data || [];
          } else if (nameLike) {
            const { data } = await supabase
              .from('qualification_sessions')
              .select('id, event_start_at, event_name, event_location, status, candidate_linkedin_url')
              .ilike('candidate_name', nameLike);
            sessions = data || [];
          }
        }

        bookingEvents = sessions.map(s => ({
          id: `booking-${s.id}`,
          type: 'booking' as const,
          timestamp: s.event_start_at || '',
          actionType: 'calendly_booking',
          stepOrder: 0,
          status: s.status || 'scheduled',
          qualificationSessionId: s.id,
          eventName: s.event_name,
          eventLocation: s.event_location,
        }));

        // Fetch Aircall call events for this candidate
        let aircallEvents: ActivityEvent[] = [];

        // Find airtable candidate phone numbers for this profile
        let candidatePhones: string[] = [];

        if (profileUrl) {
          const slug = profileUrl.split('linkedin.com')[1]?.replace(/\/$/, '') || '';
          if (slug) {
            const { data: atCandidates } = await supabase
              .from('airtable_candidates')
              .select('phone')
              .ilike('linkedin_url', `%${slug}%`)
              .not('phone', 'is', null)
              .limit(5);
            candidatePhones = (atCandidates || [])
              .map(c => c.phone?.replace(/[^0-9+]/g, '') || '')
              .filter(p => p.length >= 8);
          }
        }

        if (!candidatePhones.length && profileName?.trim() && profileName.trim().length >= 3) {
          const { data: atCandidates } = await supabase
            .from('airtable_candidates')
            .select('phone')
            .ilike('full_name', `%${profileName.trim()}%`)
            .not('phone', 'is', null)
            .limit(5);
          candidatePhones = (atCandidates || [])
            .map(c => c.phone?.replace(/[^0-9+]/g, '') || '')
            .filter(p => p.length >= 8);
        }

        console.log('[useProfileActivity] Aircall phone lookup:', { candidatePhones, profileUrl, profileName });

        if (candidatePhones.length && !cancelled) {
          // Match calls by normalized phone: matched_candidate_phone field
          const phoneFilters = candidatePhones.map(p => `matched_candidate_phone.ilike.%${p.slice(-9)}%`).join(',');
          const { data: calls } = await supabase
            .from('aircall_calls')
            .select('id, started_at, direction, status, duration, user_name')
            .or(phoneFilters)
            .order('started_at', { ascending: true })
            .limit(50);

          if (calls?.length) {
            aircallEvents = calls
              .filter(c => c.started_at)
              .map(c => ({
                id: `aircall-${c.id}`,
                type: 'aircall' as const,
                timestamp: c.started_at!,
                actionType: 'aircall_call',
                stepOrder: 0,
                status: c.status || 'done',
                callDirection: c.direction,
                callDuration: c.duration || 0,
                callUserName: c.user_name,
              }));
          }
        }

        const allEvents = [...mapped, ...bookingEvents, ...aircallEvents].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        if (!cancelled) setEvents(allEvents);
      } catch (err) {
        console.error('Error fetching profile activity:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchActivity();
    return () => { cancelled = true; };
  }, [profileId, profileUrl, profileName]);

  return { events, loading };
}
