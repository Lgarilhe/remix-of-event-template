import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { subDays, format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

export interface DailyInviteStat {
  date: string;
  label: string;
  invitesSent: number;
  invitesAccepted: number;
}

export function useDailyInviteStats(days = 30) {
  return useQuery({
    queryKey: ['daily-invite-stats', days],
    queryFn: async (): Promise<DailyInviteStat[]> => {
      const since = format(subDays(new Date(), days), 'yyyy-MM-dd');

      const { data, error } = await supabase
        .from('sequence_analytics')
        .select('date, invites_sent, invites_accepted')
        .gte('date', since)
        .order('date', { ascending: true });

      if (error) throw error;

      // Aggregate by date (multiple sequences per day)
      const byDate: Record<string, { sent: number; accepted: number }> = {};

      // Pre-fill all days
      for (let i = 0; i <= days; i++) {
        const key = format(subDays(new Date(), days - i), 'yyyy-MM-dd');
        byDate[key] = { sent: 0, accepted: 0 };
      }

      for (const row of data || []) {
        const key = row.date;
        if (!byDate[key]) byDate[key] = { sent: 0, accepted: 0 };
        byDate[key].sent += (row.invites_sent || 0);
        byDate[key].accepted += (row.invites_accepted || 0);
      }

      return Object.entries(byDate).map(([date, counts]) => ({
        date,
        label: format(parseISO(date), 'dd MMM', { locale: fr }),
        invitesSent: counts.sent,
        invitesAccepted: counts.accepted,
      }));
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
