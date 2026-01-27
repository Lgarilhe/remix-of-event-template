import React, { useState, useMemo } from 'react';
import { Search, X, Code } from 'lucide-react';
import { Job, JobFiltersState } from '@/pages/JobSpace';

interface JobFiltersProps {
  filters: JobFiltersState;
  setFilters: React.Dispatch<React.SetStateAction<JobFiltersState>>;
  jobs: Job[];
}

export const JobFilters: React.FC<JobFiltersProps> = ({ filters, setFilters, jobs }) => {
  const [skillSearch, setSkillSearch] = useState('');

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
    if (!skillSearch) return allSkills.slice(0, 20);
    return allSkills.filter(skill => 
      skill.toLowerCase().includes(skillSearch.toLowerCase())
    ).slice(0, 20);
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

  const hasActiveFilters = filters.search || 
    filters.status.length > 0 || 
    filters.contractType.length > 0 || 
    filters.location || 
    filters.remote.length > 0 ||
    filters.sector.length > 0 ||
    filters.priority.length > 0 ||
    filters.seniority.length > 0 ||
    filters.skills.length > 0;

  return (
    <div className="bg-white border border-black p-6 mb-6">
      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#1A1A1A]/40" />
        <input
          type="text"
          placeholder="Rechercher un poste, une entreprise..."
          value={filters.search}
          onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
          className="w-full pl-12 pr-4 py-3 border border-[#1A1A1A]/20 focus:border-[#1A1A1A] focus:outline-none transition-colors"
        />
      </div>

      {/* Filter groups */}
      <div className="space-y-4">
        {/* Priority */}
        {priorities.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-2">
              Priorité
            </label>
            <div className="flex flex-wrap gap-2">
              {priorities.map((priority, index) => (
                <button
                  key={`priority-${index}-${priority}`}
                  onClick={() => toggleFilter('priority', priority)}
                  className={`px-3 py-1.5 text-xs font-medium uppercase tracking-wide border transition-colors ${
                    filters.priority.includes(priority)
                      ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                      : 'bg-white text-[#1A1A1A] border-[#1A1A1A]/20 hover:border-[#1A1A1A]'
                  }`}
                >
                  {priority}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Skills Filter */}
        {allSkills.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-2">
              <Code className="w-3 h-3 inline mr-1" />
              Compétences techniques
            </label>
            
            {/* Selected skills */}
            {filters.skills.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {filters.skills.map((skill, index) => (
                  <button
                    key={`selected-skill-${index}-${skill}`}
                    onClick={() => toggleFilter('skills', skill)}
                    className="px-3 py-1.5 text-xs font-medium tracking-wide border bg-[#FA76FF] text-white border-[#FA76FF] hover:bg-[#FA76FF]/90 transition-colors flex items-center gap-1"
                  >
                    {skill}
                    <X className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )}

            {/* Skills search */}
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#1A1A1A]/40" />
              <input
                type="text"
                placeholder="Rechercher une compétence..."
                value={skillSearch}
                onChange={(e) => setSkillSearch(e.target.value)}
                className="w-full md:w-64 pl-9 pr-4 py-2 border border-[#1A1A1A]/20 focus:border-[#1A1A1A] focus:outline-none transition-colors text-sm bg-white"
              />
            </div>

            {/* Available skills */}
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {filteredSkills
                .filter(skill => !filters.skills.includes(skill))
                .map((skill, index) => (
                  <button
                    key={`skill-${index}-${skill}`}
                    onClick={() => toggleFilter('skills', skill)}
                    className="px-3 py-1.5 text-xs font-medium tracking-wide border bg-white text-[#1A1A1A] border-[#1A1A1A]/20 hover:border-[#FA76FF] hover:text-[#FA76FF] transition-colors"
                  >
                    {skill}
                  </button>
                ))}
              {filteredSkills.length === 0 && skillSearch && (
                <span className="text-sm text-[#1A1A1A]/40 italic">Aucune compétence trouvée</span>
              )}
            </div>
          </div>
        )}

        {seniorities.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-2">
              Séniorité
            </label>
            <div className="flex flex-wrap gap-2">
              {seniorities.map((seniority, index) => (
                <button
                  key={`seniority-${index}-${seniority}`}
                  onClick={() => toggleFilter('seniority', seniority)}
                  className={`px-3 py-1.5 text-xs font-medium uppercase tracking-wide border transition-colors ${
                    filters.seniority.includes(seniority)
                      ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                      : 'bg-white text-[#1A1A1A] border-[#1A1A1A]/20 hover:border-[#1A1A1A]'
                  }`}
                >
                  {seniority}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sector */}
        {sectors.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-2">
              Secteur d'activité
            </label>
            <div className="flex flex-wrap gap-2">
              {sectors.map((sector, index) => (
                <button
                  key={`sector-${index}-${sector}`}
                  onClick={() => toggleFilter('sector', sector)}
                  className={`px-3 py-1.5 text-xs font-medium tracking-wide border transition-colors ${
                    filters.sector.includes(sector)
                      ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                      : 'bg-white text-[#1A1A1A] border-[#1A1A1A]/20 hover:border-[#1A1A1A]'
                  }`}
                >
                  {sector}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Status */}
        {statuses.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-2">
              Statut
            </label>
            <div className="flex flex-wrap gap-2">
              {statuses.map((status, index) => (
                <button
                  key={`status-${index}-${status}`}
                  onClick={() => toggleFilter('status', status)}
                  className={`px-3 py-1.5 text-xs font-medium uppercase tracking-wide border transition-colors ${
                    filters.status.includes(status)
                      ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                      : 'bg-white text-[#1A1A1A] border-[#1A1A1A]/20 hover:border-[#1A1A1A]'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Contract Type */}
        {contractTypes.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-2">
              Type de contrat
            </label>
            <div className="flex flex-wrap gap-2">
              {contractTypes.map((type, index) => (
                <button
                  key={`contract-${index}-${type}`}
                  onClick={() => toggleFilter('contractType', type)}
                  className={`px-3 py-1.5 text-xs font-medium uppercase tracking-wide border transition-colors ${
                    filters.contractType.includes(type)
                      ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                      : 'bg-white text-[#1A1A1A] border-[#1A1A1A]/20 hover:border-[#1A1A1A]'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Remote */}
        {remoteOptions.length > 0 && (
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-2">
              Télétravail
            </label>
            <div className="flex flex-wrap gap-2">
              {remoteOptions.map((option, index) => (
                <button
                  key={`remote-${index}-${option}`}
                  onClick={() => toggleFilter('remote', option)}
                  className={`px-3 py-1.5 text-xs font-medium uppercase tracking-wide border transition-colors ${
                    filters.remote.includes(option)
                      ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                      : 'bg-white text-[#1A1A1A] border-[#1A1A1A]/20 hover:border-[#1A1A1A]'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Location */}
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-2">
            Localisation
          </label>
          <input
            type="text"
            placeholder="Paris, Lyon, Remote..."
            value={filters.location}
            onChange={(e) => setFilters(prev => ({ ...prev, location: e.target.value }))}
            className="w-full md:w-64 px-4 py-2 border border-[#1A1A1A]/20 focus:border-[#1A1A1A] focus:outline-none transition-colors text-sm"
          />
        </div>
      </div>

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          className="mt-4 flex items-center gap-2 text-sm text-[#1A1A1A]/60 hover:text-[#1A1A1A] transition-colors"
        >
          <X className="w-4 h-4" />
          Effacer les filtres
        </button>
      )}
    </div>
  );
};
