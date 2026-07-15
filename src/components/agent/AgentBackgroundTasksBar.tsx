import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
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
    <div className="shrink-0 border-b border-border/60 bg-muted/30 px-4 py-2 space-y-2">
      {tasks.map((t) => {
        const total = t.progress_total || 0;
        const done = Math.min(t.progress_done || 0, total || t.progress_done || 0);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const waiting = t.status === 'queued';
        return (
          <div key={t.id} className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {waiting ? (
                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              ) : (
                <Sparkles className="h-3 w-3 shrink-0 text-primary" />
              )}
              <span className="truncate font-medium text-foreground">
                Scoring — {t.title}
              </span>
              <span className="ml-auto shrink-0 tabular-nums">
                {waiting ? 'en file…' : total > 0 ? `${done}/${total}` : '…'}
              </span>
            </div>
            <Progress value={waiting ? 0 : pct} className="h-1.5" />
          </div>
        );
      })}
    </div>
  );
};
