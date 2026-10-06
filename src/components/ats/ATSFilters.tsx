/**
 * Barre de filtres du pipeline global : la recherche, puis un seul menu
 * « Filtres » (étape, source, mission, étiquettes, rappel), comme les Tâches
 * et la messagerie (design simplifié, lot Suite). « Avec rappel » est un
 * filtre ; le bouton « Rappels » de l'en-tête ouvre la liste des rappels
 * (revue design E-20). Sur téléphone, la barre passe à la ligne (E-21).
 */
import React from 'react';
import { ListFilter, Search, X } from 'lucide-react';
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
  className?: string;
}

const toggle = (list: string[], value: string, on: boolean): string[] =>
  on ? [...list, value] : list.filter((v) => v !== value);

/** Un groupe du menu : un titre discret, puis ses choix ; un filet le sépare du précédent. */
const FilterGroup: React.FC<{ id: string; label: string; first?: boolean; children: React.ReactNode }> = ({
  id,
  label,
  first = false,
  children,
}) => (
  <div role="group" aria-labelledby={id} className={cn(!first && 'mt-1 border-t border-border pt-1')}>
    <p id={id} className="eyebrow px-2 pb-1 pt-1.5">{label}</p>
    {children}
  </div>
);

export const ATSFilters: React.FC<ATSFiltersProps> = ({ filters, onFiltersChange, options, className }) => {
  const activeCount =
    filters.stage.length + filters.source.length + filters.job.length + filters.tag.length + (filters.hasReminder ? 1 : 0);

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="relative w-full sm:w-64">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          placeholder="Nom, mission, intitulé…"
          aria-label="Rechercher un candidat"
          className="h-8 pl-8 max-md:h-11"
        />
      </div>

      <FilterPill label="Filtres" icon={ListFilter} count={activeCount} contentClassName="w-64 max-h-[70vh] overflow-y-auto">
        <FilterGroup id="ats-filter-stage" label="Étape" first>
          {options.stages.map((stage) => (
            <FilterOption
              key={stage.key}
              checked={filters.stage.includes(stage.key)}
              onCheckedChange={(on) => onFiltersChange({ ...filters, stage: toggle(filters.stage, stage.key, on) })}
            >
              {stage.label}
            </FilterOption>
          ))}
        </FilterGroup>

        {options.sources.length > 1 && (
          <FilterGroup id="ats-filter-source" label="Source">
            {options.sources.map((source) => (
              <FilterOption
                key={source}
                checked={filters.source.includes(source)}
                onCheckedChange={(on) => onFiltersChange({ ...filters, source: toggle(filters.source, source, on) })}
              >
                {ATS_SOURCE_LABELS[source]}
              </FilterOption>
            ))}
          </FilterGroup>
        )}

        {options.jobs.length > 0 && (
          <FilterGroup id="ats-filter-job" label="Mission">
            {options.jobs.map((job) => (
              <FilterOption
                key={job.id}
                checked={filters.job.includes(job.id)}
                onCheckedChange={(on) => onFiltersChange({ ...filters, job: toggle(filters.job, job.id, on) })}
              >
                {job.title}
              </FilterOption>
            ))}
          </FilterGroup>
        )}

        {options.tags.length > 0 && (
          <FilterGroup id="ats-filter-tag" label="Étiquettes">
            {options.tags.map((tag) => (
              <FilterOption
                key={tag}
                checked={filters.tag.includes(tag)}
                onCheckedChange={(on) => onFiltersChange({ ...filters, tag: toggle(filters.tag, tag, on) })}
              >
                {tag}
              </FilterOption>
            ))}
          </FilterGroup>
        )}

        <FilterGroup id="ats-filter-reminder" label="Rappel">
          <FilterOption
            checked={filters.hasReminder}
            onCheckedChange={(on) => onFiltersChange({ ...filters, hasReminder: on })}
            description="Un rappel attend sur le candidat"
          >
            Avec rappel
          </FilterOption>
        </FilterGroup>

        {activeCount > 0 && (
          <div className="mt-1 border-t border-border pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start max-md:min-h-11"
              onClick={() => onFiltersChange({ ...filters, stage: [], source: [], job: [], tag: [], hasReminder: false })}
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
