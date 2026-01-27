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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  X,
  Loader2,
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
  ChevronDown,
  UserCheck,
  Folder,
  Search,
  Filter,
} from 'lucide-react';

interface LinkedInFiltersProps {
  filters: LinkedInFiltersState;
  onChange: (filters: LinkedInFiltersState) => void;
  accountId: string | null;
}

interface ParameterOption {
  id: string;
  title: string;
}

export const LinkedInFilters: React.FC<LinkedInFiltersProps> = ({
  filters,
  onChange,
  accountId,
}) => {
  // All sections open by default
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    basic: true,
    position: true,
    experience: true,
    company: true,
    past: true,
    recruiter: true,
  });

  const [loadingParams, setLoadingParams] = useState<string | null>(null);
  const [parameterOptions, setParameterOptions] = useState<Record<string, ParameterOption[]>>({});
  const [searchInputs, setSearchInputs] = useState<Record<string, string>>({});
  const debounceRef = useRef<Record<string, NodeJS.Timeout>>({});
  const abortControllerRef = useRef<Record<string, AbortController>>({});

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Map frontend filter keys to Unipile API parameter types
  const getParameterType = (key: string): string => {
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
  };

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
    [accountId, filters.api]
  );

  const handleSearchInput = (key: string, value: string) => {
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
  };

  // Simple filter add
  const handleAddSimpleFilter = (key: 'location' | 'company' | 'industry' | 'school' | 'past_company', item: ParameterOption) => {
    const current = filters[key];
    if (!current.find((f) => f.id === item.id)) {
      onChange({ ...filters, [key]: [...current, { id: item.id, name: item.title }] });
    }
    setSearchInputs((prev) => ({ ...prev, [key]: '' }));
    setParameterOptions((prev) => ({ ...prev, [key]: [] }));
  };

  const handleRemoveSimpleFilter = (key: 'location' | 'company' | 'industry' | 'school' | 'past_company', id: string) => {
    onChange({ ...filters, [key]: filters[key].filter((f) => f.id !== id) });
  };

  // Priority filter add
  const handleAddPriorityFilter = (
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
  };

  const handleUpdatePriority = (key: 'job_title' | 'skills' | 'past_job_title', id: string, priority: FilterPriority) => {
    onChange({
      ...filters,
      [key]: filters[key].map((f) => (f.id === id ? { ...f, priority } : f)),
    });
  };

  const handleRemovePriorityFilter = (key: 'job_title' | 'skills' | 'past_job_title', id: string) => {
    onChange({ ...filters, [key]: filters[key].filter((f) => f.id !== id) });
  };

  // Role filter state
  const [newRoleKeywords, setNewRoleKeywords] = useState('');
  const [newRolePriority, setNewRolePriority] = useState<FilterPriority>('MUST_HAVE');
  const [newRoleScope, setNewRoleScope] = useState<FilterScope>('CURRENT_OR_PAST');

  const handleAddRole = () => {
    if (!newRoleKeywords.trim()) return;
    const newRole: RoleFilter = {
      keywords: newRoleKeywords.trim(),
      priority: newRolePriority,
      scope: newRoleScope,
    };
    onChange({ ...filters, role: [...filters.role, newRole] });
    setNewRoleKeywords('');
  };

  const handleRemoveRole = (index: number) => {
    onChange({ ...filters, role: filters.role.filter((_, i) => i !== index) });
  };

  // Collapsible section component
  const FilterSection = ({ 
    id, 
    title, 
    icon, 
    children, 
    badge 
  }: { 
    id: string;
    title: string; 
    icon: React.ReactNode; 
    children: React.ReactNode; 
    badge?: number 
  }) => (
    <Collapsible open={openSections[id]} onOpenChange={() => toggleSection(id)} className="border-b border-[#1A1A1A]/10">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover:bg-gray-50/50 transition-colors">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-semibold text-[#1A1A1A]">{title}</span>
          {badge !== undefined && badge > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs bg-[#0077B5]/10 text-[#0077B5]">
              {badge}
            </Badge>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-[#1A1A1A]/40 transition-transform duration-200 ${openSections[id] ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">
        <div className="space-y-4">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );

  // Filter group within a section
  const FilterGroup = ({ 
    title, 
    icon, 
    children,
    badge,
  }: { 
    title: string; 
    icon: React.ReactNode; 
    children: React.ReactNode;
    badge?: number;
  }) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium text-[#1A1A1A]/70 uppercase tracking-wide">{title}</span>
        {badge !== undefined && badge > 0 && (
          <Badge variant="outline" className="h-4 px-1 text-[10px]">{badge}</Badge>
        )}
      </div>
      {children}
    </div>
  );

  // Autocomplete input for filters
  const AutocompleteInput = ({
    filterKey,
    placeholder,
    onSelect,
  }: {
    filterKey: string;
    placeholder: string;
    onSelect: (item: ParameterOption) => void;
  }) => {
    const searchValue = searchInputs[filterKey] || '';
    const options = parameterOptions[filterKey] || [];

    return (
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#1A1A1A]/40" />
          <Input
            value={searchValue}
            onChange={(e) => handleSearchInput(filterKey, e.target.value)}
            placeholder={placeholder}
            className="text-sm h-9 pl-8"
          />
          {loadingParams === filterKey && (
            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-[#0077B5]" />
          )}
        </div>
        {options.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-[#1A1A1A]/10 rounded-lg shadow-lg max-h-48 overflow-auto">
            {options.map((option) => (
              <button
                key={option.id}
                onClick={() => onSelect(option)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-[#0077B5]/5 transition-colors flex items-center justify-between group"
              >
                <span className="truncate">{option.title}</span>
                <Plus className="w-4 h-4 text-[#0077B5] opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Selected badges display
  const SelectedBadges = ({
    items,
    onRemove,
  }: {
    items: FilterItem[];
    onRemove: (id: string) => void;
  }) => {
    if (items.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((item) => (
          <Badge
            key={item.id}
            variant="secondary"
            className="gap-1 pr-1 bg-[#0077B5]/10 text-[#0077B5] hover:bg-[#0077B5]/20 text-xs"
          >
            <span className="max-w-[150px] truncate">{item.name}</span>
            <button onClick={() => onRemove(item.id)} className="ml-0.5 hover:bg-[#0077B5]/30 rounded-full p-0.5">
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
    );
  };

  // Priority badges display
  const PriorityBadges = ({
    items,
    filterKey,
    onRemove,
    onUpdatePriority,
  }: {
    items: PriorityFilterItem[];
    filterKey: 'job_title' | 'skills' | 'past_job_title';
    onRemove: (id: string) => void;
    onUpdatePriority: (id: string, priority: FilterPriority) => void;
  }) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-1.5 mb-2">
        {items.map((item) => {
          const priorityConfig = PRIORITY_OPTIONS.find((p) => p.value === item.priority);
          return (
            <div key={item.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
              <span className="text-sm flex-1 truncate">{item.name}</span>
              <Select
                value={item.priority}
                onValueChange={(val) => onUpdatePriority(item.id, val as FilterPriority)}
              >
                <SelectTrigger className={`h-6 w-24 text-[10px] border-0 ${priorityConfig?.color}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      <span className="flex items-center gap-1">
                        <span>{opt.icon}</span>
                        <span>{opt.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button onClick={() => onRemove(item.id)} className="text-red-400 hover:text-red-600 p-0.5">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    );
  };

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

  return (
    <ScrollArea className="h-[calc(100vh-220px)] bg-white rounded-xl border border-[#1A1A1A]/10">
      <div>
        {/* ===== BASIC / GEOGRAPHIC FILTERS ===== */}
        <FilterSection 
          id="basic" 
          title="Recherche de base" 
          icon={<Filter className="w-4 h-4 text-[#0077B5]" />}
          badge={countBasicFilters}
        >
          {/* Location */}
          <FilterGroup title="Localisation" icon={<MapPin className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.location.length}>
            <SelectedBadges items={filters.location} onRemove={(id) => handleRemoveSimpleFilter('location', id)} />
            <AutocompleteInput
              filterKey="location"
              placeholder="Ville, région, pays..."
              onSelect={(item) => handleAddSimpleFilter('location', item)}
            />
          </FilterGroup>

          {/* School */}
          <FilterGroup title="École / Formation" icon={<GraduationCap className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.school.length}>
            <SelectedBadges items={filters.school} onRemove={(id) => handleRemoveSimpleFilter('school', id)} />
            <AutocompleteInput
              filterKey="school"
              placeholder="Rechercher une école..."
              onSelect={(item) => handleAddSimpleFilter('school', item)}
            />
          </FilterGroup>

          {/* Profile Languages */}
          <FilterGroup title="Langue du profil" icon={<Globe className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.profile_language.length}>
            <div className="grid grid-cols-2 gap-1.5">
              {PROFILE_LANGUAGES.map((lang) => (
                <label key={lang.value} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-gray-50">
                  <Checkbox
                    checked={filters.profile_language.includes(lang.value)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onChange({ ...filters, profile_language: [...filters.profile_language, lang.value] });
                      } else {
                        onChange({ ...filters, profile_language: filters.profile_language.filter((l) => l !== lang.value) });
                      }
                    }}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-xs">{lang.label}</span>
                </label>
              ))}
            </div>
          </FilterGroup>

          {/* Network Distance */}
          <FilterGroup title="Degré de connexion" icon={<Users className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.network_distance.length}>
            <div className="space-y-1.5">
              {NETWORK_DISTANCES.map((dist) => (
                <label key={dist.value} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-gray-50">
                  <Checkbox
                    checked={filters.network_distance.includes(dist.value)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onChange({ ...filters, network_distance: [...filters.network_distance, dist.value] });
                      } else {
                        onChange({ ...filters, network_distance: filters.network_distance.filter((d) => d !== dist.value) });
                      }
                    }}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-xs">{dist.label}</span>
                </label>
              ))}
            </div>
          </FilterGroup>
        </FilterSection>

        {/* ===== POSITION / ROLE FILTERS ===== */}
        <FilterSection 
          id="position" 
          title="Poste & Compétences" 
          icon={<Briefcase className="w-4 h-4 text-[#0077B5]" />}
          badge={countPositionFilters}
        >
          {/* Job Title with priority */}
          <FilterGroup title="Titre du poste" icon={<Briefcase className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.job_title.length}>
            <PriorityBadges
              items={filters.job_title}
              filterKey="job_title"
              onRemove={(id) => handleRemovePriorityFilter('job_title', id)}
              onUpdatePriority={(id, priority) => handleUpdatePriority('job_title', id, priority)}
            />
            <AutocompleteInput
              filterKey="job_title"
              placeholder="Rechercher un poste..."
              onSelect={(item) => handleAddPriorityFilter('job_title', item)}
            />
          </FilterGroup>

          {/* Role (keywords with scope) - Recruiter */}
          <FilterGroup title="Rôle (mots-clés booléens)" icon={<Sparkles className="w-3.5 h-3.5 text-purple-500" />} badge={filters.role.length}>
            {filters.role.map((role, index) => {
              const priorityConfig = PRIORITY_OPTIONS.find((p) => p.value === role.priority);
              const scopeConfig = SCOPE_OPTIONS.find((s) => s.value === role.scope);
              return (
                <div key={index} className="p-2 bg-purple-50 rounded-lg mb-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-purple-900">{role.keywords}</span>
                    <button onClick={() => handleRemoveRole(index)} className="text-purple-400 hover:text-purple-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex gap-1 mt-1">
                    <Badge className={`text-[10px] h-5 ${priorityConfig?.color}`}>{priorityConfig?.label}</Badge>
                    <Badge variant="outline" className="text-[10px] h-5">{scopeConfig?.label}</Badge>
                  </div>
                </div>
              );
            })}
            <div className="space-y-2 p-2 bg-gray-50 rounded-lg">
              <Input
                value={newRoleKeywords}
                onChange={(e) => setNewRoleKeywords(e.target.value)}
                placeholder="Ex: developer OR engineer AND NOT junior"
                className="text-sm h-8"
              />
              <div className="grid grid-cols-2 gap-2">
                <Select value={newRolePriority} onValueChange={(v) => setNewRolePriority(v as FilterPriority)}>
                  <SelectTrigger className="text-xs h-7">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={newRoleScope} onValueChange={(v) => setNewRoleScope(v as FilterScope)}>
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
              <Button size="sm" variant="outline" onClick={handleAddRole} disabled={!newRoleKeywords.trim()} className="w-full h-7 text-xs">
                <Plus className="w-3 h-3 mr-1" />
                Ajouter le rôle
              </Button>
            </div>
          </FilterGroup>

          {/* Skills with priority */}
          <FilterGroup title="Compétences" icon={<Zap className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.skills.length}>
            <PriorityBadges
              items={filters.skills}
              filterKey="skills"
              onRemove={(id) => handleRemovePriorityFilter('skills', id)}
              onUpdatePriority={(id, priority) => handleUpdatePriority('skills', id, priority)}
            />
            <AutocompleteInput
              filterKey="skills"
              placeholder="Rechercher une compétence..."
              onSelect={(item) => handleAddPriorityFilter('skills', item)}
            />
          </FilterGroup>

          {/* Seniority */}
          <FilterGroup title="Niveau de séniorité" icon={<Target className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.seniority.length}>
            <div className="grid grid-cols-2 gap-1.5">
              {SENIORITY_LEVELS.map((level) => (
                <label key={level.value} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-gray-50">
                  <Checkbox
                    checked={filters.seniority.includes(level.value)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onChange({ ...filters, seniority: [...filters.seniority, level.value] });
                      } else {
                        onChange({ ...filters, seniority: filters.seniority.filter((s) => s !== level.value) });
                      }
                    }}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-xs truncate">{level.label}</span>
                </label>
              ))}
            </div>
          </FilterGroup>
        </FilterSection>

        {/* ===== EXPERIENCE / TENURE FILTERS ===== */}
        <FilterSection 
          id="experience" 
          title="Expérience & Ancienneté" 
          icon={<Clock className="w-4 h-4 text-[#0077B5]" />}
          badge={countExperienceFilters}
        >
          {/* Years of Experience */}
          <FilterGroup title="Années d'expérience totale" icon={<Clock className="w-3.5 h-3.5 text-[#0077B5]" />}>
            <div className="grid grid-cols-2 gap-2">
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
                />
              </div>
            </div>
          </FilterGroup>

          {/* Tenure at Company */}
          <FilterGroup title="Ancienneté dans l'entreprise actuelle" icon={<Building className="w-3.5 h-3.5 text-[#0077B5]" />}>
            <div className="grid grid-cols-2 gap-2">
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
                />
              </div>
            </div>
          </FilterGroup>

          {/* Tenure at Role */}
          <FilterGroup title="Ancienneté dans le poste actuel" icon={<Briefcase className="w-3.5 h-3.5 text-[#0077B5]" />}>
            <div className="grid grid-cols-2 gap-2">
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
        >
          {/* Company */}
          <FilterGroup title="Nom de l'entreprise" icon={<Building2 className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.company.length}>
            <SelectedBadges items={filters.company} onRemove={(id) => handleRemoveSimpleFilter('company', id)} />
            <AutocompleteInput
              filterKey="company"
              placeholder="Rechercher une entreprise..."
              onSelect={(item) => handleAddSimpleFilter('company', item)}
            />
          </FilterGroup>

          {/* Industry */}
          <FilterGroup title="Secteur d'activité" icon={<Layers className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.industry.length}>
            <SelectedBadges items={filters.industry} onRemove={(id) => handleRemoveSimpleFilter('industry', id)} />
            <AutocompleteInput
              filterKey="industry"
              placeholder="Rechercher un secteur..."
              onSelect={(item) => handleAddSimpleFilter('industry', item)}
            />
          </FilterGroup>

          {/* Company Headcount */}
          <FilterGroup title="Taille de l'entreprise" icon={<BarChart3 className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.company_headcount.length}>
            <div className="grid grid-cols-2 gap-1.5">
              {COMPANY_HEADCOUNT_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-gray-50">
                  <Checkbox
                    checked={filters.company_headcount.includes(opt.value)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onChange({ ...filters, company_headcount: [...filters.company_headcount, opt.value] });
                      } else {
                        onChange({ ...filters, company_headcount: filters.company_headcount.filter((h) => h !== opt.value) });
                      }
                    }}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-xs">{opt.label}</span>
                </label>
              ))}
            </div>
          </FilterGroup>

          {/* Company Type */}
          <FilterGroup title="Type d'entreprise" icon={<Building className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.company_type.length}>
            <div className="space-y-1.5">
              {COMPANY_TYPE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-gray-50">
                  <Checkbox
                    checked={filters.company_type.includes(opt.value)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onChange({ ...filters, company_type: [...filters.company_type, opt.value] });
                      } else {
                        onChange({ ...filters, company_type: filters.company_type.filter((t) => t !== opt.value) });
                      }
                    }}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-xs">{opt.label}</span>
                </label>
              ))}
            </div>
          </FilterGroup>
        </FilterSection>

        {/* ===== PAST EXPERIENCE FILTERS ===== */}
        <FilterSection 
          id="past" 
          title="Expérience passée" 
          icon={<History className="w-4 h-4 text-amber-600" />}
          badge={countPastFilters}
        >
          {/* Past Company */}
          <FilterGroup title="Ancienne entreprise" icon={<Building2 className="w-3.5 h-3.5 text-amber-600" />} badge={filters.past_company.length}>
            <SelectedBadges items={filters.past_company} onRemove={(id) => handleRemoveSimpleFilter('past_company', id)} />
            <AutocompleteInput
              filterKey="past_company"
              placeholder="Rechercher une ancienne entreprise..."
              onSelect={(item) => handleAddSimpleFilter('past_company', item)}
            />
          </FilterGroup>

          {/* Past Job Title */}
          <FilterGroup title="Ancien poste" icon={<Briefcase className="w-3.5 h-3.5 text-amber-600" />} badge={filters.past_job_title.length}>
            <PriorityBadges
              items={filters.past_job_title}
              filterKey="past_job_title"
              onRemove={(id) => handleRemovePriorityFilter('past_job_title', id)}
              onUpdatePriority={(id, priority) => handleUpdatePriority('past_job_title', id, priority)}
            />
            <AutocompleteInput
              filterKey="past_job_title"
              placeholder="Rechercher un ancien poste..."
              onSelect={(item) => handleAddPriorityFilter('past_job_title', item)}
            />
          </FilterGroup>
        </FilterSection>

        {/* ===== RECRUITER / ADVANCED FILTERS ===== */}
        <FilterSection 
          id="recruiter" 
          title="Filtres avancés (Recruiter)" 
          icon={<Target className="w-4 h-4 text-purple-500" />}
          badge={countRecruiterFilters}
        >
          {/* Open to Work */}
          <FilterGroup title="Open to Work" icon={<UserCheck className="w-3.5 h-3.5 text-green-500" />}>
            <div className="flex items-center justify-between p-2 bg-green-50 rounded-lg">
              <span className="text-sm text-green-800">Profils Open to Work uniquement</span>
              <Switch
                checked={filters.open_to_work === true}
                onCheckedChange={(checked) =>
                  onChange({
                    ...filters,
                    open_to_work: checked ? true : null,
                  })
                }
              />
            </div>
          </FilterGroup>

          {/* Open to types */}
          <FilterGroup title="Open to (type)" icon={<Zap className="w-3.5 h-3.5 text-[#0077B5]" />} badge={filters.open_to.length}>
            <div className="space-y-1.5">
              {OPEN_TO_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-gray-50">
                  <Checkbox
                    checked={filters.open_to.includes(opt.value as any)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        onChange({ ...filters, open_to: [...filters.open_to, opt.value as any] });
                      } else {
                        onChange({ ...filters, open_to: filters.open_to.filter((o) => o !== opt.value) });
                      }
                    }}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-xs">{opt.label}</span>
                </label>
              ))}
            </div>
          </FilterGroup>

          {/* Spotlight */}
          <FilterGroup title="Spotlight" icon={<Sparkles className="w-3.5 h-3.5 text-purple-500" />}>
            <Select 
              value={filters.spotlight || '_empty'} 
              onValueChange={(v) => onChange({ ...filters, spotlight: v === '_empty' ? '' : v as typeof filters.spotlight })}
            >
              <SelectTrigger className="text-sm h-9">
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
          <FilterGroup title="Hiring Project (ID)" icon={<Folder className="w-3.5 h-3.5 text-purple-500" />}>
            <Input
              value={filters.hiring_project}
              onChange={(e) => onChange({ ...filters, hiring_project: e.target.value })}
              placeholder="ID du projet de recrutement"
              className="text-sm h-8"
            />
          </FilterGroup>

          {/* Talent Pool */}
          <FilterGroup title="Talent Pool (ID)" icon={<Users className="w-3.5 h-3.5 text-purple-500" />}>
            <Input
              value={filters.talent_pool}
              onChange={(e) => onChange({ ...filters, talent_pool: e.target.value })}
              placeholder="ID du pool de talents"
              className="text-sm h-8"
            />
          </FilterGroup>
        </FilterSection>
      </div>
    </ScrollArea>
  );
};
