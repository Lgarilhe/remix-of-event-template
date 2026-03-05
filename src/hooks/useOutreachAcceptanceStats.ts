import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { differenceInDays, parseISO } from 'date-fns';

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
  // Fetch all sequence enrollments
  const allEnrollments: any[] = [];
  let from = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data: page, error } = await supabase
      .from('sequence_enrollments')
      .select('id, created_by, created_at, connection_status, status, replied_at, completed_at')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error || !page || page.length === 0) break;
    allEnrollments.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  // Fetch consultant profiles
  const userIds = [...new Set(allEnrollments.map(e => e.created_by))];
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

  // Categorize enrollments
  const categorize = (enrollments: any[]) => {
    let connected = 0;
    let notConnected = 0;
    let pending = 0;
    let acceptedWithin3Days = 0;

    for (const e of enrollments) {
      const cs = (e.connection_status || '').toLowerCase();
      
      if (cs === 'connected' || cs === 'accepted') {
        connected++;
        // Check if accepted within 3 days of enrollment
        if (e.completed_at || e.replied_at) {
          const responseDate = parseISO(e.replied_at || e.completed_at);
          const createdDate = parseISO(e.created_at);
          if (differenceInDays(responseDate, createdDate) <= 3) {
            acceptedWithin3Days++;
          }
        } else {
          // If connected but no completion date, assume quick acceptance
          acceptedWithin3Days++;
        }
      } else if (cs === 'not_connected' || cs === 'declined' || cs === 'withdrawn') {
        notConnected++;
      } else {
        // unknown, pending, etc.
        pending++;
      }
    }

    const decidedTotal = connected + notConnected;
    const acceptanceRate = decidedTotal > 0 ? Math.round((connected / decidedTotal) * 100) : 0;

    return { totalEnrolled: enrollments.length, connected, notConnected, pending, acceptedWithin3Days, acceptanceRate };
  };

  // Global stats
  const globalStats = categorize(allEnrollments);

  // By consultant
  const byConsultantMap = new Map<string, any[]>();
  for (const e of allEnrollments) {
    const list = byConsultantMap.get(e.created_by) || [];
    list.push(e);
    byConsultantMap.set(e.created_by, list);
  }

  const byConsultant: ConsultantStats[] = [];
  for (const [userId, enrollments] of byConsultantMap) {
    const stats = categorize(enrollments);
    byConsultant.push({
      userId,
      displayName: profilesMap.get(userId) || 'Consultant',
      ...stats,
    });
  }

  // Sort by total enrolled desc
  byConsultant.sort((a, b) => b.totalEnrolled - a.totalEnrolled);

  return {
    global: {
      totalEnrolled: globalStats.totalEnrolled,
      connected: globalStats.connected,
      notConnected: globalStats.notConnected,
      pending: globalStats.pending,
      acceptanceRate: globalStats.acceptanceRate,
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
