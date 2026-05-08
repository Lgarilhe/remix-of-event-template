import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Shield, GraduationCap, Building2, X, Pencil, Plus, Save } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { usePedigreePresets } from '@/hooks/usePedigreePresets';
import {
  COMPANY_PROVENANCE_LABELS, DIPLOMA_ORIGIN_LABELS, SENIORITY_LABELS,
  type PedigreeRequirements,
} from '@/types/pedigreePreset';
import { PedigreeRequirementsEditor, cleanRequirements, hasAnyRequirement } from '@/components/pedigree/PedigreeRequirementsEditor';
import { cn } from '@/lib/utils';

interface Props {
  clientName?: string | null;
  selectedPresetId?: string | null;
  /** Snapshot des requirements actuellement appliqués sur la mission. */
  currentRequirements?: PedigreeRequirements | null;
  /** Nom affiché pour le snapshot custom (si pas de preset_id). */
  currentPresetName?: string | null;
  /** Pas de auto-application si false (ex: brief déjà initialisé) */
  enableAutoApply?: boolean;
  onChange: (patch: {
    pedigree_preset_id: string | null;
    pedigree_preset_name: string | null;
    pedigree_requirements: PedigreeRequirements | undefined;
  }) => void;
  readOnly?: boolean;
}

const EMPTY_REQUIREMENTS: PedigreeRequirements = {
  schools_required: [],
  diploma_must_be_from: 'any',
  companies_required_provenance: [],
  companies_specific_required: [],
  companies_avoid: [],
  strict_mode: false,
  custom_instructions: '',
};

/**
 * Sélecteur de preset pedigree pour le brief mission.
 *
 * 3 modes :
 * 1. Preset master : auto-applique celui par défaut du client si match,
 *    ou pick manuel dans la liste.
 * 2. From scratch (cette mission) : configurer des critères ad-hoc sans
 *    passer par un preset master. Bouton "Configurer pour cette mission".
 * 3. Override d'un preset : cloner les requirements du preset et les
 *    personnaliser pour cette mission uniquement. Le preset master reste
 *    intact. Bouton "Personnaliser pour cette mission".
 *
 * Modes 2/3 : pedigree_preset_id = null, requirements stockées dans le
 * snapshot job_details.pedigree_requirements uniquement.
 */
export const PedigreePresetSelector: React.FC<Props> = ({
  clientName, selectedPresetId, currentRequirements, currentPresetName,
  enableAutoApply = true, onChange, readOnly,
}) => {
  const { presets, loading, getDefaultForClient } = usePedigreePresets();
  const autoAppliedRef = useRef(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'override' | 'from_scratch'>('from_scratch');
  const [draft, setDraft] = useState<PedigreeRequirements>(EMPTY_REQUIREMENTS);

  const selected = useMemo(
    () => presets.find(p => p.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  );

  /** Mode "personnalisé" = requirements présentes mais aucun preset_id lié. */
  const isCustom = !selectedPresetId && hasAnyRequirement(currentRequirements);

  // Auto-application du preset par défaut au mount si match client
  useEffect(() => {
    if (!enableAutoApply || readOnly) return;
    if (selectedPresetId) return;
    if (isCustom) return; // ne pas écraser un override custom déjà posé
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
  }, [clientName, selectedPresetId, isCustom, enableAutoApply, readOnly, loading, getDefaultForClient, onChange]);

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

  const openOverride = () => {
    setEditorMode('override');
    setDraft({ ...EMPTY_REQUIREMENTS, ...(selected?.pedigree_requirements || currentRequirements || {}) });
    setEditorOpen(true);
  };

  const openFromScratch = () => {
    setEditorMode('from_scratch');
    setDraft({ ...EMPTY_REQUIREMENTS, ...(currentRequirements || {}) });
    setEditorOpen(true);
  };

  const saveDraft = () => {
    const cleaned = cleanRequirements(draft);
    if (Object.keys(cleaned).length === 0) {
      // Si l'éditeur est vide → comme un clear
      handleClear();
      setEditorOpen(false);
      return;
    }
    const baseName = editorMode === 'override' && selected
      ? `${selected.name} (personnalisé)`
      : 'Critères ad-hoc (cette mission)';
    onChange({
      pedigree_preset_id: null,         // détaché du master
      pedigree_preset_name: baseName,
      pedigree_requirements: cleaned,
    });
    setEditorOpen(false);
  };

  const isAutoMatch = !!getDefaultForClient(clientName);

  return (
    <>
      <div className="border-2 border-dashed border-border rounded-lg p-4 bg-muted/20">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <h4 className="text-sm font-bold uppercase tracking-wider">
                Pedigree client
              </h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Critères clients (top école, scale-up, …) appliqués au scoring IA.
              </p>
            </div>
          </div>
          {(selected || isCustom) && !readOnly && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleClear}>
              <X className="w-3.5 h-3.5 mr-1" /> Retirer
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={isCustom ? '__custom__' : (selectedPresetId ?? '__none__')}
            onValueChange={handleSelect}
            disabled={readOnly}
          >
            <SelectTrigger className="w-full sm:w-[300px] h-9 text-sm">
              <SelectValue placeholder={loading ? 'Chargement…' : 'Aucun preset'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Aucun preset</SelectItem>
              {isCustom && (
                <SelectItem value="__custom__" disabled>
                  {currentPresetName || 'Critères ad-hoc (cette mission)'}
                </SelectItem>
              )}
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
          {isCustom && (
            <Badge variant="secondary" className="text-3xs">
              Personnalisé
            </Badge>
          )}
          {(selected?.pedigree_requirements?.strict_mode || (isCustom && currentRequirements?.strict_mode)) && (
            <Badge variant="outline" className="text-3xs gap-1">
              <Shield className="w-3 h-3" /> Mode strict
            </Badge>
          )}
        </div>

        {/* Résumé read-only */}
        {(selected || isCustom) && (
          <PedigreeSummary req={selected?.pedigree_requirements ?? currentRequirements ?? {}} />
        )}

        {/* Actions per-mission */}
        {!readOnly && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border/60">
            {selected && (
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={openOverride}>
                <Pencil className="w-3.5 h-3.5" />
                Personnaliser pour cette mission
              </Button>
            )}
            {!selected && (
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={openFromScratch}>
                {isCustom ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                {isCustom ? 'Modifier les critères' : 'Configurer pour cette mission'}
              </Button>
            )}
          </div>
        )}

        {!selected && !isCustom && presets.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground mt-3">
            Aucun preset n'est configuré.{' '}
            <a href="/settings?tab=presets" className="underline font-medium">
              Créer un preset →
            </a>
          </p>
        )}
      </div>

      {/* Dialog d'édition (override ou from scratch) */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editorMode === 'override'
                ? `Personnaliser "${selected?.name}" pour cette mission`
                : 'Critères pedigree pour cette mission'}
            </DialogTitle>
            <DialogDescription>
              {editorMode === 'override'
                ? 'Les modifications ne s\'appliquent qu\'à cette mission. Le preset master reste intact.'
                : 'Configurez des critères pedigree ad-hoc pour cette mission, sans créer de preset réutilisable.'}
            </DialogDescription>
          </DialogHeader>

          <PedigreeRequirementsEditor value={draft} onChange={setDraft} />

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Annuler</Button>
            <Button onClick={saveDraft} className="gap-1.5">
              <Save className="w-3.5 h-3.5" /> Appliquer à cette mission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

/** Résumé read-only des critères du preset / override actif. */
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
