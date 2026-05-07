import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Plus, Sparkles, ArrowLeft, ArrowRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { JobDetails, CONTRACT_TYPE_LABELS, URGENCY_LABELS, REMOTE_LABELS, SIZE_LABELS, SALARY_TYPE_LABELS } from '@/types/jobDetails';

// ─── Shared field components ───────────────────────────────

const Field = ({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  className,
  readOnly = false,
}: {
  label: string;
  value: string | number | undefined | null;
  onChange: (val: string) => void;
  type?: 'text' | 'number' | 'textarea' | 'email' | 'tel' | 'url';
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
}) => {
  const [localValue, setLocalValue] = useState<string>(
    value != null ? String(value) : ''
  );

  // Sync with external changes (voice dictation, AI auto-fill, real-time sync)
  useEffect(() => {
    setLocalValue(value != null ? String(value) : '');
  }, [value]);

  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="text-3xs uppercase tracking-wider font-bold text-muted-foreground">{label}</label>
      {type === 'textarea' ? (
        <textarea
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={() => onChange(localValue)}
          placeholder={placeholder}
          readOnly={readOnly}
          tabIndex={readOnly ? -1 : undefined}
          className={cn(
            'w-full min-h-[80px] px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground resize-y focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/30 transition-colors placeholder:text-muted-foreground/40',
            readOnly && 'cursor-default opacity-70 focus:border-border'
          )}
        />
      ) : (
        <input
          type={type}
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={() => onChange(localValue)}
          placeholder={placeholder}
          readOnly={readOnly}
          tabIndex={readOnly ? -1 : undefined}
          className={cn(
            'w-full h-[38px] px-3 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/30 transition-colors placeholder:text-muted-foreground/40',
            readOnly && 'cursor-default opacity-70 focus:border-border'
          )}
        />
      )}
    </div>
  );
};

const SelectField = ({
  label,
  value,
  onChange,
  options,
  placeholder,
  readOnly = false,
}: {
  label: string;
  value: string | undefined | null;
  onChange: (val: string) => void;
  options: Record<string, string>;
  placeholder?: string;
  readOnly?: boolean;
}) => (
  <div className="space-y-1.5">
    <label className="text-3xs uppercase tracking-wider font-bold text-muted-foreground">{label}</label>
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={readOnly}
      tabIndex={readOnly ? -1 : undefined}
      className={cn(
        'w-full h-[38px] px-3 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/30 transition-colors',
        readOnly && 'cursor-default opacity-70 focus:border-border'
      )}
    >
      <option value="">{placeholder || '---'}</option>
      {Object.entries(options).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  </div>
);

const TagInput = ({
  label,
  tags,
  onChange,
  color,
  placeholder,
  readOnly = false,
}: {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  color: string;
  placeholder?: string;
  readOnly?: boolean;
}) => {
  const [input, setInput] = useState('');

  const addTag = () => {
    const v = input.trim();
    if (readOnly) return;
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setInput('');
  };

  return (
    <div className="space-y-2">
      <label className="text-3xs uppercase tracking-wider font-bold text-muted-foreground">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag, i) => (
          <motion.span
            key={`${tag}-${i}`}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 text-2xs font-bold uppercase tracking-wider rounded-full border', color)}
          >
            {tag}
            {!readOnly && (
              <button type="button" onClick={() => onChange(tags.filter((_, j) => j !== i))} className="hover:opacity-60">
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </motion.span>
        ))}
        {!readOnly && (
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={() => {
              if (input.trim()) addTag();
            }}
            placeholder={placeholder || 'Ajouter...'}
            className="h-8 w-32 px-2 text-xs border border-dashed border-border bg-transparent text-foreground focus:border-border transition-colors focus:outline-none"
          />
        )}
      </div>
    </div>
  );
};

// ─── Steps config ──────────────────────────────────────────

const STEPS = [
  { key: 'poste', label: 'Le Poste', subtitle: 'Titre, contrat, localisation et contexte du recrutement', emoji: '1' },
  { key: 'client', label: 'Le Client', subtitle: "Informations sur l'entreprise et le hiring manager", emoji: '2' },
  { key: 'profil', label: 'Le Profil', subtitle: 'Seniorité, expérience, rémunération et langues', emoji: '3' },
  { key: 'competences', label: 'Les Compétences', subtitle: 'Compétences techniques et soft skills par priorité', emoji: '4' },
  { key: 'evaluation', label: "L'Évaluation", subtitle: 'Critères du manager, deal-breakers et pondérations', emoji: '5' },
];

// ─── Completion score ──────────────────────────────────────

interface CompletionItem {
  label: string;
  done: boolean;
  critical: boolean;
}

function computeCompletionScore(d: JobDetails): { score: number; items: CompletionItem[] } {
  const checks: Array<[boolean, string, boolean]> = [
    [!!d.title, 'Titre du poste', true],
    [!!d.contract_type, 'Type de contrat', false],
    [!!d.client?.name, 'Nom du client', false],
    [!!d.location, 'Localisation', true],
    [!!d.remote_policy, 'Politique remote', false],
    [!!d.seniority, 'Seniorité', true],
    [d.experience_min != null, 'Expérience min', false],
    [d.salary_min != null, 'Salaire min', false],
    [(d.skills_must_have?.length || 0) > 0, 'Skills must-have', true],
    [!!d.mission_description || !!d.context, 'Description ou contexte', true],
    [(d.evaluation_criteria?.length || 0) > 0, "Critères d'évaluation", false],
  ];
  const done = checks.filter(([ok]) => ok).length;
  const items = checks.map(([ok, label, critical]) => ({ label, done: ok, critical }));
  return { score: Math.round((done / checks.length) * 100), items };
}

function getStepCompletion(stepIndex: number, d: JobDetails): { filled: number; total: number; missingCritical: string[] } {
  const missing: string[] = [];
  switch (stepIndex) {
    case 0: {
      const fields = [!!d.title, !!d.contract_type, !!d.location, !!d.remote_policy, !!d.mission_description || !!d.context];
      if (!d.title) missing.push('Titre du poste');
      if (!d.location) missing.push('Localisation');
      if (!d.mission_description && !d.context) missing.push('Description ou contexte');
      return { filled: fields.filter(Boolean).length, total: fields.length, missingCritical: missing };
    }
    case 1: {
      const fields = [!!d.client?.name, !!d.client?.sector, !!d.client?.size];
      return { filled: fields.filter(Boolean).length, total: fields.length, missingCritical: [] };
    }
    case 2: {
      const fields = [!!d.seniority, d.experience_min != null, d.salary_min != null];
      if (!d.seniority) missing.push('Seniorité');
      return { filled: fields.filter(Boolean).length, total: fields.length, missingCritical: missing };
    }
    case 3: {
      const fields = [(d.skills_must_have?.length || 0) > 0, (d.skills_should_have?.length || 0) > 0];
      if (!(d.skills_must_have?.length)) missing.push('Skills must-have');
      return { filled: fields.filter(Boolean).length, total: fields.length, missingCritical: missing };
    }
    case 4: {
      const fields = [(d.evaluation_criteria?.length || 0) > 0];
      return { filled: fields.filter(Boolean).length, total: fields.length, missingCritical: [] };
    }
    default:
      return { filled: 0, total: 0, missingCritical: [] };
  }
}

// ─── Fullscreen step dialog ────────────────────────────────

const FullscreenStepDialog: React.FC<{
  stepIndex: number;
  d: JobDetails;
  updateField: (path: string, value: any) => void;
  onUpdate: (patch: Partial<JobDetails>) => void;
  readOnly: boolean;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  isFirst: boolean;
  isLast: boolean;
  onLaunchSourcing?: () => void;
  score: number;
  items: CompletionItem[];
}> = ({ stepIndex, d, updateField, onUpdate, readOnly, onClose, onNext, onPrev, isFirst, isLast, onLaunchSourcing, score, items }) => {
  const step = STEPS[stepIndex];
  const { filled, total } = getStepCompletion(stepIndex, d);
  const allCriticalMissing = items.filter((i) => i.critical && !i.done);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[4000] flex h-[100dvh] flex-col bg-background pointer-events-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      {/* Header */}
      <div className="relative z-10 shrink-0 border-b-2 border-border bg-background">
        <div className="flex items-center justify-between px-4 sm:px-8 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-foreground text-background flex items-center justify-center text-xs sm:text-sm font-bold border border-border shrink-0">
              {step.emoji}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-lg font-bold uppercase tracking-wider text-foreground truncate">{step.label}</h2>
              <p className="text-xs text-muted-foreground truncate hidden sm:block">{step.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {stepIndex + 1}/{STEPS.length}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center border border-border text-muted-foreground hover:text-foreground hover:border-border transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="h-1 bg-foreground/10">
          <motion.div
            className="h-full bg-foreground"
            initial={{ width: 0 }}
            animate={{ width: total > 0 ? `${(filled / total) * 100}%` : '0%' }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="max-w-2xl mx-auto px-4 sm:px-8 pt-4 sm:pt-6 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:pb-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={stepIndex}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.25 }}
            >
              {stepIndex === 0 && <StepPoste d={d} updateField={updateField} readOnly={readOnly} />}
              {stepIndex === 1 && <StepClient d={d} updateField={updateField} readOnly={readOnly} />}
              {stepIndex === 2 && <StepProfil d={d} updateField={updateField} onUpdate={onUpdate} readOnly={readOnly} />}
              {stepIndex === 3 && <StepCompetences d={d} onUpdate={onUpdate} readOnly={readOnly} />}
              {stepIndex === 4 && <StepEvaluation d={d} onUpdate={onUpdate} readOnly={readOnly} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Footer navigation */}
      <div className="relative z-10 shrink-0 border-t-2 border-border bg-background">
        <div className="max-w-2xl mx-auto px-4 sm:px-8 py-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={isFirst ? onClose : onPrev}
            className="flex items-center gap-1.5 h-9 px-4 text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground hover:text-foreground hover:border-border transition-all"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {isFirst ? 'Fermer' : 'Précédent'}
          </button>

          {isLast ? (
            <div className="flex items-center gap-3">
              {!readOnly && score >= 70 && onLaunchSourcing ? (
                <ShimmerButton onClick={onLaunchSourcing} className="h-[40px] text-xs px-6" shimmerDuration="1.5s">
                  <Sparkles className="w-3.5 h-3.5" />
                  Lancer le sourcing
                  <ArrowRight className="w-3.5 h-3.5" />
                </ShimmerButton>
              ) : (
                <div className="flex items-center gap-3">
                  {!readOnly && allCriticalMissing.length > 0 && (
                    <div className="hidden sm:flex items-center gap-2 text-destructive">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span className="text-xs font-bold uppercase tracking-wider">
                        {allCriticalMissing.length} champ{allCriticalMissing.length > 1 ? 's' : ''} requis manquant{allCriticalMissing.length > 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex items-center gap-1.5 h-[40px] px-5 text-xs font-bold uppercase tracking-wider border border-border bg-foreground text-background"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {readOnly ? 'Fermer' : 'Terminer'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={onNext}
              className="group relative overflow-hidden flex items-center gap-1.5 h-[40px] px-6 text-xs font-bold uppercase tracking-wider border border-border bg-foreground text-background"
            >
              <span className="relative z-10 flex items-center gap-1.5">
                Suivant
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </button>
          )}
        </div>
      </div>
    </motion.div>,
    document.body
  );
};

// ─── Main wizard component ────────────────────────────────

interface BriefWizardProps {
  jobDetails: JobDetails;
  onUpdate: (patch: Partial<JobDetails>) => void;
  readOnly?: boolean;
  onLaunchSourcing?: () => void;
}

export const BriefWizard: React.FC<BriefWizardProps> = ({ jobDetails, onUpdate, readOnly = false, onLaunchSourcing }) => {
  const [openStep, setOpenStep] = useState<number | null>(null);
  const d = jobDetails;

  const updateField = useCallback(
    (path: string, value: any) => {
      const parts = path.split('.');
      const buildPatch = (keys: string[], val: any): any => {
        if (keys.length === 1) return { [keys[0]]: val };
        const [head, ...rest] = keys;
        return { [head]: buildPatch(rest, val) };
      };
      onUpdate(buildPatch(parts, value !== '' && value != null ? value : undefined));
    },
    [onUpdate]
  );

  const { score, items } = useMemo(() => computeCompletionScore(d), [d]);
  const stepCompletions = useMemo(() => STEPS.map((_, i) => getStepCompletion(i, d)), [d]);

  return (
    <>
      <div className="space-y-0">
        {STEPS.map((step, i) => {
          const comp = stepCompletions[i];
          const pct = comp.total > 0 ? Math.round((comp.filled / comp.total) * 100) : 0;
          const hasMissing = comp.missingCritical.length > 0;

          return (
            <button
              type="button"
              key={step.key}
              onClick={() => setOpenStep(i)}
              className={cn(
                'w-full border border-border p-4 sm:p-5 flex items-center gap-3 text-left transition-all group relative cursor-pointer',
                i > 0 && 'border-t-0',
                readOnly ? 'hover:bg-foreground/[0.02]' : 'hover:bg-foreground/[0.03] active:bg-foreground/[0.06]'
              )}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <div
                className={cn(
                  'w-10 h-10 flex items-center justify-center text-sm font-bold shrink-0 rounded-xl border-2 transition-colors',
                  pct === 100
                    ? 'bg-foreground text-background border-border'
                    : hasMissing
                      ? 'border-destructive/50 text-destructive'
                      : 'border-border text-muted-foreground group-hover:border-border'
                )}
              >
                {pct === 100 ? <Check className="w-4 h-4" /> : step.emoji}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-bold uppercase tracking-wider text-foreground">{step.label}</span>
                  {pct > 0 && pct < 100 && <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{pct}%</span>}
                </div>
                <p className="text-xs text-muted-foreground truncate">{step.subtitle}</p>
                {hasMissing && (
                  <div className="flex items-center gap-1 mt-1 text-destructive">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider truncate">{comp.missingCritical.join(', ')}</span>
                  </div>
                )}
              </div>

              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {openStep !== null && (
          <FullscreenStepDialog
            stepIndex={openStep}
            d={d}
            updateField={updateField}
            onUpdate={onUpdate}
            readOnly={readOnly}
            onClose={() => setOpenStep(null)}
            onNext={() => setOpenStep(Math.min(openStep + 1, STEPS.length - 1))}
            onPrev={() => setOpenStep(Math.max(openStep - 1, 0))}
            isFirst={openStep === 0}
            isLast={openStep === STEPS.length - 1}
            onLaunchSourcing={onLaunchSourcing}
            score={score}
            items={items}
          />
        )}
      </AnimatePresence>
    </>
  );
};

// ─── Step 1: Le poste ──────────────────────────────────────

const StepPoste = ({ d, updateField, readOnly }: { d: JobDetails; updateField: (p: string, v: any) => void; readOnly: boolean }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Titre du poste *" value={d.title} onChange={(v) => updateField('title', v)} placeholder="Ex: DevOps Senior" readOnly={readOnly} />
      <Field label="Référence interne" value={d.reference} onChange={(v) => updateField('reference', v)} placeholder="Ex: SKL-2026-042" readOnly={readOnly} />
      <SelectField label="Type de contrat *" value={d.contract_type} onChange={(v) => updateField('contract_type', v)} options={CONTRACT_TYPE_LABELS} readOnly={readOnly} />
      <SelectField label="Urgence" value={d.urgency} onChange={(v) => updateField('urgency', v)} options={URGENCY_LABELS} readOnly={readOnly} />
      <Field label="Date de démarrage" value={d.start_date} onChange={(v) => updateField('start_date', v)} placeholder="Ex: ASAP, Septembre 2026" readOnly={readOnly} />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Localisation *" value={d.location} onChange={(v) => updateField('location', v)} placeholder="Ex: Paris, Lyon" readOnly={readOnly} />
      <SelectField label="Politique remote *" value={d.remote_policy} onChange={(v) => updateField('remote_policy', v)} options={REMOTE_LABELS} readOnly={readOnly} />
      {d.remote_policy === 'hybrid' && (
        <Field label="Jours remote / semaine" value={d.remote_days} onChange={(v) => updateField('remote_days', v ? Number(v) : undefined)} type="number" readOnly={readOnly} />
      )}
    </div>
    <Field label="Contexte (pourquoi on recrute)" value={d.context} onChange={(v) => updateField('context', v)} type="textarea" placeholder="Création de poste, remplacement, croissance..." readOnly={readOnly} />
    <Field label="Description détaillée" value={d.mission_description} onChange={(v) => updateField('mission_description', v)} type="textarea" placeholder="Missions, responsabilités, environnement technique..." readOnly={readOnly} />
  </div>
);

// ─── Step 2: Le client ─────────────────────────────────────

const StepClient = ({ d, updateField, readOnly }: { d: JobDetails; updateField: (p: string, v: any) => void; readOnly: boolean }) => (
  <div className="space-y-3">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Nom du client *" value={d.client?.name} onChange={(v) => updateField('client.name', v)} placeholder="Ex: Numspot" readOnly={readOnly} />
      <Field label="Secteur" value={d.client?.sector} onChange={(v) => updateField('client.sector', v)} placeholder="Ex: Cloud, Fintech" readOnly={readOnly} />
      <SelectField label="Taille" value={d.client?.size} onChange={(v) => updateField('client.size', v)} options={SIZE_LABELS} readOnly={readOnly} />
      <Field label="Site web" value={d.client?.website} onChange={(v) => updateField('client.website', v)} type="url" placeholder="https://..." readOnly={readOnly} />
    </div>
    <Field label="Notes culture" value={d.client?.culture_notes} onChange={(v) => updateField('client.culture_notes', v)} type="textarea" placeholder="Stack technique, valeurs, ambiance, particularités..." readOnly={readOnly} />
    <div className="pt-5 border-t-2 border-border">
      <p className="text-3xs uppercase tracking-wider font-bold text-muted-foreground mb-4">Hiring Manager</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nom" value={d.client?.hiring_manager?.name} onChange={(v) => updateField('client.hiring_manager.name', v)} readOnly={readOnly} />
        <Field label="Titre" value={d.client?.hiring_manager?.title} onChange={(v) => updateField('client.hiring_manager.title', v)} placeholder="Ex: CTO" readOnly={readOnly} />
        <Field label="Email" value={d.client?.hiring_manager?.email} onChange={(v) => updateField('client.hiring_manager.email', v)} type="email" readOnly={readOnly} />
        <Field label="LinkedIn" value={d.client?.hiring_manager?.linkedin} onChange={(v) => updateField('client.hiring_manager.linkedin', v)} type="url" placeholder="https://linkedin.com/in/..." readOnly={readOnly} />
      </div>
    </div>
  </div>
);

// ─── Step 3: Profil recherché ──────────────────────────────

const StepProfil = ({ d, updateField, readOnly }: { d: JobDetails; updateField: (p: string, v: any) => void; onUpdate: (p: Partial<JobDetails>) => void; readOnly: boolean }) => (
  <div className="space-y-3">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Seniorité *" value={d.seniority} onChange={(v) => updateField('seniority', v)} placeholder="Ex: Senior, Lead, Junior" readOnly={readOnly} />
      <div className="flex gap-2">
        <Field label="XP min (années)" value={d.experience_min} onChange={(v) => updateField('experience_min', v ? Number(v) : undefined)} type="number" className="flex-1" readOnly={readOnly} />
        <Field label="XP max" value={d.experience_max} onChange={(v) => updateField('experience_max', v ? Number(v) : undefined)} type="number" className="flex-1" readOnly={readOnly} />
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Field label="Salaire min *" value={d.salary_min} onChange={(v) => updateField('salary_min', v ? Number(v) : undefined)} type="number" readOnly={readOnly} />
      <Field label="Salaire max" value={d.salary_max} onChange={(v) => updateField('salary_max', v ? Number(v) : undefined)} type="number" readOnly={readOnly} />
      <SelectField label="Type" value={d.salary_type} onChange={(v) => updateField('salary_type', v)} options={SALARY_TYPE_LABELS} readOnly={readOnly} />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Equity / variable" value={d.equity} onChange={(v) => updateField('equity', v)} placeholder="Ex: BSPCE, 0.5%" readOnly={readOnly} />
      <Field label="Avantages" value={d.benefits} onChange={(v) => updateField('benefits', v)} placeholder="Ex: TR, mutuelle, télétravail" readOnly={readOnly} />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="Taille de l'équipe" value={d.team_size} onChange={(v) => updateField('team_size', v ? Number(v) : undefined)} type="number" readOnly={readOnly} />
      <Field label="Reporte à" value={d.reports_to} onChange={(v) => updateField('reports_to', v)} placeholder="Ex: CTO, VP Engineering" readOnly={readOnly} />
    </div>
  </div>
);

// ─── Step 4: Compétences ───────────────────────────────────

const StepCompetences = ({ d, onUpdate, readOnly }: { d: JobDetails; onUpdate: (p: Partial<JobDetails>) => void; readOnly: boolean }) => (
  <div className="space-y-4">
    <TagInput label="Must-have — indispensable" tags={d.skills_must_have || []} onChange={(tags) => onUpdate({ skills_must_have: tags })} color="bg-destructive text-destructive-foreground border-destructive" placeholder="Skill obligatoire" readOnly={readOnly} />
    <TagInput label="Should-have — important" tags={d.skills_should_have || []} onChange={(tags) => onUpdate({ skills_should_have: tags })} color="bg-accent/30 text-foreground border-accent" placeholder="Skill important" readOnly={readOnly} />
    <TagInput label="Nice-to-have — bonus" tags={d.skills_nice_to_have || []} onChange={(tags) => onUpdate({ skills_nice_to_have: tags })} color="bg-foreground text-background border-border" placeholder="Skill bonus" readOnly={readOnly} />
    <TagInput label="À éviter" tags={d.skills_to_avoid || []} onChange={(tags) => onUpdate({ skills_to_avoid: tags })} color="bg-foreground/10 text-foreground line-through border-border" placeholder="Trait rédhibitoire" readOnly={readOnly} />
    <Field label="Certifications" value={d.certifications?.join(', ')} onChange={(v) => onUpdate({ certifications: v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [] })} placeholder="Ex: AWS, PMP, CISSP (séparés par des virgules)" readOnly={readOnly} />
    <Field label="Brief brut (texte ou voice transcript)" value={d.raw_brief} onChange={(v) => onUpdate({ raw_brief: v })} type="textarea" placeholder="Collez un brief brut ou retrouvez ici le transcript vocal..." readOnly={readOnly} />
  </div>
);

// ─── Step 5: Évaluation ────────────────────────────────────

const CATEGORY_OPTIONS: Record<string, string> = {
  technical: 'Technique',
  soft_skill: 'Soft skills',
  culture_fit: 'Culture fit',
  motivation: 'Motivation',
  experience: 'Expérience',
};

const WEIGHT_OPTIONS: Record<string, string> = {
  '1': 'Bonus',
  '2': 'Important',
  '3': 'Critique',
};

const StepEvaluation = ({ d, onUpdate, readOnly }: { d: JobDetails; onUpdate: (p: Partial<JobDetails>) => void; readOnly: boolean }) => {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState<string>('technical');
  const [newWeight, setNewWeight] = useState<string>('2');

  const criteria = d.evaluation_criteria || [];
  const weights = d.evaluation_weights || { technical: 40, soft_skill: 20, culture_fit: 20, motivation: 10, experience: 10 };

  const addCriterion = () => {
    if (readOnly || !newLabel.trim()) return;
    const newCriterion = {
      id: `crit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: newLabel.trim(),
      description: '',
      category: newCategory as any,
      weight: Number(newWeight) as 1 | 2 | 3,
      deal_breaker: Number(newWeight) === 3,
    };
    onUpdate({ evaluation_criteria: [...criteria, newCriterion] });
    setNewLabel('');
    setAdding(false);
  };

  const removeCriterion = (id: string) => {
    if (readOnly) return;
    onUpdate({ evaluation_criteria: criteria.filter((c) => c.id !== id) });
  };

  const updateCriterion = (id: string, patch: any) => {
    if (readOnly) return;
    onUpdate({ evaluation_criteria: criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };

  const updateWeightVal = (category: string, value: number) => {
    if (readOnly) return;
    onUpdate({ evaluation_weights: { ...weights, [category]: value } });
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-3xs uppercase tracking-wider font-bold text-muted-foreground mb-3">Répartition des poids (total = 100%)</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Object.entries(CATEGORY_OPTIONS).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <label className="text-3xs uppercase tracking-wider font-bold text-muted-foreground">{label}</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={(weights as any)[key] || 0}
                  onChange={(e) => updateWeightVal(key, Number(e.target.value) || 0)}
                  readOnly={readOnly}
                  tabIndex={readOnly ? -1 : undefined}
                  className={cn(
                    'w-full h-9 px-2 text-sm text-center rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/30',
                    readOnly && 'cursor-default opacity-70 focus:border-border'
                  )}
                />
                <span className="text-xs text-muted-foreground font-bold">%</span>
              </div>
            </div>
          ))}
        </div>
        {Object.values(weights).reduce((a, b) => a + b, 0) !== 100 && (
          <p className="text-xs text-destructive font-bold mt-1">Total : {Object.values(weights).reduce((a, b) => a + b, 0)}% (doit être 100%)</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-3xs uppercase tracking-wider font-bold text-muted-foreground">Critères ({criteria.length})</p>
          {!readOnly && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 h-[28px] px-3 text-xs font-bold uppercase tracking-wider border border-border text-foreground hover:bg-foreground hover:text-background transition-all"
            >
              <Plus className="w-3 h-3" /> Ajouter
            </button>
          )}
        </div>

        <AnimatePresence>
          {adding && !readOnly && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="border border-border p-3 mb-3 space-y-3 overflow-hidden"
            >
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCriterion();
                  }
                }}
                autoFocus
                placeholder="Ex: Maîtrise de Kubernetes, Leadership..."
                className="w-full h-9 px-3 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/30"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SelectField label="Catégorie" value={newCategory} onChange={setNewCategory} options={CATEGORY_OPTIONS} />
                <SelectField label="Importance" value={newWeight} onChange={setNewWeight} options={WEIGHT_OPTIONS} />
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={addCriterion}
                    disabled={!newLabel.trim()}
                    className="h-9 px-4 bg-foreground text-background text-xs font-bold uppercase tracking-wider border border-border disabled:opacity-50"
                  >
                    Ajouter
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setNewLabel('');
                    }}
                    className="h-9 px-3 text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground hover:text-foreground hover:border-border transition-all"
                  >
                    X
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {criteria.length === 0 ? (
          <div className="border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground mb-2 font-bold">Aucun critère défini</p>
            <p className="text-xs text-muted-foreground">Ajoutez les critères que le manager souhaite évaluer.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {criteria.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="border border-border px-4 py-3 hover:border-border transition-colors"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-0.5 px-2 py-0.5 text-2xs font-bold uppercase tracking-wider shrink-0 rounded-full border',
                      c.weight === 3
                        ? 'bg-destructive text-destructive-foreground border-destructive'
                        : c.weight === 2
                          ? 'bg-accent/30 text-foreground border-accent'
                          : 'bg-accent/50 text-foreground border-border'
                    )}
                  >
                    {c.weight === 3 ? 'Critique' : c.weight === 2 ? 'Important' : 'Bonus'}
                  </span>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-foreground">{c.label}</span>
                      <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">{CATEGORY_OPTIONS[c.category] || c.category}</span>
                      {c.deal_breaker && (
                        <span className="text-3xs font-bold uppercase tracking-wider px-1.5 py-0.5 bg-destructive text-destructive-foreground border border-destructive">Deal breaker</span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-0.5">
                        <label className="text-3xs font-bold uppercase tracking-wider text-muted-foreground">Mon 10/10 c'est...</label>
                        <input
                          defaultValue={c.level_10 || ''}
                          onBlur={(e) => updateCriterion(c.id, { level_10: e.target.value || undefined })}
                          placeholder="Excellence pour ce critère"
                          readOnly={readOnly}
                          tabIndex={readOnly ? -1 : undefined}
                          className={cn(
                            'w-full h-8 px-2 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/30',
                            readOnly && 'cursor-default opacity-70 focus:border-border'
                          )}
                        />
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-3xs font-bold uppercase tracking-wider text-muted-foreground">Rédhibitoire si...</label>
                        <input
                          defaultValue={c.level_1 || ''}
                          onBlur={(e) => updateCriterion(c.id, { level_1: e.target.value || undefined })}
                          placeholder="Ce qui est éliminatoire"
                          readOnly={readOnly}
                          tabIndex={readOnly ? -1 : undefined}
                          className={cn(
                            'w-full h-8 px-2 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/30',
                            readOnly && 'cursor-default opacity-70 focus:border-border'
                          )}
                        />
                      </div>
                    </div>
                  </div>
                  {!readOnly && (
                    <button type="button" onClick={() => removeCriterion(c.id)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-0.5">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
