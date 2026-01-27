import React, { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInFiltersState } from './LinkedInSearch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, X, Loader2, MapPin, Building2, Briefcase, GraduationCap, Layers, Zap, Target, Users } from 'lucide-react';
import { toast } from 'sonner';

interface LinkedInFiltersProps {
  filters: LinkedInFiltersState;
  onChange: (filters: LinkedInFiltersState) => void;
  accountId: string | null;
}

interface ParameterOption {
  id: string;
  name: string;
}

export const LinkedInFilters: React.FC<LinkedInFiltersProps> = ({
  filters,
  onChange,
  accountId,
}) => {
  const [expandedSections, setExpandedSections] = useState<string[]>(['location', 'company']);
  const [loadingParams, setLoadingParams] = useState<string | null>(null);
  const [parameterOptions, setParameterOptions] = useState<Record<string, ParameterOption[]>>({});
  const [searchInputs, setSearchInputs] = useState<Record<string, string>>({});

  const toggleSection = (section: string) => {
    setExpandedSections(prev =>
      prev.includes(section)
        ? prev.filter(s => s !== section)
        : [...prev, section]
    );
  };

  const fetchParameters = useCallback(async (type: string, keywords: string) => {
    if (!accountId || !keywords.trim()) return;

    setLoadingParams(type);
    try {
      const response = await supabase.functions.invoke('unipile-search', {
        body: {
          action: 'get_parameters',
          account_id: accountId,
          type: type.toUpperCase(),
          keywords: keywords.trim(),
          service: 'RECRUITER',
        },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      setParameterOptions(prev => ({
        ...prev,
        [type]: response.data.items || [],
      }));
    } catch (error) {
      console.error('Error fetching parameters:', error);
      toast.error('Erreur de chargement des options');
    } finally {
      setLoadingParams(null);
    }
  }, [accountId]);

  const handleAddFilter = (key: keyof LinkedInFiltersState, value: string) => {
    const currentValues = filters[key] as string[];
    if (!currentValues.includes(value)) {
      onChange({ ...filters, [key]: [...currentValues, value] });
    }
    setSearchInputs(prev => ({ ...prev, [key]: '' }));
    setParameterOptions(prev => ({ ...prev, [key]: [] }));
  };

  const handleRemoveFilter = (key: keyof LinkedInFiltersState, value: string) => {
    const currentValues = filters[key] as string[];
    onChange({ ...filters, [key]: currentValues.filter(v => v !== value) });
  };

  const handleSearchInput = (key: string, value: string) => {
    setSearchInputs(prev => ({ ...prev, [key]: value }));
    
    // Debounced search
    if (value.length >= 2) {
      const paramType = key === 'job_title' ? 'JOB_TITLE' : key.toUpperCase();
      fetchParameters(key, value);
    }
  };

  const renderFilterSection = (
    key: keyof LinkedInFiltersState,
    label: string,
    icon: React.ReactNode,
    paramType?: string
  ) => {
    const values = filters[key] as string[];
    const searchValue = searchInputs[key] || '';
    const options = parameterOptions[key] || [];

    return (
      <Collapsible
        open={expandedSections.includes(key)}
        onOpenChange={() => toggleSection(key)}
      >
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
          <ChevronDown className={`w-4 h-4 text-[#1A1A1A]/40 transition-transform ${expandedSections.includes(key) ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <div className="space-y-2">
            {/* Selected values */}
            {values.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {values.map((value) => (
                  <Badge
                    key={value}
                    variant="secondary"
                    className="gap-1 pr-1 bg-[#0077B5]/10 text-[#0077B5] hover:bg-[#0077B5]/20"
                  >
                    {value}
                    <button
                      onClick={() => handleRemoveFilter(key, value)}
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
                    onClick={() => handleAddFilter(key, option.id)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                  >
                    {option.name}
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
      <div className="p-2 max-h-[500px]">
        {/* Location */}
        {renderFilterSection('location', 'Localisation', <MapPin className="w-4 h-4 text-[#0077B5]" />)}
        
        {/* Company */}
        {renderFilterSection('company', 'Entreprise', <Building2 className="w-4 h-4 text-[#0077B5]" />)}
        
        {/* Job Title */}
        {renderFilterSection('job_title', 'Poste', <Briefcase className="w-4 h-4 text-[#0077B5]" />)}
        
        {/* Industry */}
        {renderFilterSection('industry', 'Secteur', <Layers className="w-4 h-4 text-[#0077B5]" />)}
        
        {/* School */}
        {renderFilterSection('school', 'École', <GraduationCap className="w-4 h-4 text-[#0077B5]" />)}
        
        {/* Skills */}
        {renderFilterSection('skills', 'Compétences', <Zap className="w-4 h-4 text-[#0077B5]" />)}
        
        {/* Seniority */}
        <Collapsible
          open={expandedSections.includes('seniority')}
          onOpenChange={() => toggleSection('seniority')}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-gray-50 rounded-lg transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium text-[#1A1A1A]">
              <Target className="w-4 h-4 text-[#0077B5]" />
              Niveau d'expérience
            </div>
            <ChevronDown className={`w-4 h-4 text-[#1A1A1A]/40 transition-transform ${expandedSections.includes('seniority') ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3">
            <div className="space-y-2">
              {['Entry', 'Senior', 'Director', 'VP', 'CXO'].map((level) => (
                <label key={level} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={filters.seniority.includes(level)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onChange({ ...filters, seniority: [...filters.seniority, level] });
                      } else {
                        onChange({ ...filters, seniority: filters.seniority.filter(s => s !== level) });
                      }
                    }}
                    className="rounded border-gray-300"
                  />
                  {level}
                </label>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
        
        {/* Years of Experience */}
        <Collapsible
          open={expandedSections.includes('experience')}
          onOpenChange={() => toggleSection('experience')}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-gray-50 rounded-lg transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium text-[#1A1A1A]">
              <Users className="w-4 h-4 text-[#0077B5]" />
              Années d'expérience
            </div>
            <ChevronDown className={`w-4 h-4 text-[#1A1A1A]/40 transition-transform ${expandedSections.includes('experience') ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Min</Label>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={filters.years_of_experience_min || ''}
                    onChange={(e) => onChange({ 
                      ...filters, 
                      years_of_experience_min: e.target.value ? parseInt(e.target.value) : null 
                    })}
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
                    value={filters.years_of_experience_max || ''}
                    onChange={(e) => onChange({ 
                      ...filters, 
                      years_of_experience_max: e.target.value ? parseInt(e.target.value) : null 
                    })}
                    placeholder="50"
                    className="text-sm"
                  />
                </div>
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
            onCheckedChange={(checked) => onChange({ 
              ...filters, 
              open_to_work: checked ? true : null 
            })}
          />
        </div>
        
        {/* Recruiter Specific */}
        <Collapsible
          open={expandedSections.includes('recruiter')}
          onOpenChange={() => toggleSection('recruiter')}
        >
          <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-gray-50 rounded-lg transition-colors">
            <div className="flex items-center gap-2 text-sm font-medium text-[#1A1A1A]">
              <Target className="w-4 h-4 text-purple-500" />
              Filtres Recruiter
            </div>
            <ChevronDown className={`w-4 h-4 text-[#1A1A1A]/40 transition-transform ${expandedSections.includes('recruiter') ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="px-3 pb-3 space-y-3">
            <div>
              <Label className="text-xs">Hiring Project</Label>
              <Input
                value={filters.hiring_project}
                onChange={(e) => onChange({ ...filters, hiring_project: e.target.value })}
                placeholder="ID du projet"
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Talent Pool</Label>
              <Input
                value={filters.talent_pool}
                onChange={(e) => onChange({ ...filters, talent_pool: e.target.value })}
                placeholder="ID du pool"
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Spotlight</Label>
              <select
                value={filters.spotlight}
                onChange={(e) => onChange({ ...filters, spotlight: e.target.value })}
                className="w-full px-3 py-2 text-sm border rounded-md"
              >
                <option value="">Tous</option>
                <option value="RECENTLY_CHANGED_JOBS">Changement récent</option>
                <option value="RECENTLY_PROMOTED">Promu récemment</option>
                <option value="OPEN_LINK">Open Link</option>
              </select>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </ScrollArea>
  );
};
