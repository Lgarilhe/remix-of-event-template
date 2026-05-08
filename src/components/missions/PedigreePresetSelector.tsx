import React, { useEffect, useMemo, useRef } from 'react';
import { Sparkles, Shield, GraduationCap, Building2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { usePedigreePresets } from '@/hooks/usePedigreePresets';
import {
  COMPANY_PROVENANCE_LABELS, DIPLOMA_ORIGIN_LABELS, SENIORITY_LABELS,
  type ClientPedigreePreset, type PedigreeRequirements,
} from '@/types/pedigreePreset';
import { cn } from '@/lib/utils';

interface Props {
  clientName?: string | null;
  selectedPresetId?: string | null;
  /** Pas de auto-application si false (ex: brief déjà initialisé) */
  enableAutoApply?: boolean;
  onChange: (patch: {
    pedigree_preset_id: string | null;
    pedigree_preset_name: string | null;
    pedigree_requirements: PedigreeRequirements | undefined;
  }) => void;
  readOnly?: boolean;
}

/**
 * Sélecteur de preset pedigree pour le brief mission.
 *
 * Auto-applique le preset par défaut du client si :
 * - enableAutoApply = true
 * - aucun preset déjà sélectionné
 * - il existe un preset avec is_default_for_client + client_company_name match
 *
 * L'utilisateur peut override ou retirer le preset à tout moment.
 */
export const PedigreePresetSelector: React.FC<Props> = ({
  clientName, selectedPresetId, enableAutoApply = true, onChange, readOnly,
}) => {
  const { presets, loading, getDefaultForClient } = usePedigreePresets();
  const autoAppliedRef = useRef(false);

  const selected = useMemo(
    () => presets.find(p => p.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  );

  // Auto-application du preset par défaut au mount si match client
  useEffect(() => {
    if (!enableAutoApply || readOnly) return;
    if (selectedPresetId) return;
    if (autoAppliedRef.current) return;
    if (loading) return;

    const candidate = getDefaultForClient(clientName);
    if (candidate) {
      autoAppliedRef.current = true;
      onChange({
        pedigree_preset_id: candidate.id,
        pedigree_preset_name: candidate.name,
        pedigree_requirements: candidate.pedigree_requirements,
      });
    }
  }, [clientName, selectedPresetId, enableAutoApply, readOnly, loading, getDefaultForClient, onChange]);

  const handleSelect = (presetId: string) => {
    if (presetId === '__none__') {
      onChange({ pedigree_preset_id: null, pedigree_preset_name: null, pedigree_requirements: undefined });
      return;
    }
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    onChange({
      pedigree_preset_id: preset.id,
      pedigree_preset_name: preset.name,
      pedigree_requirements: preset.pedigree_requirements,
    });
  };

  const handleClear = () => {
    onChange({ pedigree_preset_id: null, pedigree_preset_name: null, pedigree_requirements: undefined });
  };

  const isAutoMatch = !!getDefaultForClient(clientName);

  return (
    <div className="border-2 border-dashed border-border rounded-lg p-4 bg-muted/20">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2">
          <Sparkles className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
          <div>
            <h4 className="text-sm font-bold uppercase tracking-wider">
              Preset pedigree client
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Critères clients récurrents (top école, scale-up, …) appliqués au scoring IA.
            </p>
          </div>
        </div>
        {selected && !readOnly && (
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleClear}>
            <X className="w-3.5 h-3.5 mr-1" /> Retirer
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={selectedPresetId ?? '__none__'} onValueChange={handleSelect} disabled={readOnly}>
          <SelectTrigger className="w-full sm:w-[300px] h-9 text-sm">
            <SelectValue placeholder={loading ? 'Chargement…' : 'Aucun preset'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Aucun preset</SelectItem>
            {presets.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.client_company_name ? ` — ${p.client_company_name}` : ''}
                {p.is_default_for_client ? ' ★' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selected && isAutoMatch && selected.client_company_name && (
          <Badge variant="secondary" className="text-3xs">
            Auto-appliqué pour {selected.client_company_name}
          </Badge>
        )}
        {selected?.pedigree_requirements?.strict_mode && (
          <Badge variant="outline" className="text-3xs gap-1">
            <Shield className="w-3 h-3" /> Mode strict
          </Badge>
        )}
      </div>

      {selected && (
        <PedigreeSummary req={selected.pedigree_requirements} />
      )}

      {!selected && presets.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground mt-3">
          Aucun preset n'est configuré.{' '}
          <a href="/settings?tab=presets" className="underline font-medium">
            Créer un preset →
          </a>
        </p>
      )}
    </div>
  );
};

/** Résumé read-only des critères du preset actif. */
const PedigreeSummary: React.FC<{ req: PedigreeRequirements }> = ({ req }) => {
  const hasSchools = (req.schools_required?.length ?? 0) > 0;
  const hasDiploma = req.diploma_must_be_from && req.diploma_must_be_from !== 'any';
  const hasCompProvenance = (req.companies_required_provenance?.length ?? 0) > 0;
  const hasCompSpecific = (req.companies_specific_required?.length ?? 0) > 0;
  const hasMinSeniority = !!req.min_seniority;
  const hasInstructions = !!req.custom_instructions?.trim();

  if (!hasSchools && !hasDiploma && !hasCompProvenance && !hasCompSpecific && !hasMinSeniority && !hasInstructions) {
    return null;
  }

  return (
    <div className="mt-3 space-y-1.5 text-3xs">
      {hasSchools && (
        <SummaryLine icon={<GraduationCap className="w-3.5 h-3.5" />} label="Écoles requises">
          {req.schools_required!.join(', ')}
        </SummaryLine>
      )}
      {hasDiploma && (
        <SummaryLine icon={<GraduationCap className="w-3.5 h-3.5" />} label="Diplôme">
          {DIPLOMA_ORIGIN_LABELS[req.diploma_must_be_from!]}
        </SummaryLine>
      )}
      {hasCompProvenance && (
        <SummaryLine icon={<Building2 className="w-3.5 h-3.5" />} label="Provenance">
          {req.companies_required_provenance!.map(c => COMPANY_PROVENANCE_LABELS[c].label).join(', ')}
        </SummaryLine>
      )}
      {hasCompSpecific && (
        <SummaryLine icon={<Building2 className="w-3.5 h-3.5" />} label="Boîtes spécifiques">
          {req.companies_specific_required!.join(', ')}
        </SummaryLine>
      )}
      {hasMinSeniority && (
        <SummaryLine icon={<Shield className="w-3.5 h-3.5" />} label="Séniorité min">
          {SENIORITY_LABELS[req.min_seniority!]}
        </SummaryLine>
      )}
      {hasInstructions && (
        <SummaryLine icon={<Sparkles className="w-3.5 h-3.5" />} label="Instructions">
          <span className="italic">{req.custom_instructions}</span>
        </SummaryLine>
      )}
    </div>
  );
};

const SummaryLine: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({ icon, label, children }) => (
  <div className="flex items-start gap-2">
    <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
    <span className="text-muted-foreground font-bold uppercase tracking-wider min-w-[100px] shrink-0">{label}</span>
    <span className={cn('text-foreground', 'flex-1')}>{children}</span>
  </div>
);
