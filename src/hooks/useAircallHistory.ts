import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { normalizePhone } from '@/lib/stringUtils';

export interface AircallCall {
  id: string;
  aircallId: number;
  direction: 'inbound' | 'outbound';
  status: string;
  startedAt: string | null;
  duration: number;
  callerName: string | null;
  calleeName: string | null;
  recordingUrl: string | null;
  voicemailUrl: string | null;
  tags: string[];
  notes: string | null;
  userName: string | null;
  userEmail: string | null;
}

interface UseAircallHistoryResult {
  calls: AircallCall[];
  loading: boolean;
  totalCalls: number;
  totalDuration: number;
}

export function useAircallHistory(
  airtableCandidateId: string | null | undefined,
  candidateName: string | null | undefined,
  candidatePhone: string | null | undefined
): UseAircallHistoryResult {
  const [calls, setCalls] = useState<AircallCall[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!airtableCandidateId && !candidateName && !candidatePhone) {
      setCalls([]);
      return;
    }

    const fetchCalls = async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('aircall_calls')
          .select('*')
          .order('started_at', { ascending: false })
          .limit(50);

        // Primary: match by airtable candidate id
        if (airtableCandidateId) {
          query = query.eq('matched_airtable_candidate_id', airtableCandidateId);
        } else if (candidatePhone) {
          // Fallback: match by phone number
          const normalized = normalizePhone(candidatePhone);
          if (normalized) {
            query = query.or(`caller_number.eq.${normalized},callee_number.eq.${normalized},raw_number.eq.${normalized},matched_candidate_phone.eq.${normalized}`);
          } else {
            setCalls([]);
            setLoading(false);
            return;
          }
        } else if (candidateName && candidateName.trim().length >= 3) {
          // Last resort: match by name
          query = query.ilike('matched_candidate_name', `%${candidateName.trim()}%`);
        } else {
          setCalls([]);
          setLoading(false);
          return;
        }

        const { data, error } = await query;

        if (error) {
          console.error('Error fetching Aircall calls:', error);
          setCalls([]);
          return;
        }

        setCalls((data || []).map((c: any) => ({
          id: c.id,
          aircallId: c.aircall_id,
          direction: c.direction,
          status: c.status,
          startedAt: c.started_at,
          duration: c.duration || 0,
          callerName: c.caller_name,
          calleeName: c.callee_name,
          recordingUrl: c.recording_url,
          voicemailUrl: c.voicemail_url,
          tags: c.tags || [],
          notes: c.notes,
          userName: c.user_name,
          userEmail: c.user_email,
        })));
      } catch (err) {
        console.error('useAircallHistory error:', err);
        setCalls([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCalls();
  }, [airtableCandidateId, candidateName, candidatePhone]);

  const totalDuration = calls.reduce((sum, c) => sum + c.duration, 0);

  return { calls, loading, totalCalls: calls.length, totalDuration };
}

// normalizePhone is now imported from @/lib/stringUtils
