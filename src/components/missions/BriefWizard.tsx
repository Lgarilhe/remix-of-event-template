import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Plus, X, Check, Mic, Sparkles, FileText, ArrowLeft, ArrowRight, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
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
      <option value="">{placeholder || '---'}</option>
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
          <motion.span
            key={`${tag}-${i}`}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className={cn("flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider", color)}
          >
            {tag}
            <button onClick={() => onChange(tags.filter((_, j) => j !== i))} className="hover:opacity-60"><X className="w-2.5 h-2.5" /></button>
          </motion.span>
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

// ─── Wizard Steps Config ───────────────────────────────────

const STEPS = [
  { key: 'poste', label: 'Le Poste', subtitle: 'Titre, contrat, localisation et contexte du recrutement', emoji: '1' },
  { key: 'client', label: 'Le Client', subtitle: "Informations sur l'entreprise et le hiring manager", emoji: '2' },
  { key: 'profil', label: 'Le Profil', subtitle: 'Seniorite, experience, remuneration et langues', emoji: '3' },
  { key: 'competences', label: 'Les Competences', subtitle: 'Competences techniques et soft skills par priorite', emoji: '4' },
  { key: 'evaluation', label: "L'Evaluation", subtitle: 'Criteres du manager, deal-breakers et ponderations', emoji: '5' },
];

// ─── Completion score ──────────────────────────────────────

function computeCompletionScore(d: JobDetails): { score: number; items: Array<{ label: string; done: boolean }> } {
  const checks: Array<[boolean, string]> = [
    [!!d.title, 'Titre du poste'],
    [!!d.contract_type, 'Type de contrat'],
    [!!d.client?.name, 'Nom du client'],
    [!!d.location, 'Localisation'],
    [!!d.remote_policy, 'Politique remote'],
    [!!d.seniority, 'Seniorite'],
    [d.experience_min != null, 'Experience min'],
    [d.salary_min != null, 'Salaire min'],
    [(d.skills_must_have?.length || 0) > 0, 'Skills must-have'],
    [!!d.mission_description || !!d.context, 'Description ou contexte'],
    [(d.evaluation_criteria?.length || 0) > 0, "Criteres d'evaluation"],
  ];
  const done = checks.filter(([ok]) => ok).length;
  const items = checks.map(([ok, label]) => ({ label, done: ok }));
  return { score: Math.round((done / checks.length) * 100), items };
}

// Step required fields validation
function isStepValid(stepIndex: number, d: JobDetails): boolean {
  switch (stepIndex) {
    case 0: return !!d.title;
    case 1: return true; // optional
    case 2: return true; // optional
    case 3: return true; // optional
    case 4: return true; // optional
    default: return true;
  }
}

// ─── Slide transition variants ─────────────────────────────

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
};

// ─── Mini wizard stepper ───────────────────────────────────

const WizardStepper: React.FC<{
  activeStep: number;
  steps: typeof STEPS;
  completedSteps: boolean[];
  onStepClick: (i: number) => void;
}> = ({ activeStep, steps: stepList, completedSteps, onStepClick }) => (
  <div className="flex items-center gap-0 px-4 py-3 bg-muted/20 border-b border-foreground/10">
    {stepList.map((step, i) => {
      const isActive = activeStep === i;
      const isDone = completedSteps[i];
      return (
        <React.Fragment key={step.key}>
          {i > 0 && (
            <div className="flex-1 h-[2px] bg-foreground/10 mx-1 sm:mx-2 overflow-hidden min-w-[12px]">
              <motion.div
                className="h-full"
                style={{ background: isDone || i <= activeStep ? 'hsl(var(--brutal-accent))' : 'transparent' }}
                initial={{ width: '0%' }}
                animate={{ width: isDone || i <= activeStep ? '100%' : '0%' }}
                transition={{ duration: 0.4, delay: i * 0.05, ease: 'easeOut' as const }}
              />
            </div>
          )}
          <button
            onClick={() => onStepClick(i)}
            className="group flex items-center gap-1.5 shrink-0"
            title={step.label}
          >
            <motion.div
              className={cn(
                "w-7 h-7 flex items-center justify-center text-[10px] font-black shrink-0 transition-all duration-200",
                isActive
                  ? "bg-brutal-accent text-background"
                  : isDone
                    ? "text-background"
                    : "border border-foreground/20 text-muted-foreground group-hover:border-foreground/40"
              )}
              style={isDone && !isActive ? { background: 'hsl(142 71% 45%)' } : undefined}
              animate={isActive ? { scale: [1, 1.08, 1] } : {}}
              transition={isActive ? { duration: 2, repeat: Infinity, ease: 'easeInOut' as const } : {}}
            >
              {isDone && !isActive ? (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  <Check className="w-3 h-3" />
                </motion.div>
              ) : (
                step.emoji
              )}
            </motion.div>
            <span className={cn(
              "hidden sm:inline text-[9px] font-bold uppercase tracking-wider transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
            )}>
              {step.label}
            </span>
          </button>
        </React.Fragment>
      );
    })}
    {/* Step counter (mobile) */}
    <span className="sm:hidden ml-auto text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
      {activeStep + 1}/{stepList.length}
    </span>
  </div>
);

// ─── Completion panel ──────────────────────────────────────

const CompletionPanel: React.FC<{
  score: number;
  items: Array<{ label: string; done: boolean }>;
  onLaunchSourcing?: () => void;
  activeStep: number;
  onStepClick: (i: number) => void;
}> = ({ score, items, onLaunchSourcing, activeStep, onStepClick }) => {
  const progressColor = score < 30 ? 'bg-destructive' : score < 70 ? 'bg-brutal-accent' : 'bg-primary';
  const borderColor = score < 30 ? 'border-destructive' : score < 70 ? 'border-brutal-accent' : 'border-primary';

  return (
    <div className="border border-foreground/20 p-4 sticky top-24">
      {/* Score */}
      <div className="text-center mb-4">
        <div className={cn("relative inline-flex items-center justify-center w-16 h-16 border-2 transition-colors duration-500", borderColor)}>
          <div className="flex items-baseline">
            <NumberTicker value={score} className={cn("text-lg font-bold tabular-nums", score >= 70 ? "text-foreground" : "text-muted-foreground")} />
            <span className={cn("text-sm font-bold", score >= 70 ? "text-foreground" : "text-muted-foreground")}>%</span>
          </div>
        </div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-2">Completion</p>
      </div>

      {/* Color progress bar */}
      <div className="h-2 w-full bg-foreground/10 mb-4 overflow-hidden">
        <motion.div
          className={cn("h-full transition-colors duration-500", progressColor)}
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' as const }}
        />
      </div>

      {/* Checklist */}
      <div className="space-y-1.5 mb-4">
        <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Checklist</p>
        {items.map((item) => (
          <motion.div
            key={item.label}
            className="flex items-center gap-2 text-[10px]"
            initial={false}
            animate={{ opacity: item.done ? 0.5 : 1 }}
          >
            <motion.div
              className={cn(
                "w-4 h-4 flex items-center justify-center shrink-0 border transition-colors",
                item.done ? "bg-primary border-primary" : "border-foreground/20 bg-background"
              )}
              animate={item.done ? { scale: [1, 1.2, 1] } : {}}
              transition={{ duration: 0.3 }}
            >
              {item.done && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>
                  <Check className="w-2.5 h-2.5 text-primary-foreground" />
                </motion.div>
              )}
            </motion.div>
            <span className={cn("transition-all", item.done ? "text-muted-foreground line-through" : "text-foreground")}>
              {item.label}
            </span>
          </motion.div>
        ))}
      </div>

      {/* 100% celebration */}
      {score === 100 && (
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-3 border-t border-foreground/10">
          <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ duration: 0.5, delay: 0.2 }} className="text-2xl mb-1">
            <span role="img" aria-label="celebration">&#x1F389;</span>
          </motion.div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-foreground">Brief complet !</p>
        </motion.div>
      )}

      {/* Launch sourcing CTA at 70%+ */}
      {score >= 70 && onLaunchSourcing && (
        <div className="mt-4 pt-4 border-t border-foreground/10">
          <ShimmerButton onClick={onLaunchSourcing} className="w-full h-[36px] text-[10px]" shimmerDuration="1.5s">
            <Sparkles className="w-3 h-3" />
            Lancer le sourcing
            <ArrowRight className="w-3 h-3" />
          </ShimmerButton>
        </div>
      )}

      {/* Quick step nav */}
      <div className="mt-4 pt-4 border-t border-foreground/10 space-y-1">
        {STEPS.map((step, i) => (
          <button
            key={step.key}
            onClick={() => onStepClick(i)}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wider text-left transition-colors",
              activeStep === i ? "text-foreground font-bold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <span className="w-4 text-center">{step.emoji}</span> {step.label}
          </button>
        ))}
      </div>
    </div>
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
  const [activeStep, setActiveStep] = useState(0);
  const [direction, setDirection] = useState(0);
  const d = jobDetails;

  const goToStep = useCallback((newStep: number) => {
    setDirection(newStep > activeStep ? 1 : -1);
    setActiveStep(newStep);
  }, [activeStep]);

  const updateField = useCallback((path: string, value: any) => {
    const parts = path.split('.');
    const buildPatch = (keys: string[], val: any): any => {
      if (keys.length === 1) return { [keys[0]]: val };
      const [head, ...rest] = keys;
      return { [head]: buildPatch(rest, val) };
    };
    onUpdate(buildPatch(parts, value !== '' && value != null ? value : undefined));
  }, [onUpdate]);

  const { score, items } = useMemo(() => computeCompletionScore(d), [d]);
  const isBriefEmpty = !d.title && !d.mission_description && !d.raw_brief;

  const completedSteps = useMemo(() => [
    !!(d.title && (d.mission_description || d.context || d.raw_brief)),
    !!d.client?.name,
    !!(d.seniority || d.experience_min != null),
    (d.skills_must_have?.length || 0) > 0,
    (d.evaluation_criteria?.length || 0) > 0,
  ], [d]);

  const canGoNext = isStepValid(activeStep, d);
  const currentStep = STEPS[activeStep];

  return (
    <div className="flex flex-col lg:flex-row gap-0 lg:gap-6">
      {/* Left: Wizard */}
      <div className="flex-1 min-w-0">
        {/* Empty state hero */}
        {isBriefEmpty && !readOnly && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="border border-foreground/20 border-b-0 p-6 sm:p-8 bg-muted/20"
          >
            <div className="flex flex-col sm:flex-row items-center gap-5">
              <motion.div
                className="w-14 h-14 bg-foreground text-background flex items-center justify-center shrink-0"
                initial={{ scale: 0, rotate: -90 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              >
                <FileText className="w-7 h-7" />
              </motion.div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-foreground mb-1">
                  Decrivez votre besoin
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-md">
                  L'IA structurera automatiquement votre brief. Remplissez les champs etape par etape ou utilisez la dictee vocale.
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Wizard stepper */}
        <div className="border border-foreground/20">
          <WizardStepper
            activeStep={activeStep}
            steps={STEPS}
            completedSteps={completedSteps}
            onStepClick={goToStep}
          />

          {/* Section header */}
          <div className="px-5 sm:px-6 pt-5 pb-3 border-b border-foreground/10">
            <motion.h3
              key={`title-${activeStep}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="text-lg font-black uppercase tracking-wider text-foreground"
            >
              {currentStep.label}
            </motion.h3>
            <motion.p
              key={`sub-${activeStep}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: 0.05 }}
              className="text-xs text-muted-foreground mt-1"
            >
              {currentStep.subtitle}
            </motion.p>
          </div>

          {/* Step content with directional slide */}
          <div className="px-5 sm:px-6 py-5 overflow-hidden min-h-[300px]">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={activeStep}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25, ease: 'easeOut' as const }}
              >
                {activeStep === 0 && <StepPoste d={d} updateField={updateField} readOnly={readOnly} />}
                {activeStep === 1 && <StepClient d={d} updateField={updateField} readOnly={readOnly} />}
                {activeStep === 2 && <StepProfil d={d} updateField={updateField} onUpdate={onUpdate} readOnly={readOnly} />}
                {activeStep === 3 && <StepCompetences d={d} onUpdate={onUpdate} readOnly={readOnly} />}
                {activeStep === 4 && <StepEvaluation d={d} onUpdate={onUpdate} readOnly={readOnly} />}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Navigation prev/next */}
          {!readOnly && (
            <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-t border-foreground/10 bg-muted/10">
              <button
                onClick={() => goToStep(Math.max(0, activeStep - 1))}
                disabled={activeStep === 0}
                className="flex items-center gap-1.5 h-[36px] px-4 text-[10px] font-bold uppercase tracking-wider border border-foreground/20 text-muted-foreground hover:text-foreground hover:border-foreground disabled:opacity-30 transition-colors"
              >
                <ArrowLeft className="w-3 h-3" />
                Precedent
              </button>

              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                {activeStep + 1} / {STEPS.length}
              </span>

              {activeStep < STEPS.length - 1 ? (
                <button
                  onClick={() => goToStep(activeStep + 1)}
                  disabled={!canGoNext}
                  className={cn(
                    "relative overflow-hidden flex items-center gap-1.5 h-[36px] px-5 text-[10px] font-bold uppercase tracking-wider border transition-all",
                    canGoNext
                      ? "border-foreground bg-foreground text-background group"
                      : "border-foreground/20 bg-foreground/10 text-muted-foreground cursor-not-allowed"
                  )}
                >
                  <span className="relative z-10 flex items-center gap-1.5">
                    Suivant
                    <ArrowRight className="w-3 h-3" />
                  </span>
                  {canGoNext && (
                    <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                  )}
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300 }}>
                    <Check className="w-4 h-4 text-foreground" />
                  </motion.div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-foreground">Termine</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Completion sidebar (desktop) */}
      <div className="hidden lg:block lg:w-[240px] shrink-0">
        <CompletionPanel
          score={score}
          items={items}
          onLaunchSourcing={score >= 70 ? onLaunchSourcing : undefined}
          activeStep={activeStep}
          onStepClick={goToStep}
        />
      </div>

      {/* Mobile: bottom completion bar */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-foreground/20 bg-background/95 backdrop-blur-sm px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Mini progress */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold text-foreground">
                <NumberTicker value={score} className="font-bold" />%
              </span>
              <span className="text-[9px] text-muted-foreground uppercase tracking-wider">complete</span>
            </div>
            <div className="h-1.5 w-full bg-foreground/10 overflow-hidden">
              <motion.div
                className={cn("h-full", score < 30 ? 'bg-destructive' : score < 70 ? 'bg-brutal-accent' : 'bg-primary')}
                animate={{ width: `${score}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>

          {/* CTA */}
          {score >= 70 && onLaunchSourcing ? (
            <ShimmerButton onClick={onLaunchSourcing} className="h-[34px] text-[9px] px-4 shrink-0" shimmerDuration="1.5s">
              <Sparkles className="w-3 h-3" />
              Sourcing
            </ShimmerButton>
          ) : (
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0">
              {items.filter(i => !i.done).length} restants
            </span>
          )}
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
      <Field label="Reference interne" value={d.reference} onChange={(v) => updateField('reference', v)} placeholder="Ex: SKL-2026-042" />
      <SelectField label="Type de contrat *" value={d.contract_type} onChange={(v) => updateField('contract_type', v)} options={CONTRACT_TYPE_LABELS} />
      <SelectField label="Urgence" value={d.urgency} onChange={(v) => updateField('urgency', v)} options={URGENCY_LABELS} />
      <Field label="Date de demarrage" value={d.start_date} onChange={(v) => updateField('start_date', v)} placeholder="Ex: ASAP, Septembre 2026" />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Localisation *" value={d.location} onChange={(v) => updateField('location', v)} placeholder="Ex: Paris, Lyon" />
      <SelectField label="Politique remote *" value={d.remote_policy} onChange={(v) => updateField('remote_policy', v)} options={REMOTE_LABELS} />
      {d.remote_policy === 'hybrid' && (
        <Field label="Jours remote / semaine" value={d.remote_days} onChange={(v) => updateField('remote_days', v ? Number(v) : undefined)} type="number" />
      )}
    </div>
    <Field label="Contexte (pourquoi on recrute)" value={d.context} onChange={(v) => updateField('context', v)} type="textarea" placeholder="Creation de poste, remplacement, croissance..." />
    <Field label="Description detaillee" value={d.mission_description} onChange={(v) => updateField('mission_description', v)} type="textarea" placeholder="Missions, responsabilites, environnement technique..." />
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
    <Field label="Notes culture" value={d.client?.culture_notes} onChange={(v) => updateField('client.culture_notes', v)} type="textarea" placeholder="Stack technique, valeurs, ambiance, particularites..." />
    <div className="pt-4 border-t border-foreground/10">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">Hiring Manager</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Nom" value={d.client?.hiring_manager?.name} onChange={(v) => updateField('client.hiring_manager.name', v)} />
        <Field label="Titre" value={d.client?.hiring_manager?.title} onChange={(v) => updateField('client.hiring_manager.title', v)} placeholder="Ex: CTO" />
        <Field label="Email" value={d.client?.hiring_manager?.email} onChange={(v) => updateField('client.hiring_manager.email', v)} type="email" />
        <Field label="LinkedIn" value={d.client?.hiring_manager?.linkedin} onChange={(v) => updateField('client.hiring_manager.linkedin', v)} type="url" placeholder="https://linkedin.com/in/..." />
      </div>
    </div>
  </div>
);

// ─── Step 3: Profil recherche ──────────────────────────────

const StepProfil = ({ d, updateField, onUpdate, readOnly }: { d: JobDetails; updateField: (p: string, v: any) => void; onUpdate: (p: Partial<JobDetails>) => void; readOnly: boolean }) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Seniorite *" value={d.seniority} onChange={(v) => updateField('seniority', v)} placeholder="Ex: Senior, Lead, Junior" />
      <div className="flex gap-2">
        <Field label="XP min (annees)" value={d.experience_min} onChange={(v) => updateField('experience_min', v ? Number(v) : undefined)} type="number" className="flex-1" />
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
      <Field label="Avantages" value={d.benefits} onChange={(v) => updateField('benefits', v)} placeholder="Ex: TR, mutuelle, teletravail" />
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Taille de l'equipe" value={d.team_size} onChange={(v) => updateField('team_size', v ? Number(v) : undefined)} type="number" />
      <Field label="Reporte a" value={d.reports_to} onChange={(v) => updateField('reports_to', v)} placeholder="Ex: CTO, VP Engineering" />
    </div>
  </div>
);

// ─── Step 4: Competences ───────────────────────────────────

const StepCompetences = ({ d, onUpdate, readOnly }: { d: JobDetails; onUpdate: (p: Partial<JobDetails>) => void; readOnly: boolean }) => (
  <div className="space-y-5">
    <TagInput label="Must-have --- indispensable" tags={d.skills_must_have || []} onChange={(tags) => onUpdate({ skills_must_have: tags })} color="bg-destructive text-destructive-foreground" placeholder="Skill obligatoire" />
    <TagInput label="Should-have --- important" tags={d.skills_should_have || []} onChange={(tags) => onUpdate({ skills_should_have: tags })} color="bg-brutal-accent text-foreground" placeholder="Skill important" />
    <TagInput label="Nice-to-have --- bonus" tags={d.skills_nice_to_have || []} onChange={(tags) => onUpdate({ skills_nice_to_have: tags })} color="bg-primary text-primary-foreground" placeholder="Skill bonus" />
    <TagInput label="A eviter" tags={d.skills_to_avoid || []} onChange={(tags) => onUpdate({ skills_to_avoid: tags })} color="bg-foreground/10 text-foreground line-through border border-foreground/20" placeholder="Trait redhibitoire" />
    <Field label="Certifications" value={d.certifications?.join(', ')} onChange={(v) => onUpdate({ certifications: v ? v.split(',').map(s => s.trim()).filter(Boolean) : [] })} placeholder="Ex: AWS, PMP, CISSP (separes par des virgules)" />
    <Field label="Brief brut (texte ou voice transcript)" value={d.raw_brief} onChange={(v) => onUpdate({ raw_brief: v })} type="textarea" placeholder="Collez un brief brut ou retrouvez ici le transcript vocal..." />
  </div>
);

// ─── Step 5: Evaluation ────────────────────────────────────

const CATEGORY_OPTIONS: Record<string, string> = {
  technical: 'Technique',
  soft_skill: 'Soft skills',
  culture_fit: 'Culture fit',
  motivation: 'Motivation',
  experience: 'Experience',
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
    if (!newLabel.trim()) return;
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
    onUpdate({ evaluation_criteria: criteria.filter(c => c.id !== id) });
  };

  const updateCriterion = (id: string, patch: any) => {
    onUpdate({ evaluation_criteria: criteria.map(c => c.id === id ? { ...c, ...patch } : c) });
  };

  const updateWeightVal = (category: string, value: number) => {
    onUpdate({ evaluation_weights: { ...weights, [category]: value } });
  };

  return (
    <div className="space-y-6">
      {/* Weight distribution */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
          Repartition des poids (total = 100%)
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {Object.entries(CATEGORY_OPTIONS).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
              <div className="flex items-center gap-1">
                <input
                  type="number" min={0} max={100}
                  value={(weights as any)[key] || 0}
                  onChange={(e) => updateWeightVal(key, Number(e.target.value) || 0)}
                  className="w-full h-[34px] px-2 text-sm text-center border border-foreground/20 bg-background text-foreground focus:border-foreground focus:outline-none"
                />
                <span className="text-[10px] text-muted-foreground">%</span>
              </div>
            </div>
          ))}
        </div>
        {Object.values(weights).reduce((a, b) => a + b, 0) !== 100 && (
          <p className="text-[10px] text-destructive mt-1">
            Total : {Object.values(weights).reduce((a, b) => a + b, 0)}% (doit etre 100%)
          </p>
        )}
      </div>

      {/* Criteria list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Criteres ({criteria.length})
          </p>
          {!readOnly && !adding && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 h-[28px] px-3 text-[9px] font-bold uppercase tracking-wider border border-foreground/20 text-foreground hover:border-foreground transition-colors"
            >
              <Plus className="w-3 h-3" /> Ajouter
            </button>
          )}
        </div>

        <AnimatePresence>
          {adding && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="border border-foreground/20 p-3 mb-3 space-y-3 overflow-hidden"
            >
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCriterion(); } }}
                autoFocus
                placeholder="Ex: Maitrise de Kubernetes, Leadership..."
                className="w-full h-[34px] px-3 text-sm border border-foreground/20 bg-background text-foreground focus:border-foreground focus:outline-none"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SelectField label="Categorie" value={newCategory} onChange={setNewCategory} options={CATEGORY_OPTIONS} />
                <SelectField label="Importance" value={newWeight} onChange={setNewWeight} options={WEIGHT_OPTIONS} />
                <div className="flex items-end gap-2">
                  <button onClick={addCriterion} disabled={!newLabel.trim()}
                    className="h-[34px] px-4 bg-foreground text-background text-[10px] font-bold uppercase tracking-wider border border-foreground disabled:opacity-50">
                    Ajouter
                  </button>
                  <button onClick={() => { setAdding(false); setNewLabel(''); }}
                    className="h-[34px] px-3 text-[10px] font-bold uppercase tracking-wider border border-foreground/20 text-muted-foreground hover:text-foreground">
                    X
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {criteria.length === 0 ? (
          <div className="border border-dashed border-foreground/20 p-6 text-center">
            <p className="text-sm text-muted-foreground mb-2">Aucun critere defini</p>
            <p className="text-[10px] text-muted-foreground">
              Ajoutez les criteres que le manager souhaite evaluer.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {criteria.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="border border-foreground/15 px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <span className={cn(
                    "mt-0.5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider shrink-0",
                    c.weight === 3 ? "bg-destructive text-destructive-foreground" :
                    c.weight === 2 ? "bg-brutal-accent text-foreground" :
                    "bg-foreground/10 text-foreground"
                  )}>
                    {c.weight === 3 ? 'Critique' : c.weight === 2 ? 'Important' : 'Bonus'}
                  </span>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{c.label}</span>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{CATEGORY_OPTIONS[c.category] || c.category}</span>
                      {c.deal_breaker && (
                        <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-destructive text-destructive-foreground">Deal breaker</span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-0.5">
                        <label className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Mon 10/10 c'est...</label>
                        <input
                          defaultValue={c.level_10 || ''}
                          onBlur={(e) => updateCriterion(c.id, { level_10: e.target.value || undefined })}
                          placeholder="Excellence pour ce critere"
                          className="w-full h-[30px] px-2 text-[11px] border border-foreground/15 bg-background text-foreground focus:border-foreground focus:outline-none"
                        />
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground">Redhibitoire si...</label>
                        <input
                          defaultValue={c.level_1 || ''}
                          onBlur={(e) => updateCriterion(c.id, { level_1: e.target.value || undefined })}
                          placeholder="Ce qui est eliminatoire"
                          className="w-full h-[30px] px-2 text-[11px] border border-foreground/15 bg-background text-foreground focus:border-foreground focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                  {!readOnly && (
                    <button
                      onClick={() => removeCriterion(c.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-0.5"
                    >
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
