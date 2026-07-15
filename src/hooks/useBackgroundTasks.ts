import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

/**
 * Tâches de fond du copilot (scoring en masse…) pour l'organisation active.
 *
 * Ne remonte QUE les tâches actives (en file / en cours) : la fin est signalée
 * par une notification (cloche) + un message dans la conversation. La table est
 * publiée en realtime (migration 20260715130000) → la progression avance en
 * direct sans polling.
 */
export interface BackgroundTask {
  id: string;
  kind: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled';
  progress_total: number;
  progress_done: number;
  progress_failed: number;
  params: { project_id?: string } | null;
  created_at: string;
}

const ACTIVE = new Set(['queued', 'running']);

export function useBackgroundTasks() {
  const { organizationId } = useOrganization();
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);

  const fetchActive = useCallback(async () => {
    if (!organizationId) {
      setTasks([]);
      return;
    }
    const { data } = await supabase
      .from('agent_background_tasks' as any)
      .select('id, kind, title, status, progress_total, progress_done, progress_failed, params, created_at')
      .eq('organization_id', organizationId)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false });
    setTasks(((data ?? []) as unknown as BackgroundTask[]));
  }, [organizationId]);

  useEffect(() => {
    void fetchActive();
  }, [fetchActive]);

  useEffect(() => {
    if (!organizationId) return;
    let mounted = true;

    const channel = supabase
      .channel(`agent-bg-tasks-${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_background_tasks',
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          if (!mounted) return;
          const row = payload.new as BackgroundTask | undefined;
          const oldRow = payload.old as { id?: string } | undefined;
          if (payload.eventType === 'DELETE') {
            setTasks((prev) => prev.filter((t) => t.id !== oldRow?.id));
            return;
          }
          if (!row) return;
          setTasks((prev) => {
            const rest = prev.filter((t) => t.id !== row.id);
            // Ne garde que les tâches actives ; une tâche terminée sort de la barre.
            return ACTIVE.has(row.status) ? [row, ...rest] : rest;
          });
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [organizationId]);

  return { tasks, refresh: fetchActive };
}
