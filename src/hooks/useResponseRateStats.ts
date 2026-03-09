import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ResponseRateStats {
  sequences: { sent: number; replied: number; rate: number };
  inmails: { sent: number; replied: number; rate: number };
  combined: { sent: number; replied: number; rate: number };
}

export function useResponseRateStats() {
  return useQuery({
    queryKey: ['response-rate-stats'],
    queryFn: async (): Promise<ResponseRateStats> => {
      // Sequence stats: count unique enrollments by status
      const { data: seqData, error: seqErr } = await supabase
        .from('sequence_enrollments')
        .select('status')
        .in('status', ['active', 'completed', 'replied', 'paused']);

      if (seqErr) throw seqErr;

      const seqSent = (seqData || []).length;
      const seqReplied = (seqData || []).filter(e => e.status === 'replied').length;

      // InMail stats
      const { data: imData, error: imErr } = await supabase
        .from('inmail_queue')
        .select('status')
        .in('status', ['sent', 'replied']);

      if (imErr) throw imErr;

      const imSent = (imData || []).filter(e => e.status === 'sent' || e.status === 'replied').length;
      const imReplied = (imData || []).filter(e => e.status === 'replied').length;

      const combinedSent = seqSent + imSent;
      const combinedReplied = seqReplied + imReplied;

      return {
        sequences: {
          sent: seqSent,
          replied: seqReplied,
          rate: seqSent > 0 ? Math.round((seqReplied / seqSent) * 100) : 0,
        },
        inmails: {
          sent: imSent,
          replied: imReplied,
          rate: imSent > 0 ? Math.round((imReplied / imSent) * 100) : 0,
        },
        combined: {
          sent: combinedSent,
          replied: combinedReplied,
          rate: combinedSent > 0 ? Math.round((combinedReplied / combinedSent) * 100) : 0,
        },
      };
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
