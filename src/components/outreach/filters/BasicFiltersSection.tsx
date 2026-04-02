import React from 'react';
import {
  FilterPriority,
  PROFILE_LANGUAGES,
  NETWORK_DISTANCES,
  LOCATION_RADIUS_OPTIONS,
} from '../types';
import {
  FilterSection,
  FilterGroup,
  AutocompleteInput,
  SelectedBadges,
  PriorityBadges,
  LocationBadges,
  MultiSelectDropdown,
} from '../FilterComponents';
import { TOP_SCHOOLS } from '../topSchools';
import { isFilterSupported, getFilterTooltip } from '../filterApiSupport';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Sparkles, X, Filter } from 'lucide-react';
import { toast } from 'sonner';
import type {
  FilterSectionBaseProps,
  AutocompleteProps,
  SectionToggleProps,
  SimpleFilterHandlers,
  PriorityFilterHandlers,
  LocationHandlers,
} from './types';

interface BasicFiltersSectionProps
  extends FilterSectionBaseProps,
    AutocompleteProps,
    SectionToggleProps,
    Pick<SimpleFilterHandlers, 'onAddSimpleFilter' | 'onRemoveSimpleFilter'>,
    PriorityFilterHandlers,
    LocationHandlers {
  countBasicFilters: number;
}

export const BasicFiltersSection: React.FC<BasicFiltersSectionProps> = ({
  filters,
  onChange,
  accountId,
  searchInputs,
  parameterOptions,
  loadingParams,
  onSearchInput,
  isOpen,
  onToggle,
  activeFiltersPreview,
  countBasicFilters,
  onAddSimpleFilter,
  onRemoveSimpleFilter,
  onAddPriorityFilter,
  onUpdatePriority,
  onRemovePriorityFilter,
  onAddLocation,
  onRemoveLocation,
  onUpdateLocationPriority,
  onUpdateLocationScope,
}) => {
  return (
    <FilterSection
      id="basic"
      title="Recherche de base"
      icon={<Filter className="w-4 h-4 text-sky-500/80" />}
      badge={countBasicFilters}
      isOpen={isOpen}
      onToggle={onToggle}
      activeFiltersPreview={activeFiltersPreview}
      bgColorClass="bg-sky-50/40"
    >
      {/* Location - with priority and scope for Recruiter */}
      <FilterGroup title="Localisation" badge={filters.location.length}>
        {filters.api === 'recruiter' ? (
          <>
            <LocationBadges
              items={filters.location}
              onRemove={onRemoveLocation}
              onUpdatePriority={onUpdateLocationPriority}
              onUpdateScope={onUpdateLocationScope}
            />
            <AutocompleteInput
              filterKey="location"
              placeholder="Ville, région, pays..."
              value={searchInputs['location'] || ''}
              options={parameterOptions['location'] || []}
              loading={loadingParams === 'location'}
              onInputChange={(val) => onSearchInput('location', val)}
              onSelect={onAddLocation}
            />
          </>
        ) : (
          <>
            <SelectedBadges items={filters.location} onRemove={onRemoveLocation} />
            <AutocompleteInput
              filterKey="location"
              placeholder="Ville, région, pays..."
              value={searchInputs['location'] || ''}
              options={parameterOptions['location'] || []}
              loading={loadingParams === 'location'}
              onInputChange={(val) => onSearchInput('location', val)}
              onSelect={onAddLocation}
            />
          </>
        )}
        {/* Location radius - only for Recruiter when locations are selected */}
        {filters.api === 'recruiter' && filters.location.length > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Rayon de recherche</span>
              <Select
                value={filters.location_within_area?.toString() || 'null'}
                onValueChange={(val) => onChange({
                  ...filters,
                  location_within_area: val === 'null' ? null : parseInt(val)
                })}
              >
                <SelectTrigger className="h-7 w-[160px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background z-[100]" position="popper" sideOffset={4}>
                  {LOCATION_RADIUS_OPTIONS.map((opt) => (
                    <SelectItem
                      key={opt.value?.toString() || 'null'}
                      value={opt.value?.toString() || 'null'}
                      className="text-xs"
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </FilterGroup>

      {/* School - with priority for Recruiter */}
      <FilterGroup
        title="École / Formation"
        badge={filters.school.length}
        unsupported={!isFilterSupported(filters.api, 'school')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'school')}
      >
        {/* Quick add TOP 15 schools button */}
        <div className="flex items-center gap-2 mb-2">
          <Select
            value=""
            onValueChange={(priority: FilterPriority) => {
              if (!priority) return;
              void (async () => {
                if (filters.api !== 'recruiter') {
                  const existingIds = new Set(filters.school.map((s) => s.id));
                  const newSchools = TOP_SCHOOLS
                    .filter((s) => !existingIds.has(s.id))
                    .map((s) => ({ id: s.id, name: s.name, priority }));

                  if (newSchools.length > 0) {
                    onChange({ ...filters, school: [...filters.school, ...newSchools] });
                  }
                  return;
                }

                if (!accountId) {
                  toast.error("Sélectionne d'abord un compte LinkedIn pour résoudre les écoles");
                  return;
                }

                const existingIds = new Set(filters.school.map((s) => s.id));
                toast.info('Résolution des IDs des TOP écoles…');

                const resolved = await Promise.all(
                  TOP_SCHOOLS.map(async (school) => {
                    const { data } = await invokeUnipile({
                      body: {
                        action: 'get_parameters',
                        account_id: accountId,
                        type: 'SCHOOL',
                        service: 'RECRUITER',
                        keywords: school.name,
                        limit: 10,
                      },
                    });

                    if (!data?.success || !Array.isArray(data?.items) || (data.items as any[]).length === 0) {
                      return null;
                    }

                    const target = school.name.trim().toLowerCase();
                    const match =
                      data.items.find((it: any) => String(it.title || '').trim().toLowerCase() === target) ||
                      data.items.find((it: any) => String(it.title || '').trim().toLowerCase().includes(target)) ||
                      data.items[0];

                    if (!match?.id) return null;
                    return { id: String(match.id), name: school.name };
                  })
                );

                const newSchools = resolved
                  .filter((x): x is { id: string; name: string } => Boolean(x))
                  .filter((s) => !existingIds.has(s.id))
                  .map((s) => ({ id: s.id, name: s.name, priority }));

                if (newSchools.length === 0) {
                  toast.message('Aucune nouvelle école ajoutée (déjà présentes ou introuvables)');
                  return;
                }

                onChange({ ...filters, school: [...filters.school, ...newSchools] });
              })();
            }}
          >
            <SelectTrigger className="h-8 text-xs bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200 hover:border-amber-300 w-auto gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-amber-800 font-medium">TOP 15 Écoles</span>
            </SelectTrigger>
            <SelectContent className="bg-popover border shadow-lg z-[3000]">
              <SelectItem value="MUST_HAVE" className="text-xs cursor-pointer">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Must-have (obligatoire)
                </span>
              </SelectItem>
              <SelectItem value="CAN_HAVE" className="text-xs cursor-pointer">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Should-have (valorisé)
                </span>
              </SelectItem>
              <SelectItem value="DOESNT_HAVE" className="text-xs cursor-pointer">
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gray-400" />
                  Exclure ces écoles
                </span>
              </SelectItem>
            </SelectContent>
          </Select>

          {filters.school.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...filters, school: [] })}
              className="h-8 text-xs text-muted-foreground hover:text-destructive"
            >
              <X className="w-3 h-3 mr-1" />
              Tout effacer
            </Button>
          )}
        </div>

        {filters.api === 'recruiter' ? (
          <>
            <PriorityBadges
              items={filters.school}
              onRemove={(id) => onRemovePriorityFilter('school', id)}
              onUpdatePriority={(id, priority) => onUpdatePriority('school', id, priority)}
            />
            <AutocompleteInput
              filterKey="school"
              placeholder="Ou rechercher une école..."
              value={searchInputs['school'] || ''}
              options={parameterOptions['school'] || []}
              loading={loadingParams === 'school'}
              onInputChange={(val) => onSearchInput('school', val)}
              onSelect={(item) => onAddPriorityFilter('school', item)}
              disabled={!isFilterSupported(filters.api, 'school')}
            />
          </>
        ) : (
          <>
            <SelectedBadges items={filters.school} onRemove={(id) => onRemovePriorityFilter('school', id)} />
            <AutocompleteInput
              filterKey="school"
              placeholder="Ou rechercher une école..."
              value={searchInputs['school'] || ''}
              options={parameterOptions['school'] || []}
              loading={loadingParams === 'school'}
              onInputChange={(val) => onSearchInput('school', val)}
              onSelect={(item) => onAddPriorityFilter('school', item)}
              disabled={!isFilterSupported(filters.api, 'school')}
            />
          </>
        )}
      </FilterGroup>

      {/* Profile Languages */}
      <FilterGroup title="Langue du profil" badge={filters.profile_language.length}>
        <MultiSelectDropdown
          options={PROFILE_LANGUAGES.map(l => ({ value: l.value, label: l.label }))}
          selected={filters.profile_language}
          onChange={(selected) => onChange({ ...filters, profile_language: selected as string[] })}
          placeholder="Sélectionner les langues..."
        />
      </FilterGroup>

      {/* Network Distance */}
      <FilterGroup title="Degré de connexion" badge={filters.network_distance.length}>
        <MultiSelectDropdown
          options={NETWORK_DISTANCES.map(d => ({ value: d.value, label: d.label }))}
          selected={filters.network_distance}
          onChange={(selected) => onChange({ ...filters, network_distance: selected as number[] })}
          placeholder="Sélectionner les degrés..."
        />
      </FilterGroup>

      {/* Groups - Sales Navigator */}
      <FilterGroup
        title="Groupes LinkedIn"
        badge={filters.groups.length}
        unsupported={!isFilterSupported(filters.api, 'groups')}
        unsupportedTooltip={getFilterTooltip(filters.api, 'groups')}
      >
        <SelectedBadges items={filters.groups} onRemove={(id) => onRemoveSimpleFilter('groups', id)} />
        <AutocompleteInput
          filterKey="groups"
          placeholder="Rechercher un groupe..."
          value={searchInputs['groups'] || ''}
          options={parameterOptions['groups'] || []}
          loading={loadingParams === 'groups'}
          onInputChange={(val) => onSearchInput('groups', val)}
          onSelect={(item) => onAddSimpleFilter('groups', item)}
          disabled={!isFilterSupported(filters.api, 'groups')}
        />
      </FilterGroup>
    </FilterSection>
  );
};
