import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Search, Filter, X, Bell } from 'lucide-react';

interface ATSFiltersProps {
  filters: {
    search: string;
    stage: string[];
    source: string[];
    job: string[];
    hasReminder: boolean;
  };
  onFiltersChange: (filters: ATSFiltersProps['filters']) => void;
  options: {
    stages: string[];
    sources: string[];
    jobs: { id: string; title: string }[];
  };
}

const SOURCE_LABELS: Record<string, string> = {
  shortlist: 'Pipeline Notion',
  sequence: 'Séquences',
  inmail: 'InMails',
};

export const ATSFilters: React.FC<ATSFiltersProps> = ({ filters, onFiltersChange, options }) => {
  const activeFiltersCount = 
    filters.stage.length + 
    filters.source.length + 
    filters.job.length + 
    (filters.hasReminder ? 1 : 0);

  const clearAllFilters = () => {
    onFiltersChange({
      search: '',
      stage: [],
      source: [],
      job: [],
      hasReminder: false,
    });
  };

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1A1A1A]/40" />
        <Input
          placeholder="Rechercher un candidat..."
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          className="pl-9 w-64 bg-white"
        />
      </div>

      {/* Stage Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            Étape
            {filters.stage.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                {filters.stage.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-3" align="start">
          <div className="space-y-2">
            {options.stages.map(stage => (
              <label key={stage} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={filters.stage.includes(stage)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onFiltersChange({ ...filters, stage: [...filters.stage, stage] });
                    } else {
                      onFiltersChange({ ...filters, stage: filters.stage.filter(s => s !== stage) });
                    }
                  }}
                />
                <span className="text-sm">{stage}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Source Filter */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            Source
            {filters.source.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                {filters.source.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-3" align="start">
          <div className="space-y-2">
            {options.sources.map(source => (
              <label key={source} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={filters.source.includes(source)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onFiltersChange({ ...filters, source: [...filters.source, source] });
                    } else {
                      onFiltersChange({ ...filters, source: filters.source.filter(s => s !== source) });
                    }
                  }}
                />
                <span className="text-sm">{SOURCE_LABELS[source] || source}</span>
              </label>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Job Filter */}
      {options.jobs.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              Poste
              {filters.job.length > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                  {filters.job.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start">
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {options.jobs.map(job => (
                <label key={job.id} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={filters.job.includes(job.id)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onFiltersChange({ ...filters, job: [...filters.job, job.id] });
                      } else {
                        onFiltersChange({ ...filters, job: filters.job.filter(j => j !== job.id) });
                      }
                    }}
                  />
                  <span className="text-sm truncate">{job.title}</span>
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Reminder filter */}
      <Button
        variant={filters.hasReminder ? 'default' : 'outline'}
        size="sm"
        onClick={() => onFiltersChange({ ...filters, hasReminder: !filters.hasReminder })}
        className="gap-2"
      >
        <Bell className="w-4 h-4" />
        Avec rappel
      </Button>

      {/* Clear all */}
      {activeFiltersCount > 0 && (
        <Button variant="ghost" size="sm" onClick={clearAllFilters} className="gap-1 text-red-600">
          <X className="w-4 h-4" />
          Effacer ({activeFiltersCount})
        </Button>
      )}
    </div>
  );
};
