import React from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useBackgroundTasks } from '@/hooks/useBackgroundTasks';

/**
 * Barre de progression des tâches de fond du copilot (scoring en masse…).
 * Affichée dans le panneau de chat sous le bandeau d'approbation. Ne montre que
 * les tâches actives ; la fin est signalée par une notification + un message.
 */
export const AgentBackgroundTasksBar: React.FC = () => {
  const { tasks } = useBackgroundTasks();

  if (tasks.length === 0) return null;

  return (
    <div className="shrink-0 space-y-2 border-b border-border bg-muted px-4 py-2">
      {tasks.map((t) => {
        const total = t.progress_total || 0;
        const done = Math.min(t.progress_done || 0, total || t.progress_done || 0);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const waiting = t.status === 'queued';
        return (
          <div key={t.id} className="space-y-1">
            <div className="flex items-center gap-2 text-2xs text-muted-foreground">
              {waiting ? (
                <Loader2 className="h-3 w-3 animate-spin shrink-0" aria-hidden="true" />
              ) : (
                <BarChart3 className="h-3 w-3 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate font-medium text-foreground">Scoring : {t.title}</span>
              <span className="ml-auto shrink-0 tabular-nums">
                {waiting ? 'en attente…' : total > 0 ? `${done} sur ${total}` : '…'}
              </span>
            </div>
            <Progress
              value={waiting ? 0 : pct}
              className="h-1.5"
              aria-label={`Scoring : ${t.title}${total > 0 ? `, ${done} sur ${total}` : ''}`}
            />
          </div>
        );
      })}
    </div>
  );
};
