import React, { useState, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { invokeUnipile } from '@/lib/invokeUnipile';
import {
  LinkedInFiltersState,
  FilterItem,
  PriorityFilterItem,
  LocationFilterItem,
  RoleFilter,
  FilterPriority,
  FilterScope,
  LocationScope,
  CompanyKeywordFilter,
  SENIORITY_LEVELS,
  NETWORK_DISTANCES,
  PRIORITY_OPTIONS,
  SPOTLIGHT_OPTIONS,
  PROFILE_LANGUAGES,
  COMPANY_HEADCOUNT_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  OPEN_TO_OPTIONS_CLASSIC,
  ACTIVITY_MESSAGE_OPTIONS,
  ACTIVITY_NOTE_OPTIONS,
} from './types';
import {
  FilterSection,
  FilterGroup,
  AutocompleteInput,
  SelectedBadges,
  PriorityBadges,
  ParameterOption,
  MultiSelectDropdown,
} from './FilterComponents';
import { CompanyFilter } from './CompanyFilter';
import { isFilterSupported, getFilterTooltip } from './filterApiSupport';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  X,
  Sparkles,
  Clock,
  Building2,
  History,
} from 'lucide-react';
import { toast } from 'sonner';

import { BasicFiltersSection } from './filters/BasicFiltersSection';
import { PositionFiltersSection } from './filters/PositionFiltersSection';
import { RecruiterFiltersSection } from './filters/RecruiterFiltersSection';

interface LinkedInFiltersProps {
  filters: LinkedInFiltersState;
  onChange: (filters: LinkedInFiltersState) => void;
  accountId: string | null;
}

export const LinkedInFilters: React.FC<LinkedInFiltersProps> = ({
  filters,
  onChange,
  accountId,
}) => {
  // Section open states
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    basic: false,
    position: false,
    experience: false,
    company: false,
    past: false,
    recruiter: false,
  });

  // Autocomplete states
  const [loadingParams, setLoadingParams] = useState<string | null>(null);
  const [parameterOptions, setParameterOptions] = useState<Record<string, ParameterOption[]>>({});
  const [searchInputs, setSearchInputs] = useState<Record<string, string>>({});
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const abortControllerRef = useRef<Record<string, AbortController>>({});

  // Role filter state
  const [newRoleKeywords, setNewRoleKeywords] = useState('');
  const [newRolePriority, setNewRolePriority] = useState<FilterPriority>('MUST_HAVE');
  const [newRoleScope, setNewRoleScope] = useState<FilterScope>('CURRENT_OR_PAST');
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [roleDialogDraft, setRoleDialogDraft] = useState('');
  const [editingRoleIndex, setEditingRoleIndex] = useState<number | null>(null);
  const [roleDialogPriority, setRoleDialogPriority] = useState<FilterPriority>('MUST_HAVE');
  const [roleDialogScope, setRoleDialogScope] = useState<FilterScope>('CURRENT_OR_PAST');

  const toggleSection = useCallback((section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // ── Parameter fetching ──

  const getParameterType = useCallback((key: string): string => {
    const typeMap: Record<string, string> = {
      location: 'LOCATION',
      company: 'COMPANY',
      past_company: 'COMPANY',
      job_title: 'JOB_TITLE',
      past_job_title: 'JOB_TITLE',
      industry: 'INDUSTRY',
      school: 'SCHOOL',
      skills: 'SKILL',
      service: 'SERVICE',
      connections_of: 'CONNECTIONS',
      followers_of: 'PEOPLE',
      function: 'DEPARTMENT',
      company_location: 'REGION',
      groups: 'GROUPS',
      degree: 'DEGREE',
      tags: 'TAGS',
    };
    return typeMap[key] || key.toUpperCase();
  }, []);

  const fetchParameters = useCallback(
    async (key: string, keywords: string) => {
      if (!accountId || !keywords.trim() || keywords.length < 2) {
        setParameterOptions((prev) => ({ ...prev, [key]: [] }));
        return;
      }

      if (abortControllerRef.current[key]) {
        abortControllerRef.current[key].abort();
      }
      abortControllerRef.current[key] = new AbortController();

      setLoadingParams(key);
      try {
        const paramType = getParameterType(key);

        const { data } = await invokeUnipile({
          body: {
            action: 'get_parameters',
            account_id: accountId,
            type: paramType,
            keywords: keywords.trim(),
            service: filters.api === 'classic' ? 'CLASSIC' : filters.api === 'sales_navigator' ? 'SALES_NAVIGATOR' : 'RECRUITER',
          },
        });

        if (abortControllerRef.current[key]?.signal.aborted) return;

        if (!data?.success) {
          setParameterOptions((prev) => ({ ...prev, [key]: [] }));
          return;
        }

        let items: ParameterOption[] = (data.items as ParameterOption[]) || [];

        if (key === 'location') {
          const KNOWN_COUNTRIES: ParameterOption[] = [
            { id: '105015875', title: 'France' },
            { id: '101165590', title: 'United Kingdom' },
            { id: '101174742', title: 'Germany' },
            { id: '102713980', title: 'India' },
            { id: '103644278', title: 'United States' },
            { id: '106155005', title: 'Spain' },
            { id: '103350119', title: 'Italy' },
            { id: '100565514', title: 'Belgium' },
            { id: '103883259', title: 'Switzerland' },
            { id: '102890719', title: 'Netherlands' },
            { id: '100364837', title: 'Portugal' },
            { id: '104738515', title: 'Canada' },
            { id: '101620260', title: 'Australia' },
            { id: '102478259', title: 'Singapore' },
            { id: '104305776', title: 'Luxembourg' },
            { id: '105646813', title: 'Morocco' },
          ];
          const normalizedQuery = keywords.trim().toLowerCase();
          const existingIds = new Set(items.map(i => i.id));
          const matchingCountries = KNOWN_COUNTRIES.filter(c =>
            c.title.toLowerCase().includes(normalizedQuery) && !existingIds.has(c.id)
          );
          if (matchingCountries.length > 0) {
            items = [...matchingCountries, ...items];
          }
        }

        setParameterOptions((prev) => ({ ...prev, [key]: items }));
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.error('Error fetching parameters:', error);
        setParameterOptions((prev) => ({ ...prev, [key]: [] }));
      } finally {
        setLoadingParams(null);
      }
    },
    [accountId, filters.api, getParameterType]
  );

  const handleSearchInput = useCallback((key: string, value: string) => {
    setSearchInputs((prev) => ({ ...prev, [key]: value }));

    if (debounceRef.current[key]) {
      clearTimeout(debounceRef.current[key]);
    }

    if (abortControllerRef.current[key]) {
      abortControllerRef.current[key].abort();
    }

    if (value.length >= 2) {
      debounceRef.current[key] = setTimeout(() => {
        fetchParameters(key, value);
      }, 500);
    } else {
      setParameterOptions((prev) => ({ ...prev, [key]: [] }));
    }
  }, [fetchParameters]);

  // ── Filter handlers ──

  const handleAddSimpleFilter = useCallback((key: 'company' | 'industry' | 'past_company' | 'function' | 'company_location' | 'groups', item: ParameterOption) => {
    const current = filters[key] as FilterItem[];
    if (!current.find((f) => f.id === item.id)) {
      onChange({ ...filters, [key]: [...current, { id: item.id, name: item.title }] });
    }
    setSearchInputs((prev) => ({ ...prev, [key]: '' }));
    setParameterOptions((prev) => ({ ...prev, [key]: [] }));
  }, [filters, onChange]);

  const handleRemoveSimpleFilter = useCallback((key: 'company' | 'industry' | 'past_company' | 'function' | 'company_location' | 'groups', id: string) => {
    onChange({ ...filters, [key]: (filters[key] as FilterItem[]).filter((f) => f.id !== id) });
  }, [filters, onChange]);

  const handleAddLocation = useCallback((item: ParameterOption) => {
    const current = filters.location;
    if (!current.find((f) => f.id === item.id)) {
      const newLocation: LocationFilterItem = {
        id: item.id,
        name: item.title,
        priority: 'MUST_HAVE',
        scope: 'CURRENT_OR_OPEN_TO_RELOCATE'
      };
      onChange({ ...filters, location: [...current, newLocation] });
    }
    setSearchInputs((prev) => ({ ...prev, location: '' }));
    setParameterOptions((prev) => ({ ...prev, location: [] }));
  }, [filters, onChange]);

  const handleRemoveLocation = useCallback((id: string) => {
    onChange({ ...filters, location: filters.location.filter((f) => f.id !== id) });
  }, [filters, onChange]);

  const handleUpdateLocationPriority = useCallback((id: string, priority: FilterPriority) => {
    onChange({
      ...filters,
      location: filters.location.map((f) => (f.id === id ? { ...f, priority } : f)),
    });
  }, [filters, onChange]);

  const handleUpdateLocationScope = useCallback((id: string, scope: LocationScope) => {
    onChange({
      ...filters,
      location: filters.location.map((f) => (f.id === id ? { ...f, scope } : f)),
    });
  }, [filters, onChange]);

  const handleAddPriorityFilter = useCallback((
    key: 'job_title' | 'skills' | 'past_job_title' | 'school' | 'degree',
    item: ParameterOption,
    priority: FilterPriority = 'MUST_HAVE'
  ) => {
    const current = filters[key];
    if (!current.find((f) => f.id === item.id)) {
      onChange({ ...filters, [key]: [...current, { id: item.id, name: item.title, priority }] });
    }
    setSearchInputs((prev) => ({ ...prev, [key]: '' }));
    setParameterOptions((prev) => ({ ...prev, [key]: [] }));
  }, [filters, onChange]);

  const handleUpdatePriority = useCallback((key: 'job_title' | 'skills' | 'past_job_title' | 'school' | 'degree', id: string, priority: FilterPriority) => {
    onChange({
      ...filters,
      [key]: filters[key].map((f) => (f.id === id ? { ...f, priority } : f)),
    });
  }, [filters, onChange]);

  const handleRemovePriorityFilter = useCallback((key: 'job_title' | 'skills' | 'past_job_title' | 'school' | 'degree', id: string) => {
    onChange({ ...filters, [key]: filters[key].filter((f) => f.id !== id) });
  }, [filters, onChange]);

  const handleRemoveRole = useCallback((index: number) => {
    onChange({ ...filters, role: filters.role.filter((_, i) => i !== index) });
  }, [filters, onChange]);

  const handleUpdateRole = useCallback((index: number, updates: Partial<RoleFilter>) => {
    onChange({
      ...filters,
      role: filters.role.map((r, i) => (i === index ? { ...r, ...updates } : r)),
    });
  }, [filters, onChange]);

  const handleAddCompanyKeyword = useCallback((company: CompanyKeywordFilter) => {
    onChange({ ...filters, company_keywords: [...filters.company_keywords, company] });
  }, [filters, onChange]);

  const handleRemoveCompanyKeyword = useCallback((index: number) => {
    onChange({ ...filters, company_keywords: filters.company_keywords.filter((_, i) => i !== index) });
  }, [filters, onChange]);

  const handleUpdateCompanyKeyword = useCallback((index: number, updates: Partial<CompanyKeywordFilter>) => {
    onChange({
      ...filters,
      company_keywords: filters.company_keywords.map((c, i) => (i === index ? { ...c, ...updates } : c)),
    });
  }, [filters, onChange]);

  // ── Filter counts ──

  const countBasicFilters = filters.location.length + filters.school.length + filters.profile_language.length + filters.network_distance.length + filters.groups.length;
  const countPositionFilters = filters.job_title.length + filters.role.length + filters.skills.length + filters.seniority.length + filters.function.length + filters.degree.length;
  const countExperienceFilters = (filters.years_of_experience_min !== null ? 1 : 0) + (filters.years_of_experience_max !== null ? 1 : 0) +
    (filters.calculated_experience_min !== null ? 1 : 0) + (filters.calculated_experience_max !== null ? 1 : 0) +
    (filters.tenure_at_company_min !== null ? 1 : 0) + (filters.tenure_at_company_max !== null ? 1 : 0) +
    (filters.tenure_at_role_min !== null ? 1 : 0) + (filters.tenure_at_role_max !== null ? 1 : 0);
  const countCompanyFilters = filters.company.length + filters.company_keywords.length + filters.industry.length + filters.company_headcount.length + filters.company_type.length + filters.company_location.length;
  const countPastFilters = filters.past_company.length + filters.past_job_title.length;
  const countRecruiterFilters = (filters.spotlight ? 1 : 0) + (filters.hiring_project ? 1 : 0) +
    (filters.open_to_work === true ? 1 : 0) + filters.open_to.length +
    (filters.activity_messages ? 1 : 0) + (filters.activity_notes ? 1 : 0) + filters.tags.length;

  // ── Filter previews ──

  const basicFiltersPreview: string[] = [
    ...(filters.location || []).map(f => f.name),
    ...(filters.school || []).map(f => f.name),
    ...(filters.profile_language || []).map(l => PROFILE_LANGUAGES.find(pl => pl.value === l)?.label || l),
    ...(filters.network_distance || []).map(d => NETWORK_DISTANCES.find(nd => nd.value === d)?.label || String(d)),
    ...(filters.groups || []).map(f => f.name),
  ];

  const positionFiltersPreview = [
    ...(filters.job_title || []).map(f => f.name),
    ...(filters.role || []).map(r => r.keywords),
    ...(filters.skills || []).map(f => f.name),
    ...(filters.seniority || []).map(s => SENIORITY_LEVELS.find(sl => sl.value === s)?.label || s),
    ...(filters.function || []).map(f => f.name),
    ...(filters.degree || []).map(d => d.name),
  ];

  const experienceFiltersPreview = [
    ...(filters.calculated_experience_min !== null || filters.calculated_experience_max !== null
      ? [`Exp (calculée): ${filters.calculated_experience_min ?? 0}-${filters.calculated_experience_max ?? '∞'} ans`]
      : []),
    ...(filters.years_of_experience_min !== null || filters.years_of_experience_max !== null
      ? [`Exp (LinkedIn): ${filters.years_of_experience_min ?? 0}-${filters.years_of_experience_max ?? '∞'} ans`]
      : []),
    ...(filters.tenure_at_company_min !== null || filters.tenure_at_company_max !== null
      ? [`Ancienneté: ${filters.tenure_at_company_min ?? 0}-${filters.tenure_at_company_max ?? '∞'} ans`]
      : []),
  ];

  const companyFiltersPreview = [
    ...(filters.company || []).map(f => f.name),
    ...(filters.company_keywords || []).map(c => c.keywords),
    ...(filters.industry || []).map(f => f.name),
    ...(filters.company_headcount || []).map(h => COMPANY_HEADCOUNT_OPTIONS.find(ch => ch.value === h)?.label || h),
    ...(filters.company_type || []).map(t => COMPANY_TYPE_OPTIONS.find(ct => ct.value === t)?.label || t),
    ...(filters.company_location || []).map(f => f.name),
  ];

  const pastFiltersPreview = [
    ...(filters.past_company || []).map(f => f.name),
    ...(filters.past_job_title || []).map(f => f.name),
  ];

  const recruiterFiltersPreview = [
    ...(filters.open_to_work === true ? ['Open to Work'] : []),
    ...(filters.open_to || []).map(o => OPEN_TO_OPTIONS_CLASSIC.find(oo => oo.value === o)?.label || o),
    ...(filters.spotlight ? [SPOTLIGHT_OPTIONS.find(s => s.value === filters.spotlight)?.label || 'Spotlight'] : []),
    ...(filters.hiring_project ? ['Hiring Project'] : []),
    ...(filters.activity_messages ? [
      `${ACTIVITY_MESSAGE_OPTIONS.find(a => a.value === filters.activity_messages)?.label || filters.activity_messages}${
        filters.activity_messages_days ? ` (${filters.activity_messages_days}j)` : ''
      }`
    ] : []),
    ...(filters.activity_notes ? [
      `${ACTIVITY_NOTE_OPTIONS.find(a => a.value === filters.activity_notes)?.label || filters.activity_notes}${
        filters.activity_notes_days ? ` (${filters.activity_notes_days}j)` : ''
      }`
    ] : []),
    ...(filters.tags || []),
  ];

  // AI filters reset
  const hasAiFilters = filters.role.length > 0 ||
    filters.company_keywords.length > 0 ||
    filters.school.length > 0 ||
    filters.keywords.length > 0;

  const handleResetAiFilters = useCallback(() => {
    onChange({
      ...filters,
      keywords: '',
      role: [],
      company_keywords: [],
      school: [],
      seniority: [],
      calculated_experience_min: null,
      calculated_experience_max: null,
      years_of_experience_min: null,
      years_of_experience_max: null,
      location_within_area: null,
      spotlight: '',
      open_to_work: null,
    });
    toast.success('Filtres IA réinitialisés');
  }, [filters, onChange]);

  // Shared autocomplete props
  const autocompleteProps = {
    searchInputs,
    parameterOptions,
    loadingParams,
    onSearchInput: handleSearchInput,
  };

  return (
    <div className="h-[calc(100vh-220px)] bg-background border border-border overflow-y-auto">
      <div>
        {/* ===== BASIC / GEOGRAPHIC FILTERS (extracted) ===== */}
        <BasicFiltersSection
          filters={filters}
          onChange={onChange}
          accountId={accountId}
          {...autocompleteProps}
          isOpen={openSections.basic}
          onToggle={() => toggleSection('basic')}
          activeFiltersPreview={basicFiltersPreview}
          countBasicFilters={countBasicFilters}
          onAddSimpleFilter={handleAddSimpleFilter}
          onRemoveSimpleFilter={handleRemoveSimpleFilter}
          onAddPriorityFilter={handleAddPriorityFilter}
          onUpdatePriority={handleUpdatePriority}
          onRemovePriorityFilter={handleRemovePriorityFilter}
          onAddLocation={handleAddLocation}
          onRemoveLocation={handleRemoveLocation}
          onUpdateLocationPriority={handleUpdateLocationPriority}
          onUpdateLocationScope={handleUpdateLocationScope}
        />

        {/* ===== POSITION / ROLE FILTERS (extracted) ===== */}
        <PositionFiltersSection
          filters={filters}
          onChange={onChange}
          accountId={accountId}
          {...autocompleteProps}
          isOpen={openSections.position}
          onToggle={() => toggleSection('position')}
          activeFiltersPreview={positionFiltersPreview}
          countPositionFilters={countPositionFilters}
          onAddSimpleFilter={handleAddSimpleFilter}
          onRemoveSimpleFilter={handleRemoveSimpleFilter}
          onAddPriorityFilter={handleAddPriorityFilter}
          onUpdatePriority={handleUpdatePriority}
          onRemovePriorityFilter={handleRemovePriorityFilter}
          newRoleKeywords={newRoleKeywords}
          onNewRoleKeywordsChange={setNewRoleKeywords}
          newRolePriority={newRolePriority}
          onNewRolePriorityChange={setNewRolePriority}
          newRoleScope={newRoleScope}
          onNewRoleScopeChange={setNewRoleScope}
          roleDialogOpen={roleDialogOpen}
          onRoleDialogOpenChange={setRoleDialogOpen}
          roleDialogDraft={roleDialogDraft}
          onRoleDialogDraftChange={setRoleDialogDraft}
          roleDialogPriority={roleDialogPriority}
          onRoleDialogPriorityChange={setRoleDialogPriority}
          roleDialogScope={roleDialogScope}
          onRoleDialogScopeChange={setRoleDialogScope}
          editingRoleIndex={editingRoleIndex}
          onEditingRoleIndexChange={setEditingRoleIndex}
          onRemoveRole={handleRemoveRole}
          onUpdateRole={handleUpdateRole}
        />

        {/* ===== EXPERIENCE / TENURE FILTERS (inline) ===== */}
        <FilterSection
          id="experience"
          title="Expérience & Ancienneté"
          icon={<Clock className="w-4 h-4 text-orange-500/80" />}
          badge={countExperienceFilters}
          isOpen={openSections.experience}
          onToggle={() => toggleSection('experience')}
          activeFiltersPreview={experienceFiltersPreview}
          bgColorClass="bg-warning/5"
        >
          {/* Calculated Experience */}
          <FilterGroup
            title="Expérience calculée (depuis diplôme)"
            badge={(filters.calculated_experience_min !== null || filters.calculated_experience_max !== null) ? 1 : 0}
          >
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                ✨ Filtre plus fiable basé sur l'année de fin d'études
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground uppercase">Min (ans)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={filters.calculated_experience_min ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...filters,
                        calculated_experience_min: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    placeholder="0"
                    className="text-sm h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase">Max (ans)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={filters.calculated_experience_max ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...filters,
                        calculated_experience_max: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    placeholder="50"
                    className="text-sm h-8"
                  />
                </div>
              </div>
            </div>
          </FilterGroup>

          {/* Years of Experience (LinkedIn API) */}
          <FilterGroup
            title="Années d'expérience (LinkedIn API)"
            unsupported={!isFilterSupported(filters.api, 'years_of_experience')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'years_of_experience')}
          >
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                ⚠️ Filtre LinkedIn (peut être peu fiable)
              </p>
              <div className={`grid grid-cols-2 gap-2 ${!isFilterSupported(filters.api, 'years_of_experience') ? 'opacity-50 pointer-events-none' : ''}`}>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase">Min (ans)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={filters.years_of_experience_min ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...filters,
                        years_of_experience_min: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    placeholder="0"
                    className="text-sm h-8"
                    disabled={!isFilterSupported(filters.api, 'years_of_experience')}
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase">Max (ans)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={filters.years_of_experience_max ?? ''}
                    onChange={(e) =>
                      onChange({
                        ...filters,
                        years_of_experience_max: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    placeholder="50"
                    className="text-sm h-8"
                    disabled={!isFilterSupported(filters.api, 'years_of_experience')}
                  />
                </div>
              </div>
            </div>
          </FilterGroup>

          {/* Tenure at Company */}
          <FilterGroup
            title="Ancienneté dans l'entreprise actuelle"
            unsupported={!isFilterSupported(filters.api, 'tenure_at_company')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'tenure_at_company')}
          >
            <div className={`grid grid-cols-2 gap-2 ${!isFilterSupported(filters.api, 'tenure_at_company') ? 'opacity-50 pointer-events-none' : ''}`}>
              <div>
                <Label className="text-xs text-muted-foreground uppercase">Min (années)</Label>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={filters.tenure_at_company_min ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      tenure_at_company_min: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
                  placeholder="0"
                  className="text-sm h-8"
                  disabled={!isFilterSupported(filters.api, 'tenure_at_company')}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground uppercase">Max (années)</Label>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={filters.tenure_at_company_max ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      tenure_at_company_max: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
                  placeholder="50"
                  className="text-sm h-8"
                  disabled={!isFilterSupported(filters.api, 'tenure_at_company')}
                />
              </div>
            </div>
          </FilterGroup>

          {/* Tenure at Role */}
          <FilterGroup
            title="Ancienneté dans le poste actuel"
            unsupported={!isFilterSupported(filters.api, 'tenure_at_role')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'tenure_at_role')}
          >
            <div className={`grid grid-cols-2 gap-2 ${!isFilterSupported(filters.api, 'tenure_at_role') ? 'opacity-50 pointer-events-none' : ''}`}>
              <div>
                <Label className="text-xs text-muted-foreground uppercase">Min (années)</Label>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={filters.tenure_at_role_min ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      tenure_at_role_min: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
                  placeholder="0"
                  className="text-sm h-8"
                  disabled={!isFilterSupported(filters.api, 'tenure_at_role')}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground uppercase">Max (années)</Label>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={filters.tenure_at_role_max ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      tenure_at_role_max: e.target.value ? parseInt(e.target.value) : null,
                    })
                  }
                  placeholder="50"
                  className="text-sm h-8"
                  disabled={!isFilterSupported(filters.api, 'tenure_at_role')}
                />
              </div>
            </div>
          </FilterGroup>
        </FilterSection>

        {/* ===== COMPANY FILTERS (inline) ===== */}
        <FilterSection
          id="company"
          title="Entreprise actuelle"
          icon={<Building2 className="w-4 h-4 text-emerald-500/80" />}
          badge={countCompanyFilters}
          isOpen={openSections.company}
          onToggle={() => toggleSection('company')}
          activeFiltersPreview={companyFiltersPreview}
          bgColorClass="bg-success/5"
        >
          {/* Smart filters — company type */}
          <FilterGroup title="Filtres intelligents">
            <div className="space-y-2">
              {/* Exclude ESN/Consulting toggle */}
              <label className="flex items-center justify-between px-2 py-1.5 border border-border hover:border-border cursor-pointer transition-colors">
                <span className="text-xs font-medium text-foreground">Exclure ESN / Consulting</span>
                <input
                  type="checkbox"
                  checked={filters.exclude_consulting || false}
                  onChange={(e) => onChange({ ...filters, exclude_consulting: e.target.checked })}
                  className="w-4 h-4 accent-foreground"
                />
              </label>

              {/* Company category */}
              <div className="space-y-1">
                <span className="text-xs font-bold text-muted-foreground">Type d'entreprise</span>
                <div className="flex flex-wrap gap-1">
                  {[
                    { key: '', label: 'Tous' },
                    { key: 'startup', label: '🚀 Startup' },
                    { key: 'scaleup', label: '📈 Scale-up' },
                    { key: 'enterprise', label: '🏛️ Enterprise' },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => onChange({ ...filters, company_category: opt.key as any })}
                      className={cn(
                        "px-2 py-1 text-xs font-bold border transition-colors",
                        (filters.company_category || '') === opt.key
                          ? "bg-foreground text-background border-border"
                          : "border-border text-foreground hover:border-border"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </FilterGroup>

          {/* Company */}
          <FilterGroup
            title="Nom de l'entreprise"
            badge={filters.company.length + filters.company_keywords.length}
          >
            <CompanyFilter
              idCompanies={filters.company}
              onAddIdCompany={(item) => handleAddSimpleFilter('company', item)}
              onRemoveIdCompany={(id) => handleRemoveSimpleFilter('company', id)}
              keywordCompanies={filters.company_keywords}
              onAddKeywordCompany={handleAddCompanyKeyword}
              onRemoveKeywordCompany={handleRemoveCompanyKeyword}
              onUpdateKeywordCompany={handleUpdateCompanyKeyword}
              searchValue={searchInputs['company'] || ''}
              onSearchChange={(val) => handleSearchInput('company', val)}
              options={parameterOptions['company'] || []}
              loading={loadingParams === 'company'}
              isRecruiter={filters.api === 'recruiter'}
            />
          </FilterGroup>

          {/* Industry */}
          <FilterGroup title="Secteur d'activité" badge={filters.industry.length}>
            <SelectedBadges items={filters.industry} onRemove={(id) => handleRemoveSimpleFilter('industry', id)} />
            <AutocompleteInput
              filterKey="industry"
              placeholder="Rechercher un secteur..."
              value={searchInputs['industry'] || ''}
              options={parameterOptions['industry'] || []}
              loading={loadingParams === 'industry'}
              onInputChange={(val) => handleSearchInput('industry', val)}
              onSelect={(item) => handleAddSimpleFilter('industry', item)}
            />
          </FilterGroup>

          {/* Company Headcount */}
          <FilterGroup
            title="Taille de l'entreprise"
            badge={filters.company_headcount.length}
            unsupported={!isFilterSupported(filters.api, 'company_headcount')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'company_headcount')}
          >
            <MultiSelectDropdown
              options={COMPANY_HEADCOUNT_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
              selected={filters.company_headcount}
              onChange={(selected) => onChange({ ...filters, company_headcount: selected as string[] })}
              placeholder="Sélectionner les tailles..."
              disabled={!isFilterSupported(filters.api, 'company_headcount')}
            />
          </FilterGroup>

          {/* Company Type */}
          <FilterGroup
            title="Type d'entreprise"
            badge={filters.company_type.length}
            unsupported={!isFilterSupported(filters.api, 'company_type')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'company_type')}
          >
            <MultiSelectDropdown
              options={COMPANY_TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
              selected={filters.company_type}
              onChange={(selected) => onChange({ ...filters, company_type: selected as string[] })}
              placeholder="Sélectionner les types..."
              disabled={!isFilterSupported(filters.api, 'company_type')}
            />
          </FilterGroup>

          {/* Company Location */}
          <FilterGroup
            title="Siège de l'entreprise"
            badge={filters.company_location.length}
            unsupported={!isFilterSupported(filters.api, 'company_location')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'company_location')}
          >
            <SelectedBadges items={filters.company_location} onRemove={(id) => handleRemoveSimpleFilter('company_location', id)} />
            <AutocompleteInput
              filterKey="company_location"
              placeholder="Rechercher une localisation..."
              value={searchInputs['company_location'] || ''}
              options={parameterOptions['company_location'] || []}
              loading={loadingParams === 'company_location'}
              onInputChange={(val) => handleSearchInput('company_location', val)}
              onSelect={(item) => handleAddSimpleFilter('company_location', item)}
              disabled={!isFilterSupported(filters.api, 'company_location')}
            />
          </FilterGroup>
        </FilterSection>

        {/* ===== PAST EXPERIENCE FILTERS (inline) ===== */}
        <FilterSection
          id="past"
          title="Expérience passée"
          icon={<History className="w-4 h-4 text-amber-500/80" />}
          badge={countPastFilters}
          isOpen={openSections.past}
          onToggle={() => toggleSection('past')}
          activeFiltersPreview={pastFiltersPreview}
          bgColorClass="bg-warning/5"
        >
          {/* Past Company */}
          <FilterGroup title="Ancienne entreprise" badge={filters.past_company.length}>
            <SelectedBadges items={filters.past_company} onRemove={(id) => handleRemoveSimpleFilter('past_company', id)} />
            <AutocompleteInput
              filterKey="past_company"
              placeholder="Rechercher une ancienne entreprise..."
              value={searchInputs['past_company'] || ''}
              options={parameterOptions['past_company'] || []}
              loading={loadingParams === 'past_company'}
              onInputChange={(val) => handleSearchInput('past_company', val)}
              onSelect={(item) => handleAddSimpleFilter('past_company', item)}
            />
          </FilterGroup>

          {/* Past Job Title */}
          <FilterGroup
            title="Ancien poste"
            badge={filters.past_job_title.length}
            unsupported={!isFilterSupported(filters.api, 'past_job_title')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'past_job_title')}
          >
            <PriorityBadges
              items={filters.past_job_title}
              onRemove={(id) => handleRemovePriorityFilter('past_job_title', id)}
              onUpdatePriority={(id, priority) => handleUpdatePriority('past_job_title', id, priority)}
            />
            <AutocompleteInput
              filterKey="past_job_title"
              placeholder="Rechercher un ancien poste..."
              value={searchInputs['past_job_title'] || ''}
              options={parameterOptions['past_job_title'] || []}
              loading={loadingParams === 'past_job_title'}
              onInputChange={(val) => handleSearchInput('past_job_title', val)}
              onSelect={(item) => handleAddPriorityFilter('past_job_title', item)}
              disabled={!isFilterSupported(filters.api, 'past_job_title')}
            />
          </FilterGroup>
        </FilterSection>

        {/* ===== RECRUITER / ADVANCED FILTERS — LinkedIn only ===== */}
        {filters.api !== 'database' && (
          <RecruiterFiltersSection
            filters={filters}
            onChange={onChange}
            accountId={accountId}
            isOpen={openSections.recruiter}
            onToggle={() => toggleSection('recruiter')}
            activeFiltersPreview={recruiterFiltersPreview}
            countRecruiterFilters={countRecruiterFilters}
          />
        )}
      </div>
    </div>
  );
};
