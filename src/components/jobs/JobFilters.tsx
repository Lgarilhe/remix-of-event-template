import React, { useState, useMemo } from 'react';
import { Search, X, Code, ChevronDown, Filter } from 'lucide-react';
import { Job, JobFiltersState } from '@/pages/JobSpace';
import { useIsMobile } from '@/hooks/use-mobile';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface JobFiltersProps {
  filters: JobFiltersState;
  setFilters: React.Dispatch<React.SetStateAction<JobFiltersState>>;
  jobs: Job[];
}

export const JobFilters: React.FC<JobFiltersProps> = ({ filters, setFilters, jobs }) => {
  const [skillSearch, setSkillSearch] = useState('');
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(!isMobile);

  // Extract unique values for filters
  const statuses = [...new Set(jobs.map(j => j.status).filter(Boolean))];
  const contractTypes = [...new Set(jobs.map(j => j.contractType).filter(Boolean))];
  const remoteOptions = [...new Set(jobs.map(j => j.remote).filter(Boolean))];
  const sectors = [...new Set(jobs.map(j => j.client?.sector).filter(Boolean))] as string[];
  const priorities = [...new Set(jobs.map(j => j.priority).filter(Boolean))];
  const seniorities = [...new Set(jobs.map(j => j.seniority).filter(Boolean))];
  
  // Extract all unique skills from jobs
  const allSkills = useMemo(() => {
    const skillsSet = new Set<string>();
    jobs.forEach(job => {
      job.skills?.forEach(skill => {
        if (skill && skill.trim()) {
          skillsSet.add(skill.trim());
        }
      });
    });
    return [...skillsSet].sort();
  }, [jobs]);

  // Filter skills based on search
  const filteredSkills = useMemo(() => {
    if (!skillSearch) return allSkills.slice(0, 15);
    return allSkills.filter(skill => 
      skill.toLowerCase().includes(skillSearch.toLowerCase())
    ).slice(0, 15);
  }, [allSkills, skillSearch]);

  const toggleFilter = (key: 'status' | 'contractType' | 'remote' | 'sector' | 'priority' | 'seniority' | 'skills', value: string) => {
    setFilters(prev => {
      const current = prev[key];
      const updated = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [key]: updated };
    });
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      status: [],
      contractType: [],
      location: '',
      remote: [],
      sector: [],
      priority: [],
      seniority: [],
      skills: [],
    });
    setSkillSearch('');
  };

  const activeFilterCount = 
    filters.status.length + 
    filters.contractType.length + 
    filters.remote.length +
    filters.sector.length +
    filters.priority.length +
    filters.seniority.length +
    filters.skills.length +
    (filters.location ? 1 : 0);

  const hasActiveFilters = filters.search || activeFilterCount > 0;

  return (
    <div className="mb-6">
      {/* Search - Always visible */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1A1A1A]/40" />
        <input
          type="text"
          placeholder="Rechercher un poste, une entreprise..."
          value={filters.search}
          onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#1A1A1A]/10 focus:border-[#1A1A1A]/30 focus:outline-none transition-colors text-sm rounded-sm"
        />
      </div>

      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger className="flex items-center gap-2 text-sm text-[#1A1A1A]/60 hover:text-[#1A1A1A] transition-colors py-2">
            <Filter className="w-4 h-4" />
            <span>Filtres avancés</span>
            {activeFilterCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] bg-[#FA76FF] text-white rounded-full font-medium">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 text-xs text-[#1A1A1A]/50 hover:text-[#1A1A1A] transition-colors"
            >
              <X className="w-3 h-3" />
              Effacer
            </button>
          )}
        </div>

        <CollapsibleContent className="pt-3">
          <div className="bg-white/50 border border-[#1A1A1A]/5 rounded-sm p-4 space-y-4">
            {/* Skills Filter */}
            {allSkills.length > 0 && (
              <FilterSection 
                label="Compétences" 
                icon={<Code className="w-3 h-3" />}
              >
                {/* Selected skills */}
                {filters.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {filters.skills.map((skill, index) => (
                      <FilterChip
                        key={`selected-skill-${index}-${skill}`}
                        label={skill}
                        active
                        onToggle={() => toggleFilter('skills', skill)}
                        showRemove
                        accent
                      />
                    ))}
                  </div>
                )}

                {/* Skills search */}
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#1A1A1A]/30" />
                  <input
                    type="text"
                    placeholder="Rechercher..."
                    value={skillSearch}
                    onChange={(e) => setSkillSearch(e.target.value)}
                    className="w-full md:w-48 pl-8 pr-3 py-1.5 border border-[#1A1A1A]/10 focus:border-[#1A1A1A]/20 focus:outline-none transition-colors text-xs bg-white/80 rounded-sm"
                  />
                </div>

                {/* Available skills */}
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {filteredSkills
                    .filter(skill => !filters.skills.includes(skill))
                    .map((skill, index) => (
                      <FilterChip
                        key={`skill-${index}-${skill}`}
                        label={skill}
                        onToggle={() => toggleFilter('skills', skill)}
                      />
                    ))}
                  {filteredSkills.length === 0 && skillSearch && (
                    <span className="text-xs text-[#1A1A1A]/40 italic">Aucune compétence trouvée</span>
                  )}
                </div>
              </FilterSection>
            )}

            {/* Two column layout for other filters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Priority */}
              {priorities.length > 0 && (
                <FilterSection label="Priorité">
                  <div className="flex flex-wrap gap-1.5">
                    {priorities.map((priority, index) => (
                      <FilterChip
                        key={`priority-${index}-${priority}`}
                        label={priority}
                        active={filters.priority.includes(priority)}
                        onToggle={() => toggleFilter('priority', priority)}
                      />
                    ))}
                  </div>
                </FilterSection>
              )}

              {/* Seniority */}
              {seniorities.length > 0 && (
                <FilterSection label="Séniorité">
                  <div className="flex flex-wrap gap-1.5">
                    {seniorities.map((seniority, index) => (
                      <FilterChip
                        key={`seniority-${index}-${seniority}`}
                        label={seniority}
                        active={filters.seniority.includes(seniority)}
                        onToggle={() => toggleFilter('seniority', seniority)}
                      />
                    ))}
                  </div>
                </FilterSection>
              )}

              {/* Sector */}
              {sectors.length > 0 && (
                <FilterSection label="Secteur">
                  <div className="flex flex-wrap gap-1.5">
                    {sectors.map((sector, index) => (
                      <FilterChip
                        key={`sector-${index}-${sector}`}
                        label={sector}
                        active={filters.sector.includes(sector)}
                        onToggle={() => toggleFilter('sector', sector)}
                      />
                    ))}
                  </div>
                </FilterSection>
              )}

              {/* Contract Type */}
              {contractTypes.length > 0 && (
                <FilterSection label="Type de contrat">
                  <div className="flex flex-wrap gap-1.5">
                    {contractTypes.map((type, index) => (
                      <FilterChip
                        key={`contract-${index}-${type}`}
                        label={type}
                        active={filters.contractType.includes(type)}
                        onToggle={() => toggleFilter('contractType', type)}
                      />
                    ))}
                  </div>
                </FilterSection>
              )}

              {/* Remote */}
              {remoteOptions.length > 0 && (
                <FilterSection label="Télétravail">
                  <div className="flex flex-wrap gap-1.5">
                    {remoteOptions.map((option, index) => (
                      <FilterChip
                        key={`remote-${index}-${option}`}
                        label={option}
                        active={filters.remote.includes(option)}
                        onToggle={() => toggleFilter('remote', option)}
                      />
                    ))}
                  </div>
                </FilterSection>
              )}

              {/* Status */}
              {statuses.length > 0 && (
                <FilterSection label="Statut">
                  <div className="flex flex-wrap gap-1.5">
                    {statuses.map((status, index) => (
                      <FilterChip
                        key={`status-${index}-${status}`}
                        label={status}
                        active={filters.status.includes(status)}
                        onToggle={() => toggleFilter('status', status)}
                      />
                    ))}
                  </div>
                </FilterSection>
              )}
            </div>

            {/* Location */}
            <FilterSection label="Localisation">
              <input
                type="text"
                placeholder="Paris, Lyon, Remote..."
                value={filters.location}
                onChange={(e) => setFilters(prev => ({ ...prev, location: e.target.value }))}
                className="w-full md:w-48 px-3 py-1.5 border border-[#1A1A1A]/10 focus:border-[#1A1A1A]/20 focus:outline-none transition-colors text-xs bg-white/80 rounded-sm"
              />
            </FilterSection>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

// Sub-components
interface FilterSectionProps {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

const FilterSection: React.FC<FilterSectionProps> = ({ label, icon, children }) => (
  <div>
    <label className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[#1A1A1A]/50 mb-1.5">
      {icon}
      {label}
    </label>
    {children}
  </div>
);

interface FilterChipProps {
  label: string;
  active?: boolean;
  onToggle: () => void;
  showRemove?: boolean;
  accent?: boolean;
}

const FilterChip: React.FC<FilterChipProps> = ({ label, active, onToggle, showRemove, accent }) => (
  <button
    onClick={onToggle}
    className={`px-2 py-1 text-[11px] font-medium tracking-wide border transition-all rounded-sm flex items-center gap-1 ${
      active
        ? accent
          ? 'bg-[#FA76FF] text-white border-[#FA76FF] hover:bg-[#FA76FF]/90'
          : 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
        : 'bg-white/80 text-[#1A1A1A]/70 border-[#1A1A1A]/10 hover:border-[#1A1A1A]/30 hover:text-[#1A1A1A]'
    }`}
  >
    {label}
    {showRemove && <X className="w-2.5 h-2.5" />}
  </button>
);
