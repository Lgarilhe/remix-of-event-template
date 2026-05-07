/**
 * TasksFiltersBar — barre de filtres pills pour la page /tasks.
 *
 * Filtres :
 * - Catégorie (multi) : general / follow_up / interview_prep / debrief /
 *   admin / client / sourcing
 * - Mission (multi) : dérivée des reminders ayant un job_title
 * - Type (toggle) : tâches manuelles vs auto-générées
 *
 * Pattern Linear/Calendar : pills avec popover + count badges.
 */

import React, { useMemo } from 'react';
import {
  Filter,
  Briefcase,
  Sparkles,
  X,
  CheckCircle2,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { Reminder, TaskCategory } from '@/hooks/useAllReminders';

export interface TasksFilters {
  /** Catégories autorisées. Vide = toutes. */
  categories: TaskCategory[];
  /** job_titles autorisés. Vide = tous. */
  jobTitles: string[];
  /** Si true, n'affiche que les auto-générées. Si null, ignore. */
  autoOnly: boolean | null;
}

export const DEFAULT_TASKS_FILTERS: TasksFilters = {
  categories: [],
  jobTitles: [],
  autoOnly: null,
};

interface TasksFiltersBarProps {
  filters: TasksFilters;
  onFiltersChange: (filters: TasksFilters) => void;
  /** Tous les reminders — sert à dériver les options uniques (jobs) */
  allReminders: Reminder[];
}

const CATEGORY_OPTIONS: { value: TaskCategory; label: string; emoji: string }[] = [
  { value: 'general', label: 'Général', emoji: '📌' },
  { value: 'follow_up', label: 'Relance', emoji: '🔁' },
  { value: 'interview_prep', label: 'Prép. entretien', emoji: '🎯' },
  { value: 'debrief', label: 'Débrief', emoji: '📝' },
  { value: 'admin', label: 'Admin', emoji: '📂' },
  { value: 'client', label: 'Client', emoji: '🤝' },
  { value: 'sourcing', label: 'Sourcing', emoji: '🔍' },
];

const FilterPill: React.FC<{
  label: string;
  count: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, count, icon, children }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[11.5px] font-medium transition-colors shrink-0',
          count > 0
            ? 'bg-foreground text-background border-foreground'
            : 'border-border bg-background hover:bg-accent text-foreground',
        )}
      >
        {icon}
        {label}
        {count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-background text-foreground text-[10px] font-bold tabular-nums">
            {count}
          </span>
        )}
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-56 p-3 rounded-xl border-border" align="start">
      {children}
    </PopoverContent>
  </Popover>
);

export const TasksFiltersBar: React.FC<TasksFiltersBarProps> = ({
  filters,
  onFiltersChange,
  allReminders,
}) => {
  // Dérive les jobs uniques depuis les reminders
  const jobs = useMemo(() => {
    const set = new Set<string>();
    for (const r of allReminders) {
      if (r.job_title) set.add(r.job_title);
    }
    return Array.from(set).sort();
  }, [allReminders]);

  const activeCount =
    filters.categories.length +
    filters.jobTitles.length +
    (filters.autoOnly !== null ? 1 : 0);

  const clearAll = () => onFiltersChange(DEFAULT_TASKS_FILTERS);

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide flex-wrap">
      {/* Catégorie */}
      <FilterPill
        label="Catégorie"
        count={filters.categories.length}
        icon={<Filter className="w-3.5 h-3.5" />}
      >
        <div className="space-y-2">
          {CATEGORY_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={filters.categories.includes(opt.value)}
                onCheckedChange={(checked) =>
                  onFiltersChange({
                    ...filters,
                    categories: checked
                      ? [...filters.categories, opt.value]
                      : filters.categories.filter((c) => c !== opt.value),
                  })
                }
              />
              <span className="mr-1">{opt.emoji}</span>
              {opt.label}
            </label>
          ))}
        </div>
      </FilterPill>

      {/* Mission */}
      {jobs.length > 0 && (
        <FilterPill
          label="Mission"
          count={filters.jobTitles.length}
          icon={<Briefcase className="w-3.5 h-3.5" />}
        >
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {jobs.map((job) => (
              <label key={job} className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={filters.jobTitles.includes(job)}
                  onCheckedChange={(checked) =>
                    onFiltersChange({
                      ...filters,
                      jobTitles: checked
                        ? [...filters.jobTitles, job]
                        : filters.jobTitles.filter((j) => j !== job),
                    })
                  }
                />
                <span className="truncate">{job}</span>
              </label>
            ))}
          </div>
        </FilterPill>
      )}

      {/* Auto / Manuelle toggle 3-states */}
      <button
        onClick={() => {
          const next: boolean | null =
            filters.autoOnly === null ? true : filters.autoOnly === true ? false : null;
          onFiltersChange({ ...filters, autoOnly: next });
        }}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[11.5px] font-medium transition-colors shrink-0',
          filters.autoOnly !== null
            ? 'bg-foreground text-background border-foreground'
            : 'border-border bg-background hover:bg-accent text-foreground',
        )}
      >
        {filters.autoOnly === true ? (
          <>
            <Sparkles className="w-3.5 h-3.5" />
            Auto seulement
          </>
        ) : filters.autoOnly === false ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5" />
            Manuel seulement
          </>
        ) : (
          <>
            <Sparkles className="w-3.5 h-3.5" />
            Source
          </>
        )}
      </button>

      {/* Clear all */}
      {activeCount > 0 && (
        <button
          onClick={clearAll}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-destructive/40 bg-destructive/5 hover:bg-destructive/10 text-destructive text-[11.5px] font-medium transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
          Effacer ({activeCount})
        </button>
      )}
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
