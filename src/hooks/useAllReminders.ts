/**
 * useAllReminders — hook global pour la page /tasks (B6).
 *
 * La RLS de `candidate_reminders` ouvre toute l'organisation (policy
 * `org_members_all` : organization_id = get_user_org_id(auth.uid())) : la
 * requête ramène donc les tâches de toute l'équipe, pas seulement celles de
 * l'utilisateur. Le périmètre se choisit via `scope` :
 * - 'mine' (défaut) : tâches créées par l'utilisateur courant (created_by),
 *   pour que la page Tâches, le tableau de bord et la barre comptent pareil ;
 * - 'team' : toute l'organisation.
 * Les compteurs (`counts`, dont `counts.overdue`) suivent ce périmètre.
 * Fournit filtres + bucketing par urgence (overdue / today / week / later / done).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isPast, isToday, isThisWeek, parseISO } from 'date-fns';
import { useCallback, useMemo } from 'react';
import { useAuthReady } from '@/hooks/useAuthReady';

export type TaskCategory =
  | 'general'
  | 'follow_up'
  | 'interview_prep'
  | 'debrief'
  | 'admin'
  | 'client'
  | 'sourcing';

export interface Reminder {
  id: string;
  /** Nullable depuis migration V2 — tasks standalone possibles */
  candidate_id: string | null;
  candidate_name: string | null;
  job_id: string | null;
  job_title: string | null;
  title: string;
  description: string | null;
  due_at: string;
  completed_at: string | null;
  created_at: string;
  created_by: string;
  category: TaskCategory;
  auto_generated: boolean;
  source_event_id: string | null;
}

/** Périmètre des tâches : celles de l'utilisateur ou celles de l'équipe. */
export type TaskScope = 'mine' | 'team';

export type ReminderBucket = 'overdue' | 'today' | 'week' | 'later' | 'done';

export interface GroupedReminders {
  overdue: Reminder[];
  today: Reminder[];
  week: Reminder[];
  later: Reminder[];
  done: Reminder[];
}

function bucketFor(r: Reminder): ReminderBucket {
  if (r.completed_at) return 'done';
  try {
    const d = parseISO(r.due_at);
    if (isPast(d) && !isToday(d)) return 'overdue';
    if (isToday(d)) return 'today';
    if (isThisWeek(d, { weekStartsOn: 1 })) return 'week';
    return 'later';
  } catch {
    return 'later';
  }
}

async function fetchAllReminders(): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from('candidate_reminders')
    .select('*')
    .order('due_at', { ascending: true });

  // Une lecture en échec ne doit pas se lire « aucune tâche » : l'erreur remonte
  // à la page, qui affiche un état d'erreur avec « Réessayer » (revue A-34).
  if (error) throw error;
  return (data ?? []) as Reminder[];
}

export function useAllReminders({ scope = 'mine' }: { scope?: TaskScope } = {}) {
  const qc = useQueryClient();
  const { isReady: authReady, user } = useAuthReady();
  const userId = user?.id ?? null;

  const { data: teamReminders = [], isLoading: queryLoading, isError, error, refetch } = useQuery({
    queryKey: ['all-reminders'],
    queryFn: fetchAllReminders,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  // Filtre côté client : le cache ['all-reminders'] reste partagé (mêmes
  // invalidations et mises à jour optimistes quel que soit le périmètre).
  const reminders = useMemo(
    () => (scope === 'mine'
      ? teamReminders.filter((r) => userId !== null && r.created_by === userId)
      : teamReminders),
    [teamReminders, scope, userId],
  );
  // Tant que l'utilisateur n'est pas connu, « mes tâches » n'est pas calculable.
  const isLoading = queryLoading || (scope === 'mine' && !authReady);

  const grouped: GroupedReminders = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    done: [],
  };
  for (const r of reminders) {
    grouped[bucketFor(r)].push(r);
  }

  const toggleComplete = useCallback(async (reminder: Reminder) => {
    const nextCompletedAt = reminder.completed_at ? null : new Date().toISOString();
    const { error } = await supabase
      .from('candidate_reminders')
      .update({ completed_at: nextCompletedAt })
      .eq('id', reminder.id);

    if (error) {
      toast.error('Erreur lors de la mise à jour');
      return;
    }

    // Optimistic cache update
    qc.setQueryData<Reminder[]>(['all-reminders'], (prev) =>
      (prev ?? []).map((r) =>
        r.id === reminder.id ? { ...r, completed_at: nextCompletedAt } : r,
      ),
    );
    // Chiffre gris de la barre (tâches en retard) : clé à part, non couverte par setQueryData.
    void qc.invalidateQueries({ queryKey: ['all-reminders', 'overdue-count'] });

    toast.success(nextCompletedAt ? 'Tâche terminée' : 'Tâche réactivée');
  }, [qc]);

  const deleteReminder = useCallback(async (reminderId: string) => {
    const { error } = await supabase
      .from('candidate_reminders')
      .delete()
      .eq('id', reminderId);

    if (error) {
      toast.error('Erreur lors de la suppression');
      return;
    }

    qc.setQueryData<Reminder[]>(['all-reminders'], (prev) =>
      (prev ?? []).filter((r) => r.id !== reminderId),
    );
    void qc.invalidateQueries({ queryKey: ['all-reminders', 'overdue-count'] });
    toast.success('Tâche supprimée');
  }, [qc]);

  return {
    reminders,
    grouped,
    isLoading,
    isError,
    // Message technique (PostgrestError ou Error), montré replié par ErrorState.
    error: error ? ((error as { message?: string }).message ?? String(error)) : null,
    refetch,
    toggleComplete,
    deleteReminder,
    counts: {
      overdue: grouped.overdue.length,
      today: grouped.today.length,
      week: grouped.week.length,
      later: grouped.later.length,
      done: grouped.done.length,
      active: grouped.overdue.length + grouped.today.length + grouped.week.length + grouped.later.length,
    },
  };
}
