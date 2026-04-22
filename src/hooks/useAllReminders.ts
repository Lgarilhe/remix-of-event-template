/**
 * useAllReminders — hook global pour la page /tasks (B6).
 *
 * Agrège tous les `candidate_reminders` de l'utilisateur (RLS scope déjà par user).
 * Fournit filtres + bucketing par urgence (overdue / today / week / later / done).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { isPast, isToday, isThisWeek, parseISO } from 'date-fns';
import { useCallback } from 'react';

export interface Reminder {
  id: string;
  candidate_id: string;
  candidate_name: string | null;
  job_id: string | null;
  job_title: string | null;
  title: string;
  description: string | null;
  due_at: string;
  completed_at: string | null;
  created_at: string;
}

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

  if (error) {
    console.warn('[useAllReminders] fetch error:', error);
    return [];
  }
  return (data ?? []) as Reminder[];
}

export function useAllReminders() {
  const qc = useQueryClient();

  const { data: reminders = [], isLoading, refetch } = useQuery({
    queryKey: ['all-reminders'],
    queryFn: fetchAllReminders,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

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
    toast.success('Tâche supprimée');
  }, [qc]);

  return {
    reminders,
    grouped,
    isLoading,
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
