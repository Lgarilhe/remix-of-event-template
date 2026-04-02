import React, { useMemo } from 'react';
import { SlidersHorizontal, X, Search, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LinkedInFiltersState } from '../types';
import type { Job } from '@/types/jobs';

interface AppliedFiltersBarProps {
  filters: LinkedInFiltersState;
  selectedJob: Job | null;
  searchSource?: 'linkedin' | 'database';
  onSearchSourceChange?: (source: 'linkedin' | 'database') => void;
  onOpenFilters: () => void;
  onRemoveFilter?: (key: string, index?: number) => void;
  onSearch: () => void;
  loading: boolean;
  hasSearched: boolean;
}

interface FilterChip {
  key: string;
  label: string;
  index?: number;
}

function countActiveFilters(filters: LinkedInFiltersState): number {
  let count = 0;
  if (filters.keywords?.trim()) count++;
  if ((filters as any).location?.length) count += (filters as any).location.length;
  if ((filters as any).role?.length) count += (filters as any).role.length;
  if ((filters as any).skills?.length) count += (filters as any).skills.length;
  if ((filters as any).seniority_level?.length) count++;
  if ((filters as any).company?.length) count += (filters as any).company.length;
  if ((filters as any).calculated_experience_min || (filters as any).calculated_experience_max) count++;
  if ((filters as any).industry?.length) count += (filters as any).industry.length;
  if ((filters as any).school?.length) count += (filters as any).school.length;
  if ((filters as any).network_distance) count++;
  return count;
}

function extractChips(filters: LinkedInFiltersState, max: number = 6): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.keywords?.trim()) {
    chips.push({ key: 'keywords', label: `"${filters.keywords.slice(0, 30)}${filters.keywords.length > 30 ? '…' : ''}"` });
  }
  if ((filters as any).location?.length) {
    (filters as any).location.forEach((loc: any, i: number) => {
      if (chips.length < max) chips.push({ key: 'location', label: loc.name || loc, index: i });
    });
  }
  if ((filters as any).role?.length) {
    (filters as any).role.forEach((r: any, i: number) => {
      if (chips.length < max) chips.push({ key: 'role', label: r.keywords || r, index: i });
    });
  }
  if ((filters as any).skills?.length) {
    (filters as any).skills.forEach((s: string, i: number) => {
      if (chips.length < max) chips.push({ key: 'skills', label: s, index: i });
    });
  }
  if ((filters as any).company?.length) {
    (filters as any).company.forEach((c: any, i: number) => {
      if (chips.length < max) chips.push({ key: 'company', label: c.name || c, index: i });
    });
  }

  return chips;
}

export const AppliedFiltersBar: React.FC<AppliedFiltersBarProps> = ({
  filters,
  selectedJob,
  searchSource = 'linkedin',
  onSearchSourceChange,
  onOpenFilters,
  onRemoveFilter,
  onSearch,
  loading,
  hasSearched,
}) => {
  const activeCount = useMemo(() => countActiveFilters(filters), [filters]);
  const chips = useMemo(() => extractChips(filters), [filters]);

  return (
    <div className="flex flex-col gap-2 mb-4">
      {/* Main bar */}
      <div className="flex items-center gap-2">
        {/* Source toggle */}
        {onSearchSourceChange && (
          <div className="flex items-center border border-border rounded-lg overflow-hidden shrink-0">
            <button
              onClick={() => onSearchSourceChange('linkedin')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                searchSource === 'linkedin'
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Search className="w-3 h-3" />
              LinkedIn
            </button>
            <button
              onClick={() => onSearchSourceChange('database')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
                searchSource === 'database'
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Database className="w-3 h-3" />
              Base
            </button>
          </div>
        )}

        {/* Filters trigger button */}
        <button
          onClick={onOpenFilters}
          className={cn(
            "flex items-center gap-2 px-4 py-1.5 rounded-lg border border-border transition-colors",
            "hover:bg-accent text-foreground",
            activeCount > 0 && "border-primary/30"
          )}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wider">Filtres</span>
          {activeCount > 0 && (
            <span className="min-w-[20px] h-5 flex items-center justify-center px-1.5 text-[10px] font-bold bg-primary text-primary-foreground rounded-full">
              {activeCount}
            </span>
          )}
        </button>

        {/* Job context */}
        {selectedJob && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-xs text-muted-foreground truncate max-w-[200px]">
            <span className="truncate">{selectedJob.title}</span>
          </div>
        )}

        {/* Search button */}
        <button
          onClick={onSearch}
          disabled={loading}
          className={cn(
            "ml-auto flex items-center gap-2 px-5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors",
            "bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50"
          )}
        >
          {loading ? (
            <span className="w-3 h-3 border-2 border-background/30 border-t-background rounded-full animate-spin" />
          ) : (
            <Search className="w-3.5 h-3.5" />
          )}
          Rechercher
        </button>
      </div>

      {/* Filter chips */}
      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {chips.map((chip, idx) => (
            <span
              key={`${chip.key}-${chip.index ?? idx}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-xs text-muted-foreground shrink-0 border border-border/50"
            >
              <span className="truncate max-w-[120px]">{chip.label}</span>
              {onRemoveFilter && (
                <button
                  onClick={() => onRemoveFilter(chip.key, chip.index)}
                  className="hover:text-foreground transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          ))}
          {activeCount > chips.length && (
            <button
              onClick={onOpenFilters}
              className="text-xs text-primary hover:text-primary/80 shrink-0"
            >
              +{activeCount - chips.length} autres
            </button>
          )}
        </div>
      )}
    </div>
  );
};
