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

  const countActive = [
    filters.db_technologies.length > 0,
    filters.db_email_verified !== null,
    !!filters.db_revenue_min || !!filters.db_revenue_max,
    !!filters.db_funding_stage,
    !!filters.db_company_domain,
  ].filter(Boolean).length;

  const preview: string[] = [];
  if (filters.db_technologies.length) preview.push(`${filters.db_technologies.length} techno(s)`);
  if (filters.db_email_verified !== null) preview.push(filters.db_email_verified ? 'Email ✓' : 'Email ✗');
  if (filters.db_funding_stage) preview.push(filters.db_funding_stage);
  if (filters.db_company_domain) preview.push(filters.db_company_domain);

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
      title="Filtres Base Konekt"
      icon={<Database className="w-4 h-4 text-primary" />}
      badge={countActive}
      isOpen={isOpen}
      onToggle={onToggle}
      activeFiltersPreview={preview}
      bgColorClass="bg-primary/5"
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
          placeholder="ex: fintech, healthtech, SaaS..."
          value={filters.db_company_domain}
          onChange={e => onChange({ ...filters, db_company_domain: e.target.value })}
          className="h-8 text-xs"
        />
      </FilterGroup>
    </FilterSection>
  );
};
