import React, { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Play, Sparkle, MapPin, Briefcase, GraduationCap, Buildings,
  UserCircle, Plus, PencilSimple, Check, ArrowRight, ArrowLeft,
  Globe, FunnelSimple, Lightning, Target
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { JobDetails } from '@/types/jobDetails';
import type { LinkedInFiltersState } from '@/components/outreach/types';

/* ─── Types ─── */
interface WizardStep {
  id: string;
  icon: React.ElementType;
  label: string;
  description: string;
  fields: WizardField[];
}

interface WizardField {
  id: string;
  label: string;
  type: 'chips' | 'range' | 'toggle' | 'select' | 'text';
  value: string[];
  suggestions: string[];
  editable: boolean;
  /** For range fields */
  rangeMin?: number | null;
  rangeMax?: number | null;
  /** For toggle fields */
  toggleValue?: boolean;
  /** For select fields */
  selectOptions?: { value: string; label: string }[];
  selectValue?: string;
  /** For text fields */
  textValue?: string;
  textDirty?: boolean;
  placeholder?: string;
  briefSource?: string; // Where this was derived from in the brief
}

/* ─── Build steps from brief ─── */
function buildStepsFromBrief(
  jd: JobDetails,
  currentFilters: LinkedInFiltersState,
  suggestions?: { alt_skills?: string[]; alt_titles?: string[]; alt_locations?: string[]; alt_companies?: string[]; alt_certifications?: string[] } | null
): WizardStep[] {
  const steps: WizardStep[] = [];

  // Step 1: Poste / Profil cible (always shown)
  const roleFields: WizardField[] = [];

  // Keywords (Boolean search) — first field, pre-filled from current filters
  roleFields.push({
    id: 'keywords',
    label: 'Recherche Boolean',
    type: 'text',
    value: [],
    suggestions: [],
    editable: true,
    textValue: currentFilters.keywords || '',
    textDirty: false,
    placeholder: 'Ex: Python AND (Django OR Flask) NOT junior',
    briefSource: currentFilters.keywords ? 'Filtres IA' : undefined,
  });

  // Job title
  const existingTitles = currentFilters.role.map(r => r.keywords);
  const titleSuggestions = suggestions?.alt_titles?.filter(
    t => !existingTitles.some(e => e.toLowerCase() === t.toLowerCase())
  ) ?? [];
  roleFields.push({
    id: 'titles',
    label: 'Intitulés de poste',
    type: 'chips',
    value: existingTitles.length > 0 ? existingTitles : (jd.title ? [jd.title] : []),
    suggestions: titleSuggestions,
    editable: true,
    briefSource: jd.title ? `Brief: "${jd.title}"` : undefined,
  });

  // Seniority
  const seniorityOptions = [
    { value: 'junior', label: 'Junior' },
    { value: 'senior', label: 'Senior' },
    { value: 'manager', label: 'Manager' },
    { value: 'director', label: 'Director' },
    { value: 'vp', label: 'VP' },
    { value: 'c_suite', label: 'C-Suite' },
    { value: 'owner', label: 'Owner / Founder' },
  ];
  roleFields.push({
    id: 'seniority',
    label: 'Séniorité',
    type: 'chips',
    value: currentFilters.seniority.length > 0
      ? currentFilters.seniority
      : (jd.seniority ? [jd.seniority] : []),
    suggestions: [],
    editable: false,
    briefSource: jd.seniority ? `Brief: ${jd.seniority}` : undefined,
  });

  // Experience range
  roleFields.push({
    id: 'experience',
    label: 'Années d\'expérience',
    type: 'range',
    value: [],
    suggestions: [],
    editable: true,
    rangeMin: currentFilters.calculated_experience_min ?? jd.experience_min ?? null,
    rangeMax: currentFilters.calculated_experience_max ?? jd.experience_max ?? null,
    briefSource: jd.experience_min || jd.experience_max
      ? `Brief: ${jd.experience_min ?? 0}-${jd.experience_max ?? '∞'} ans`
      : undefined,
  });

  steps.push({
    id: 'profile',
    icon: UserCircle,
    label: 'Profil cible',
    description: 'Définir le poste, la séniorité et l\'expérience recherchés',
    fields: roleFields,
  });

  // Step 2: Compétences (if brief has skills)
  const hasSkills = (jd.skills_must_have?.length ?? 0) > 0 || (jd.skills_should_have?.length ?? 0) > 0 || currentFilters.skills_keywords.length > 0;
  if (hasSkills || (suggestions?.alt_skills?.length ?? 0) > 0) {
    const existingSkills = currentFilters.skills_keywords.length > 0
      ? currentFilters.skills_keywords
      : [...(jd.skills_must_have || []), ...(jd.skills_should_have || [])];
    const skillSuggestions = [
      ...(suggestions?.alt_skills || []),
      ...(suggestions?.alt_certifications || []),
    ].filter(s => !existingSkills.some(es => es.toLowerCase() === s.toLowerCase()));

    const fields: WizardField[] = [{
      id: 'skills',
      label: 'Compétences clés',
      type: 'chips',
      value: existingSkills,
      suggestions: skillSuggestions.slice(0, 10),
      editable: true,
      briefSource: (jd.skills_must_have?.length ?? 0) > 0 ? `Brief: ${jd.skills_must_have!.slice(0, 3).join(', ')}...` : undefined,
    }];

    // Nice to have as suggestions
    if (jd.skills_nice_to_have?.length) {
      const niceToHave = jd.skills_nice_to_have.filter(
        s => !existingSkills.some(es => es.toLowerCase() === s.toLowerCase())
      );
      if (niceToHave.length > 0) {
        fields[0].suggestions = [...fields[0].suggestions, ...niceToHave].slice(0, 12);
      }
    }

    steps.push({
      id: 'skills',
      icon: Lightning,
      label: 'Compétences',
      description: 'Compétences techniques et fonctionnelles recherchées',
      fields,
    });
  }

  // Step 3: Localisation (if brief has location)
  if (jd.location || currentFilters.location.length > 0 || (suggestions?.alt_locations?.length ?? 0) > 0) {
    const existingLocs = currentFilters.location.map(l => l.name);
    const locSuggestions = (suggestions?.alt_locations || []).filter(
      l => !existingLocs.some(el => el.toLowerCase() === l.toLowerCase())
    );

    steps.push({
      id: 'location',
      icon: MapPin,
      label: 'Localisation',
      description: 'Où chercher les candidats',
      fields: [{
        id: 'locations',
        label: 'Localisation',
        type: 'chips',
        value: existingLocs.length > 0 ? existingLocs : (jd.location ? [jd.location] : []),
        suggestions: locSuggestions,
        editable: true,
        briefSource: jd.location ? `Brief: "${jd.location}"` : undefined,
      }],
    });
  }

  // Step 4: Entreprise (if brief has company info)
  const hasCompanyInfo = jd.client?.name || jd.client?.sector || jd.target_companies?.length || (suggestions?.alt_companies?.length ?? 0) > 0;
  if (hasCompanyInfo || currentFilters.company.length > 0 || currentFilters.industry.length > 0) {
    const fields: WizardField[] = [];

    // Target companies
    const existingCompanies = currentFilters.company.map(c => c.name);
    const companySuggestions = (suggestions?.alt_companies || []).filter(
      c => !existingCompanies.some(ec => ec.toLowerCase() === c.toLowerCase())
    );
    // Add target companies from brief
    const briefCompanies = jd.target_companies?.flatMap(cat => cat.companies.map(c => c.name)) || [];
    const allCompanySuggestions = [...companySuggestions, ...briefCompanies.filter(
      bc => !existingCompanies.includes(bc) && !companySuggestions.includes(bc)
    )];

    fields.push({
      id: 'companies',
      label: 'Entreprises cibles',
      type: 'chips',
      value: existingCompanies,
      suggestions: allCompanySuggestions.slice(0, 8),
      editable: true,
      briefSource: jd.client?.name ? `Client: ${jd.client.name}` : undefined,
    });

    // Industry
    if (jd.client?.sector || currentFilters.industry.length > 0) {
      fields.push({
        id: 'industry',
        label: 'Secteur d\'activité',
        type: 'chips',
        value: currentFilters.industry.map(i => i.name).length > 0
          ? currentFilters.industry.map(i => i.name)
          : (jd.client?.sector ? [jd.client.sector] : []),
        suggestions: [],
        editable: true,
        briefSource: jd.client?.sector ? `Brief: "${jd.client.sector}"` : undefined,
      });
    }

    // Company size
    if (jd.client?.size) {
      fields.push({
        id: 'company_category',
        label: 'Catégorie entreprise',
        type: 'chips',
        value: currentFilters.company_category ? [currentFilters.company_category] : [jd.client.size],
        suggestions: ['startup', 'scale-up', 'enterprise'].filter(s => s !== jd.client?.size),
        editable: false,
      });
    }

    // Exclude consulting
    fields.push({
      id: 'exclude_consulting',
      label: 'Exclure ESN / Consulting',
      type: 'toggle',
      value: [],
      suggestions: [],
      editable: true,
      toggleValue: currentFilters.exclude_consulting,
    });

    steps.push({
      id: 'company',
      icon: Buildings,
      label: 'Entreprise',
      description: 'Cibler les bonnes entreprises et secteurs',
      fields,
    });
  }

  // Always have at least 2 steps — add an advanced step if needed
  if (steps.length < 2) {
    steps.push({
      id: 'advanced',
      icon: FunnelSimple,
      label: 'Filtres avancés',
      description: 'Affiner avec des critères supplémentaires',
      fields: [{
        id: 'keywords',
        label: 'Recherche Boolean',
        type: 'chips',
        value: currentFilters.keywords ? [currentFilters.keywords] : [],
        suggestions: [],
        editable: true,
      }],
    });
  }

  return steps;
}

/* ─── Inline chip editor (reused from FilterReviewModal pattern) ─── */
const ChipInput: React.FC<{ onAdd: (value: string) => void; placeholder?: string }> = ({ onAdd, placeholder = 'Ajouter...' }) => {
  const [value, setValue] = useState('');
  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) { onAdd(trimmed); setValue(''); }
  };
  return (
    <div className="inline-flex items-center border-2 border-dashed border-foreground/20 hover:border-foreground/40 transition-colors">
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        placeholder={placeholder}
        className="h-7 w-[120px] px-2 text-xs font-bold uppercase tracking-wider bg-transparent text-foreground placeholder:text-foreground/30 outline-none"
      />
      <button onClick={submit} className="h-7 w-7 flex items-center justify-center text-foreground/40 hover:text-foreground transition-colors">
        <Plus className="w-3 h-3" weight="bold" />
      </button>
    </div>
  );
};

const EditableChip: React.FC<{ value: string; onEdit: (newValue: string) => void; onRemove: () => void }> = ({ value, onEdit, onRemove }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const confirm = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== value) onEdit(trimmed);
    else setEditValue(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="inline-flex items-center border-2 border-foreground bg-foreground/5">
        <input ref={inputRef} value={editValue} onChange={e => setEditValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } if (e.key === 'Escape') { setEditValue(value); setEditing(false); } }}
          onBlur={confirm}
          className="h-7 w-[140px] px-2 text-xs font-bold uppercase tracking-wider bg-transparent text-foreground outline-none" />
        <button onClick={confirm} className="h-7 w-6 flex items-center justify-center text-foreground/60 hover:text-foreground">
          <Check className="w-3 h-3" weight="bold" />
        </button>
      </span>
    );
  }

  return (
    <span className="group inline-flex items-center gap-0.5 px-2 py-1 border-2 border-foreground/20 text-xs font-bold uppercase tracking-wider text-foreground/80 hover:border-foreground/40 transition-colors cursor-default">
      <span className="max-w-[200px] truncate">{value}</span>
      <button onClick={e => { e.stopPropagation(); setEditing(true); }} className="w-3.5 h-3.5 flex items-center justify-center text-foreground/20 hover:text-foreground transition-colors">
        <PencilSimple className="w-2.5 h-2.5" weight="bold" />
      </button>
      <button onClick={e => { e.stopPropagation(); onRemove(); }} className="w-3.5 h-3.5 flex items-center justify-center text-foreground/20 hover:text-destructive transition-colors">
        <X className="w-2.5 h-2.5" weight="bold" />
      </button>
    </span>
  );
};

/* ─── Range Input ─── */
const RangeInput: React.FC<{
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}> = ({ min, max, onChange }) => (
  <div className="flex items-center gap-2">
    <input
      type="number" min={0} placeholder="Min"
      value={min ?? ''} onChange={e => onChange(e.target.value ? parseInt(e.target.value) : null, max)}
      className="h-8 w-20 px-2 text-xs font-bold bg-transparent border-2 border-foreground/20 text-foreground outline-none focus:border-foreground"
    />
    <span className="text-xs text-muted-foreground">—</span>
    <input
      type="number" min={0} placeholder="Max"
      value={max ?? ''} onChange={e => onChange(min, e.target.value ? parseInt(e.target.value) : null)}
      className="h-8 w-20 px-2 text-xs font-bold bg-transparent border-2 border-foreground/20 text-foreground outline-none focus:border-foreground"
    />
    <span className="text-xs text-muted-foreground">ans</span>
  </div>
);

/* ═══════════════════════════════════════════════
   FILTER WIZARD
   ═══════════════════════════════════════════════ */

export interface FilterWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobDetails: JobDetails;
  currentFilters: LinkedInFiltersState;
  suggestions?: { alt_skills?: string[]; alt_titles?: string[]; alt_locations?: string[]; alt_companies?: string[]; alt_certifications?: string[] } | null;
  onApply: (patch: Partial<LinkedInFiltersState>) => void;
}

export const FilterWizard: React.FC<FilterWizardProps> = ({
  open,
  onOpenChange,
  jobDetails,
  currentFilters,
  suggestions,
  onApply,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<WizardStep[]>(() =>
    buildStepsFromBrief(jobDetails, currentFilters, suggestions)
  );

  useEffect(() => {
    if (open) {
      setSteps(buildStepsFromBrief(jobDetails, currentFilters, suggestions));
      setCurrentStep(0);
    }
  }, [open]);

  const step = steps[currentStep];
  const isLast = currentStep === steps.length - 1;

  // ── Field mutation helpers ──
  const updateField = useCallback((fieldId: string, updater: (f: WizardField) => WizardField) => {
    setSteps(prev => prev.map(s => ({
      ...s,
      fields: s.fields.map(f => f.id === fieldId ? updater(f) : f),
    })));
  }, []);

  const addChip = useCallback((fieldId: string, value: string) => {
    updateField(fieldId, f => ({
      ...f,
      value: f.value.some(v => v.toLowerCase() === value.toLowerCase()) ? f.value : [...f.value, value],
      suggestions: f.suggestions.filter(s => s.toLowerCase() !== value.toLowerCase()),
    }));
  }, [updateField]);

  const removeChip = useCallback((fieldId: string, index: number) => {
    updateField(fieldId, f => ({ ...f, value: f.value.filter((_, i) => i !== index) }));
  }, [updateField]);

  const editChip = useCallback((fieldId: string, index: number, newValue: string) => {
    updateField(fieldId, f => {
      const newValues = [...f.value];
      newValues[index] = newValue;
      return { ...f, value: newValues };
    });
  }, [updateField]);

  const setText = useCallback((fieldId: string, text: string) => {
    updateField(fieldId, f => ({ ...f, textValue: text, textDirty: true }));
  }, [updateField]);

  const setRange = useCallback((fieldId: string, min: number | null, max: number | null) => {
    updateField(fieldId, f => ({ ...f, rangeMin: min, rangeMax: max }));
  }, [updateField]);

  const setToggle = useCallback((fieldId: string, value: boolean) => {
    updateField(fieldId, f => ({ ...f, toggleValue: value }));
  }, [updateField]);

  // ── Apply all wizard state to filters ──
  const handleApply = useCallback(() => {
    const patch: Partial<LinkedInFiltersState> = {};

    for (const step of steps) {
      for (const field of step.fields) {
        switch (field.id) {
          case 'titles':
            patch.role = field.value.map(kw => ({ keywords: kw, priority: 'MUST_HAVE' as const, scope: 'CURRENT' as const }));
            break;
          case 'seniority':
            patch.seniority = field.value;
            break;
          case 'experience':
            patch.calculated_experience_min = field.rangeMin ?? null;
            patch.calculated_experience_max = field.rangeMax ?? null;
            break;
          case 'skills':
            patch.skills_keywords = field.value;
            break;
          case 'locations':
            // Keep existing location items, can't resolve geo IDs here
            // Store as keywords for deferred resolution
            break;
          case 'companies':
            patch.company_keywords = field.value.map(kw => ({
              keywords: kw,
              priority: 'CAN_HAVE' as const,
              scope: 'CURRENT_OR_PAST' as const,
            }));
            break;
          case 'industry':
            patch.industry_keywords = field.value;
            break;
          case 'company_category':
            patch.company_category = (field.value[0] as LinkedInFiltersState['company_category']) || '';
            break;
          case 'exclude_consulting':
            patch.exclude_consulting = field.toggleValue ?? false;
            break;
          case 'keywords':
            // Only overwrite if user explicitly edited the text field
            if (field.textDirty) {
              patch.keywords = field.textValue ?? '';
            } else if (field.type === 'chips') {
              // Legacy fallback for the "advanced" step chips-based keywords
              patch.keywords = field.value[0] || '';
            }
            // If not dirty and text type → preserve currentFilters.keywords (don't include in patch)
            break;
        }
      }
    }

    onApply(patch);
    onOpenChange(false);
  }, [steps, onApply, onOpenChange]);

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[4000] flex h-[100dvh] items-end sm:items-center justify-center pointer-events-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-foreground/60 pointer-events-auto"
            onClick={() => onOpenChange(false)}
          />

          {/* Panel */}
          <motion.div
            className="relative z-[1] w-full sm:max-w-xl max-h-[90dvh] flex flex-col bg-background border-2 border-foreground sm:mx-4 overflow-hidden pointer-events-auto"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            {/* ── Header ── */}
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b-2 border-foreground bg-foreground/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-foreground flex items-center justify-center">
                  <Target className="w-4 h-4 text-background" weight="bold" />
                </div>
                <div>
                  <h2 className="text-xs font-black uppercase tracking-wider text-foreground">Wizard filtres</h2>
                  <p className="text-xs text-muted-foreground">
                    Étape {currentStep + 1} / {steps.length} — {step?.label}
                  </p>
                </div>
              </div>
              <button
                onClick={() => onOpenChange(false)}
                className="w-8 h-8 flex items-center justify-center border-2 border-foreground/20 hover:border-foreground transition-colors"
              >
                <X className="w-4 h-4" weight="bold" />
              </button>
            </div>

            {/* ── Stepper ── */}
            <div className="shrink-0 flex items-center px-4 py-2.5 border-b-2 border-foreground/10 bg-foreground/[0.01] gap-1 overflow-x-auto">
              {steps.map((s, i) => {
                const StepIcon = s.icon;
                const isActive = i === currentStep;
                const isDone = i < currentStep;
                return (
                  <button
                    key={s.id}
                    onClick={() => setCurrentStep(i)}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider border-2 transition-all shrink-0",
                      isActive
                        ? "border-foreground bg-foreground text-background"
                        : isDone
                        ? "border-foreground/30 bg-foreground/5 text-foreground"
                        : "border-foreground/15 text-foreground/40 hover:border-foreground/30 hover:text-foreground/60"
                    )}
                  >
                    {isDone ? (
                      <Check className="w-3 h-3" weight="bold" />
                    ) : (
                      <StepIcon className="w-3.5 h-3.5" weight={isActive ? 'fill' : 'duotone'} />
                    )}
                    <span className="hidden sm:inline">{s.label}</span>
                  </button>
                );
              })}
            </div>

            {/* ── Step content ── */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {step && (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.15 }}
                    className="p-4 space-y-4"
                  >
                    {/* Step description */}
                    <p className="text-xs text-muted-foreground">{step.description}</p>

                    {/* Fields */}
                    {step.fields.map(field => (
                      <div key={field.id} className="border-2 border-foreground/15 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black uppercase tracking-wider text-foreground">
                            {field.label}
                          </span>
                          {field.briefSource && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Sparkle className="w-2.5 h-2.5" weight="fill" />
                              {field.briefSource}
                            </span>
                          )}
                        </div>

                        {/* Chips field */}
                        {field.type === 'chips' && (
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-1.5">
                              {field.editable ? (
                                <>
                                  {field.value.map((chip, i) => (
                                    <EditableChip
                                      key={`${chip}-${i}`}
                                      value={chip}
                                      onEdit={newVal => editChip(field.id, i, newVal)}
                                      onRemove={() => removeChip(field.id, i)}
                                    />
                                  ))}
                                  <ChipInput onAdd={val => addChip(field.id, val)} />
                                </>
                              ) : (
                                field.value.map((chip, i) => (
                                  <span
                                    key={`${chip}-${i}`}
                                    className={cn(
                                      "inline-flex items-center gap-1 px-2 py-1 border-2 text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors",
                                      "border-foreground/20 text-foreground/80 hover:border-foreground/40"
                                    )}
                                    onClick={() => removeChip(field.id, i)}
                                  >
                                    <span>{chip}</span>
                                    <X className="w-2.5 h-2.5 text-foreground/30" />
                                  </span>
                                ))
                              )}
                            </div>

                            {/* Suggestions */}
                            {field.suggestions.length > 0 && (
                              <div className="pt-1.5 border-t border-foreground/10">
                                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                                  <Sparkle className="w-2.5 h-2.5" weight="fill" />
                                  Suggestions
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {field.suggestions.map((sug, i) => (
                                    <button
                                      key={`sug-${sug}-${i}`}
                                      onClick={() => addChip(field.id, sug)}
                                      className="inline-flex items-center gap-1 px-2 py-1 border-2 border-dashed border-foreground/15 text-xs font-bold uppercase tracking-wider text-foreground/50 hover:border-foreground/40 hover:text-foreground/80 hover:bg-foreground/[0.03] transition-all"
                                    >
                                      <Plus className="w-2.5 h-2.5" />
                                      <span>{sug}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Range field */}
                        {field.type === 'range' && (
                          <RangeInput
                            min={field.rangeMin ?? null}
                            max={field.rangeMax ?? null}
                            onChange={(min, max) => setRange(field.id, min, max)}
                          />
                        )}

                        {/* Toggle field */}
                        {field.type === 'toggle' && (
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setToggle(field.id, !field.toggleValue)}
                              className={cn(
                                "w-5 h-5 border-2 flex items-center justify-center shrink-0 text-xs font-black transition-colors",
                                field.toggleValue
                                  ? "bg-foreground text-background border-foreground"
                                  : "bg-background text-foreground/30 border-foreground/30"
                              )}
                            >
                              {field.toggleValue ? '✓' : ''}
                            </button>
                            <span className="text-xs text-muted-foreground">
                              {field.toggleValue ? 'Activé — ESN / IT Services exclus' : 'Désactivé — Tous les types d\'entreprise'}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </motion.div>
                </AnimatePresence>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="shrink-0 border-t-2 border-foreground p-4 flex items-center gap-2 bg-background">
              {currentStep > 0 && (
                <button
                  onClick={() => setCurrentStep(p => p - 1)}
                  className="h-[36px] px-4 text-xs font-black uppercase tracking-wider border-2 border-foreground bg-background text-foreground hover:bg-foreground/[0.04] transition-colors flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3 h-3" weight="bold" />
                  Retour
                </button>
              )}
              <button
                onClick={() => onOpenChange(false)}
                className="h-[36px] px-3 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                Passer
              </button>
              <div className="flex-1" />
              {isLast ? (
                <button
                  onClick={handleApply}
                  className="relative overflow-hidden flex items-center justify-center gap-2 h-[36px] px-5 text-xs font-black uppercase tracking-wider border-2 border-foreground bg-foreground text-background group transition-colors"
                >
                  <Play className="w-3.5 h-3.5 relative z-10" weight="fill" />
                  <span className="relative z-10">Appliquer & chercher</span>
                  <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                </button>
              ) : (
                <button
                  onClick={() => setCurrentStep(p => p + 1)}
                  className="flex items-center gap-1.5 h-[36px] px-5 text-xs font-black uppercase tracking-wider border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 transition-colors"
                >
                  Suivant
                  <ArrowRight className="w-3 h-3" weight="bold" />
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
