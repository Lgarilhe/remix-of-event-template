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
// Design system — primitives partagées
import { PageLayout, PageHeader, EmptyState, StatTile, StatGrid } from '@/components/layout';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const BUCKET_META: Record<ReminderBucket, {
  label: string;
  icon: React.ElementType;
  color: string;
  statVariant: 'destructive' | 'warning' | 'info' | 'default' | 'success';
}> = {
  overdue: { label: 'En retard',     icon: AlertCircle,  color: 'text-destructive',       statVariant: 'destructive' },
  today:   { label: "Aujourd'hui",   icon: Clock,        color: 'text-warning',           statVariant: 'warning' },
  week:    { label: 'Cette semaine', icon: CalendarDays, color: 'text-info',              statVariant: 'info' },
  later:   { label: 'Plus tard',     icon: Bell,         color: 'text-muted-foreground',  statVariant: 'default' },
  done:    { label: 'Terminées',     icon: CheckCircle2, color: 'text-success',           statVariant: 'success' },
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
    <PageLayout maxWidth="lg">
      <SEOHead
        title="Tâches | Konekt"
        description="Vos rappels et tâches en cours"
      />

      <PageHeader
        icon={CheckSquare}
        title="Tâches"
        meta={counts.active > 0 ? `${counts.active} en cours` : undefined}
        actions={
          <>
            <div className="flex items-center border border-border" role="tablist" aria-label="Filtre tâches">
              <button
                role="tab"
                aria-selected={view === 'active'}
                onClick={() => setView('active')}
                className={cn(
                  'h-8 px-3 text-xs uppercase tracking-wider font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  view === 'active' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
                )}
              >
                Actives ({counts.active})
              </button>
              <button
                role="tab"
                aria-selected={view === 'all'}
                onClick={() => setView('all')}
                className={cn(
                  'h-8 px-3 text-xs uppercase tracking-wider font-medium transition-colors border-l border-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  view === 'all' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
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
          </>
        }
      />

      {/* KPI strip — primitives StatTile/StatGrid */}
      <StatGrid cols={{ base: 2, sm: 5 }} className="mb-6">
        {(['overdue', 'today', 'week', 'later', 'done'] as const).map((bucket) => {
          const meta = BUCKET_META[bucket];
          const count = counts[bucket];
          const isAlert = bucket === 'overdue' && count > 0;
          return (
            <StatTile
              key={bucket}
              label={meta.label}
              value={count}
              icon={meta.icon}
              variant={isAlert ? 'destructive' : meta.statVariant}
              accent={isAlert || (bucket !== 'done' && count > 0)}
            />
          );
        })}
      </StatGrid>

      {/* Loading / Empty / Content */}
      {isLoading ? (
        <div className="space-y-4 stagger-in">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted animate-pulse border border-border" />)}
        </div>
      ) : isEmpty ? (
        <EmptyState
          icon={CheckCircle2}
          title="Zéro tâche en cours"
          description="Les rappels créés sur un candidat apparaîtront ici. Tu peux en ajouter depuis le modal de détail d'un candidat."
        />
      ) : (
        <div className="space-y-6 stagger-in">
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
    </PageLayout>
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
        <Icon className={cn('w-4 h-4', meta.color)} aria-hidden="true" />
        <h2 className="text-xs uppercase tracking-wider font-bold">{meta.label}</h2>
        <span className="text-xs font-mono text-muted-foreground tabular-nums">({items.length})</span>
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
    <li className={cn('flex items-start gap-3 px-4 py-3 interactive-row', isCompleted && 'opacity-60')}>
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
