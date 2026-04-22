/**
 * Tasks — page globale des rappels/tâches (B6).
 *
 * Agrège tous les `candidate_reminders` en une vue centralisée. Regroupe par
 * urgence (En retard / Aujourd'hui / Cette semaine / Plus tard / Terminés).
 * Permet de cocher, supprimer et cliquer pour aller au candidat lié.
 *
 * Phase 2 (futur) : création de tâche standalone (sans candidat lié) nécessitera
 * alter table candidate_reminders → candidate_id nullable OR nouvelle table `tasks`.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { useAllReminders, type Reminder, type ReminderBucket } from '@/hooks/useAllReminders';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { CheckSquare, Bell, Clock, CheckCircle2, AlertCircle, CalendarDays, RefreshCw, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const BUCKET_META: Record<ReminderBucket, { label: string; icon: React.ElementType; color: string; emptyMessage: string }> = {
  overdue:  { label: 'En retard',       icon: AlertCircle,  color: 'text-destructive border-destructive/30 bg-destructive/5',       emptyMessage: 'Aucun retard 🎉' },
  today:    { label: "Aujourd'hui",     icon: Clock,        color: 'text-warning border-warning/30 bg-warning/5',                   emptyMessage: "Rien pour aujourd'hui" },
  week:     { label: 'Cette semaine',   icon: CalendarDays, color: 'text-info border-info/30 bg-info/5',                            emptyMessage: 'Rien cette semaine' },
  later:    { label: 'Plus tard',       icon: Bell,         color: 'text-muted-foreground border-border bg-muted/30',               emptyMessage: 'Rien prévu' },
  done:     { label: 'Terminées',       icon: CheckCircle2, color: 'text-success border-success/30 bg-success/5',                   emptyMessage: 'Aucune tâche terminée' },
};

export default function TasksPage() {
  const navigate = useNavigate();
  const { grouped, counts, isLoading, refetch, toggleComplete, deleteReminder } = useAllReminders();
  const [view, setView] = useState<'active' | 'all'>('active');

  const visibleBuckets: ReminderBucket[] = view === 'active'
    ? ['overdue', 'today', 'week', 'later']
    : ['overdue', 'today', 'week', 'later', 'done'];

  const isEmpty = counts.active === 0 && (view === 'active' || counts.done === 0);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Tâches | Konekt"
        description="Vos rappels et tâches en cours"
      />

      <div className="py-6 pb-8">
        <div className="max-w-[1200px] mx-auto px-3 sm:px-6 lg:px-8">

          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-2.5">
              <CheckSquare className="w-5 h-5 text-foreground" aria-hidden="true" />
              <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Tâches</h1>
              {counts.active > 0 && (
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  {counts.active} en cours
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center border border-border">
                <button
                  onClick={() => setView('active')}
                  className={cn(
                    'h-8 px-3 text-xs uppercase tracking-wider font-medium transition-colors',
                    view === 'active' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Actives ({counts.active})
                </button>
                <button
                  onClick={() => setView('all')}
                  className={cn(
                    'h-8 px-3 text-xs uppercase tracking-wider font-medium transition-colors border-l border-border',
                    view === 'all' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Toutes
                </button>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                aria-label="Actualiser les tâches"
                className="h-8 gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Actualiser</span>
              </Button>
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-0 mb-6 border border-border">
            {(['overdue', 'today', 'week', 'later', 'done'] as const).map((bucket, i) => {
              const meta = BUCKET_META[bucket];
              const Icon = meta.icon;
              const count = counts[bucket];
              const isPrimaryAlert = bucket === 'overdue' && count > 0;
              return (
                <div
                  key={bucket}
                  className={cn(
                    'p-3 flex flex-col gap-1',
                    i > 0 && 'sm:border-l border-border',
                    i % 2 !== 0 && 'max-sm:border-l border-border',
                    i >= 2 && 'max-sm:border-t border-border',
                    isPrimaryAlert && 'bg-destructive/5',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn('w-3 h-3', isPrimaryAlert ? 'text-destructive' : 'text-muted-foreground')} aria-hidden="true" />
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium truncate">{meta.label}</span>
                  </div>
                  <span className={cn('text-xl font-bold font-mono tabular-nums', isPrimaryAlert && 'text-destructive')}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Loading / Empty / Content */}
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted animate-pulse border border-border" />)}
            </div>
          ) : isEmpty ? (
            <div className="text-center py-16 border border-dashed border-border">
              <CheckCircle2 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" aria-hidden="true" />
              <h3 className="text-sm font-bold uppercase tracking-wider mb-1">Zéro tâche en cours</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Les rappels créés sur un candidat apparaîtront ici. Tu peux en ajouter depuis le modal de détail d'un candidat.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {visibleBuckets.map(bucket => {
                const items = grouped[bucket];
                const meta = BUCKET_META[bucket];
                if (items.length === 0) return null;
                return (
                  <BucketSection
                    key={bucket}
                    bucket={bucket}
                    items={items}
                    meta={meta}
                    onToggle={toggleComplete}
                    onDelete={deleteReminder}
                    onNavigate={(candidateId) => navigate(`/pipeline?candidate=${candidateId}`)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BucketSection({
  bucket, items, meta, onToggle, onDelete, onNavigate,
}: {
  bucket: ReminderBucket;
  items: Reminder[];
  meta: typeof BUCKET_META[ReminderBucket];
  onToggle: (r: Reminder) => void;
  onDelete: (id: string) => void;
  onNavigate: (candidateId: string) => void;
}) {
  const Icon = meta.icon;
  return (
    <section>
      <div className="flex items-center gap-2 mb-2 px-1">
        <Icon className={cn('w-4 h-4', meta.color.split(' ')[0])} aria-hidden="true" />
        <h2 className="text-xs uppercase tracking-wider font-bold">{meta.label}</h2>
        <span className="text-xs font-mono text-muted-foreground">({items.length})</span>
      </div>
      <ul className="divide-y divide-border border border-border bg-background">
        {items.map(r => (
          <TaskRow
            key={r.id}
            reminder={r}
            onToggle={onToggle}
            onDelete={onDelete}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </section>
  );
}

const TaskRow = React.memo(function TaskRow({
  reminder, onToggle, onDelete, onNavigate,
}: {
  reminder: Reminder;
  onToggle: (r: Reminder) => void;
  onDelete: (id: string) => void;
  onNavigate: (candidateId: string) => void;
}) {
  const [loading, setLoading] = useState<'toggle' | 'delete' | null>(null);
  const isCompleted = !!reminder.completed_at;
  const dueLabel = (() => {
    try { return format(parseISO(reminder.due_at), "d MMM yyyy 'à' HH:mm", { locale: fr }); }
    catch { return '—'; }
  })();

  return (
    <li className={cn('flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors', isCompleted && 'opacity-60')}>
      <Checkbox
        checked={isCompleted}
        onCheckedChange={async () => {
          setLoading('toggle');
          try { await onToggle(reminder); } finally { setLoading(null); }
        }}
        disabled={loading !== null}
        className="mt-1"
        aria-label={isCompleted ? 'Marquer comme non terminée' : 'Marquer comme terminée'}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={cn('text-sm font-medium text-foreground', isCompleted && 'line-through text-muted-foreground')}>
            {reminder.title}
          </p>
          {reminder.job_title && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border text-muted-foreground">
              {reminder.job_title}
            </Badge>
          )}
        </div>
        {reminder.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{reminder.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 font-mono">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {dueLabel}
          </span>
          {reminder.candidate_name && (
            <button
              onClick={() => onNavigate(reminder.candidate_id)}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
              {reminder.candidate_name}
            </button>
          )}
        </div>
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
            aria-label="Supprimer la tâche"
            disabled={loading !== null}
          >
            {loading === 'delete' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la tâche ?</AlertDialogTitle>
            <AlertDialogDescription>
              "{reminder.title}" sera définitivement supprimée. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                setLoading('delete');
                try { await onDelete(reminder.id); } finally { setLoading(null); }
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
});
