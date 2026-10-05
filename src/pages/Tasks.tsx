/**
 * Tasks — page globale des tâches (candidate_reminders).
 *
 * Regroupées par urgence : en retard, aujourd'hui, cette semaine, plus tard,
 * terminées. Chaque tâche se coche, se supprime (après confirmation) et mène
 * au candidat ou à la mission liés. Les suggestions automatiques (compte rendu
 * manquant, entretien à préparer, candidat à relancer) se créent en un clic,
 * sous la liste.
 *
 * Design simplifié, lot T (docs/design/06-simplicite.md) : un seul bouton plein,
 * les filtres dans un seul menu, des listes sans cadre, le visage du candidat
 * ou les initiales du client sur chaque ligne (src/components/tasks/TaskList.tsx).
 *
 * Une lecture en échec s'affiche comme une erreur avec « Réessayer », jamais
 * comme une liste vide (revue design A-34).
 */

import { useMemo, useState } from 'react';
import { CheckSquare, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { SEOHead } from '@/components/SEOHead';
import { EmptyState, ErrorState, PageHeader, PageLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAllReminders, type ReminderBucket, type TaskScope } from '@/hooks/useAllReminders';
import { useAutoTaskSuggestions, type AutoTaskSuggestion } from '@/hooks/useAutoTaskSuggestions';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useCandidateAvatarsByCandidateId } from '@/hooks/useCandidateAvatars';
import { useOrganization } from '@/hooks/useOrganization';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import { supabase } from '@/integrations/supabase/client';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { TaskSection, TaskSuggestions, type TaskMission } from '@/components/tasks/TaskList';
import {
  TasksFiltersBar,
  applyTasksFilters,
  DEFAULT_TASKS_FILTERS,
  type TasksFilters,
  type TasksView,
} from '@/components/tasks/TasksFiltersBar';
import { plural } from '@/lib/plural';

const BUCKETS: { key: ReminderBucket; label: string }[] = [
  { key: 'overdue', label: 'En retard' },
  { key: 'today', label: "Aujourd'hui" },
  { key: 'week', label: 'Cette semaine' },
  { key: 'later', label: 'Plus tard' },
  { key: 'done', label: 'Terminées' },
];

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

  // Visage du candidat de chaque tâche et suggestion (photo LinkedIn enregistrée, sinon initiales).
  const candidateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of reminders) if (r.candidate_id) ids.add(r.candidate_id);
    for (const s of suggestions) if (s.candidate?.candidateId) ids.add(s.candidate.candidateId);
    return Array.from(ids);
  }, [reminders, suggestions]);
  const photos = useCandidateAvatarsByCandidateId(candidateIds);

  // Mission d'une tâche (job_id « project:… » ou nu) : lien et client, pour les initiales.
  const { projects } = useSourcingProjects();
  const missionOf = useMemo(() => {
    const byId = new Map<string, TaskMission>(
      projects.map((p) => [p.id, { id: p.id, client: p.jd_client || p.client_name || null }]),
    );
    return (jobId: string | null) => (jobId ? byId.get(jobId.replace(/^project:/, '')) ?? null : null);
  }, [projects]);

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

  const acceptSuggestion = async (s: AutoTaskSuggestion) => {
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

  // Pas de zéro : sans tâche en cours, l'état vide parle.
  const subtitle = isLoading || isError || counts.active === 0
    ? undefined
    : `${plural(counts.active, 'tâche')} en cours${counts.done > 0 ? `, ${plural(counts.done, 'terminée')}` : ''}.`;

  return (
    <PageLayout maxWidth="lg">
      <SEOHead title="Tâches | Konekt" description="Vos tâches et rappels en cours" />

      <PageHeader
        title="Tâches"
        subtitle={subtitle}
        actions={
          <Button type="button" variant="primary" onClick={() => setCreateOpen(true)} className="min-h-11 md:min-h-0">
            <Plus aria-hidden="true" />
            Nouvelle tâche
          </Button>
        }
      />

      <div className="mb-8">
        <TasksFiltersBar
          filters={filters}
          onFiltersChange={setFilters}
          scope={scope}
          onScopeChange={setScope}
          view={view}
          onViewChange={setView}
          allReminders={reminders}
        />
      </div>

      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Chargement des tâches">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
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
          headingLevel={2}
          description={`${plural(hiddenByFilters, 'tâche')} masquée${hiddenByFilters > 1 ? 's' : ''} par les filtres.`}
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => setFilters(DEFAULT_TASKS_FILTERS)} className="min-h-11 md:min-h-0">
              Effacer les filtres
            </Button>
          }
        />
      ) : isEmpty ? (
        <EmptyState
          illustration="taches"
          title="Aucune tâche en cours"
          headingLevel={2}
          description="Créez une tâche ici, depuis la fiche d'un candidat ou depuis un entretien de l'agenda."
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => setCreateOpen(true)} className="min-h-11 md:min-h-0">
              <Plus aria-hidden="true" />
              Nouvelle tâche
            </Button>
          }
        />
      ) : (
        <div className="space-y-10">
          {visibleBuckets.map((bucket) => {
            const items = filteredGrouped[bucket.key];
            if (items.length === 0) return null;
            return (
              <TaskSection
                key={bucket.key}
                bucket={bucket.key}
                label={bucket.label}
                items={items}
                photos={photos}
                missionOf={missionOf}
                onToggle={toggleComplete}
                onDelete={deleteReminder}
              />
            );
          })}
        </div>
      )}

      {!isLoading && !isError && visibleSuggestions.length > 0 && (
        <div className="mt-12">
          <TaskSuggestions
            suggestions={visibleSuggestions}
            photos={photos}
            creatingKey={creatingSuggestion}
            onAccept={acceptSuggestion}
            onDismiss={(key) => setDismissedSuggestions((prev) => new Set(prev).add(key))}
          />
        </div>
      )}

      <CreateTaskModal open={createOpen} onOpenChange={setCreateOpen} />
    </PageLayout>
  );
}
