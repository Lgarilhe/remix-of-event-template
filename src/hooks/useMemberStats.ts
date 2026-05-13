/**
 * useMemberStats — Aggregated activity stats per org member.
 *
 * Loads in 2 batched queries (one per metric) and returns a map keyed by
 * user_id, ready to use in the team list :
 *   - active_sequences : sequence_enrollments where assigned_sender_id =
 *     user_id (fallback created_by) AND status IN ('active','pending')
 *   - candidates_30d : candidate_assignments where assigned_to = user_id
 *     AND created_at > now() - 30d
 *
 * Cached 5min (staleTime). RLS handles per-org scoping — caller should NOT
 * inject org filter since the queries already join via organization_id
 * implicit RLS.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface MemberStats {
  active_sequences: number;
  candidates_30d: number;
}

export type MemberStatsMap = Record<string, MemberStats>;

const EMPTY: MemberStats = { active_sequences: 0, candidates_30d: 0 };

export function useMemberStats(orgId: string | null, userIds: string[]) {
  const queryKey = ['member-stats', orgId, [...userIds].sort().join(',')];

  return useQuery({
    queryKey,
    queryFn: async (): Promise<MemberStatsMap> => {
      if (!orgId || userIds.length === 0) return {};
      const map: MemberStatsMap = {};
      for (const uid of userIds) map[uid] = { ...EMPTY };

      // ─── 1. Active sequences per user ──
      // Prefer assigned_sender_id, fall back to created_by. We count both
      // and merge in JS to avoid a complex OR query.
      try {
        const { data: bySender } = await supabase
          .from('sequence_enrollments')
          .select('assigned_sender_id')
          .eq('organization_id', orgId)
          .in('status', ['active', 'pending'])
          .in('assigned_sender_id', userIds);
        if (Array.isArray(bySender)) {
          for (const row of bySender) {
            const uid = row.assigned_sender_id as string | null;
            if (uid && map[uid]) map[uid].active_sequences += 1;
          }
        }

        // Pour les enrollments SANS assigned_sender_id, retombe sur created_by
        const { data: byCreator } = await supabase
          .from('sequence_enrollments')
          .select('created_by, assigned_sender_id')
          .eq('organization_id', orgId)
          .in('status', ['active', 'pending'])
          .is('assigned_sender_id', null)
          .in('created_by', userIds);
        if (Array.isArray(byCreator)) {
          for (const row of byCreator) {
            const uid = row.created_by as string | null;
            if (uid && map[uid]) map[uid].active_sequences += 1;
          }
        }
      } catch (e) {
        console.warn('[useMemberStats] sequences fetch failed:', e);
      }

      // ─── 2. Candidates assigned in last 30 days ──
      try {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data } = await supabase
          .from('candidate_assignments')
          .select('assigned_to')
          .eq('organization_id', orgId)
          .gte('created_at', since)
          .in('assigned_to', userIds);
        if (Array.isArray(data)) {
          for (const row of data) {
            const uid = row.assigned_to as string | null;
            if (uid && map[uid]) map[uid].candidates_30d += 1;
          }
        }
      } catch (e) {
        console.warn('[useMemberStats] candidates fetch failed:', e);
      }

      return map;
    },
    enabled: !!orgId && userIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
