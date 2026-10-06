// Refonte mission, lot 3 : reports « Plus tard » de la carte Maintenant, table
// mission_action_snoozes (une ligne par personne, mission et action). Le report
// masque l'action pour la personne jusqu'au lendemain 6 h (heure du navigateur).
//
// - lecture : toutes les lignes non échues de la personne, en une requête ;
// - écriture : jamais de succès annoncé avant la base. L'upsert relit la ligne
//   écrite (.select().single()) et la met dans le cache avec l'instant du
//   serveur ; un DELETE refusé rend 0 ligne sans erreur, d'où .select('id') ;
// - erreur d'écriture : message, rien ne change (l'action reste) ;
// - erreur de lecture : la règle s'évalue sans report (montrer une action de
//   trop vaut mieux que la cacher à tort) ;
// - clé ['mission-action-snoozes', …], hors de la barre latérale : « Plus
//   tard » n'agit jamais sur le chiffre d'À traiter.

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { nextLocalMorning, snoozeIndexKey, type SnoozeRow } from '@/lib/missionSnooze';

/** Plafond de lecture : au-delà, les reports les moins récents ne seraient pas vus. */
export const SNOOZES_READ_LIMIT = 200;

export const missionSnoozesKey = (userId: string | null) => ['mission-action-snoozes', userId] as const;

const SNOOZE_FAILED = "Le report n'a pas été enregistré. Réessayez.";
const UNSNOOZE_FAILED = "Les actions n'ont pas pu être reprises. Réessayez.";
const COLUMNS = 'id, project_id, action_key, expires_at, updated_at';

interface RawSnooze {
  id: string;
  project_id: string;
  action_key: string;
  expires_at: string;
  updated_at: string;
}

const toRow = (r: RawSnooze): SnoozeRow => ({
  id: r.id,
  projectId: r.project_id,
  actionKey: r.action_key,
  expiresAt: r.expires_at,
  updatedAt: r.updated_at,
});

const rowIndex = (row: Pick<SnoozeRow, 'projectId' | 'actionKey'>): string => snoozeIndexKey(row.projectId, row.actionKey);

/** État réseau du navigateur : écrire hors ligne laisserait la requête en attente avec la carte déjà passée à l'action suivante. */
function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => onlineManager.subscribe(() => listener()),
    () => onlineManager.isOnline(),
    () => true,
  );
}

export function useMissionActionSnoozes() {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = missionSnoozesKey(userId);
  const online = useOnline();

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<SnoozeRow[]> => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('mission_action_snoozes')
        .select(COLUMNS)
        .eq('user_id', userId)
        .gt('expires_at', new Date().toISOString())
        .order('updated_at', { ascending: false })
        .limit(SNOOZES_READ_LIMIT);
      if (error) throw error;
      return (data ?? []).map(toRow);
    },
    enabled: !!userId,
    staleTime: 60_000,
    // Une échéance passée sort de la lecture : la relecture fait revenir l'action.
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  const snoozeMutation = useMutation({
    mutationFn: async ({ projectId, actionKey }: { projectId: string; actionKey: string }): Promise<SnoozeRow> => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('mission_action_snoozes')
        .upsert(
          { user_id: userId, project_id: projectId, action_key: actionKey, expires_at: nextLocalMorning(new Date()).toISOString() },
          { onConflict: 'user_id,project_id,action_key' },
        )
        .select(COLUMNS)
        .single();
      if (error) throw error;
      return toRow(data);
    },
    onSuccess: (row) => {
      queryClient.setQueryData<SnoozeRow[]>(queryKey, (old) => [
        row,
        ...(old ?? []).filter((r) => rowIndex(r) !== rowIndex(row)),
      ]);
    },
    onError: (error) => {
      console.error('[mission-action-snoozes] report non enregistré', error);
      toast.error(SNOOZE_FAILED);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey }).catch(() => undefined);
    },
  });

  const unsnoozeMutation = useMutation({
    mutationFn: async ({ projectId, actionKeys }: { projectId: string; actionKeys: readonly string[] }): Promise<void> => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('mission_action_snoozes')
        .delete()
        .eq('user_id', userId)
        .eq('project_id', projectId)
        .in('action_key', [...actionKeys])
        .select('id');
      if (error) throw error;
      // Zéro ligne sans erreur : rien n'a été retiré (droit refusé ou ligne déjà échue).
      if (!data || data.length === 0) throw new Error('Aucun report retiré');
    },
    onSuccess: (_void, { projectId, actionKeys }) => {
      const gone = new Set(actionKeys.map((k) => snoozeIndexKey(projectId, k)));
      queryClient.setQueryData<SnoozeRow[]>(queryKey, (old) => (old ?? []).filter((r) => !gone.has(rowIndex(r))));
    },
    onError: (error) => {
      console.error('[mission-action-snoozes] reports non retirés', error);
      toast.error(UNSNOOZE_FAILED);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey }).catch(() => undefined);
    },
  });

  const rows = query.data;
  const index = useMemo(() => new Map((rows ?? []).map((r) => [rowIndex(r), r] as const)), [rows]);

  const { mutateAsync: snoozeAsync, isPending: snoozing } = snoozeMutation;
  const { mutateAsync: unsnoozeAsync, isPending: unsnoozing } = unsnoozeMutation;

  /** Reporte une action au lendemain matin. Vrai si la ligne est écrite ; faux sinon (le message est déjà affiché). */
  const snooze = useCallback(
    (projectId: string, actionKey: string): Promise<boolean> =>
      snoozeAsync({ projectId, actionKey }).then(
        () => true,
        () => false,
      ),
    [snoozeAsync],
  );

  /** Retire des reports (« Les reprendre »). Vrai si au moins une ligne est retirée. */
  const unsnooze = useCallback(
    (projectId: string, actionKeys: readonly string[]): Promise<boolean> =>
      unsnoozeAsync({ projectId, actionKeys }).then(
        () => true,
        () => false,
      ),
    [unsnoozeAsync],
  );

  return {
    /** Reports non échus, indexés par snoozeIndexKey(mission, action). */
    index,
    isError: query.isError,
    isLoading: query.isLoading,
    online,
    snooze,
    unsnooze,
    isWriting: snoozing || unsnoozing,
  };
}
