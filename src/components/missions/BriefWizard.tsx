import React, { useState, useCallback, useMemo } from 'react';
import { ChevronDown, Plus, X, Check, Mic, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { JobDetails, CONTRACT_TYPE_LABELS, URGENCY_LABELS, REMOTE_LABELS, SIZE_LABELS, SALARY_TYPE_LABELS } from '@/types/jobDetails';

// ─── Shared field components ───────────────────────────────

const Field = ({ label, value, onChange, type = 'text', placeholder, className }: {
  label: string; value: string | number | undefined | null; onChange: (val: string) => void;
  type?: 'text' | 'number' | 'textarea' | 'email' | 'tel' | 'url'; placeholder?: string; className?: string;
}) => (
  <div className={cn("space-y-1", className)}>
    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
    {type === 'textarea' ? (
      <textarea defaultValue={value ?? ''} onBlur={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full min-h-[80px] px-3 py-2 text-sm border border-foreground/20 bg-background text-foreground resize-y focus:border-foreground focus:outline-none transition-colors" />
    ) : (
      <input type={type} defaultValue={value ?? ''} onBlur={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full h-[36px] px-3 text-sm border border-foreground/20 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors" />
    )}
  </div>
);

const SelectField = ({ label, value, onChange, options, placeholder }: {
  label: string; value: string | undefined | null; onChange: (val: string) => void;
  options: Record<string, string>; placeholder?: string;
}) => (
  <div className="space-y-1">
    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}
      className="w-full h-[36px] px-3 text-sm border border-foreground/20 bg-background text-foreground focus:border-foreground focus:outline-none transition-colors">
      <option value="">{placeholder || '—'}</option>
      {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  </div>
);

const TagInput = ({ label, tags, onChange, color, placeholder }: {
  label: string; tags: string[]; onChange: (tags: string[]) => void; color: string; placeholder?: string;
}) => {
  const [input, setInput] = useState('');
  const addTag = () => { const v = input.trim(); if (v && !tags.includes(v)) onChange([...tags, v]); setInput(''); };
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag, i) => (
          <span key={i} className={cn("flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider", color)}>
            {tag}
            <button onClick={() => onChange(tags.filter((_, j) => j !== i))} className="hover:opacity-60"><X className="w-2.5 h-2.5" /></button>
          </span>
        ))}
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
          onBlur={() => { if (input.trim()) addTag(); }}
          placeholder={placeholder || 'Ajouter...'}
          className="h-[28px] w-32 px-2 text-[11px] border border-dashed border-foreground/15 bg-transparent text-foreground focus:border-foreground/40 focus:outline-none" />
      </div>
    </div>
  );
};

// ─── Wizard Steps ──────────────────────────────────────────

const STEPS = [
  { key: 'poste', label: 'Le poste', emoji: '🏷️' },
  { key: 'client', label: 'Le client', emoji: '🏢' },
  { key: 'profil', label: 'Profil recherché', emoji: '🎯' },
  { key: 'competences', label: 'Compétences', emoji: '⚡' },
];

// ─── Completion score ──────────────────────────────────────

function computeCompletionScore(d: JobDetails): { score: number; missing: string[] } {
  const checks: Array<[boolean, string]> = [
    [!!d.title, 'Titre du poste'],
    [!!d.contract_type, 'Type de contrat'],
    [!!d.client?.name, 'Nom du client'],
    [!!d.location, 'Localisation'],
    [!!d.remote_policy, 'Politique remote'],
    [!!d.seniority, 'Séniorité'],
    [d.experience_min != null, 'Expérience min'],
    [d.salary_min != null, 'Salaire min'],
    [(d.skills_must_have?.length || 0) > 0, 'Skills must-have'],
    [!!d.mission_description || !!d.context, 'Description ou contexte'],
  ];
  const done = checks.filter(([ok]) => ok).length;
  const missing = checks.filter(([ok]) => !ok).map(([, label]) => label);
  return { score: Math.round((done / checks.length) * 100), missing };
}

// ─── Main wizard component ────────────────────────────────

interface BriefWizardProps {
  jobDetails: JobDetails;
  onUpdate: (patch: Partial<JobDetails>) => void;
  readOnly?: boolean;
}

export const BriefWizard: React.FC<BriefWizardProps> = ({ jobDetails, onUpdate, readOnly = false }) => {
  const [activeStep, setActiveStep] = useState(0);
  const d = jobDetails;

  const updateField = useCallback((path: string, value: any) => {
    const parts = path.split('.');
    const buildPatch = (keys: string[], val: any): any => {
      if (keys.length === 1) return { [keys[0]]: val };
      const [head, ...rest] = keys;
      return { [head]: buildPatch(rest, val) };
    };
    onUpdate(buildPatch(parts, value !== '' && value != null ? value : undefined));
  }, [onUpdate]);

  const { score, missing } = useMemo(() => computeCompletionScore(d), [d]);

  return (
    <div className="flex flex-col lg:flex-row gap-0 lg:gap-6">
      {/* Left: Wizard */}
      <div className="flex-1 min-w-0">
        {/* Step navigation */}
        <div className="flex gap-0 mb-0">
          {STEPS.map((step, i) => (
            <button
              key={step.key}
              onClick={() => setActiveStep(i)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 h-[38px] text-[10px] font-bold uppercase tracking-wider border border-foreground/20 transition-colors",
                i > 0 && "border-l-0",
                activeStep === i
                  ? "bg-foreground text-background"
                  : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted/30"
              )}
            >
              <span>{step.emoji}</span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="border border-foreground/20 border-t-0 p-4 sm:p-6">
          {activeStep === 0 && (
            <StepPoste d={d} updateField={updateField} readOnly={readOnly} />
          )}
          {activeStep === 1 && (
            <StepClient d={d} updateField={updateField} readOnly={readOnly} />
          )}
          {activeStep === 2 && (
            <StepProfil d={d} updateField={updateField} onUpdate={onUpdate} readOnly={readOnly} />
          )}
          {activeStep === 3 && (
            <StepCompetences d={d} onUpdate={onUpdate} readOnly={readOnly} />
          )}

          {/* Navigation */}
          {!readOnly && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-foreground/10">
              <button
                onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
                disabled={activeStep === 0}
                className="h-[34px] px-4 text-[10px] font-bold uppercase tracking-wider border border-foreground/20 text-muted-foreground hover:text-foreground hover:border-foreground disabled:opacity-30 transition-colors"
              >
                Précédent
              </button>
              {activeStep < STEPS.length - 1 ? (
                <button
                  onClick={() => setActiveStep(activeStep + 1)}
                  className="relative overflow-hidden h-[34px] px-5 text-[10px] font-bold uppercase tracking-wider border border-foreground bg-foreground text-background group"
                >
                  <span className="relative z-10">Suivant</span>
                  <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-foreground" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-foreground">Brief complet</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Completion sidebar */}
      <div className="lg:w-[240px] shrink-0 mt-4 lg:mt-0">
        <div className="border border-foreground/20 p-4 sticky top-24">
          {/* Score */}
          <div className="text-center mb-4">
            <div className="relative inline-flex items-center justify-center w-16 h-16 border-2 border-foreground">
              <span className={cn(
                "text-lg font-bold",
                score >= 80 ? "text-foreground" : score >= 50 ? "text-foreground/70" : "text-muted-foreground"
              )}>
                {score}%
              </span>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-2">
              Complétion
            </p>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 w-full bg-foreground/10 mb-4">
            <div
              className={cn("h-full transition-all duration-500", score >= 80 ? "bg-foreground" : "bg-foreground/50")}
              style={{ width: `${score}%` }}
            />
          </div>

          {/* Missing items */}
          {missing.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">À compléter</p>
              {missing.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <div className="w-1.5 h-1.5 bg-foreground/20 shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          )}

          {/* All done */}
          {missing.length === 0 && (
            <div className="text-center py-2">
              <Check className="w-5 h-5 text-foreground mx-auto mb-1" />
              <p className="text-[10px] font-bold uppercase tracking-wider text-foreground">Brief complet</p>
              <p className="text-[9px] text-muted-foreground mt-1">Prêt pour l'analyse IA</p>
            </div>
          )}

          {/* Quick step links */}
          <div className="mt-4 pt-4 border-t border-foreground/10 space-y-1">
            {STEPS.map((step, i) => (
              <button
                key={step.key}
                onClick={() => setActiveStep(i)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wider text-left transition-colors",
                  activeStep === i ? "text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span>{step.emoji}</span> {step.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Step 1: Le poste ──────────────────────────────────────

const StepPoste = ({ d, updateField, readOnly }: { d: JobDetails; updateField: (p: string, v: any) => void; readOnly: boolean }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Titre du poste *" value={d.title} onChange={(v) => updateField('title', v)} placeholder="Ex: DevOps Senior" />
      <Field label="Référence interne" value={d.reference} onChange={(v) => updateField('reference', v)} placeholder="Ex: SKL-2026-042" />
      <SelectField label="Type de contrat *" value={d.contract_type} onChange={(v) => updateField('contract_type', v)} options={CONTRACT_TYPE_LABELS} />
      <SelectField label="Urgence" value={d.urgency} onChange={(v) => updateField('urgency', v)} options={URGENCY_LABELS} />
      <Field label="Date de démarrage" value={d.start_date} onChange={(v) => updateField('start_date', v)} placeholder="Ex: ASAP, Septembre 2026" />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Localisation *" value={d.location} onChange={(v) => updateField('location', v)} placeholder="Ex: Paris, Lyon" />
      <SelectField label="Politique remote *" value={d.remote_policy} onChange={(v) => updateField('remote_policy', v)} options={REMOTE_LABELS} />
      {d.remote_policy === 'hybrid' && (
        <Field label="Jours remote / semaine" value={d.remote_days} onChange={(v) => updateField('remote_days', v ? Number(v) : undefined)} type="number" />
      )}
    </div>
    <Field label="Contexte (pourquoi on recrute)" value={d.context} onChange={(v) => updateField('context', v)} type="textarea" placeholder="Création de poste, remplacement, croissance..." />
    <Field label="Description détaillée" value={d.mission_description} onChange={(v) => updateField('mission_description', v)} type="textarea" placeholder="Missions, responsabilités, environnement technique..." />
  </div>
);

// ─── Step 2: Le client ─────────────────────────────────────

const StepClient = ({ d, updateField, readOnly }: { d: JobDetails; updateField: (p: string, v: any) => void; readOnly: boolean }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Nom du client *" value={d.client?.name} onChange={(v) => updateField('client.name', v)} placeholder="Ex: Numspot" />
      <Field label="Secteur" value={d.client?.sector} onChange={(v) => updateField('client.sector', v)} placeholder="Ex: Cloud, Fintech" />
      <SelectField label="Taille" value={d.client?.size} onChange={(v) => updateField('client.size', v)} options={SIZE_LABELS} />
      <Field label="Site web" value={d.client?.website} onChange={(v) => updateField('client.website', v)} type="url" placeholder="https://..." />
    </div>
    <Field label="Notes culture" value={d.client?.culture_notes} onChange={(v) => updateField('client.culture_notes', v)} type="textarea" placeholder="Stack technique, valeurs, ambiance, particularités..." />

    {/* Hiring Manager */}
    <div className="pt-4 border-t border-foreground/10">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">👤 Hiring Manager</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Nom" value={d.client?.hiring_manager?.name} onChange={(v) => updateField('client.hiring_manager.name', v)} />
        <Field label="Titre" value={d.client?.hiring_manager?.title} onChange={(v) => updateField('client.hiring_manager.title', v)} placeholder="Ex: CTO" />
        <Field label="Email" value={d.client?.hiring_manager?.email} onChange={(v) => updateField('client.hiring_manager.email', v)} type="email" />
        <Field label="LinkedIn" value={d.client?.hiring_manager?.linkedin} onChange={(v) => updateField('client.hiring_manager.linkedin', v)} type="url" placeholder="https://linkedin.com/in/..." />
      </div>
    </div>
  </div>
);

// ─── Step 3: Profil recherché ──────────────────────────────

const StepProfil = ({ d, updateField, onUpdate, readOnly }: { d: JobDetails; updateField: (p: string, v: any) => void; onUpdate: (p: Partial<JobDetails>) => void; readOnly: boolean }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Séniorité *" value={d.seniority} onChange={(v) => updateField('seniority', v)} placeholder="Ex: Senior, Lead, Junior" />
      <div className="flex gap-2">
        <Field label="XP min (années)" value={d.experience_min} onChange={(v) => updateField('experience_min', v ? Number(v) : undefined)} type="number" className="flex-1" />
        <Field label="XP max" value={d.experience_max} onChange={(v) => updateField('experience_max', v ? Number(v) : undefined)} type="number" className="flex-1" />
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Field label="Salaire min *" value={d.salary_min} onChange={(v) => updateField('salary_min', v ? Number(v) : undefined)} type="number" />
      <Field label="Salaire max" value={d.salary_max} onChange={(v) => updateField('salary_max', v ? Number(v) : undefined)} type="number" />
      <SelectField label="Type" value={d.salary_type} onChange={(v) => updateField('salary_type', v)} options={SALARY_TYPE_LABELS} />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Equity / variable" value={d.equity} onChange={(v) => updateField('equity', v)} placeholder="Ex: BSPCE, 0.5%" />
      <Field label="Avantages" value={d.benefits} onChange={(v) => updateField('benefits', v)} placeholder="Ex: TR, mutuelle, télétravail" />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Taille de l'équipe" value={d.team_size} onChange={(v) => updateField('team_size', v ? Number(v) : undefined)} type="number" />
      <Field label="Reporte à" value={d.reports_to} onChange={(v) => updateField('reports_to', v)} placeholder="Ex: CTO, VP Engineering" />
    </div>
  </div>
);

// ─── Step 4: Compétences ───────────────────────────────────

const StepCompetences = ({ d, onUpdate, readOnly }: { d: JobDetails; onUpdate: (p: Partial<JobDetails>) => void; readOnly: boolean }) => (
  <div className="space-y-5">
    <TagInput label="🔴 Must-have — indispensable" tags={d.skills_must_have || []} onChange={(tags) => onUpdate({ skills_must_have: tags })} color="bg-red-600 text-white" placeholder="Skill obligatoire" />
    <TagInput label="🟡 Should-have — important" tags={d.skills_should_have || []} onChange={(tags) => onUpdate({ skills_should_have: tags })} color="bg-amber-500 text-white" placeholder="Skill important" />
    <TagInput label="🟢 Nice-to-have — bonus" tags={d.skills_nice_to_have || []} onChange={(tags) => onUpdate({ skills_nice_to_have: tags })} color="bg-emerald-600 text-white" placeholder="Skill bonus" />
    <TagInput label="⛔ À éviter" tags={d.skills_to_avoid || []} onChange={(tags) => onUpdate({ skills_to_avoid: tags })} color="bg-foreground/10 text-foreground line-through border border-foreground/20" placeholder="Trait rédhibitoire" />
    <Field label="Certifications" value={d.certifications?.join(', ')} onChange={(v) => onUpdate({ certifications: v ? v.split(',').map(s => s.trim()).filter(Boolean) : [] })} placeholder="Ex: AWS, PMP, CISSP (séparés par des virgules)" />
    <Field label="Brief brut (texte ou voice transcript)" value={d.raw_brief} onChange={(v) => onUpdate({ raw_brief: v })} type="textarea" placeholder="Collez un brief brut ou retrouvez ici le transcript vocal..." />
  </div>
);
