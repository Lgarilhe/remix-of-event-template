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
} from './types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
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
  const [loadingParams, setLoadingParams] = useState<string | null>(null);
  const [parameterOptions, setParameterOptions] = useState<Record<string, ParameterOption[]>>({});
  const [searchInputs, setSearchInputs] = useState<Record<string, string>>({});
  const debounceRef = useRef<Record<string, NodeJS.Timeout>>({});
  const abortControllerRef = useRef<Record<string, AbortController>>({});

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
            service: 'RECRUITER',
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
    [accountId]
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
      }, 600);
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

  // Filter section component - always expanded
  const FilterSection = ({ title, icon, children, badge }: { title: string; icon: React.ReactNode; children: React.ReactNode; badge?: number }) => (
    <div className="border-b border-[#1A1A1A]/5 pb-4 mb-4 last:border-b-0 last:pb-0 last:mb-0">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-sm font-semibold text-[#1A1A1A]">{title}</span>
        {badge !== undefined && badge > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-xs bg-[#0077B5]/10 text-[#0077B5]">
            {badge}
          </Badge>
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
        <Input
          value={searchValue}
          onChange={(e) => handleSearchInput(filterKey, e.target.value)}
          placeholder={placeholder}
          className="text-sm h-9"
        />
        {loadingParams === filterKey && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-[#0077B5]" />
        )}
        {options.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-40 overflow-auto">
            {options.map((option) => (
              <button
                key={option.id}
                onClick={() => onSelect(option)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors flex items-center justify-between"
              >
                <span>{option.title}</span>
                <Plus className="w-4 h-4 text-[#0077B5]" />
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
      <div className="flex flex-wrap gap-1 mb-2">
        {items.map((item) => (
          <Badge
            key={item.id}
            variant="secondary"
            className="gap-1 pr-1 bg-[#0077B5]/10 text-[#0077B5] hover:bg-[#0077B5]/20"
          >
            {item.name}
            <button onClick={() => onRemove(item.id)} className="ml-1 hover:bg-[#0077B5]/20 rounded-full p-0.5">
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
      <div className="space-y-1 mb-2">
        {items.map((item) => {
          const priorityConfig = PRIORITY_OPTIONS.find((p) => p.value === item.priority);
          return (
            <div key={item.id} className="flex items-center justify-between gap-2 p-2 bg-gray-50 rounded-lg">
              <span className="text-sm flex-1 truncate">{item.name}</span>
              <Select
                value={item.priority}
                onValueChange={(val) => onUpdatePriority(item.id, val as FilterPriority)}
              >
                <SelectTrigger className={`h-7 w-28 text-xs ${priorityConfig?.color}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button onClick={() => onRemove(item.id)} className="text-red-400 hover:text-red-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <ScrollArea className="h-[calc(100vh-220px)]">
      <div className="p-4 space-y-0">
        {/* ===== BASIC FILTERS ===== */}
        
        {/* Location */}
        <FilterSection title="Localisation" icon={<MapPin className="w-4 h-4 text-[#0077B5]" />} badge={filters.location.length}>
          <SelectedBadges items={filters.location} onRemove={(id) => handleRemoveSimpleFilter('location', id)} />
          <AutocompleteInput
            filterKey="location"
            placeholder="Rechercher une ville, région..."
            onSelect={(item) => handleAddSimpleFilter('location', item)}
          />
        </FilterSection>

        {/* Company */}
        <FilterSection title="Entreprise actuelle" icon={<Building2 className="w-4 h-4 text-[#0077B5]" />} badge={filters.company.length}>
          <SelectedBadges items={filters.company} onRemove={(id) => handleRemoveSimpleFilter('company', id)} />
          <AutocompleteInput
            filterKey="company"
            placeholder="Rechercher une entreprise..."
            onSelect={(item) => handleAddSimpleFilter('company', item)}
          />
        </FilterSection>

        {/* Job Title with priority */}
        <FilterSection title="Poste actuel" icon={<Briefcase className="w-4 h-4 text-[#0077B5]" />} badge={filters.job_title.length}>
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
        </FilterSection>

        {/* Role (keywords with scope) */}
        <FilterSection title="Rôle (mots-clés)" icon={<Sparkles className="w-4 h-4 text-purple-500" />} badge={filters.role.length}>
          {filters.role.map((role, index) => {
            const priorityConfig = PRIORITY_OPTIONS.find((p) => p.value === role.priority);
            const scopeConfig = SCOPE_OPTIONS.find((s) => s.value === role.scope);
            return (
              <div key={index} className="p-2 bg-gray-50 rounded-lg mb-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{role.keywords}</span>
                  <button onClick={() => handleRemoveRole(index)} className="text-red-400 hover:text-red-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex gap-1 text-xs mt-1">
                  <Badge className={priorityConfig?.color}>{priorityConfig?.label}</Badge>
                  <Badge variant="outline">{scopeConfig?.label}</Badge>
                </div>
              </div>
            );
          })}
          <div className="space-y-2">
            <Input
              value={newRoleKeywords}
              onChange={(e) => setNewRoleKeywords(e.target.value)}
              placeholder="Ex: developer OR engineer"
              className="text-sm h-9"
            />
            <div className="grid grid-cols-2 gap-2">
              <Select value={newRolePriority} onValueChange={(v) => setNewRolePriority(v as FilterPriority)}>
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={newRoleScope} onValueChange={(v) => setNewRoleScope(v as FilterScope)}>
                <SelectTrigger className="text-xs h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={handleAddRole} disabled={!newRoleKeywords.trim()} className="w-full h-8">
              <Plus className="w-4 h-4 mr-1" />
              Ajouter
            </Button>
          </div>
        </FilterSection>

        {/* Industry */}
        <FilterSection title="Secteur d'activité" icon={<Layers className="w-4 h-4 text-[#0077B5]" />} badge={filters.industry.length}>
          <SelectedBadges items={filters.industry} onRemove={(id) => handleRemoveSimpleFilter('industry', id)} />
          <AutocompleteInput
            filterKey="industry"
            placeholder="Rechercher un secteur..."
            onSelect={(item) => handleAddSimpleFilter('industry', item)}
          />
        </FilterSection>

        {/* School */}
        <FilterSection title="École / Formation" icon={<GraduationCap className="w-4 h-4 text-[#0077B5]" />} badge={filters.school.length}>
          <SelectedBadges items={filters.school} onRemove={(id) => handleRemoveSimpleFilter('school', id)} />
          <AutocompleteInput
            filterKey="school"
            placeholder="Rechercher une école..."
            onSelect={(item) => handleAddSimpleFilter('school', item)}
          />
        </FilterSection>

        {/* Skills with priority */}
        <FilterSection title="Compétences" icon={<Zap className="w-4 h-4 text-[#0077B5]" />} badge={filters.skills.length}>
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
        </FilterSection>

        {/* Seniority */}
        <FilterSection title="Niveau d'expérience" icon={<Target className="w-4 h-4 text-[#0077B5]" />} badge={filters.seniority.length}>
          <div className="grid grid-cols-2 gap-2">
            {SENIORITY_LEVELS.map((level) => (
              <label key={level.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={filters.seniority.includes(level.value)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onChange({ ...filters, seniority: [...filters.seniority, level.value] });
                    } else {
                      onChange({ ...filters, seniority: filters.seniority.filter((s) => s !== level.value) });
                    }
                  }}
                />
                <span className="truncate">{level.label}</span>
              </label>
            ))}
          </div>
        </FilterSection>

        {/* Network Distance */}
        <FilterSection title="Degré de connexion" icon={<Users className="w-4 h-4 text-[#0077B5]" />} badge={filters.network_distance.length}>
          <div className="space-y-2">
            {NETWORK_DISTANCES.map((dist) => (
              <label key={dist.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={filters.network_distance.includes(dist.value)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onChange({ ...filters, network_distance: [...filters.network_distance, dist.value] });
                    } else {
                      onChange({ ...filters, network_distance: filters.network_distance.filter((d) => d !== dist.value) });
                    }
                  }}
                />
                {dist.label}
              </label>
            ))}
          </div>
        </FilterSection>

        {/* Years of Experience */}
        <FilterSection title="Années d'expérience" icon={<Clock className="w-4 h-4 text-[#0077B5]" />}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Min</Label>
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
                className="text-sm h-9"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Max</Label>
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
                className="text-sm h-9"
              />
            </div>
          </div>
        </FilterSection>

        {/* Profile Languages */}
        <FilterSection title="Langue du profil" icon={<Globe className="w-4 h-4 text-[#0077B5]" />} badge={filters.profile_language.length}>
          <div className="grid grid-cols-2 gap-2">
            {PROFILE_LANGUAGES.map((lang) => (
              <label key={lang.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={filters.profile_language.includes(lang.value)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onChange({ ...filters, profile_language: [...filters.profile_language, lang.value] });
                    } else {
                      onChange({ ...filters, profile_language: filters.profile_language.filter((l) => l !== lang.value) });
                    }
                  }}
                />
                {lang.label}
              </label>
            ))}
          </div>
        </FilterSection>

        {/* Open to Work */}
        <FilterSection title="Open to Work" icon={<Zap className="w-4 h-4 text-green-500" />}>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Afficher uniquement les profils Open to Work</span>
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
        </FilterSection>

        {/* ===== PAST EXPERIENCE FILTERS ===== */}
        
        {/* Past Company */}
        <FilterSection title="Entreprise passée" icon={<History className="w-4 h-4 text-amber-600" />} badge={filters.past_company.length}>
          <SelectedBadges items={filters.past_company} onRemove={(id) => handleRemoveSimpleFilter('past_company', id)} />
          <AutocompleteInput
            filterKey="past_company"
            placeholder="Rechercher une ancienne entreprise..."
            onSelect={(item) => handleAddSimpleFilter('past_company', item)}
          />
        </FilterSection>

        {/* Past Job Title */}
        <FilterSection title="Poste passé" icon={<Briefcase className="w-4 h-4 text-amber-600" />} badge={filters.past_job_title.length}>
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
        </FilterSection>

        {/* ===== TENURE FILTERS ===== */}
        
        {/* Tenure at Company */}
        <FilterSection title="Ancienneté dans l'entreprise" icon={<Building className="w-4 h-4 text-[#0077B5]" />}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Min (années)</Label>
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
                className="text-sm h-9"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Max (années)</Label>
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
                className="text-sm h-9"
              />
            </div>
          </div>
        </FilterSection>

        {/* Tenure at Role */}
        <FilterSection title="Ancienneté dans le poste" icon={<Clock className="w-4 h-4 text-[#0077B5]" />}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Min (années)</Label>
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
                className="text-sm h-9"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Max (années)</Label>
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
                className="text-sm h-9"
              />
            </div>
          </div>
        </FilterSection>

        {/* ===== COMPANY FILTERS (Sales Navigator style) ===== */}
        
        {/* Company Headcount */}
        <FilterSection title="Taille de l'entreprise" icon={<BarChart3 className="w-4 h-4 text-[#0077B5]" />} badge={filters.company_headcount.length}>
          <div className="grid grid-cols-2 gap-2">
            {COMPANY_HEADCOUNT_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={filters.company_headcount.includes(opt.value)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onChange({ ...filters, company_headcount: [...filters.company_headcount, opt.value] });
                    } else {
                      onChange({ ...filters, company_headcount: filters.company_headcount.filter((h) => h !== opt.value) });
                    }
                  }}
                />
                <span className="truncate">{opt.label}</span>
              </label>
            ))}
          </div>
        </FilterSection>

        {/* Company Type */}
        <FilterSection title="Type d'entreprise" icon={<Building2 className="w-4 h-4 text-[#0077B5]" />} badge={filters.company_type.length}>
          <div className="space-y-2">
            {COMPANY_TYPE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={filters.company_type.includes(opt.value)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onChange({ ...filters, company_type: [...filters.company_type, opt.value] });
                    } else {
                      onChange({ ...filters, company_type: filters.company_type.filter((t) => t !== opt.value) });
                    }
                  }}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </FilterSection>

        {/* ===== RECRUITER SPECIFIC ===== */}
        
        {/* Spotlight */}
        <FilterSection title="Spotlight (Recruiter)" icon={<Target className="w-4 h-4 text-purple-500" />}>
          <Select 
            value={filters.spotlight || '_empty'} 
            onValueChange={(v) => onChange({ ...filters, spotlight: v === '_empty' ? '' : v as typeof filters.spotlight })}
          >
            <SelectTrigger className="text-sm h-9">
              <SelectValue placeholder="Tous les profils" />
            </SelectTrigger>
            <SelectContent>
              {SPOTLIGHT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value || '_empty'} value={opt.value || '_empty'}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSection>

        {/* Hiring Project */}
        <FilterSection title="Hiring Project" icon={<Briefcase className="w-4 h-4 text-purple-500" />}>
          <Input
            value={filters.hiring_project}
            onChange={(e) => onChange({ ...filters, hiring_project: e.target.value })}
            placeholder="ID du projet de recrutement"
            className="text-sm h-9"
          />
        </FilterSection>

        {/* Talent Pool */}
        <FilterSection title="Talent Pool" icon={<Users className="w-4 h-4 text-purple-500" />}>
          <Input
            value={filters.talent_pool}
            onChange={(e) => onChange({ ...filters, talent_pool: e.target.value })}
            placeholder="ID du pool de talents"
            className="text-sm h-9"
          />
        </FilterSection>
      </div>
    </ScrollArea>
  );
};
