/**
 * Chiffre gris de la rangée basse (§2.4, D8) : nombre de mes tâches en retard.
 *
 * Même règle que la page Tâches, filtre compris : retard = échéance avant le
 * début du jour, tâche non terminée (useAllReminders : isPast && !isToday) ;
 * « mes tâches » = created_by, sans filtre d'organisation (la page lit sans
 * filtre et laisse la RLS décider). Comptage seul, sans lignes.
 *
 * null en chargement, hors ligne ou en erreur sans données : jamais un 0 inventé.
 * La clé commence par ['all-reminders'] : les invalidations de la page (préfixe)
 * la rafraîchissent aussi.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';

export const overdueTasksCountQueryKey = (userId: string | null) =>
  ['all-reminders', 'overdue-count', userId] as const;

export function useOverdueTasksCount(): number | null {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: overdueTasksCountQueryKey(userId),
    queryFn: async (): Promise<number> => {
      if (!userId) throw new Error('Utilisateur inconnu');
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const { count, error } = await supabase
        .from('candidate_reminders')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', userId)
        .is('completed_at', null)
        .lt('due_at', startOfToday.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!userId,
    staleTime: 60_000,
    retry: 1,
    refetchInterval: 5 * 60_000,
  });

  return query.data ?? null;
}
