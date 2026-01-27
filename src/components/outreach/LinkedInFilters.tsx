import React, { useState, useCallback, useRef, useEffect } from 'react';
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
} from './types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ChevronDown,
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
} from 'lucide-react';
import { toast } from 'sonner';

interface LinkedInFiltersProps {
  filters: LinkedInFiltersState;
  onChange: (filters: LinkedInFiltersState) => void;
  accountId: string | null;
}

interface ParameterOption {
  id: string;
  title: string; // API returns 'title', not 'name'
}

export const LinkedInFilters: React.FC<LinkedInFiltersProps> = ({
  filters,
  onChange,
  accountId,
}) => {
  const [expandedSections, setExpandedSections] = useState<string[]>(['location', 'job_title']);
  const [loadingParams, setLoadingParams] = useState<string | null>(null);
  const [parameterOptions, setParameterOptions] = useState<Record<string, ParameterOption[]>>({});
  const [searchInputs, setSearchInputs] = useState<Record<string, string>>({});
  const debounceRef = useRef<Record<string, NodeJS.Timeout>>({});

  const toggleSection = (section: string) => {
    setExpandedSections((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]
    );
  };

  // Map frontend filter keys to Unipile API parameter types
  const getParameterType = (key: string): string => {
    const typeMap: Record<string, string> = {
      location: 'LOCATION',
      company: 'COMPANY',
      job_title: 'JOB_TITLE',
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

        if (response.error) throw response.error;
        if (!response.data?.success) {
          console.warn('Parameters fetch failed:', response.data?.error);
          setParameterOptions((prev) => ({ ...prev, [key]: [] }));
          return;
        }

        setParameterOptions((prev) => ({
          ...prev,
          [key]: response.data.items || [],
        }));
      } catch (error) {
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

    // Clear existing debounce
    if (debounceRef.current[key]) {
      clearTimeout(debounceRef.current[key]);
    }

    // Debounced search
    if (value.length >= 2) {
      debounceRef.current[key] = setTimeout(() => {
        fetchParameters(key, value);
      }, 300);
    } else {
      setParameterOptions((prev) => ({ ...prev, [key]: [] }));
    }
  };

  // Simple filter add (location, company, industry, school)
  const handleAddSimpleFilter = (key: 'location' | 'company' | 'industry' | 'school', item: ParameterOption) => {
    const current = filters[key];
    if (!current.find((f) => f.id === item.id)) {
      onChange({ ...filters, [key]: [...current, { id: item.id, name: item.title }] });
    }
    setSearchInputs((prev) => ({ ...prev, [key]: '' }));
    setParameterOptions((prev) => ({ ...prev, [key]: [] }));
  };

  const handleRemoveSimpleFilter = (key: 'location' | 'company' | 'industry' | 'school', id: string) => {
    onChange({ ...filters, [key]: filters[key].filter((f) => f.id !== id) });
  };

  // Priority filter add (job_title, skills)
  const handleAddPriorityFilter = (
    key: 'job_title' | 'skills',
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

  const handleUpdatePriority = (key: 'job_title' | 'skills', id: string, priority: FilterPriority) => {
    onChange({
      ...filters,
      [key]: filters[key].map((f) => (f.id === id ? { ...f, priority } : f)),
    });
  };

  const handleRemovePriorityFilter = (key: 'job_title' | 'skills', id: string) => {
    onChange({ ...filters, [key]: filters[key].filter((f) => f.id !== id) });
  };

  // Role filter
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

  // Render simple filter section
  const renderSimpleFilterSection = (
    key: 'location' | 'company' | 'industry' | 'school',
    label: string,
    icon: React.ReactNode
  ) => {
    const values = filters[key];
    const searchValue = searchInputs[key] || '';
    const options = parameterOptions[key] || [];

    return (
      <Collapsible open={expandedSections.includes(key)} onOpenChange={() => toggleSection(key)}>
        <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-gray-50 rounded-lg transition-colors">
          <div className="flex items-center gap-2 text-sm font-medium text-[#1A1A1A]">
            {icon}
            {label}
            {values.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {values.length}
              </Badge>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-[#1A1A1A]/40 transition-transform ${
              expandedSections.includes(key) ? 'rotate-180' : ''
            }`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <div className="space-y-2">
            {/* Selected values */}
            {values.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {values.map((item) => (
                  <Badge
                    key={item.id}
                    variant="secondary"
                    className="gap-1 pr-1 bg-[#0077B5]/10 text-[#0077B5] hover:bg-[#0077B5]/20"
                  >
                    {item.name}
                    <button
                      onClick={() => handleRemoveSimpleFilter(key, item.id)}
                      className="ml-1 hover:bg-[#0077B5]/20 rounded-full p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Search input */}
            <div className="relative">
              <Input
                value={searchValue}
                onChange={(e) => handleSearchInput(key, e.target.value)}
                placeholder={`Rechercher ${label.toLowerCase()}...`}
                className="text-sm"
              />
              {loadingParams === key && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-[#0077B5]" />
              )}
            </div>

            {/* Options dropdown */}
            {options.length > 0 && (
              <div className="bg-white border rounded-lg shadow-lg max-h-40 overflow-auto">
                {options.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => handleAddSimpleFilter(key, option)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                  >
                    {option.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  // Render priority filter section (job_title, skills)
  const renderPriorityFilterSection = (
    key: 'job_title' | 'skills',
    label: string,
    icon: React.ReactNode
  ) => {
    const values = filters[key];
    const searchValue = searchInputs[key] || '';
    const options = parameterOptions[key] || [];

    return (
      <Collapsible open={expandedSections.includes(key)} onOpenChange={() => toggleSection(key)}>
        <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-gray-50 rounded-lg transition-colors">
          <div className="flex items-center gap-2 text-sm font-medium text-[#1A1A1A]">
            {icon}
            {label}
            {values.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                {values.length}
              </Badge>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-[#1A1A1A]/40 transition-transform ${
              expandedSections.includes(key) ? 'rotate-180' : ''
            }`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <div className="space-y-2">
            {/* Selected values with priority */}
            {values.length > 0 && (
              <div className="space-y-1">
                {values.map((item) => {
                  const priorityConfig = PRIORITY_OPTIONS.find((p) => p.value === item.priority);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 p-2 bg-gray-50 rounded-lg"
                    >
                      <span className="text-sm flex-1 truncate">{item.name}</span>
                      <Select
                        value={item.priority}
                        onValueChange={(val) => handleUpdatePriority(key, item.id, val as FilterPriority)}
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
                      <button
                        onClick={() => handleRemovePriorityFilter(key, item.id)}
                        className="text-red-400 hover:text-red-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Search input */}
            <div className="relative">
              <Input
                value={searchValue}
                onChange={(e) => handleSearchInput(key, e.target.value)}
                placeholder={`Rechercher ${label.toLowerCase()}...`}
                className="text-sm"
              />
              {loadingParams === key && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-[#0077B5]" />
              )}
            </div>

            {/* Options dropdown */}
            {options.length > 0 && (
              <div className="bg-white border rounded-lg shadow-lg max-h-40 overflow-auto">
                {options.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => handleAddPriorityFilter(key, option)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors flex items-center justify-between"
                  >
                    <span>{option.title}</span>
                    <Plus className="w-4 h-4 text-[#0077B5]" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  return (
    <ScrollArea className="bg-white rounded-lg border border-[#1A1A1A]/10">
      <div className="p-2 max-h-[600px]">
        {/* Location */}
        {renderSimpleFilterSection('location', 'Localisation', <MapPin className="w-4 h-4 text-[#0077B5]" />)}

        {/* Company */}
        {renderSimpleFilterSection('company', 'Entreprise', <Building2 className="w-4 h-4 text-[#0077B5]" />)}

        {/* Job Title with priority */}
        {renderPriorityFilterSection('job_title', 'Poste', <Briefcase className="w-4 h-4 text-[#0077B5]" />)}

        {/* Role (keywords with scope) */}
        <Collapsible open={expandedSections.includes('role')} onOpenChange={() => toggleSection('role')}>
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-gray-50 rounded-lg transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium text-[#1A1A1A]">
              <Sparkles className="w-4 h-4 text-purple-500" />
              Rôle (mots-clés)
              {filters.role.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {filters.role.length}
                </Badge>
              )}
            </div>
            <ChevronDown
              className={`w-4 h-4 text-[#1A1A1A]/40 transition-transform ${
                expandedSections.includes('role') ? 'rotate-180' : ''
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3">
            <div className="space-y-2">
              {/* Existing roles */}
              {filters.role.map((role, index) => {
                const priorityConfig = PRIORITY_OPTIONS.find((p) => p.value === role.priority);
                const scopeConfig = SCOPE_OPTIONS.find((s) => s.value === role.scope);
                return (
                  <div key={index} className="p-2 bg-gray-50 rounded-lg space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{role.keywords}</span>
                      <button onClick={() => handleRemoveRole(index)} className="text-red-400 hover:text-red-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex gap-1 text-xs">
                      <Badge className={priorityConfig?.color}>{priorityConfig?.label}</Badge>
                      <Badge variant="outline">{scopeConfig?.label}</Badge>
                    </div>
                  </div>
                );
              })}

              {/* Add new role */}
              <div className="space-y-2 pt-2 border-t">
                <Input
                  value={newRoleKeywords}
                  onChange={(e) => setNewRoleKeywords(e.target.value)}
                  placeholder="Ex: developer OR engineer"
                  className="text-sm"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Select value={newRolePriority} onValueChange={(v) => setNewRolePriority(v as FilterPriority)}>
                    <SelectTrigger className="text-xs h-8">
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
                  <Select value={newRoleScope} onValueChange={(v) => setNewRoleScope(v as FilterScope)}>
                    <SelectTrigger className="text-xs h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCOPE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" variant="outline" onClick={handleAddRole} disabled={!newRoleKeywords.trim()} className="w-full">
                  <Plus className="w-4 h-4 mr-1" />
                  Ajouter le rôle
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Industry */}
        {renderSimpleFilterSection('industry', 'Secteur', <Layers className="w-4 h-4 text-[#0077B5]" />)}

        {/* School */}
        {renderSimpleFilterSection('school', 'École', <GraduationCap className="w-4 h-4 text-[#0077B5]" />)}

        {/* Skills with priority */}
        {renderPriorityFilterSection('skills', 'Compétences', <Zap className="w-4 h-4 text-[#0077B5]" />)}

        {/* Seniority */}
        <Collapsible open={expandedSections.includes('seniority')} onOpenChange={() => toggleSection('seniority')}>
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-gray-50 rounded-lg transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium text-[#1A1A1A]">
              <Target className="w-4 h-4 text-[#0077B5]" />
              Niveau d'expérience
              {filters.seniority.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {filters.seniority.length}
                </Badge>
              )}
            </div>
            <ChevronDown
              className={`w-4 h-4 text-[#1A1A1A]/40 transition-transform ${
                expandedSections.includes('seniority') ? 'rotate-180' : ''
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3">
            <div className="space-y-2">
              {SENIORITY_LEVELS.map((level) => (
                <label key={level.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.seniority.includes(level.value)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onChange({ ...filters, seniority: [...filters.seniority, level.value] });
                      } else {
                        onChange({ ...filters, seniority: filters.seniority.filter((s) => s !== level.value) });
                      }
                    }}
                    className="rounded border-gray-300"
                  />
                  {level.label}
                </label>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Network Distance */}
        <Collapsible open={expandedSections.includes('network')} onOpenChange={() => toggleSection('network')}>
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-gray-50 rounded-lg transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium text-[#1A1A1A]">
              <Users className="w-4 h-4 text-[#0077B5]" />
              Degré de connexion
              {filters.network_distance.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {filters.network_distance.length}
                </Badge>
              )}
            </div>
            <ChevronDown
              className={`w-4 h-4 text-[#1A1A1A]/40 transition-transform ${
                expandedSections.includes('network') ? 'rotate-180' : ''
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3">
            <div className="space-y-2">
              {NETWORK_DISTANCES.map((dist) => (
                <label key={dist.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.network_distance.includes(dist.value)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onChange({ ...filters, network_distance: [...filters.network_distance, dist.value] });
                      } else {
                        onChange({ ...filters, network_distance: filters.network_distance.filter((d) => d !== dist.value) });
                      }
                    }}
                    className="rounded border-gray-300"
                  />
                  {dist.label}
                </label>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Years of Experience */}
        <Collapsible open={expandedSections.includes('experience')} onOpenChange={() => toggleSection('experience')}>
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-gray-50 rounded-lg transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium text-[#1A1A1A]">
              <Users className="w-4 h-4 text-[#0077B5]" />
              Années d'expérience
            </div>
            <ChevronDown
              className={`w-4 h-4 text-[#1A1A1A]/40 transition-transform ${
                expandedSections.includes('experience') ? 'rotate-180' : ''
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Min</Label>
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
                  className="text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Max</Label>
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
                  className="text-sm"
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Open to Work */}
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-[#1A1A1A]">
            <Zap className="w-4 h-4 text-green-500" />
            Open to Work
          </div>
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

        {/* Recruiter Specific */}
        <Collapsible open={expandedSections.includes('recruiter')} onOpenChange={() => toggleSection('recruiter')}>
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-gray-50 rounded-lg transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium text-[#1A1A1A]">
              <Target className="w-4 h-4 text-purple-500" />
              Filtres Recruiter
            </div>
            <ChevronDown
              className={`w-4 h-4 text-[#1A1A1A]/40 transition-transform ${
                expandedSections.includes('recruiter') ? 'rotate-180' : ''
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3 space-y-3">
            <div>
              <Label className="text-xs">Hiring Project (ID)</Label>
              <Input
                value={filters.hiring_project}
                onChange={(e) => onChange({ ...filters, hiring_project: e.target.value })}
                placeholder="ID du projet"
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Talent Pool (ID)</Label>
              <Input
                value={filters.talent_pool}
                onChange={(e) => onChange({ ...filters, talent_pool: e.target.value })}
                placeholder="ID du pool"
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Spotlight</Label>
              <Select value={filters.spotlight} onValueChange={(v) => onChange({ ...filters, spotlight: v })}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Tous" />
                </SelectTrigger>
                <SelectContent>
                  {SPOTLIGHT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value || '_all'}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </ScrollArea>
  );
};
