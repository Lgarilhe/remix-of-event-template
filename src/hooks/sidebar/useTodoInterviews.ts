/**
 * Entretiens aujourd'hui et Comptes rendus à faire (§4.5, D33), plus la liste
 * des entretiens du jour que j'anime, lue par le tableau de bord (D40).
 *
 * Une requête pour les deux sections, bornée : du jour J-7 à la fin du jour.
 * La RLS ouvre l'organisation entière, d'où le filtre « moi » : animateur
 * (manager_id), sinon créateur quand aucun animateur n'est désigné.
 */
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { isSameLocalDay, localDayKey, splitInterviews } from '@/lib/sidebarSignals';
import { queryState, type SectionState } from '@/lib/sidebarSection';

export interface InterviewRow {
  id: string;
  event_start_at: string | null;
  event_end_at: string | null;
  event_location: string | null;
  event_name: string | null;
  candidate_name: string | null;
  project_id: string | null;
  job_title: string | null;
  status: string;
}

export interface TodoInterviews {
  status: SectionState;
  stale: boolean;
  retry: () => void;
  today: InterviewRow[];
  debriefs: InterviewRow[];
  /** Entretiens que j'anime ce jour, tous statuts ; null tant qu'inconnu. */
  mineTodayIds: Set<string> | null;
}

const MINUTE = 60_000;

/**
 * `now` (millisecondes) : heure de référence de la répartition, fournie par
 * une section qui se rafraîchit à la minute. Absent : l'heure du rendu.
 */
export function useTodoInterviews(opts?: { now?: number }): TodoInterviews {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { organizationId } = useOrganization();

  // Arrondi à la minute : la répartition ne se recalcule pas à chaque rendu.
  const nowMs = opts?.now ?? Math.floor(Date.now() / MINUTE) * MINUTE;
  const dayKey = localDayKey(new Date(nowMs));

  const query = useQuery({
    queryKey: ['sidebar', 'interviews', userId, organizationId, dayKey],
    queryFn: async (): Promise<InterviewRow[]> => {
      if (!userId || !organizationId) throw new Error('Organisation inconnue');
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 7);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const { data, error } = await supabase
        .from('qualification_sessions')
        .select('id, event_start_at, event_end_at, event_location, event_name, candidate_name, project_id, job_title, status')
        .eq('organization_id', organizationId)
        .or(`manager_id.eq.${userId},and(manager_id.is.null,created_by.eq.${userId})`)
        .gte('event_start_at', start.toISOString())
        .lte('event_start_at', end.toISOString())
        // Du plus récent au plus ancien : la borne coupe les vieux comptes rendus,
        // jamais les entretiens du jour (splitInterviews retrie chaque liste).
        .order('event_start_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!userId && !!organizationId,
    staleTime: 60_000,
    retry: 1,
    refetchInterval: 5 * 60_000,
  });

  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  const { state, stale } = queryState({ data: query.data, isError: query.isError, fetchStatus: query.fetchStatus });
  const rows = query.data;

  const split = useMemo(
    () => (rows ? splitInterviews(rows, new Date(nowMs)) : { today: [], debriefs: [] }),
    [rows, nowMs],
  );

  const mineTodayIds = useMemo(() => {
    if (!rows) return null;
    const ref = new Date(`${dayKey}T12:00:00`);
    return new Set(rows.filter((r) => isSameLocalDay(r.event_start_at, ref)).map((r) => r.id));
  }, [rows, dayKey]);

  return { status: state, stale, retry, today: split.today, debriefs: split.debriefs, mineTodayIds };
}
