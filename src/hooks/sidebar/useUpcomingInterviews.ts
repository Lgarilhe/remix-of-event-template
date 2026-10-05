/**
 * Prochains entretiens que j'anime, lus par la zone « Événements à venir » et
 * par les alertes de début d'entretien (une seule lecture pour les deux : même
 * clé de cache).
 *
 * Source : qualification_sessions, que remplissent le webhook de prise de
 * rendez-vous et, plus tard, les agendas reliés. Toute ligne qui porte une
 * heure de début apparaît ici sans autre branchement.
 *
 * Fenêtre : de 3 heures avant maintenant (un entretien long déjà commencé)
 * à la fin du troisième jour. Même filtre « moi » que useTodoInterviews :
 * animateur (manager_id), sinon créateur quand aucun animateur n'est désigné.
 */
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { UPCOMING_DAYS, localDayKey } from '@/lib/sidebarSignals';
import { queryState, type SectionState } from '@/lib/sidebarSection';

export interface UpcomingInterviewRow {
  id: string;
  event_start_at: string | null;
  event_end_at: string | null;
  event_location: string | null;
  event_name: string | null;
  candidate_name: string | null;
  candidate_profile_id: string | null;
  project_id: string | null;
  job_title: string | null;
  status: string;
}

export interface UpcomingInterviews {
  status: SectionState;
  stale: boolean;
  retry: () => void;
  rows: UpcomingInterviewRow[];
}

const MINUTE = 60_000;
const LOOKBACK_MS = 3 * 60 * MINUTE;

/** `now` (millisecondes) : jour de la clé de cache, fourni par le composant qui rafraîchit l'heure. */
export function useUpcomingInterviews(opts?: { now?: number }): UpcomingInterviews {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { organizationId } = useOrganization();
  const dayKey = localDayKey(new Date(opts?.now ?? Date.now()));

  const query = useQuery({
    queryKey: ['sidebar', 'upcoming-interviews', userId, organizationId, dayKey],
    queryFn: async (): Promise<UpcomingInterviewRow[]> => {
      if (!userId || !organizationId) throw new Error('Organisation inconnue');
      const start = new Date(Date.now() - LOOKBACK_MS);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      end.setDate(end.getDate() + UPCOMING_DAYS - 1);
      const { data, error } = await supabase
        .from('qualification_sessions')
        .select(
          'id, event_start_at, event_end_at, event_location, event_name, candidate_name, candidate_profile_id, project_id, job_title, status',
        )
        .eq('organization_id', organizationId)
        .or(`manager_id.eq.${userId},and(manager_id.is.null,created_by.eq.${userId})`)
        .gte('event_start_at', start.toISOString())
        .lte('event_start_at', end.toISOString())
        .order('event_start_at', { ascending: true })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!userId && !!organizationId,
    staleTime: MINUTE,
    retry: 1,
    refetchInterval: 5 * MINUTE,
  });

  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  const { state, stale } = queryState({ data: query.data, isError: query.isError, fetchStatus: query.fetchStatus });

  return { status: state, stale, retry, rows: query.data ?? [] };
}
