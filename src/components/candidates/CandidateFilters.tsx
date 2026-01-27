import React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface FilterOptions {
  stages: string[];
  expertise: string[];
  entities: string[];
}

interface Filters {
  search: string;
  stage: string[];
  expertise: string[];
  entity: string[];
}

interface CandidateFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  options: FilterOptions;
}

export const CandidateFilters: React.FC<CandidateFiltersProps> = ({
  filters,
  onFiltersChange,
  options,
}) => {
  const hasActiveFilters = filters.search || filters.stage.length > 0 || 
    filters.expertise.length > 0 || filters.entity.length > 0;

  const clearFilters = () => {
    onFiltersChange({
      search: '',
      stage: [],
      expertise: [],
      entity: [],
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1A1A1A]/40" />
        <Input
          type="text"
          placeholder="Rechercher..."
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="pl-9 w-[200px] h-9 text-sm bg-white border-[#1A1A1A]/10"
        />
      </div>

      {/* Stage filter */}
      <Select
        value={filters.stage[0] || 'all'}
        onValueChange={(value) => onFiltersChange({ ...filters, stage: value === 'all' ? [] : [value] })}
      >
        <SelectTrigger className="w-[140px] h-9 text-sm bg-white border-[#1A1A1A]/10">
          <SelectValue placeholder="Étape" />
        </SelectTrigger>
        <SelectContent className="bg-white">
          <SelectItem value="all">Toutes les étapes</SelectItem>
          {options.stages.map(stage => (
            <SelectItem key={stage} value={stage}>{stage}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Entity filter */}
      <Select
        value={filters.entity[0] || 'all'}
        onValueChange={(value) => onFiltersChange({ ...filters, entity: value === 'all' ? [] : [value] })}
      >
        <SelectTrigger className="w-[120px] h-9 text-sm bg-white border-[#1A1A1A]/10">
          <SelectValue placeholder="Entité" />
        </SelectTrigger>
        <SelectContent className="bg-white">
          <SelectItem value="all">Toutes</SelectItem>
          {options.entities.map(entity => (
            <SelectItem key={entity} value={entity}>{entity}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Expertise filter */}
      <Select
        value={filters.expertise[0] || 'all'}
        onValueChange={(value) => onFiltersChange({ ...filters, expertise: value === 'all' ? [] : [value] })}
      >
        <SelectTrigger className="w-[150px] h-9 text-sm bg-white border-[#1A1A1A]/10">
          <SelectValue placeholder="Expertise" />
        </SelectTrigger>
        <SelectContent className="bg-white max-h-[300px]">
          <SelectItem value="all">Toutes</SelectItem>
          {options.expertise.map(exp => (
            <SelectItem key={exp} value={exp}>{exp}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Clear filters */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="h-9 text-[#1A1A1A]/60 hover:text-[#1A1A1A]"
        >
          <X className="w-4 h-4 mr-1" />
          Effacer
        </Button>
      )}
    </div>
  );
};
