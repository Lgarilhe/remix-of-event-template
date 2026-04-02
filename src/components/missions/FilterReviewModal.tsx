import React, { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play, Sparkle, MapPin, Briefcase, GraduationCap, Building2, Search, SlidersHorizontal, CircleUser, Plus, Pencil, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ─── Types ─── */
interface FilterSection {
  id: string;
  icon: React.ElementType;
  label: string;
  enabled: boolean;
  chips: string[];
  editable?: boolean;       // can add/edit/remove chips
  suggestions?: string[];   // AI suggested chips not yet added
  extra?: string;
}

interface AnalysisFilters {
  keywords: string;
  role: Array<{ keywords: string; priority: string; scope: string }>;
  years_of_experience_min: number | null;
  years_of_experience_max: number | null;
  skills_keywords: string[];
  location_keywords: string[];
  location_within_area: number | null;
}

interface AnalysisData {
  search_rationale: string | null;
  keyword_rationale: string | null;
  experience_rationale: string | null;
  role_keywords: string[];
  skills_to_search: string[];
  domain_expertise: string[];
  location_hint: string | null;
  job_category: string;
}

export interface FilterReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: AnalysisFilters;
  analysis: AnalysisData;
  onAccept: (filters: AnalysisFilters) => void;
  onRegenerate?: () => void;
  isLoading?: boolean;
}

/* ─── Build sections with suggestions ─── */
function buildSections(filters: AnalysisFilters, analysis: AnalysisData): FilterSection[] {
  const sections: FilterSection[] = [];

  // Roles/Titles — editable + suggestions from analysis extras
  const roleChips = filters.role?.map(r => r.keywords) ?? [];
  const activeRoles = roleChips.length > 0 ? roleChips : analysis.role_keywords ?? [];
  // Suggestions: analysis role_keywords not already in active chips
  const roleSuggestions = (analysis.role_keywords ?? []).filter(
    rk => !activeRoles.some(a => a.toLowerCase() === rk.toLowerCase())
  );
  if (activeRoles.length > 0 || roleSuggestions.length > 0) {
    sections.push({
      id: 'roles',
      icon: CircleUser,
      label: 'Titres de poste',
      enabled: true,
      chips: activeRoles,
      editable: true,
      suggestions: roleSuggestions,
    });
  }

  // Skills — editable + suggestions from domain_expertise & skills_to_search
  const skills = filters.skills_keywords?.length > 0
    ? filters.skills_keywords
    : analysis.skills_to_search ?? [];
  const allSkillSuggestions = [
    ...(analysis.skills_to_search ?? []),
    ...(analysis.domain_expertise ?? []),
  ];
  const skillSuggestions = allSkillSuggestions.filter(
    s => !skills.some(sk => sk.toLowerCase() === s.toLowerCase())
  );
  if (skills.length > 0 || skillSuggestions.length > 0) {
    sections.push({
      id: 'skills',
      icon: GraduationCap,
      label: 'Compétences clés',
      enabled: true,
      chips: skills,
      editable: true,
      suggestions: [...new Map(skillSuggestions.map(s => [s.toLowerCase(), s])).values()].slice(0, 8),
    });
  }

  // Location
  if (filters.location_keywords?.length > 0 || analysis.location_hint) {
    const locChips = filters.location_keywords?.length > 0
      ? filters.location_keywords
      : analysis.location_hint ? [analysis.location_hint] : [];
    const radius = filters.location_within_area;
    sections.push({
      id: 'location',
      icon: MapPin,
      label: 'Localisation',
      enabled: true,
      chips: locChips,
      extra: radius ? `Rayon: ${radius} km` : undefined,
    });
  }

  // Experience
  const xpMin = filters.years_of_experience_min;
  const xpMax = filters.years_of_experience_max;
  if (xpMin !== null || xpMax !== null) {
    const rangeText = xpMin !== null && xpMax !== null
      ? `${xpMin} – ${xpMax} ans`
      : xpMin !== null ? `${xpMin}+ ans` : `≤ ${xpMax} ans`;
    sections.push({
      id: 'experience',
      icon: Briefcase,
      label: 'Expérience',
      enabled: true,
      chips: [rangeText],
      extra: analysis.experience_rationale || undefined,
    });
  }

  // Boolean keywords
  if (filters.keywords) {
    sections.push({
      id: 'boolean',
      icon: Search,
      label: 'Recherche Boolean',
      enabled: true,
      chips: [filters.keywords],
      editable: true,
    });
  }

  // Domain expertise (only if not already consumed as skill suggestions)
  if (analysis.domain_expertise?.length > 0 && skills.length === 0) {
    sections.push({
      id: 'domain',
      icon: Building2,
      label: 'Domaines',
      enabled: true,
      chips: analysis.domain_expertise,
    });
  }

  return sections;
}

/* ─── Inline chip editor ─── */
const ChipInput: React.FC<{
  onAdd: (value: string) => void;
  placeholder?: string;
}> = ({ onAdd, placeholder = 'Ajouter...' }) => {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onAdd(trimmed);
      setValue('');
    }
  };

  return (
    <div className="inline-flex items-center border-2 border-dashed border-border hover:border-border transition-colors">
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        placeholder={placeholder}
        className="h-7 w-[120px] px-2 text-xs font-bold uppercase tracking-wider bg-transparent text-foreground placeholder:text-foreground/30 outline-none"
      />
      <button
        onClick={submit}
        className="h-7 w-7 flex items-center justify-center text-foreground/40 hover:text-foreground transition-colors"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
};

/* ─── Editable chip ─── */
const EditableChip: React.FC<{
  value: string;
  onEdit: (newValue: string) => void;
  onRemove: () => void;
}> = ({ value, onEdit, onRemove }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const confirm = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== value) onEdit(trimmed);
    else setEditValue(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="inline-flex items-center border-2 border-border bg-accent/50">
        <input
          ref={inputRef}
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } if (e.key === 'Escape') { setEditValue(value); setEditing(false); } }}
          onBlur={confirm}
          className="h-7 w-[140px] px-2 text-xs font-bold uppercase tracking-wider bg-transparent text-foreground outline-none"
        />
        <button onClick={confirm} className="h-7 w-6 flex items-center justify-center text-foreground/60 hover:text-foreground">
          <Check className="w-3 h-3" />
        </button>
      </span>
    );
  }

  return (
    <span className="group inline-flex items-center gap-0.5 px-2 py-1 border-2 border-border text-xs font-bold uppercase tracking-wider text-foreground/80 hover:border-border transition-colors cursor-default">
      <span className="max-w-[200px] truncate">{value}</span>
      <button
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        className="w-3.5 h-3.5 flex items-center justify-center text-foreground/20 hover:text-foreground transition-colors"
      >
        <Pencil className="w-2.5 h-2.5" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="w-3.5 h-3.5 flex items-center justify-center text-foreground/20 hover:text-destructive transition-colors"
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
};

/* ═══════════════════════════════════════════════
   FILTER REVIEW MODAL
   ═══════════════════════════════════════════════ */

export const FilterReviewModal: React.FC<FilterReviewModalProps> = ({
  open,
  onOpenChange,
  filters,
  analysis,
  onAccept,
  onRegenerate,
  isLoading,
}) => {
  const [sections, setSections] = useState<FilterSection[]>(() => buildSections(filters, analysis));

  React.useEffect(() => {
    if (open) setSections(buildSections(filters, analysis));
  }, [open, filters, analysis]);

  const toggleSection = useCallback((id: string) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  }, []);

  const removeChip = useCallback((sectionId: string, chipIndex: number) => {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const newChips = s.chips.filter((_, i) => i !== chipIndex);
      return { ...s, chips: newChips, enabled: newChips.length > 0 ? s.enabled : false };
    }));
  }, []);

  const editChip = useCallback((sectionId: string, chipIndex: number, newValue: string) => {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const newChips = [...s.chips];
      newChips[chipIndex] = newValue;
      return { ...s, chips: newChips };
    }));
  }, []);

  const addChip = useCallback((sectionId: string, value: string) => {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      if (s.chips.some(c => c.toLowerCase() === value.toLowerCase())) return s;
      // Remove from suggestions if present
      const newSuggestions = s.suggestions?.filter(sg => sg.toLowerCase() !== value.toLowerCase());
      return { ...s, chips: [...s.chips, value], suggestions: newSuggestions, enabled: true };
    }));
  }, []);

  const handleAccept = () => {
    const updated = { ...filters };
    const roleSection = sections.find(s => s.id === 'roles');
    if (roleSection && roleSection.enabled) {
      updated.role = roleSection.chips.map(kw => ({ keywords: kw, priority: 'MUST_HAVE', scope: 'CURRENT' }));
    } else {
      updated.role = [];
    }

    const skillsSection = sections.find(s => s.id === 'skills');
    if (skillsSection && skillsSection.enabled) {
      updated.skills_keywords = skillsSection.chips;
    } else {
      updated.skills_keywords = [];
    }

    const locSection = sections.find(s => s.id === 'location');
    if (locSection && locSection.enabled) {
      updated.location_keywords = locSection.chips;
    } else {
      updated.location_keywords = [];
    }

    const boolSection = sections.find(s => s.id === 'boolean');
    if (boolSection && boolSection.enabled && boolSection.chips[0]) {
      updated.keywords = boolSection.chips[0];
    } else {
      updated.keywords = '';
    }

    onAccept(updated);
  };

  const enabledCount = sections.filter(s => s.enabled).length;

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[4000] flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-foreground/60"
            onClick={() => onOpenChange(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Panel */}
          <motion.div
            className="relative w-full sm:max-w-lg max-h-[85dvh] flex flex-col bg-background border-2 border-border sm:mx-4 overflow-hidden"
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          >
            {/* ── Header ── */}
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b-2 border-border bg-foreground/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-foreground flex items-center justify-center">
                  <SlidersHorizontal className="w-4 h-4 text-background" />
                </div>
                <div>
                  <h2 className="text-xs font-black uppercase tracking-wider text-foreground">Filtres proposés</h2>
                  <p className="text-xs text-muted-foreground">{enabledCount} catégorie{enabledCount > 1 ? 's' : ''} active{enabledCount > 1 ? 's' : ''}</p>
                </div>
              </div>
              <button
                onClick={() => onOpenChange(false)}
                className="w-8 h-8 flex items-center justify-center border-2 border-border hover:border-border transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ── Strategy summary ── */}
            {analysis.search_rationale && (
              <div className="shrink-0 px-4 py-3 border-b-2 border-border bg-accent/10">
                <p className="text-xs font-black uppercase tracking-wider text-muted-foreground mb-1">
                  <Sparkle className="w-3 h-3 inline mr-1" />
                  Stratégie IA
                </p>
                <p className="text-xs text-foreground leading-relaxed">{analysis.search_rationale}</p>
              </div>
            )}

            {/* ── Sections ── */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              <div className="p-4 space-y-3">
                {sections.map((section) => (
                  <div
                    key={section.id}
                    className={cn(
                      "border-2 transition-all",
                      section.enabled ? "border-border" : "border-border opacity-50"
                    )}
                  >
                    {/* Section header */}
                    <button
                      type="button"
                      onClick={() => toggleSection(section.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-foreground/[0.02] transition-colors"
                      style={{ WebkitTapHighlightColor: 'transparent' }}
                    >
                      <div className={cn(
                        "w-5 h-5 border-2 flex items-center justify-center shrink-0 text-xs font-black transition-colors",
                        section.enabled
                          ? "bg-foreground text-background border-border"
                          : "bg-background text-foreground/30 border-border"
                      )}>
                        {section.enabled ? '✓' : ''}
                      </div>
                      <section.icon className="w-4 h-4 text-foreground/70 shrink-0" />
                      <span className="text-xs font-black uppercase tracking-wider text-foreground flex-1">{section.label}</span>
                      {section.editable && section.enabled && (
                        <Pencil className="w-3 h-3 text-foreground/30" />
                      )}
                    </button>

                    {/* Chips + editor */}
                    {section.enabled && (
                      <div className="px-3 pb-3 pt-0 space-y-2">
                        {/* Active chips */}
                        <div className="flex flex-wrap gap-1.5">
                          {section.editable ? (
                            <>
                              {section.chips.map((chip, i) => (
                                <EditableChip
                                  key={`${chip}-${i}`}
                                  value={chip}
                                  onEdit={(newVal) => editChip(section.id, i, newVal)}
                                  onRemove={() => removeChip(section.id, i)}
                                />
                              ))}
                              <ChipInput
                                onAdd={(val) => addChip(section.id, val)}
                                placeholder={section.id === 'boolean' ? 'Modifier...' : 'Ajouter...'}
                              />
                            </>
                          ) : (
                            section.chips.map((chip, i) => (
                              <span
                                key={`${chip}-${i}`}
                                className="group inline-flex items-center gap-1 px-2 py-1 border-2 border-border text-xs font-bold uppercase tracking-wider text-foreground/80 cursor-default"
                              >
                                <span className="max-w-[200px] truncate">{chip}</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); removeChip(section.id, i); }}
                                  className="w-3.5 h-3.5 flex items-center justify-center text-foreground/30 hover:text-destructive transition-colors"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </span>
                            ))
                          )}
                        </div>

                        {/* AI Suggestions */}
                        {section.suggestions && section.suggestions.length > 0 && (
                          <div className="pt-1.5 border-t border-border">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                              <Sparkle className="w-2.5 h-2.5" />
                              Suggestions IA
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {section.suggestions.map((suggestion, i) => (
                                <button
                                  key={`sug-${suggestion}-${i}`}
                                  onClick={() => addChip(section.id, suggestion)}
                                  className="inline-flex items-center gap-1 px-2 py-1 border-2 border-dashed border-border text-xs font-bold uppercase tracking-wider text-foreground/50 hover:border-border hover:text-foreground/80 hover:bg-foreground/[0.03] transition-all"
                                >
                                  <Plus className="w-2.5 h-2.5" />
                                  <span>{suggestion}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {section.extra && (
                          <p className="text-xs text-muted-foreground mt-1 italic">{section.extra}</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="shrink-0 border-t-2 border-border p-4 flex items-center gap-2 bg-background">
              {onRegenerate && (
                <button
                  onClick={onRegenerate}
                  disabled={isLoading}
                  className="h-[36px] px-4 text-xs font-black uppercase tracking-wider border-2 border-border bg-background text-foreground hover:bg-foreground/[0.04] transition-colors"
                >
                  Regénérer
                </button>
              )}
              <button
                onClick={handleAccept}
                disabled={isLoading || enabledCount === 0}
                className={cn(
                  "flex-1 relative overflow-hidden flex items-center justify-center gap-2 h-[36px] px-5 text-xs font-black uppercase tracking-wider border-2 border-border group transition-colors",
                  enabledCount > 0
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                <Play className="w-3.5 h-3.5 relative z-10" />
                <span className="relative z-10">Lancer le sourcing</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
