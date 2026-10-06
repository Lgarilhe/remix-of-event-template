/**
 * TasksFiltersBar — barre de filtres de la page /tasks.
 *
 * - Périmètre (Mes tâches / Équipe) et affichage (En cours / Toutes) : pilotés
 *   par la page, hors TasksFilters, pour que « Effacer les filtres » ne les
 *   réinitialise pas.
 * - Catégorie, mission, origine (automatique ou manuelle) : un seul menu
 *   « Filtres », comme la messagerie (design simplifié, lot T).
 */

import React, { useMemo } from 'react';
import { ListFilter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterOption, FilterPill } from '@/components/ui/filter-pill';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { TASK_CATEGORIES } from '@/lib/taskCategories';
import type { Reminder, TaskCategory, TaskScope } from '@/hooks/useAllReminders';

export interface TasksFilters {
  /** Catégories autorisées. Vide = toutes. */
  categories: TaskCategory[];
  /** job_titles autorisés. Vide = tous. */
  jobTitles: string[];
  /** true : seulement les automatiques ; false : seulement les manuelles ; null : toutes. */
  autoOnly: boolean | null;
}

export const DEFAULT_TASKS_FILTERS: TasksFilters = {
  categories: [],
  jobTitles: [],
  autoOnly: null,
};

export type TasksView = 'active' | 'all';

interface TasksFiltersBarProps {
  filters: TasksFilters;
  onFiltersChange: (filters: TasksFilters) => void;
  /** Périmètre : tâches de l'utilisateur ou de toute l'équipe */
  scope: TaskScope;
  onScopeChange: (scope: TaskScope) => void;
  /** Tâches en cours seulement, ou toutes (terminées comprises) */
  view: TasksView;
  onViewChange: (view: TasksView) => void;
  /** Tous les reminders — sert à dériver les options uniques (missions) */
  allReminders: Reminder[];
}

const toggle = <T,>(list: T[], value: T, on: boolean): T[] =>
  on ? [...list, value] : list.filter((v) => v !== value);

export const TasksFiltersBar: React.FC<TasksFiltersBarProps> = ({
  filters,
  onFiltersChange,
  scope,
  onScopeChange,
  view,
  onViewChange,
  allReminders,
}) => {
  // Missions citées par les tâches
  const jobs = useMemo(() => {
    const set = new Set<string>();
    for (const r of allReminders) {
      if (r.job_title) set.add(r.job_title);
    }
    // Une mission cochée reste décochable même si le périmètre ne la montre plus.
    for (const j of filters.jobTitles) set.add(j);
    return Array.from(set).sort();
  }, [allReminders, filters.jobTitles]);

  const filterCount =
    filters.categories.length + filters.jobTitles.length + (filters.autoOnly !== null ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        aria-label="Périmètre des tâches"
        value={scope}
        onValueChange={onScopeChange}
        options={[
          { value: 'mine', label: 'Mes tâches', title: 'Les tâches que vous avez créées' },
          { value: 'team', label: 'Équipe', title: "Les tâches de toute l'équipe" },
        ]}
      />
      <SegmentedControl
        aria-label="Tâches affichées"
        value={view}
        onValueChange={onViewChange}
        options={[
          { value: 'active', label: 'En cours' },
          { value: 'all', label: 'Toutes' },
        ]}
      />

      <FilterPill label="Filtres" icon={ListFilter} count={filterCount} contentClassName="w-64 max-h-[70vh] overflow-y-auto">
        <div role="group" aria-labelledby="tasks-filter-category">
          <p id="tasks-filter-category" className="eyebrow px-2 pb-1 pt-1.5">Catégorie</p>
          {TASK_CATEGORIES.map((c) => (
            <FilterOption
              key={c.value}
              checked={filters.categories.includes(c.value)}
              onCheckedChange={(on) => onFiltersChange({ ...filters, categories: toggle(filters.categories, c.value, on) })}
            >
              {c.label}
            </FilterOption>
          ))}
        </div>

        {jobs.length > 0 && (
          <div role="group" aria-labelledby="tasks-filter-mission" className="mt-1 border-t border-border pt-1">
            <p id="tasks-filter-mission" className="eyebrow px-2 pb-1 pt-1.5">Mission</p>
            {jobs.map((job) => (
              <FilterOption
                key={job}
                checked={filters.jobTitles.includes(job)}
                onCheckedChange={(on) => onFiltersChange({ ...filters, jobTitles: toggle(filters.jobTitles, job, on) })}
              >
                {job}
              </FilterOption>
            ))}
          </div>
        )}

        <div role="group" aria-labelledby="tasks-filter-origin" className="mt-1 border-t border-border pt-1">
          <p id="tasks-filter-origin" className="eyebrow px-2 pb-1 pt-1.5">Origine</p>
          <FilterOption
            checked={filters.autoOnly === true}
            onCheckedChange={(on) => onFiltersChange({ ...filters, autoOnly: on ? true : null })}
            description="Créées depuis une suggestion"
          >
            Automatiques
          </FilterOption>
          <FilterOption
            checked={filters.autoOnly === false}
            onCheckedChange={(on) => onFiltersChange({ ...filters, autoOnly: on ? false : null })}
            description="Créées à la main"
          >
            Manuelles
          </FilterOption>
        </div>

        {filterCount > 0 && (
          <div className="mt-1 border-t border-border pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start max-md:min-h-11"
              onClick={() => onFiltersChange(DEFAULT_TASKS_FILTERS)}
            >
              <X aria-hidden="true" />
              Effacer les filtres
            </Button>
          </div>
        )}
      </FilterPill>
    </div>
  );
};

/**
 * Applique les filtres à la liste de reminders.
 */
export function applyTasksFilters(reminders: Reminder[], filters: TasksFilters): Reminder[] {
  return reminders.filter((r) => {
    if (filters.categories.length > 0 && !filters.categories.includes(r.category)) return false;
    if (filters.jobTitles.length > 0) {
      if (!r.job_title || !filters.jobTitles.includes(r.job_title)) return false;
    }
    if (filters.autoOnly !== null) {
      if (filters.autoOnly === true && !r.auto_generated) return false;
      if (filters.autoOnly === false && r.auto_generated) return false;
    }
    return true;
  });
}
