import React, { useState, KeyboardEvent } from 'react';
import { LinkedInFiltersState } from '../types';
import { FilterSection, FilterGroup } from '../FilterComponents';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Database, X } from 'lucide-react';

const FUNDING_STAGES = ['Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'IPO'] as const;

interface Props {
  filters: LinkedInFiltersState;
  onChange: (filters: LinkedInFiltersState) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export const DatabaseFiltersSection: React.FC<Props> = ({ filters, onChange, isOpen, onToggle }) => {
  const [techInput, setTechInput] = useState('');
  const [techMustInput, setTechMustInput] = useState('');
  const [techExcludeInput, setTechExcludeInput] = useState('');
  const [jobLocInput, setJobLocInput] = useState('');
  const [notLocInput, setNotLocInput] = useState('');

  const countActive = [
    filters.db_technologies.length > 0,
    filters.db_email_verified !== null,
    !!filters.db_revenue_min || !!filters.db_revenue_max,
    !!filters.db_funding_stage,
    !!filters.db_company_domain,
    !!filters.db_org_job_titles,
    !!filters.db_org_num_jobs_min || !!filters.db_org_num_jobs_max,
    filters.exclude_consulting,
    !!filters.company_category,
    filters.db_tech_must_have_all?.length > 0,
    filters.db_tech_exclude?.length > 0,
    filters.db_org_job_locations?.length > 0,
    !!filters.db_latest_funding_date_min,
    !!filters.db_total_funding_min || !!filters.db_total_funding_max,
    filters.db_org_not_locations?.length > 0,
  ].filter(Boolean).length;

  const preview: string[] = [];
  if (filters.db_technologies.length) preview.push(`${filters.db_technologies.length} techno(s)`);
  if (filters.db_email_verified !== null) preview.push(filters.db_email_verified ? 'Email ✓' : 'Email ✗');
  if (filters.db_funding_stage) preview.push(filters.db_funding_stage);
  if (filters.db_company_domain) preview.push(filters.db_company_domain);
  if (filters.db_org_job_titles) preview.push('Postes ouverts');

  const addTech = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || filters.db_technologies.includes(trimmed)) return;
    onChange({ ...filters, db_technologies: [...filters.db_technologies, trimmed] });
    setTechInput('');
  };

  const removeTech = (tech: string) => {
    onChange({ ...filters, db_technologies: filters.db_technologies.filter(t => t !== tech) });
  };

  const handleTechKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTech(techInput);
    }
  };

  return (
    <FilterSection
      id="database"
      title="Filtres avancés Base Konekt"
      icon={<Database className="w-4 h-4 text-muted-foreground" />}
      badge={countActive}
      isOpen={isOpen}
      onToggle={onToggle}
      activeFiltersPreview={preview}
      bgColorClass=""
    >
      {/* Technologies */}
      <FilterGroup title="Technologies" badge={filters.db_technologies.length}>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {filters.db_technologies.map(t => (
            <Badge key={t} variant="secondary" className="gap-1 text-xs">
              {t}
              <X className="w-3 h-3 cursor-pointer" onClick={() => removeTech(t)} />
            </Badge>
          ))}
        </div>
        <Input
          placeholder="Ajouter une techno (Entrée pour valider)..."
          value={techInput}
          onChange={e => setTechInput(e.target.value)}
          onKeyDown={handleTechKeyDown}
          onBlur={() => addTech(techInput)}
          className="h-8 text-xs"
        />
      </FilterGroup>

      {/* Email vérifié */}
      <FilterGroup title="Email vérifié">
        <div className="flex items-center gap-3">
          <Switch
            checked={filters.db_email_verified === true}
            onCheckedChange={(checked) =>
              onChange({ ...filters, db_email_verified: checked ? true : null })
            }
          />
          <Label className="text-xs text-muted-foreground">
            {filters.db_email_verified === true ? 'Uniquement les emails vérifiés' : 'Tous les profils'}
          </Label>
        </div>
      </FilterGroup>

      {/* Revenue entreprise */}
      <FilterGroup title="Revenue entreprise">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-muted-foreground">Min</Label>
            <Input
              placeholder="ex: 1M, 10M..."
              value={filters.db_revenue_min}
              onChange={e => onChange({ ...filters, db_revenue_min: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Max</Label>
            <Input
              placeholder="ex: 100M, 1B..."
              value={filters.db_revenue_max}
              onChange={e => onChange({ ...filters, db_revenue_max: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
        </div>
      </FilterGroup>

      {/* Stade de funding */}
      <FilterGroup title="Stade de funding">
        <Select
          value={filters.db_funding_stage || '_none'}
          onValueChange={v => onChange({ ...filters, db_funding_stage: v === '_none' ? '' : v })}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Tous les stades" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">Tous les stades</SelectItem>
            {FUNDING_STAGES.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterGroup>

      {/* Domaine entreprise */}
      <FilterGroup title="Domaine entreprise">
        <Input
          placeholder="ex: stripe.com, microsoft.com..."
          value={filters.db_company_domain}
          onChange={e => onChange({ ...filters, db_company_domain: e.target.value })}
          className="h-8 text-xs"
        />
      </FilterGroup>

      {/* Postes ouverts chez l'employeur (NEW) */}
      <FilterGroup title="Postes ouverts chez l'employeur">
        <Input
          placeholder="ex: Software Engineer, Sales..."
          value={filters.db_org_job_titles}
          onChange={e => onChange({ ...filters, db_org_job_titles: e.target.value })}
          className="h-8 text-xs"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Filtrer les profils dont l'entreprise recrute pour ces postes
        </p>
      </FilterGroup>

      {/* Nombre de postes ouverts (NEW) */}
      <FilterGroup title="Nb postes ouverts">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-muted-foreground">Min</Label>
            <Input
              type="number"
              min={0}
              placeholder="0"
              value={filters.db_org_num_jobs_min}
              onChange={e => onChange({ ...filters, db_org_num_jobs_min: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Max</Label>
            <Input
              type="number"
              min={0}
              placeholder="∞"
              value={filters.db_org_num_jobs_max}
              onChange={e => onChange({ ...filters, db_org_num_jobs_max: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
        </div>
      </FilterGroup>

      {/* Exclure consulting */}
      <FilterGroup title="Exclure consulting / ESN">
        <div className="flex items-center gap-3">
          <Switch
            checked={filters.exclude_consulting}
            onCheckedChange={(checked) =>
              onChange({ ...filters, exclude_consulting: checked })
            }
          />
          <Label className="text-xs text-muted-foreground">
            {filters.exclude_consulting ? 'ESN / IT Services / Staffing exclus' : 'Tous les types d\'entreprise'}
          </Label>
        </div>
      </FilterGroup>

      {/* Catégorie entreprise */}
      <FilterGroup title="Catégorie entreprise">
        <div className="flex flex-wrap gap-1.5">
          {([
            { value: '' as const, label: 'Tous' },
            { value: 'startup' as const, label: 'Startup' },
            { value: 'scaleup' as const, label: 'Scale-up' },
            { value: 'enterprise' as const, label: 'Enterprise' },
          ] as const).map(opt => (
            <Badge
              key={opt.value}
              variant={filters.company_category === opt.value ? 'default' : 'outline'}
              className="cursor-pointer text-xs"
              onClick={() => onChange({ ...filters, company_category: opt.value })}
            >
              {opt.label}
            </Badge>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Startup (&lt;50), Scale-up (50-500), Enterprise (500+)
        </p>
      </FilterGroup>

      {/* Technologies must-have ALL (AND mode) */}
      <FilterGroup title="Technologies requises (toutes)" badge={filters.db_tech_must_have_all?.length}>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {(filters.db_tech_must_have_all || []).map(t => (
            <Badge key={t} variant="default" className="gap-1 text-xs">
              {t}
              <X className="w-3 h-3 cursor-pointer" onClick={() => onChange({ ...filters, db_tech_must_have_all: filters.db_tech_must_have_all.filter(x => x !== t) })} />
            </Badge>
          ))}
        </div>
        <Input
          placeholder="Techno requise (toutes doivent matcher)..."
          value={techMustInput}
          onChange={e => setTechMustInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const v = techMustInput.trim(); if (v && !filters.db_tech_must_have_all?.includes(v)) onChange({ ...filters, db_tech_must_have_all: [...(filters.db_tech_must_have_all || []), v] }); setTechMustInput(''); } }}
          className="h-8 text-xs"
        />
        <p className="text-[10px] text-muted-foreground mt-1">Mode AND : le profil doit maîtriser TOUTES ces technos</p>
      </FilterGroup>

      {/* Technologies à exclure */}
      <FilterGroup title="Technologies à exclure" badge={filters.db_tech_exclude?.length}>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {(filters.db_tech_exclude || []).map(t => (
            <Badge key={t} variant="destructive" className="gap-1 text-xs">
              {t}
              <X className="w-3 h-3 cursor-pointer" onClick={() => onChange({ ...filters, db_tech_exclude: filters.db_tech_exclude.filter(x => x !== t) })} />
            </Badge>
          ))}
        </div>
        <Input
          placeholder="Techno à exclure..."
          value={techExcludeInput}
          onChange={e => setTechExcludeInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const v = techExcludeInput.trim(); if (v && !filters.db_tech_exclude?.includes(v)) onChange({ ...filters, db_tech_exclude: [...(filters.db_tech_exclude || []), v] }); setTechExcludeInput(''); } }}
          className="h-8 text-xs"
        />
      </FilterGroup>

      {/* Lieux de recrutement de l'entreprise */}
      <FilterGroup title="Lieux de recrutement" badge={filters.db_org_job_locations?.length}>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {(filters.db_org_job_locations || []).map(l => (
            <Badge key={l} variant="secondary" className="gap-1 text-xs">
              {l}
              <X className="w-3 h-3 cursor-pointer" onClick={() => onChange({ ...filters, db_org_job_locations: filters.db_org_job_locations.filter(x => x !== l) })} />
            </Badge>
          ))}
        </div>
        <Input
          placeholder="Ville où l'entreprise recrute..."
          value={jobLocInput}
          onChange={e => setJobLocInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const v = jobLocInput.trim(); if (v && !filters.db_org_job_locations?.includes(v)) onChange({ ...filters, db_org_job_locations: [...(filters.db_org_job_locations || []), v] }); setJobLocInput(''); } }}
          className="h-8 text-xs"
        />
      </FilterGroup>

      {/* Exclure localisation siège */}
      <FilterGroup title="Exclure localisations siège" badge={filters.db_org_not_locations?.length}>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {(filters.db_org_not_locations || []).map(l => (
            <Badge key={l} variant="destructive" className="gap-1 text-xs">
              {l}
              <X className="w-3 h-3 cursor-pointer" onClick={() => onChange({ ...filters, db_org_not_locations: filters.db_org_not_locations.filter(x => x !== l) })} />
            </Badge>
          ))}
        </div>
        <Input
          placeholder="Pays/ville à exclure..."
          value={notLocInput}
          onChange={e => setNotLocInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); const v = notLocInput.trim(); if (v && !filters.db_org_not_locations?.includes(v)) onChange({ ...filters, db_org_not_locations: [...(filters.db_org_not_locations || []), v] }); setNotLocInput(''); } }}
          className="h-8 text-xs"
        />
      </FilterGroup>

      {/* Funding récent */}
      <FilterGroup title="Funding récent">
        <Input
          type="date"
          value={filters.db_latest_funding_date_min}
          onChange={e => onChange({ ...filters, db_latest_funding_date_min: e.target.value })}
          className="h-8 text-xs"
        />
        <p className="text-[10px] text-muted-foreground mt-1">Levée de fonds après cette date</p>
      </FilterGroup>

      {/* Funding total */}
      <FilterGroup title="Funding total levé">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-muted-foreground">Min ($)</Label>
            <Input
              type="number"
              placeholder="ex: 1000000"
              value={filters.db_total_funding_min}
              onChange={e => onChange({ ...filters, db_total_funding_min: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Max ($)</Label>
            <Input
              type="number"
              placeholder="ex: 100000000"
              value={filters.db_total_funding_max}
              onChange={e => onChange({ ...filters, db_total_funding_max: e.target.value })}
              className="h-8 text-xs"
            />
          </div>
        </div>
      </FilterGroup>
    </FilterSection>
  );
};
