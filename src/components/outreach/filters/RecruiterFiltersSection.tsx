import React from 'react';
import {
  ActivityMessageType,
  ActivityNoteType,
  SPOTLIGHT_OPTIONS,
  OPEN_TO_OPTIONS_CLASSIC,
  OPEN_TO_OPTIONS_RECRUITER,
  ACTIVITY_MESSAGE_OPTIONS,
  ACTIVITY_NOTE_OPTIONS,
  ACTIVITY_DAYS_OPTIONS,
} from '../types';
import {
  FilterSection,
  FilterGroup,
  MultiSelectDropdown,
} from '../FilterComponents';
import { isFilterSupported, getFilterTooltip } from '../filterApiSupport';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Target } from 'lucide-react';
import type { FilterSectionBaseProps, SectionToggleProps } from './types';

interface RecruiterFiltersSectionProps extends FilterSectionBaseProps, SectionToggleProps {
  countRecruiterFilters: number;
}

export const RecruiterFiltersSection: React.FC<RecruiterFiltersSectionProps> = ({
  filters,
  onChange,
  isOpen,
  onToggle,
  activeFiltersPreview,
  countRecruiterFilters,
}) => {
  return (
    <FilterSection
      id="recruiter"
      title="Filtres avancés (Recruiter)"
      icon={<Target className="w-4 h-4 text-rose-500/80" />}
      badge={countRecruiterFilters}
      isOpen={isOpen}
      onToggle={onToggle}
      activeFiltersPreview={activeFiltersPreview}
      bgColorClass="bg-destructive/5"
    >
      {/* Open to Work */}
      <FilterGroup
        title="Open to Work"
        unsupported={!isFilterSupported(filters.api, 'open_to_work')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'open_to_work')}
      >
        <div className={`flex items-center justify-between p-2 bg-success/10 rounded-lg ${!isFilterSupported(filters.api, 'open_to_work') ? 'opacity-50' : ''}`}>
          <span className="text-sm text-green-400">Profils Open to Work uniquement</span>
          <Switch
            checked={filters.open_to_work === true}
            onCheckedChange={(checked) =>
              onChange({
                ...filters,
                open_to_work: checked ? true : null,
              })
            }
            disabled={!isFilterSupported(filters.api, 'open_to_work')}
          />
        </div>
      </FilterGroup>

      {/* Open to types */}
      <FilterGroup
        title="Open to (type)"
        badge={filters.open_to.length}
        unsupported={!isFilterSupported(filters.api, 'open_to')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'open_to')}
      >
        <MultiSelectDropdown
          options={(filters.api === 'classic' ? OPEN_TO_OPTIONS_CLASSIC : OPEN_TO_OPTIONS_RECRUITER).map(o => ({ value: o.value, label: o.label }))}
          selected={filters.open_to}
          onChange={(selected) => onChange({ ...filters, open_to: selected as typeof filters.open_to })}
          placeholder="Sélectionner les types..."
          disabled={!isFilterSupported(filters.api, 'open_to')}
        />
      </FilterGroup>

      {/* Spotlight */}
      <FilterGroup
        title="Spotlight"
        unsupported={!isFilterSupported(filters.api, 'spotlight')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'spotlight')}
      >
        <Select
          value={filters.spotlight || '_empty'}
          onValueChange={(v) => onChange({ ...filters, spotlight: v === '_empty' ? '' : v as typeof filters.spotlight })}
          disabled={!isFilterSupported(filters.api, 'spotlight')}
        >
          <SelectTrigger className={`text-sm h-9 ${!isFilterSupported(filters.api, 'spotlight') ? 'opacity-50' : ''}`}>
            <SelectValue placeholder="Tous les profils" />
          </SelectTrigger>
          <SelectContent>
            {SPOTLIGHT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value || '_empty'} value={opt.value || '_empty'} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterGroup>

      {/* Hiring Project */}
      <FilterGroup
        title="Hiring Project (ID)"
        unsupported={!isFilterSupported(filters.api, 'hiring_project')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'hiring_project')}
      >
        <Input
          value={filters.hiring_project}
          onChange={(e) => onChange({ ...filters, hiring_project: e.target.value })}
          placeholder="ID du projet de recrutement"
          className={`text-sm h-8 ${!isFilterSupported(filters.api, 'hiring_project') ? 'opacity-50' : ''}`}
          disabled={!isFilterSupported(filters.api, 'hiring_project')}
        />
      </FilterGroup>

      {/* Talent Pool */}
      <FilterGroup
        title="Talent Pool (ID)"
        unsupported={!isFilterSupported(filters.api, 'talent_pool')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'talent_pool')}
      >
        <Input
          value={filters.talent_pool}
          onChange={(e) => onChange({ ...filters, talent_pool: e.target.value })}
          placeholder="ID du pool de talents"
          className={`text-sm h-8 ${!isFilterSupported(filters.api, 'talent_pool') ? 'opacity-50' : ''}`}
          disabled={!isFilterSupported(filters.api, 'talent_pool')}
        />
      </FilterGroup>

      {/* Activity: Messages */}
      <FilterGroup
        title="Activité - Messages"
        unsupported={!isFilterSupported(filters.api, 'activity')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'activity')}
      >
        <div className="space-y-2">
          <Select
            value={filters.activity_messages || '_none'}
            onValueChange={(v) => onChange({
              ...filters,
              activity_messages: v === '_none' ? null : v as ActivityMessageType,
              activity_messages_days: v === '_none' ? null : filters.activity_messages_days
            })}
            disabled={!isFilterSupported(filters.api, 'activity')}
          >
            <SelectTrigger className={`text-sm h-9 ${!isFilterSupported(filters.api, 'activity') ? 'opacity-50' : ''}`}>
              <SelectValue placeholder="Tous les profils" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none" className="text-xs">Tous les profils</SelectItem>
              {ACTIVITY_MESSAGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filters.activity_messages && (
            <Select
              value={filters.activity_messages_days?.toString() || '_all'}
              onValueChange={(v) => onChange({
                ...filters,
                activity_messages_days: v === '_all' ? null : parseInt(v)
              })}
              disabled={!isFilterSupported(filters.api, 'activity')}
            >
              <SelectTrigger className="text-sm h-8 bg-brand-purple/10 border-purple-800">
                <SelectValue placeholder="Période..." />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_DAYS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value?.toString() || '_all'} value={opt.value?.toString() || '_all'} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </FilterGroup>

      {/* Activity: Notes */}
      <FilterGroup
        title="Activité - Notes"
        unsupported={!isFilterSupported(filters.api, 'activity')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'activity')}
      >
        <div className="space-y-2">
          <Select
            value={filters.activity_notes || '_none'}
            onValueChange={(v) => onChange({
              ...filters,
              activity_notes: v === '_none' ? null : v as ActivityNoteType,
              activity_notes_days: v === '_none' ? null : filters.activity_notes_days
            })}
            disabled={!isFilterSupported(filters.api, 'activity')}
          >
            <SelectTrigger className={`text-sm h-9 ${!isFilterSupported(filters.api, 'activity') ? 'opacity-50' : ''}`}>
              <SelectValue placeholder="Tous les profils" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none" className="text-xs">Tous les profils</SelectItem>
              {ACTIVITY_NOTE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filters.activity_notes && (
            <Select
              value={filters.activity_notes_days?.toString() || '_all'}
              onValueChange={(v) => onChange({
                ...filters,
                activity_notes_days: v === '_all' ? null : parseInt(v)
              })}
              disabled={!isFilterSupported(filters.api, 'activity')}
            >
              <SelectTrigger className="text-sm h-8 bg-brand-purple/10 border-purple-800">
                <SelectValue placeholder="Période..." />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_DAYS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value?.toString() || '_all'} value={opt.value?.toString() || '_all'} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </FilterGroup>

      {/* Tags */}
      <FilterGroup
        title="Tags"
        badge={filters.tags.length}
        unsupported={!isFilterSupported(filters.api, 'tags')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'tags')}
      >
        <div className={`space-y-2 ${!isFilterSupported(filters.api, 'tags') ? 'opacity-50 pointer-events-none' : ''}`}>
          {filters.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {filters.tags.map((tag, index) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className="gap-1 pr-1 bg-purple-100 text-purple-700 hover:bg-purple-200 text-xs"
                >
                  <span className="max-w-[150px] truncate">{tag}</span>
                  <button
                    type="button"
                    onClick={() => onChange({ ...filters, tags: filters.tags.filter((_, i) => i !== index) })}
                    className="ml-0.5 hover:bg-purple-300 rounded-full p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          <Input
            placeholder="Ajouter un tag (Entrée pour valider)..."
            className="text-sm h-8"
            disabled={!isFilterSupported(filters.api, 'tags')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const input = e.currentTarget;
                const value = input.value.trim();
                if (value && !filters.tags.includes(value)) {
                  onChange({ ...filters, tags: [...filters.tags, value] });
                  input.value = '';
                }
                e.preventDefault();
              }
            }}
          />
        </div>
      </FilterGroup>
    </FilterSection>
  );
};
