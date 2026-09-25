/**
 * Filtres de la shortlist client : la recherche et les pastilles du kit
 * (FilterPill), à la hauteur des filtres du pipeline global (revue design E-28).
 */
import React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { FilterOption, FilterPill } from '@/components/ui/filter-pill';

interface FilterOptions {
  stages: string[];
  expertise: string[];
  entities: string[];
  positions: { id: string; name: string }[];
}

interface Filters {
  search: string;
  stage: string[];
  expertise: string[];
  entity: string[];
  position: string[];
}

interface CandidateFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  options: FilterOptions;
}

const toggle = (list: string[], value: string, on: boolean): string[] =>
  on ? [...list, value] : list.filter((v) => v !== value);

export const CandidateFilters: React.FC<CandidateFiltersProps> = ({
  filters,
  onFiltersChange,
  options,
}) => {
  const hasActiveFilters = filters.search || filters.stage.length > 0 ||
    filters.expertise.length > 0 || filters.entity.length > 0 || filters.position.length > 0;

  const clearFilters = () => {
    onFiltersChange({
      search: '',
      stage: [],
      expertise: [],
      entity: [],
      position: [],
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Nom, e-mail, poste…"
          aria-label="Rechercher dans la shortlist"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="h-8 pl-8 max-md:h-11"
        />
      </div>

      {options.positions.length > 0 && (
        <FilterPill label="Poste" count={filters.position.length} contentClassName="max-h-72 overflow-y-auto">
          {options.positions.map(pos => (
            <FilterOption
              key={pos.id}
              checked={filters.position.includes(pos.id)}
              onCheckedChange={(on) => onFiltersChange({ ...filters, position: toggle(filters.position, pos.id, on) })}
            >
              {pos.name}
            </FilterOption>
          ))}
        </FilterPill>
      )}

      {options.stages.length > 0 && (
        <FilterPill label="Étape" count={filters.stage.length}>
          {options.stages.map(stage => (
            <FilterOption
              key={stage}
              checked={filters.stage.includes(stage)}
              onCheckedChange={(on) => onFiltersChange({ ...filters, stage: toggle(filters.stage, stage, on) })}
            >
              {stage}
            </FilterOption>
          ))}
        </FilterPill>
      )}

      {options.entities.length > 0 && (
        <FilterPill label="Entité" count={filters.entity.length}>
          {options.entities.map(entity => (
            <FilterOption
              key={entity}
              checked={filters.entity.includes(entity)}
              onCheckedChange={(on) => onFiltersChange({ ...filters, entity: toggle(filters.entity, entity, on) })}
            >
              {entity}
            </FilterOption>
          ))}
        </FilterPill>
      )}

      {options.expertise.length > 0 && (
        <FilterPill label="Expertise" count={filters.expertise.length} contentClassName="max-h-72 overflow-y-auto">
          {options.expertise.map(exp => (
            <FilterOption
              key={exp}
              checked={filters.expertise.includes(exp)}
              onCheckedChange={(on) => onFiltersChange({ ...filters, expertise: toggle(filters.expertise, exp, on) })}
            >
              {exp}
            </FilterOption>
          ))}
        </FilterPill>
      )}

      {hasActiveFilters && (
        <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
          <X aria-hidden="true" />
          Effacer les filtres
        </Button>
      )}
    </div>
  );
};
