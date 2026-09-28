/**
 * Barre de filtres du pipeline global : la recherche, puis les pastilles du
 * kit (FilterPill), comme dans les Tâches et l'Agenda. « Avec rappel » est un
 * filtre ; le bouton « Rappels » de l'en-tête ouvre la liste des rappels
 * (revue design E-20). Sur téléphone, la barre passe à la ligne au lieu de
 * couper ses pastilles (E-21).
 */
import React from 'react';
import { Check, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterOption, FilterPill } from '@/components/ui/filter-pill';
import { Input } from '@/components/ui/input';
import { ATS_SOURCE_LABELS, type ATSCandidate } from '@/hooks/useATSData';
import { cn } from '@/lib/utils';

export interface ATSFiltersValue {
  search: string;
  stage: string[];
  source: string[];
  job: string[];
  tag: string[];
  hasReminder: boolean;
}

interface ATSFiltersProps {
  filters: ATSFiltersValue;
  onFiltersChange: (filters: ATSFiltersValue) => void;
  options: {
    /** Étapes présentes, dans l'ordre du pipeline. */
    stages: { key: string; label: string }[];
    sources: ATSCandidate['source'][];
    jobs: { id: string; title: string }[];
    tags: string[];
  };
}

const toggle = (list: string[], value: string, on: boolean): string[] =>
  on ? [...list, value] : list.filter((v) => v !== value);

export const ATSFilters: React.FC<ATSFiltersProps> = ({ filters, onFiltersChange, options }) => {
  const activeCount =
    filters.stage.length + filters.source.length + filters.job.length + filters.tag.length + (filters.hasReminder ? 1 : 0);
  const hasFilters = activeCount > 0 || filters.search.trim() !== '';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          placeholder="Nom, poste, intitulé…"
          aria-label="Rechercher un candidat"
          className="h-8 pl-8 max-md:h-11"
        />
      </div>

      <FilterPill label="Étape" count={filters.stage.length} contentClassName="max-h-72 overflow-y-auto">
        {options.stages.map((stage) => (
          <FilterOption
            key={stage.key}
            checked={filters.stage.includes(stage.key)}
            onCheckedChange={(on) => onFiltersChange({ ...filters, stage: toggle(filters.stage, stage.key, on) })}
          >
            {stage.label}
          </FilterOption>
        ))}
      </FilterPill>

      <FilterPill label="Source" count={filters.source.length}>
        {options.sources.map((source) => (
          <FilterOption
            key={source}
            checked={filters.source.includes(source)}
            onCheckedChange={(on) => onFiltersChange({ ...filters, source: toggle(filters.source, source, on) })}
          >
            {ATS_SOURCE_LABELS[source]}
          </FilterOption>
        ))}
      </FilterPill>

      {options.jobs.length > 0 && (
        <FilterPill label="Poste" count={filters.job.length} contentClassName="max-h-72 overflow-y-auto">
          {options.jobs.map((job) => (
            <FilterOption
              key={job.id}
              checked={filters.job.includes(job.id)}
              onCheckedChange={(on) => onFiltersChange({ ...filters, job: toggle(filters.job, job.id, on) })}
            >
              {job.title}
            </FilterOption>
          ))}
        </FilterPill>
      )}

      {options.tags.length > 0 && (
        <FilterPill label="Étiquettes" count={filters.tag.length} contentClassName="max-h-72 overflow-y-auto">
          {options.tags.map((tag) => (
            <FilterOption
              key={tag}
              checked={filters.tag.includes(tag)}
              onCheckedChange={(on) => onFiltersChange({ ...filters, tag: toggle(filters.tag, tag, on) })}
            >
              {tag}
            </FilterOption>
          ))}
        </FilterPill>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={filters.hasReminder}
        onClick={() => onFiltersChange({ ...filters, hasReminder: !filters.hasReminder })}
        className={cn(filters.hasReminder && 'border-border-strong bg-accent')}
      >
        {filters.hasReminder && <Check aria-hidden="true" />}
        Avec rappel
      </Button>

      {hasFilters && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onFiltersChange({ search: '', stage: [], source: [], job: [], tag: [], hasReminder: false })}
        >
          <X aria-hidden="true" />
          Effacer les filtres
        </Button>
      )}
    </div>
  );
};
