import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ConsultantStats {
  userId: string;
  displayName: string;
  totalEnrolled: number;
  connected: number;
  notConnected: number;
  pending: number;
  acceptedWithin3Days: number;
  acceptanceRate: number;
}

export interface OutreachAcceptanceStats {
  global: {
    totalEnrolled: number;
    connected: number;
    notConnected: number;
    pending: number;
    acceptanceRate: number;
  };
  byConsultant: ConsultantStats[];
}

async function fetchOutreachAcceptanceStats(): Promise<OutreachAcceptanceStats> {
  // Use server-side aggregation RPC instead of fetching all enrollments
  const { data: rpcData, error: rpcError } = await (supabase.rpc as any)('get_outreach_acceptance_stats');
  
  if (rpcError) throw rpcError;
  if (!rpcData || rpcData.length === 0) {
    return {
      global: { totalEnrolled: 0, connected: 0, notConnected: 0, pending: 0, acceptanceRate: 0 },
      byConsultant: [],
    };
  }

  // Fetch consultant display names
  const userIds = rpcData.map((r: any) => r.user_id);
  const profilesMap = new Map<string, string>();
  
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', userIds);
    
    if (profiles) {
      profiles.forEach((p: any) => {
        profilesMap.set(p.user_id, p.display_name || 'Consultant');
      });
    }
  }

  // Build per-consultant stats + global aggregates
  let globalTotal = 0, globalConnected = 0, globalNotConnected = 0, globalPending = 0;
  const byConsultant: ConsultantStats[] = [];

  for (const row of rpcData) {
    const total = Number(row.total_enrolled) || 0;
    const connected = Number(row.connected) || 0;
    const notConnected = Number(row.not_connected) || 0;
    const pending = Number(row.pending) || 0;
    const decidedTotal = connected + notConnected;
    const acceptanceRate = decidedTotal > 0 ? Math.round((connected / decidedTotal) * 100) : 0;

    globalTotal += total;
    globalConnected += connected;
    globalNotConnected += notConnected;
    globalPending += pending;

    byConsultant.push({
      userId: row.user_id,
      displayName: profilesMap.get(row.user_id) || 'Consultant',
      totalEnrolled: total,
      connected,
      notConnected,
      pending,
      acceptedWithin3Days: 0, // Not available from aggregate; kept for interface compat
      acceptanceRate,
    });
  }

  // Sort by total enrolled desc
  byConsultant.sort((a, b) => b.totalEnrolled - a.totalEnrolled);

  const globalDecided = globalConnected + globalNotConnected;

  return {
    global: {
      totalEnrolled: globalTotal,
      connected: globalConnected,
      notConnected: globalNotConnected,
      pending: globalPending,
      acceptanceRate: globalDecided > 0 ? Math.round((globalConnected / globalDecided) * 100) : 0,
    },
    byConsultant,
  };
}

export function useOutreachAcceptanceStats() {
  return useQuery({
    queryKey: ['outreach-acceptance-stats'],
    queryFn: fetchOutreachAcceptanceStats,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
