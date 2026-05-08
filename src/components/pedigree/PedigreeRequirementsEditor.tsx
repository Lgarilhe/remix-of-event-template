import React, { useState } from 'react';
import { Briefcase, GraduationCap, Shield } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  COMPANY_PROVENANCE_LABELS, COMPANY_AVOID_LABELS, DIPLOMA_ORIGIN_LABELS, SENIORITY_LABELS,
  type CompanyProvenance, type CompanyAvoidCategory, type PedigreeRequirements,
} from '@/types/pedigreePreset';
import { cn } from '@/lib/utils';

/**
 * Éditeur réutilisable pour PedigreeRequirements.
 *
 * Utilisé dans :
 * - PedigreePresetsSettings (form de création/édition de preset master)
 * - PedigreePresetSelector (override per-mission ou config from-scratch)
 *
 * Pure controlled component : pas de state interne pour les requirements,
 * pas de mutation DB. Le parent gère la persistance.
 */
interface Props {
  value: PedigreeRequirements;
  onChange: (next: PedigreeRequirements) => void;
}

export const PedigreeRequirementsEditor: React.FC<Props> = ({ value, onChange }) => {
  const update = (patch: Partial<PedigreeRequirements>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-5">
      {/* Section : Écoles & diplômes */}
      <SectionHeader icon={GraduationCap} title="Écoles & diplômes" />
      <div className="space-y-3 pl-1">
        <div>
          <Label>Écoles requises (au moins une suffit)</Label>
          <CsvInput
            value={value.schools_required || []}
            onChange={(v) => update({ schools_required: v })}
            placeholder="ex: Polytechnique, Centrale, HEC, EPITA, 42, ESSEC"
            hint="Séparez par des virgules. Le LLM gère les aliases (X = Polytechnique, CentraleSupélec = Centrale)."
          />
        </div>
        <div>
          <Label htmlFor="diploma-origin">Origine du diplôme</Label>
          <Select
            value={value.diploma_must_be_from || 'any'}
            onValueChange={(v) => update({ diploma_must_be_from: v as PedigreeRequirements['diploma_must_be_from'] })}
          >
            <SelectTrigger id="diploma-origin">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DIPLOMA_ORIGIN_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Cible le pays de l'établissement, pas la nationalité du candidat.
          </p>
        </div>
      </div>

      {/* Section : Provenance entreprises */}
      <SectionHeader icon={Briefcase} title="Provenance entreprises" />
      <div className="space-y-3 pl-1">
        <div>
          <Label>Catégories souhaitées (au moins une expérience)</Label>
          <MultiSelectPills
            options={Object.entries(COMPANY_PROVENANCE_LABELS).map(([k, v]) => ({ value: k, label: v.label, description: v.description }))}
            value={value.companies_required_provenance || []}
            onChange={(v) => update({ companies_required_provenance: v as CompanyProvenance[] })}
          />
        </div>
        <div>
          <Label>Entreprises spécifiques requises (au moins une suffit)</Label>
          <CsvInput
            value={value.companies_specific_required || []}
            onChange={(v) => update({ companies_specific_required: v })}
            placeholder="ex: Stripe, Doctolib, Datadog"
            hint="Si renseigné, le candidat doit avoir au moins une expérience chez l'une d'elles."
          />
        </div>
        <div>
          <Label>Catégories à éviter (signal négatif)</Label>
          <MultiSelectPills
            options={Object.entries(COMPANY_AVOID_LABELS).map(([k, v]) => ({ value: k, label: v.label, description: v.description }))}
            value={value.companies_avoid || []}
            onChange={(v) => update({ companies_avoid: v as CompanyAvoidCategory[] })}
          />
        </div>
      </div>

      {/* Section : Séniorité & strict */}
      <SectionHeader icon={Shield} title="Séniorité & mode strict" />
      <div className="space-y-3 pl-1">
        <div>
          <Label htmlFor="min-seniority">Séniorité minimale</Label>
          <Select
            value={value.min_seniority || 'none'}
            onValueChange={(v) => update({ min_seniority: v === 'none' ? undefined : v as PedigreeRequirements['min_seniority'] })}
          >
            <SelectTrigger id="min-seniority">
              <SelectValue placeholder="Pas de minimum" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Pas de minimum</SelectItem>
              {Object.entries(SENIORITY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-start justify-between p-3 border border-border rounded-md gap-3">
          <div className="min-w-0">
            <Label htmlFor="strict-mode" className="cursor-pointer">Mode strict</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Si activé, tout profil non-conforme aux critères ci-dessus est plafonné à 50 (force
              "Skip" ou "Maybe"). Sinon, les critères sont des préférences qui ajustent le score
              sans bloquer.
            </p>
          </div>
          <Switch
            id="strict-mode"
            checked={value.strict_mode || false}
            onCheckedChange={(v) => update({ strict_mode: v })}
          />
        </div>
      </div>

      {/* Section : Instructions libres */}
      <div>
        <Label htmlFor="custom">Instructions additionnelles (optionnel)</Label>
        <Textarea
          id="custom"
          placeholder="ex: Préférer profils ayant fait Polytechnique X-15 ou X-16 + 3 ans Stripe minimum."
          value={value.custom_instructions || ''}
          onChange={(e) => update({ custom_instructions: e.target.value })}
          rows={3}
          maxLength={400}
        />
        <p className="text-xs text-muted-foreground mt-1">
          {(value.custom_instructions?.length || 0)} / 400 caractères
        </p>
      </div>
    </div>
  );
};

/** Cleanup helper : supprime les champs vides du PedigreeRequirements. */
export function cleanRequirements(req: PedigreeRequirements): PedigreeRequirements {
  return {
    ...(req.schools_required?.length ? { schools_required: req.schools_required } : {}),
    ...(req.diploma_must_be_from && req.diploma_must_be_from !== 'any' ? { diploma_must_be_from: req.diploma_must_be_from } : {}),
    ...(req.companies_required_provenance?.length ? { companies_required_provenance: req.companies_required_provenance } : {}),
    ...(req.companies_specific_required?.length ? { companies_specific_required: req.companies_specific_required } : {}),
    ...(req.companies_avoid?.length ? { companies_avoid: req.companies_avoid } : {}),
    ...(req.min_seniority ? { min_seniority: req.min_seniority } : {}),
    ...(req.strict_mode ? { strict_mode: true } : {}),
    ...(req.custom_instructions?.trim() ? { custom_instructions: req.custom_instructions.trim().slice(0, 400) } : {}),
  };
}

/** True si le PedigreeRequirements a au moins un critère renseigné. */
export function hasAnyRequirement(req: PedigreeRequirements | undefined | null): boolean {
  if (!req) return false;
  return Object.keys(cleanRequirements(req)).length > 0;
}

const SectionHeader: React.FC<{ icon: React.ElementType; title: string }> = ({ icon: Icon, title }) => (
  <div className="flex items-center gap-2 pt-2 pb-1 border-b border-border">
    <Icon className="w-4 h-4 text-foreground/70" />
    <h4 className="text-sm font-semibold">{title}</h4>
  </div>
);

// ── Input CSV (transforme texte virgule-séparé en string[]) ──
const CsvInput: React.FC<{
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  hint?: string;
}> = ({ value, onChange, placeholder, hint }) => {
  const [text, setText] = useState(value.join(', '));
  React.useEffect(() => {
    setText(value.join(', '));
  }, [value]);
  return (
    <div className="space-y-1">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = text.split(',').map(s => s.trim()).filter(Boolean);
          onChange(parsed);
        }}
        placeholder={placeholder}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
};

// ── Multi-select pills ──
const MultiSelectPills: React.FC<{
  options: Array<{ value: string; label: string; description: string }>;
  value: string[];
  onChange: (v: string[]) => void;
}> = ({ options, value, onChange }) => {
  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter(x => x !== v));
    else onChange([...value, v]);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const active = value.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            title={opt.description}
            className={cn(
              'text-xs px-2.5 py-1.5 border rounded-md transition-colors text-left',
              active
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'border-border bg-muted/30 text-foreground hover:border-foreground/30',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};
