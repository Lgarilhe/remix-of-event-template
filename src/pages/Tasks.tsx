/**
 * Tasks — page globale des tâches (candidate_reminders).
 *
 * Regroupées par urgence : en retard, aujourd'hui, cette semaine, plus tard,
 * terminées. Chaque tâche se coche, se supprime (après confirmation) et mène
 * au candidat ou à la mission liés. Les suggestions automatiques (compte rendu
 * manquant, entretien à préparer, candidat à relancer) se créent en un clic.
 *
 * Une lecture en échec s'affiche comme une erreur avec « Réessayer », jamais
 * comme une liste vide (revue design A-34).
 */

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO, isToday, isTomorrow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { AlertCircle, Bell, CalendarDays, CheckCircle2, CheckSquare, Clock, Plus, RefreshCw, Trash2, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { SEOHead } from '@/components/SEOHead';
import { EmptyState, ErrorState, PageHeader, PageLayout, Section } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAllReminders, type Reminder, type ReminderBucket, type TaskScope } from '@/hooks/useAllReminders';
import { useAutoTaskSuggestions } from '@/hooks/useAutoTaskSuggestions';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import {
  TasksFiltersBar,
  applyTasksFilters,
  DEFAULT_TASKS_FILTERS,
  type TasksFilters,
  type TasksView,
} from '@/components/tasks/TasksFiltersBar';
import { plural } from '@/lib/plural';

const BUCKETS: { key: ReminderBucket; label: string; icon: React.ElementType }[] = [
  { key: 'overdue', label: 'En retard', icon: AlertCircle },
  { key: 'today', label: "Aujourd'hui", icon: Clock },
  { key: 'week', label: 'Cette semaine', icon: CalendarDays },
  { key: 'later', label: 'Plus tard', icon: Bell },
  { key: 'done', label: 'Terminées', icon: CheckCircle2 },
];

type Suggestion = ReturnType<typeof useAutoTaskSuggestions>['suggestions'][number];

export default function TasksPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthReady();
  const { organizationId } = useOrganization();
  // Périmètre : « Mes tâches » par défaut ; les compteurs du hook suivent ce choix
  const [scope, setScope] = useState<TaskScope>('mine');
  const { grouped, counts, isLoading, isError, error, refetch, toggleComplete, deleteReminder, reminders } =
    useAllReminders({ scope });
  const [view, setView] = useState<TasksView>('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [filters, setFilters] = useState<TasksFilters>(DEFAULT_TASKS_FILTERS);
  const [refreshing, setRefreshing] = useState(false);

  // Suggestions automatiques (compte rendu manquant, entretien à préparer, relance)
  const { suggestions } = useAutoTaskSuggestions();
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [creatingSuggestion, setCreatingSuggestion] = useState<string | null>(null);

  const filteredGrouped = useMemo(
    () => ({
      overdue: applyTasksFilters(grouped.overdue, filters),
      today: applyTasksFilters(grouped.today, filters),
      week: applyTasksFilters(grouped.week, filters),
      later: applyTasksFilters(grouped.later, filters),
      done: applyTasksFilters(grouped.done, filters),
    }),
    [grouped, filters],
  );

  const filteredActive =
    filteredGrouped.overdue.length + filteredGrouped.today.length + filteredGrouped.week.length + filteredGrouped.later.length;

  const acceptSuggestion = async (s: Suggestion) => {
    if (!user || !organizationId) return;
    setCreatingSuggestion(s.key);
    const { error: insertError } = await supabase.from('candidate_reminders').insert({
      organization_id: organizationId,
      created_by: user.id,
      title: s.title,
      description: s.description,
      due_at: s.dueAt.toISOString(),
      category: s.category,
      candidate_id: s.candidate?.candidateId ?? null,
      candidate_name: s.candidate?.name ?? null,
      source_event_id: s.sourceEventId,
      auto_generated: true,
    } as any);
    setCreatingSuggestion(null);
    if (insertError) {
      console.warn('[acceptSuggestion]', insertError);
      toast.error("La tâche n'a pas pu être créée. Réessayez.");
      return;
    }
    setDismissedSuggestions((prev) => new Set(prev).add(s.key));
    toast.success('Tâche créée');
    await queryClient.invalidateQueries({ queryKey: ['all-reminders'] });
    await queryClient.invalidateQueries({ queryKey: ['auto-task-suggestions'] });
  };

  const visibleSuggestions = useMemo(
    () => suggestions.filter((s) => !dismissedSuggestions.has(s.key)),
    [suggestions, dismissedSuggestions],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const visibleBuckets = BUCKETS.filter((b) => view === 'all' || b.key !== 'done');
  const isEmpty = filteredActive === 0 && (view === 'active' || filteredGrouped.done.length === 0);
  const hiddenByFilters = counts.active + (view === 'all' ? counts.done : 0);
  const isFilteredEmpty = isEmpty && hiddenByFilters > 0;

  const subtitle = isLoading || isError
    ? undefined
    : counts.active > 0
      ? `${plural(counts.active, 'tâche')} en cours · ${plural(counts.done, 'terminée')}`
      : 'Aucune tâche en cours';

  return (
    <PageLayout maxWidth="lg">
      <SEOHead title="Tâches | Konekt" description="Vos tâches et rappels en cours" />

      <PageHeader
        title="Tâches"
        subtitle={subtitle}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="outline" size="icon" onClick={refresh} disabled={refreshing} aria-label="Actualiser les tâches">
                  <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Actualiser</TooltipContent>
            </Tooltip>
            <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" />
              Nouvelle tâche
            </Button>
          </>
        }
      />

      {visibleSuggestions.length > 0 && !isError && (
        <Section
          headingLevel={2}
          title={plural(visibleSuggestions.length, 'suggestion')}
          subtitle="Détectées d'après votre activité récente"
          className="mb-6"
        >
          <ul className="divide-y divide-border">
            {visibleSuggestions.map((s) => (
              <li key={s.key} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{s.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.reason}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={creatingSuggestion === s.key}
                    onClick={() => acceptSuggestion(s)}
                  >
                    {creatingSuggestion !== s.key && <Plus aria-hidden="true" />}
                    Créer la tâche
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDismissedSuggestions((prev) => new Set(prev).add(s.key))}
                        aria-label={`Ignorer la suggestion « ${s.title} »`}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Ignorer</TooltipContent>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="mb-6">
        <TasksFiltersBar
          filters={filters}
          onFiltersChange={setFilters}
          scope={scope}
          onScopeChange={setScope}
          view={view}
          onViewChange={setView}
          activeCount={isLoading || isError ? null : counts.active}
          allReminders={reminders}
        />
      </div>

      {isLoading ? (
        <div className="space-y-4" role="status" aria-label="Chargement des tâches">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Impossible de charger vos tâches"
          description="Vérifiez votre connexion, puis réessayez. Vos tâches ne sont pas perdues."
          detail={error}
          onRetry={refresh}
          retrying={refreshing}
        />
      ) : isFilteredEmpty ? (
        <EmptyState
          icon={CheckSquare}
          title="Aucune tâche ne correspond à vos filtres"
          description={`${plural(hiddenByFilters, 'tâche')} masquée${hiddenByFilters > 1 ? 's' : ''} par les filtres.`}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => setFilters(DEFAULT_TASKS_FILTERS)}>
              Effacer les filtres
            </Button>
          }
        />
      ) : isEmpty ? (
        <EmptyState
          icon={CheckSquare}
          title="Aucune tâche en cours"
          description="Créez une tâche ici, depuis la fiche d'un candidat ou depuis un entretien de l'agenda."
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" />
              Nouvelle tâche
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {visibleBuckets.map((bucket) => {
            const items = filteredGrouped[bucket.key];
            if (items.length === 0) return null;
            return (
              <Section key={bucket.key} headingLevel={2} icon={bucket.icon} title={bucket.label} subtitle={String(items.length)}>
                <ul className="divide-y divide-border">
                  {items.map((r) => (
                    <TaskRow
                      key={r.id}
                      reminder={r}
                      overdue={bucket.key === 'overdue'}
                      onToggle={toggleComplete}
                      onDelete={deleteReminder}
                    />
                  ))}
                </ul>
              </Section>
            );
          })}
        </div>
      )}

      <CreateTaskModal open={createOpen} onOpenChange={setCreateOpen} />
    </PageLayout>
  );
}

/** « Aujourd'hui à 14:30 », « Demain à 9:00 », « 22 sept. à 11:29 ». */
function dueLabelOf(dueAt: string): string {
  try {
    const d = parseISO(dueAt);
    const time = format(d, 'HH:mm');
    if (isToday(d)) return `Aujourd'hui à ${time}`;
    if (isTomorrow(d)) return `Demain à ${time}`;
    return format(d, "d MMM 'à' HH:mm", { locale: fr });
  } catch {
    return 'Date inconnue';
  }
}

const TaskRow = React.memo(function TaskRow({
  reminder,
  overdue = false,
  onToggle,
  onDelete,
}: {
  reminder: Reminder;
  overdue?: boolean;
  onToggle: (r: Reminder) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<'toggle' | 'delete' | null>(null);
  const isCompleted = !!reminder.completed_at;

  return (
    <li className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40">
      <Checkbox
        checked={isCompleted}
        onCheckedChange={async () => {
          setBusy('toggle');
          try {
            await onToggle(reminder);
          } finally {
            setBusy(null);
          }
        }}
        disabled={busy !== null}
        className="mt-0.5 shrink-0"
        aria-label={isCompleted ? `Rouvrir la tâche « ${reminder.title} »` : `Marquer la tâche « ${reminder.title} » comme faite`}
      />

      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium text-foreground', isCompleted && 'text-muted-foreground line-through')}>
          {reminder.title}
        </p>
        {reminder.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{reminder.description}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className={cn('inline-flex items-center gap-1 tabular-nums', overdue && 'font-medium text-danger')}>
            <Clock className="h-3 w-3" aria-hidden="true" />
            {dueLabelOf(reminder.due_at)}
            {overdue && <span className="sr-only"> (en retard)</span>}
          </span>
          {reminder.candidate_name && reminder.candidate_id && (
            <Link
              to={`/pipeline?candidate=${reminder.candidate_id}`}
              className="inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <User className="h-3 w-3" aria-hidden="true" />
              {reminder.candidate_name}
            </Link>
          )}
          {reminder.candidate_name && !reminder.candidate_id && (
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" aria-hidden="true" />
              {reminder.candidate_name}
            </span>
          )}
          {reminder.job_title &&
            (reminder.job_id ? (
              <Link
                to={`/missions/${reminder.job_id}`}
                className="truncate rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {reminder.job_title}
              </Link>
            ) : (
              <span className="truncate">{reminder.job_title}</span>
            ))}
        </p>
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-danger"
            aria-label={`Supprimer la tâche « ${reminder.title} »`}
            loading={busy === 'delete'}
          >
            {busy !== 'delete' && <Trash2 aria-hidden="true" />}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la tâche ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {reminder.title} » sera définitivement supprimée. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                setBusy('delete');
                try {
                  await onDelete(reminder.id);
                } finally {
                  setBusy(null);
                }
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
