import {
  LinkedInFiltersState,
  FilterPriority,
  FilterScope,
  LocationScope,
  RoleFilter,
  FilterItem,
  PriorityFilterItem,
  LocationFilterItem,
} from '../types';
import { ParameterOption } from '../FilterComponents';

// Props communes à toutes les sections de filtres
export interface FilterSectionBaseProps {
  filters: LinkedInFiltersState;
  onChange: (filters: LinkedInFiltersState) => void;
  accountId: string | null;
}

// Autocomplete shared state
export interface AutocompleteProps {
  searchInputs: Record<string, string>;
  parameterOptions: Record<string, ParameterOption[]>;
  loadingParams: string | null;
  onSearchInput: (key: string, value: string) => void;
}

// Section toggle props
export interface SectionToggleProps {
  isOpen: boolean;
  onToggle: () => void;
  activeFiltersPreview: string[];
}

// Handlers shared across sections
export interface SimpleFilterHandlers {
  onAddSimpleFilter: (key: 'company' | 'industry' | 'past_company' | 'function' | 'company_location' | 'groups', item: ParameterOption) => void;
  onRemoveSimpleFilter: (key: 'company' | 'industry' | 'past_company' | 'function' | 'company_location' | 'groups', id: string) => void;
}

export interface PriorityFilterHandlers {
  onAddPriorityFilter: (key: 'job_title' | 'skills' | 'past_job_title' | 'school' | 'degree', item: ParameterOption, priority?: FilterPriority) => void;
  onUpdatePriority: (key: 'job_title' | 'skills' | 'past_job_title' | 'school' | 'degree', id: string, priority: FilterPriority) => void;
  onRemovePriorityFilter: (key: 'job_title' | 'skills' | 'past_job_title' | 'school' | 'degree', id: string) => void;
}

export interface LocationHandlers {
  onAddLocation: (item: ParameterOption) => void;
  onRemoveLocation: (id: string) => void;
  onUpdateLocationPriority: (id: string, priority: FilterPriority) => void;
  onUpdateLocationScope: (id: string, scope: LocationScope) => void;
}
