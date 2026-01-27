import React, { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  LinkedInFiltersState,
  FilterItem,
  PriorityFilterItem,
  RoleFilter,
  FilterPriority,
  FilterScope,
  SENIORITY_LEVELS,
  NETWORK_DISTANCES,
  PRIORITY_OPTIONS,
  SCOPE_OPTIONS,
  SPOTLIGHT_OPTIONS,
  PROFILE_LANGUAGES,
  COMPANY_HEADCOUNT_OPTIONS,
  COMPANY_TYPE_OPTIONS,
  OPEN_TO_OPTIONS,
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
import { isFilterSupported, getFilterTooltip, FilterKey } from './filterApiSupport';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  X,
  MapPin,
  Building2,
  Briefcase,
  GraduationCap,
  Layers,
  Zap,
  Target,
  Users,
  Plus,
  Sparkles,
  Globe,
  Clock,
  Building,
  BarChart3,
  History,
  UserCheck,
  Folder,
  Filter,
  AlertTriangle,
} from 'lucide-react';

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
  // Section open states - collapsed by default
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
  const debounceRef = useRef<Record<string, NodeJS.Timeout>>({});
  const abortControllerRef = useRef<Record<string, AbortController>>({});

  // Role filter state
  const [newRoleKeywords, setNewRoleKeywords] = useState('');
  const [newRolePriority, setNewRolePriority] = useState<FilterPriority>('MUST_HAVE');
  const [newRoleScope, setNewRoleScope] = useState<FilterScope>('CURRENT_OR_PAST');

  const toggleSection = useCallback((section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  }, []);

  // Map frontend filter keys to Unipile API parameter types
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

        const response = await supabase.functions.invoke('unipile-search', {
          body: {
            action: 'get_parameters',
            account_id: accountId,
            type: paramType,
            keywords: keywords.trim(),
            service: filters.api === 'classic' ? 'CLASSIC' : filters.api === 'sales_navigator' ? 'SALES_NAVIGATOR' : 'RECRUITER',
          },
        });

        if (abortControllerRef.current[key]?.signal.aborted) return;

        if (response.error) throw response.error;
        if (!response.data?.success) {
          setParameterOptions((prev) => ({ ...prev, [key]: [] }));
          return;
        }

        setParameterOptions((prev) => ({
          ...prev,
          [key]: response.data.items || [],
        }));
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

  // Simple filter handlers
  const handleAddSimpleFilter = useCallback((key: 'location' | 'company' | 'industry' | 'school' | 'past_company', item: ParameterOption) => {
    const current = filters[key];
    if (!current.find((f) => f.id === item.id)) {
      onChange({ ...filters, [key]: [...current, { id: item.id, name: item.title }] });
    }
    setSearchInputs((prev) => ({ ...prev, [key]: '' }));
    setParameterOptions((prev) => ({ ...prev, [key]: [] }));
  }, [filters, onChange]);

  const handleRemoveSimpleFilter = useCallback((key: 'location' | 'company' | 'industry' | 'school' | 'past_company', id: string) => {
    onChange({ ...filters, [key]: filters[key].filter((f) => f.id !== id) });
  }, [filters, onChange]);

  // Priority filter handlers
  const handleAddPriorityFilter = useCallback((
    key: 'job_title' | 'skills' | 'past_job_title',
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

  const handleUpdatePriority = useCallback((key: 'job_title' | 'skills' | 'past_job_title', id: string, priority: FilterPriority) => {
    onChange({
      ...filters,
      [key]: filters[key].map((f) => (f.id === id ? { ...f, priority } : f)),
    });
  }, [filters, onChange]);

  const handleRemovePriorityFilter = useCallback((key: 'job_title' | 'skills' | 'past_job_title', id: string) => {
    onChange({ ...filters, [key]: filters[key].filter((f) => f.id !== id) });
  }, [filters, onChange]);

  // Role handlers
  const handleAddRole = useCallback(() => {
    if (!newRoleKeywords.trim()) return;
    const newRole: RoleFilter = {
      keywords: newRoleKeywords.trim(),
      priority: newRolePriority,
      scope: newRoleScope,
    };
    onChange({ ...filters, role: [...filters.role, newRole] });
    setNewRoleKeywords('');
  }, [newRoleKeywords, newRolePriority, newRoleScope, filters, onChange]);

  const handleRemoveRole = useCallback((index: number) => {
    onChange({ ...filters, role: filters.role.filter((_, i) => i !== index) });
  }, [filters, onChange]);

  const handleUpdateRole = useCallback((index: number, updates: Partial<RoleFilter>) => {
    onChange({
      ...filters,
      role: filters.role.map((r, i) => (i === index ? { ...r, ...updates } : r)),
    });
  }, [filters, onChange]);

  // Count active filters
  const countBasicFilters = filters.location.length + filters.school.length + filters.profile_language.length + filters.network_distance.length;
  const countPositionFilters = filters.job_title.length + filters.role.length + filters.skills.length + filters.seniority.length;
  const countExperienceFilters = (filters.years_of_experience_min !== null ? 1 : 0) + (filters.years_of_experience_max !== null ? 1 : 0) + 
    (filters.tenure_at_company_min !== null ? 1 : 0) + (filters.tenure_at_company_max !== null ? 1 : 0) +
    (filters.tenure_at_role_min !== null ? 1 : 0) + (filters.tenure_at_role_max !== null ? 1 : 0);
  const countCompanyFilters = filters.company.length + filters.industry.length + filters.company_headcount.length + filters.company_type.length;
  const countPastFilters = filters.past_company.length + filters.past_job_title.length;
  const countRecruiterFilters = (filters.spotlight ? 1 : 0) + (filters.hiring_project ? 1 : 0) + (filters.talent_pool ? 1 : 0) + 
    (filters.open_to_work === true ? 1 : 0) + filters.open_to.length;

  // Preview of active filters for each section
  const basicFiltersPreview: string[] = [
    ...filters.location.map(f => f.name),
    ...filters.school.map(f => f.name),
    ...filters.profile_language.map(l => PROFILE_LANGUAGES.find(pl => pl.value === l)?.label || l),
    ...filters.network_distance.map(d => NETWORK_DISTANCES.find(nd => nd.value === d)?.label || String(d)),
  ];
  
  const positionFiltersPreview = [
    ...filters.job_title.map(f => f.name),
    ...filters.role.map(r => r.keywords),
    ...filters.skills.map(f => f.name),
    ...filters.seniority.map(s => SENIORITY_LEVELS.find(sl => sl.value === s)?.label || s),
  ];
  
  const experienceFiltersPreview = [
    ...(filters.years_of_experience_min !== null || filters.years_of_experience_max !== null 
      ? [`Exp: ${filters.years_of_experience_min ?? 0}-${filters.years_of_experience_max ?? '∞'} ans`] 
      : []),
    ...(filters.tenure_at_company_min !== null || filters.tenure_at_company_max !== null 
      ? [`Ancienneté: ${filters.tenure_at_company_min ?? 0}-${filters.tenure_at_company_max ?? '∞'} ans`] 
      : []),
  ];
  
  const companyFiltersPreview = [
    ...filters.company.map(f => f.name),
    ...filters.industry.map(f => f.name),
    ...filters.company_headcount.map(h => COMPANY_HEADCOUNT_OPTIONS.find(ch => ch.value === h)?.label || h),
    ...filters.company_type.map(t => COMPANY_TYPE_OPTIONS.find(ct => ct.value === t)?.label || t),
  ];
  
  const pastFiltersPreview = [
    ...filters.past_company.map(f => f.name),
    ...filters.past_job_title.map(f => f.name),
  ];
  
  const recruiterFiltersPreview = [
    ...(filters.open_to_work === true ? ['Open to Work'] : []),
    ...filters.open_to.map(o => OPEN_TO_OPTIONS.find(oo => oo.value === o)?.label || o),
    ...(filters.spotlight ? [SPOTLIGHT_OPTIONS.find(s => s.value === filters.spotlight)?.label || 'Spotlight'] : []),
    ...(filters.hiring_project ? ['Hiring Project'] : []),
    ...(filters.talent_pool ? ['Talent Pool'] : []),
  ];

  return (
    <div className="h-[calc(100vh-220px)] bg-white rounded-xl border border-[#1A1A1A]/10 overflow-y-auto">
      <div>
        {/* ===== BASIC / GEOGRAPHIC FILTERS ===== */}
        <FilterSection 
          id="basic" 
          title="Recherche de base" 
          icon={<Filter className="w-4 h-4 text-[#0077B5]" />}
          badge={countBasicFilters}
          isOpen={openSections.basic}
          onToggle={() => toggleSection('basic')}
          activeFiltersPreview={basicFiltersPreview}
        >
          {/* Location */}
          <FilterGroup title="Localisation" icon={<MapPin className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.location.length}>
            <SelectedBadges items={filters.location} onRemove={(id) => handleRemoveSimpleFilter('location', id)} />
            <AutocompleteInput
              filterKey="location"
              placeholder="Ville, région, pays..."
              value={searchInputs['location'] || ''}
              options={parameterOptions['location'] || []}
              loading={loadingParams === 'location'}
              onInputChange={(val) => handleSearchInput('location', val)}
              onSelect={(item) => handleAddSimpleFilter('location', item)}
            />
          </FilterGroup>

          {/* School */}
          <FilterGroup 
            title="École / Formation" 
            icon={<GraduationCap className="w-3.5 h-3.5 text-[#0077B5]" />} 
            badge={filters.school.length}
            unsupported={!isFilterSupported(filters.api, 'school')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'school')}
          >
            <SelectedBadges items={filters.school} onRemove={(id) => handleRemoveSimpleFilter('school', id)} />
            <AutocompleteInput
              filterKey="school"
              placeholder="Rechercher une école..."
              value={searchInputs['school'] || ''}
              options={parameterOptions['school'] || []}
              loading={loadingParams === 'school'}
              onInputChange={(val) => handleSearchInput('school', val)}
              onSelect={(item) => handleAddSimpleFilter('school', item)}
              disabled={!isFilterSupported(filters.api, 'school')}
            />
          </FilterGroup>

          {/* Profile Languages */}
          <FilterGroup title="Langue du profil" icon={<Globe className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.profile_language.length}>
            <MultiSelectDropdown
              options={PROFILE_LANGUAGES.map(l => ({ value: l.value, label: l.label }))}
              selected={filters.profile_language}
              onChange={(selected) => onChange({ ...filters, profile_language: selected as string[] })}
              placeholder="Sélectionner les langues..."
            />
          </FilterGroup>

          {/* Network Distance */}
          <FilterGroup title="Degré de connexion" icon={<Users className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.network_distance.length}>
            <MultiSelectDropdown
              options={NETWORK_DISTANCES.map(d => ({ value: d.value, label: d.label }))}
              selected={filters.network_distance}
              onChange={(selected) => onChange({ ...filters, network_distance: selected as number[] })}
              placeholder="Sélectionner les degrés..."
            />
          </FilterGroup>
        </FilterSection>

        {/* ===== POSITION / ROLE FILTERS ===== */}
        <FilterSection 
          id="position" 
          title="Poste & Compétences" 
          icon={<Briefcase className="w-4 h-4 text-[#0077B5]" />}
          badge={countPositionFilters}
          isOpen={openSections.position}
          onToggle={() => toggleSection('position')}
          activeFiltersPreview={positionFiltersPreview}
        >
          {/* Job Title with priority */}
          <FilterGroup 
            title="Titre du poste" 
            icon={<Briefcase className="w-3.5 h-3.5 text-[#0077B5]" />} 
            badge={filters.job_title.length}
            unsupported={!isFilterSupported(filters.api, 'job_title')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'job_title')}
          >
            <PriorityBadges
              items={filters.job_title}
              onRemove={(id) => handleRemovePriorityFilter('job_title', id)}
              onUpdatePriority={(id, priority) => handleUpdatePriority('job_title', id, priority)}
            />
            <AutocompleteInput
              filterKey="job_title"
              placeholder="Rechercher un poste..."
              value={searchInputs['job_title'] || ''}
              options={parameterOptions['job_title'] || []}
              loading={loadingParams === 'job_title'}
              onInputChange={(val) => handleSearchInput('job_title', val)}
              onSelect={(item) => handleAddPriorityFilter('job_title', item)}
              disabled={!isFilterSupported(filters.api, 'job_title')}
            />
          </FilterGroup>

          {/* Role (keywords with scope) - Recruiter only */}
          <FilterGroup 
            title="Rôle (mots-clés booléens)" 
            icon={<Sparkles className="w-3.5 h-3.5 text-purple-500" />} 
            badge={filters.role.length}
            unsupported={!isFilterSupported(filters.api, 'role')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'role')}
          >
            {filters.role.map((role, index) => (
              <div key={index} className="p-2 bg-purple-50 rounded-lg mb-2 space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={role.keywords}
                    onChange={(e) => handleUpdateRole(index, { keywords: e.target.value })}
                    className="text-sm h-7 flex-1 bg-white border-purple-200"
                    placeholder="Mots-clés du rôle..."
                  />
                  <button type="button" onClick={() => handleRemoveRole(index)} className="text-purple-400 hover:text-purple-600 shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={role.priority} onValueChange={(v) => handleUpdateRole(index, { priority: v as FilterPriority })}>
                    <SelectTrigger className="text-xs h-6 bg-white border-purple-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={role.scope} onValueChange={(v) => handleUpdateRole(index, { scope: v as FilterScope })}>
                    <SelectTrigger className="text-xs h-6 bg-white border-purple-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCOPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
            <div className={`space-y-2 p-2 bg-gray-50 rounded-lg ${!isFilterSupported(filters.api, 'role') ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="flex gap-2">
                <Input
                  value={newRoleKeywords}
                  onChange={(e) => setNewRoleKeywords(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newRoleKeywords.trim()) {
                      e.preventDefault();
                      handleAddRole();
                    }
                  }}
                  onBlur={() => {
                    if (newRoleKeywords.trim()) {
                      handleAddRole();
                    }
                  }}
                  placeholder="Tapez un rôle et appuyez Entrée..."
                  className="text-sm h-8 flex-1"
                  disabled={!isFilterSupported(filters.api, 'role')}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Priorité</Label>
                  <Select value={newRolePriority} onValueChange={(v) => setNewRolePriority(v as FilterPriority)} disabled={!isFilterSupported(filters.api, 'role')}>
                    <SelectTrigger className="text-xs h-7">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Scope</Label>
                  <Select value={newRoleScope} onValueChange={(v) => setNewRoleScope(v as FilterScope)} disabled={!isFilterSupported(filters.api, 'role')}>
                    <SelectTrigger className="text-xs h-7">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCOPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground text-center">
                Appuyez sur Entrée ou sortez du champ pour ajouter
              </p>
            </div>
          </FilterGroup>

          {/* Skills with priority */}
          <FilterGroup 
            title="Compétences" 
            icon={<Zap className="w-3.5 h-3.5 text-[#0077B5]" />} 
            badge={filters.skills.length}
            unsupported={!isFilterSupported(filters.api, 'skills')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'skills')}
          >
            <PriorityBadges
              items={filters.skills}
              onRemove={(id) => handleRemovePriorityFilter('skills', id)}
              onUpdatePriority={(id, priority) => handleUpdatePriority('skills', id, priority)}
            />
            <AutocompleteInput
              filterKey="skills"
              placeholder="Rechercher une compétence..."
              value={searchInputs['skills'] || ''}
              options={parameterOptions['skills'] || []}
              loading={loadingParams === 'skills'}
              onInputChange={(val) => handleSearchInput('skills', val)}
              onSelect={(item) => handleAddPriorityFilter('skills', item)}
              disabled={!isFilterSupported(filters.api, 'skills')}
            />
          </FilterGroup>

          {/* Seniority */}
          <FilterGroup 
            title="Niveau de séniorité" 
            icon={<Target className="w-3.5 h-3.5 text-[#0077B5]" />} 
            badge={filters.seniority.length}
            unsupported={!isFilterSupported(filters.api, 'seniority')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'seniority')}
          >
            <MultiSelectDropdown
              options={SENIORITY_LEVELS.map(l => ({ value: l.value, label: l.label }))}
              selected={filters.seniority}
              onChange={(selected) => onChange({ ...filters, seniority: selected as string[] })}
              placeholder="Sélectionner les niveaux..."
              disabled={!isFilterSupported(filters.api, 'seniority')}
            />
          </FilterGroup>
        </FilterSection>

        {/* ===== EXPERIENCE / TENURE FILTERS ===== */}
        <FilterSection 
          id="experience" 
          title="Expérience & Ancienneté" 
          icon={<Clock className="w-4 h-4 text-[#0077B5]" />}
          badge={countExperienceFilters}
          isOpen={openSections.experience}
          onToggle={() => toggleSection('experience')}
          activeFiltersPreview={experienceFiltersPreview}
        >
          {/* Years of Experience */}
          <FilterGroup 
            title="Années d'expérience totale" 
            icon={<Clock className="w-3.5 h-3.5 text-[#0077B5]" />}
            unsupported={!isFilterSupported(filters.api, 'years_of_experience')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'years_of_experience')}
          >
            <div className={`grid grid-cols-2 gap-2 ${!isFilterSupported(filters.api, 'years_of_experience') ? 'opacity-50 pointer-events-none' : ''}`}>
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase">Min</Label>
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
                <Label className="text-[10px] text-muted-foreground uppercase">Max</Label>
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
          </FilterGroup>

          {/* Tenure at Company */}
          <FilterGroup 
            title="Ancienneté dans l'entreprise actuelle" 
            icon={<Building className="w-3.5 h-3.5 text-[#0077B5]" />}
            unsupported={!isFilterSupported(filters.api, 'tenure_at_company')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'tenure_at_company')}
          >
            <div className={`grid grid-cols-2 gap-2 ${!isFilterSupported(filters.api, 'tenure_at_company') ? 'opacity-50 pointer-events-none' : ''}`}>
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase">Min (années)</Label>
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
                <Label className="text-[10px] text-muted-foreground uppercase">Max (années)</Label>
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
            icon={<Briefcase className="w-3.5 h-3.5 text-[#0077B5]" />}
            unsupported={!isFilterSupported(filters.api, 'tenure_at_role')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'tenure_at_role')}
          >
            <div className={`grid grid-cols-2 gap-2 ${!isFilterSupported(filters.api, 'tenure_at_role') ? 'opacity-50 pointer-events-none' : ''}`}>
              <div>
                <Label className="text-[10px] text-muted-foreground uppercase">Min (années)</Label>
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
                <Label className="text-[10px] text-muted-foreground uppercase">Max (années)</Label>
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

        {/* ===== COMPANY FILTERS ===== */}
        <FilterSection 
          id="company" 
          title="Entreprise actuelle" 
          icon={<Building2 className="w-4 h-4 text-[#0077B5]" />}
          badge={countCompanyFilters}
          isOpen={openSections.company}
          onToggle={() => toggleSection('company')}
          activeFiltersPreview={companyFiltersPreview}
        >
          {/* Company */}
          <FilterGroup title="Nom de l'entreprise" icon={<Building2 className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.company.length}>
            <SelectedBadges items={filters.company} onRemove={(id) => handleRemoveSimpleFilter('company', id)} />
            <AutocompleteInput
              filterKey="company"
              placeholder="Rechercher une entreprise..."
              value={searchInputs['company'] || ''}
              options={parameterOptions['company'] || []}
              loading={loadingParams === 'company'}
              onInputChange={(val) => handleSearchInput('company', val)}
              onSelect={(item) => handleAddSimpleFilter('company', item)}
            />
          </FilterGroup>

          {/* Industry */}
          <FilterGroup title="Secteur d'activité" icon={<Layers className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.industry.length}>
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
            icon={<BarChart3 className="w-3.5 h-3.5 text-[#0077B5]" />} 
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
            icon={<Building className="w-3.5 h-3.5 text-[#0077B5]" />} 
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
        </FilterSection>

        {/* ===== PAST EXPERIENCE FILTERS ===== */}
        <FilterSection 
          id="past" 
          title="Expérience passée" 
          icon={<History className="w-4 h-4 text-amber-600" />}
          badge={countPastFilters}
          isOpen={openSections.past}
          onToggle={() => toggleSection('past')}
          activeFiltersPreview={pastFiltersPreview}
        >
          {/* Past Company */}
          <FilterGroup title="Ancienne entreprise" icon={<Building2 className="w-3.5 h-3.5 text-amber-600" />} badge={filters.past_company.length}>
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
            icon={<Briefcase className="w-3.5 h-3.5 text-amber-600" />} 
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

        {/* ===== RECRUITER / ADVANCED FILTERS ===== */}
        <FilterSection 
          id="recruiter" 
          title="Filtres avancés (Recruiter)" 
          icon={<Target className="w-4 h-4 text-purple-500" />}
          badge={countRecruiterFilters}
          isOpen={openSections.recruiter}
          onToggle={() => toggleSection('recruiter')}
          activeFiltersPreview={recruiterFiltersPreview}
        >
          {/* Open to Work */}
          <FilterGroup 
            title="Open to Work" 
            icon={<UserCheck className="w-3.5 h-3.5 text-green-500" />}
            unsupported={!isFilterSupported(filters.api, 'open_to_work')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'open_to_work')}
          >
            <div className={`flex items-center justify-between p-2 bg-green-50 rounded-lg ${!isFilterSupported(filters.api, 'open_to_work') ? 'opacity-50' : ''}`}>
              <span className="text-sm text-green-800">Profils Open to Work uniquement</span>
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
            icon={<Zap className="w-3.5 h-3.5 text-[#0077B5]" />} 
            badge={filters.open_to.length}
            unsupported={!isFilterSupported(filters.api, 'open_to')}
            unsupportedTooltip={getFilterTooltip(filters.api, 'open_to')}
          >
            <MultiSelectDropdown
              options={OPEN_TO_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
              selected={filters.open_to}
              onChange={(selected) => onChange({ ...filters, open_to: selected as typeof filters.open_to })}
              placeholder="Sélectionner les types..."
              disabled={!isFilterSupported(filters.api, 'open_to')}
            />
          </FilterGroup>

          {/* Spotlight */}
          <FilterGroup 
            title="Spotlight" 
            icon={<Sparkles className="w-3.5 h-3.5 text-purple-500" />}
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
            icon={<Folder className="w-3.5 h-3.5 text-purple-500" />}
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
            icon={<Users className="w-3.5 h-3.5 text-purple-500" />}
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
        </FilterSection>
      </div>
    </div>
  );
};
