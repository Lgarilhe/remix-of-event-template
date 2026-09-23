import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';

/**
 * Épingles de missions (D22, §3.5), table job_favorites : une ligne par
 * (user_id, job_id), job_id portant l'identifiant de la mission.
 *
 * - lecture bornée aux 50 plus récentes (des orphelines anciennes ne masquent
 *   pas les épingles récentes) ;
 * - aucune colonne d'organisation (absente en prod) ;
 * - mise à jour optimiste, retour arrière en cas d'échec ;
 * - le plafond de 10 se contrôle côté barre, sur les épingles résolues.
 */

export interface MissionPin {
  id: string;
  job_id: string;
  created_at: string;
}

export const MISSION_PINS_READ_LIMIT = 50;

export function missionPinsQueryKey(userId: string | null): ['job-favorites', string | null] {
  return ['job-favorites', userId];
}

const ADD_FAILED = "L'épingle n'a pas été enregistrée. Réessayez.";
const REMOVE_FAILED = "L'épingle n'a pas été retirée. Réessayez.";

interface PinVariables {
  projectId: string;
  pinned: boolean;
}

export function useMissionPins(opts: { enabled: boolean }) {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = missionPinsQueryKey(userId);

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<MissionPin[]> => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('job_favorites')
        .select('id, job_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(MISSION_PINS_READ_LIMIT);
      if (error) throw error;
      return data ?? [];
    },
    enabled: opts.enabled && !!userId,
    staleTime: 60_000,
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: async ({ projectId, pinned }: PinVariables): Promise<void> => {
      if (!userId) throw new Error('Not authenticated');
      if (pinned) {
        const { error } = await supabase
          .from('job_favorites')
          .insert({ user_id: userId, job_id: projectId })
          .select('id')
          .single();
        // Doublon (autre onglet, double clic) : l'épingle existe, c'est le résultat voulu.
        if (error && error.code !== '23505') throw error;
        return;
      }
      const { data, error } = await supabase
        .from('job_favorites')
        .delete()
        .eq('user_id', userId)
        .eq('job_id', projectId)
        .select('id');
      if (error) throw error;
      // Zéro ligne sans erreur : rien n'a été retiré (RLS ou ligne absente).
      if (!data || data.length === 0) throw new Error('Aucune épingle retirée');
    },
    onMutate: async ({ projectId, pinned }: PinVariables) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<MissionPin[]>(queryKey);
      queryClient.setQueryData<MissionPin[]>(queryKey, (old) => {
        const rows = old ?? [];
        if (pinned) {
          if (rows.some((r) => r.job_id === projectId)) return rows;
          return [{ id: `optimistic-${projectId}`, job_id: projectId, created_at: new Date().toISOString() }, ...rows];
        }
        return rows.filter((r) => r.job_id !== projectId);
      });
      return { previous };
    },
    onError: (_error, { pinned }, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous);
      toast.error(pinned ? ADD_FAILED : REMOVE_FAILED);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey }).catch(() => undefined);
    },
  });

  const { mutate } = mutation;
  const setPinned = useCallback(
    (projectId: string, pinned: boolean) => {
      mutate({ projectId, pinned });
    },
    [mutate],
  );

  return {
    data: query.data,
    isError: query.isError,
    fetchStatus: query.fetchStatus,
    refetch: query.refetch,
    setPinned,
  };
}
