import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ActivityEvent {
  id: string;
  type: 'sequence_step' | 'booking';
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
    const fetch = async () => {
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
          const { data } = await supabase
            .from('sequence_enrollments')
            .select('id, sequence_id')
            .ilike('profile_name', profileName.trim());
          enrollments = data || [];
        }

        if (!enrollments.length || cancelled) {
          setEvents([]);
          return;
        }

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

        if (!executions?.length || cancelled) {
          setEvents([]);
          return;
        }

        // Get step details for action types
        const stepIds = [...new Set(executions.map(e => e.step_id))];
        const { data: steps } = await supabase
          .from('sequence_steps')
          .select('id, action_type, sequence_id')
          .in('id', stepIds);
        const stepMap = new Map(steps?.map(s => [s.id, s]) || []);

        const enrollmentSeqMap = new Map(enrollments.map(e => [e.id, e.sequence_id]));

        const mapped: ActivityEvent[] = executions
          .filter(ex => ex.executed_at) // only show executed steps
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

        // Fetch booking events (qualification sessions) for this candidate
        let bookingEvents: ActivityEvent[] = [];
        if (profileUrl) {
          const normalizedPath = profileUrl.split('linkedin.com')[1]?.replace(/\/$/, '') || '';
          if (normalizedPath) {
            const { data: sessions } = await supabase
              .from('qualification_sessions')
              .select('id, event_start_at, event_name, event_location, status, candidate_linkedin_url')
              .ilike('candidate_linkedin_url', `%${normalizedPath}%`);

            bookingEvents = (sessions || []).map(s => ({
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
          }
        }

        const allEvents = [...mapped, ...bookingEvents].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        if (!cancelled) setEvents(allEvents);
      } catch (err) {
        console.error('Error fetching profile activity:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetch();
    return () => { cancelled = true; };
  }, [profileId, profileUrl, profileName]);

  return { events, loading };
}
