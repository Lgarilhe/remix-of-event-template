import React from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, X, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ATSFiltersProps {
  filters: {
    search: string;
    stage: string[];
    source: string[];
    job: string[];
    tag: string[];
    hasReminder: boolean;
  };
  onFiltersChange: (filters: ATSFiltersProps['filters']) => void;
  options: {
    stages: string[];
    sources: string[];
    jobs: { id: string; title: string }[];
    tags: string[];
  };
}

const SOURCE_LABELS: Record<string, string> = {
  shortlist: 'Pipeline Notion',
  sequence: 'Séquences',
  inmail: 'InMails',
};

const FilterButton: React.FC<{
  label: string;
  count: number;
  children: React.ReactNode;
}> = ({ label, count, children }) => (
  <Popover>
    <PopoverTrigger asChild>
      <button className={cn(
        "inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[11.5px] font-medium transition-colors shrink-0 whitespace-nowrap",
        count > 0
          ? "bg-foreground text-background border-foreground"
          : "border-border bg-background hover:bg-accent text-foreground",
      )}>
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

export const ATSFilters: React.FC<ATSFiltersProps> = ({ filters, onFiltersChange, options }) => {
  const activeFiltersCount = 
    filters.stage.length + 
    filters.source.length + 
    filters.job.length + 
    filters.tag.length +
    (filters.hasReminder ? 1 : 0);

  const clearAllFilters = () => {
    onFiltersChange({ search: '', stage: [], source: [], job: [], tag: [], hasReminder: false });
  };

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
      {/* Search */}
      <div className="relative shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Rechercher…"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="pl-9 w-48 sm:w-56 rounded-full border-border bg-background text-[12px] h-8"
        />
      </div>

      {/* Stage Filter */}
      <FilterButton label="Étape" count={filters.stage.length}>
        <div className="space-y-2">
          {options.stages.map(stage => (
            <label key={stage} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={filters.stage.includes(stage)}
                onCheckedChange={(checked) => {
                  if (checked) onFiltersChange({ ...filters, stage: [...filters.stage, stage] });
                  else onFiltersChange({ ...filters, stage: filters.stage.filter(s => s !== stage) });
                }}
              />
              {stage}
            </label>
          ))}
        </div>
      </FilterButton>

      {/* Source Filter */}
      <FilterButton label="Source" count={filters.source.length}>
        <div className="space-y-2">
          {options.sources.map(source => (
            <label key={source} className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox
                checked={filters.source.includes(source)}
                onCheckedChange={(checked) => {
                  if (checked) onFiltersChange({ ...filters, source: [...filters.source, source] });
                  else onFiltersChange({ ...filters, source: filters.source.filter(s => s !== source) });
                }}
              />
              {SOURCE_LABELS[source] || source}
            </label>
          ))}
        </div>
      </FilterButton>

      {/* Job Filter */}
      {options.jobs.length > 0 && (
        <FilterButton label="Poste" count={filters.job.length}>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {options.jobs.map(job => (
              <label key={job.id} className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={filters.job.includes(job.id)}
                  onCheckedChange={(checked) => {
                    if (checked) onFiltersChange({ ...filters, job: [...filters.job, job.id] });
                    else onFiltersChange({ ...filters, job: filters.job.filter(j => j !== job.id) });
                  }}
                />
                <span className="truncate">{job.title}</span>
              </label>
            ))}
          </div>
        </FilterButton>
      )}

      {/* Tag Filter */}
      {options.tags.length > 0 && (
        <FilterButton label="Tags" count={filters.tag.length}>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {options.tags.map(tag => (
              <label key={tag} className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox
                  checked={filters.tag.includes(tag)}
                  onCheckedChange={(checked) => {
                    if (checked) onFiltersChange({ ...filters, tag: [...filters.tag, tag] });
                    else onFiltersChange({ ...filters, tag: filters.tag.filter(t => t !== tag) });
                  }}
                />
                <span className="truncate">{tag}</span>
              </label>
            ))}
          </div>
        </FilterButton>
      )}
      <button
        onClick={() => onFiltersChange({ ...filters, hasReminder: !filters.hasReminder })}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[11.5px] font-medium transition-colors shrink-0",
          filters.hasReminder
            ? "bg-foreground text-background border-foreground"
            : "border-border bg-background hover:bg-accent text-foreground",
        )}
      >
        <Bell className="w-3.5 h-3.5" />
        Rappels
      </button>

      {/* Clear all */}
      {activeFiltersCount > 0 && (
        <button
          onClick={clearAllFilters}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-destructive/40 bg-destructive/5 hover:bg-destructive/10 text-destructive text-[11.5px] font-medium transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" />
          Effacer ({activeFiltersCount})
        </button>
      )}
    </div>
  );
};