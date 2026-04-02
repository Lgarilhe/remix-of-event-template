import React from 'react';
import { cn } from '@/lib/utils';
import { Check, AlertCircle, Info, Users, Layers, Shield, Eye } from 'lucide-react';
import { motion } from 'framer-motion';

export type WizardStep = 'info' | 'senders' | 'steps' | 'guardrails' | 'review';

const WIZARD_STEPS: { id: WizardStep; label: string; icon: typeof Info; description: string }[] = [
  { id: 'info', label: 'Informations', icon: Info, description: 'Nom et objectif' },
  { id: 'senders', label: 'Expéditeurs', icon: Users, description: 'Comptes & rotation' },
  { id: 'steps', label: 'Étapes', icon: Layers, description: 'Actions & messages' },
  { id: 'guardrails', label: 'Garde-fous', icon: Shield, description: 'Limites & sécurité' },
  { id: 'review', label: 'Vérification', icon: Eye, description: 'Aperçu final' },
];

interface SequenceWizardStepperProps {
  currentStep: WizardStep;
  onStepChange: (step: WizardStep) => void;
  completedSteps: Set<WizardStep>;
  validationErrors: Map<WizardStep, string[]>;
}

export const SequenceWizardStepper: React.FC<SequenceWizardStepperProps> = ({
  currentStep,
  onStepChange,
  completedSteps,
  validationErrors,
}) => {
  const currentIndex = WIZARD_STEPS.findIndex(s => s.id === currentStep);

  return (
    <nav className="relative flex flex-col" role="navigation" aria-label="Étapes du wizard">
      {/* Vertical progress line */}
      <div className="absolute left-[19px] top-5 bottom-5 w-px bg-border" />
      <motion.div
        className="absolute left-[19px] top-5 w-px bg-foreground"
        initial={false}
        animate={{ height: `${(currentIndex / Math.max(WIZARD_STEPS.length - 1, 1)) * 100}%` }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        style={{ maxHeight: 'calc(100% - 40px)' }}
      />

      {WIZARD_STEPS.map((step, index) => {
        const isCurrent = currentStep === step.id;
        const isCompleted = completedSteps.has(step.id);
        const isPast = index < currentIndex;
        const errors = validationErrors.get(step.id) || [];
        const hasErrors = errors.length > 0;
        const StepIcon = step.icon;

        return (
          <button
            key={step.id}
            onClick={() => onStepChange(step.id)}
            className={cn(
              "relative flex items-start gap-3.5 px-2 py-3 text-left transition-colors group",
              isCurrent
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground/80"
            )}
          >
            {/* Step indicator circle */}
            <div className="relative z-10 shrink-0">
              <motion.div
                className={cn(
                  "w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-semibold transition-colors border-2",
                  isCurrent
                    ? "bg-foreground text-background border-border"
                    : isCompleted && !hasErrors
                      ? "bg-success text-success-foreground border-success"
                      : hasErrors
                        ? "bg-destructive/10 text-destructive border-destructive/40"
                        : "bg-background text-muted-foreground border-border group-hover:border-border"
                )}
                initial={false}
                animate={isCurrent ? { scale: [1, 1.1, 1] } : {}}
                transition={{ duration: 0.3 }}
              >
                {isCompleted && !hasErrors ? (
                  <Check className="w-3 h-3" />
                ) : hasErrors ? (
                  <AlertCircle className="w-3 h-3" />
                ) : (
                  <span>{index + 1}</span>
                )}
              </motion.div>
            </div>

            {/* Label & description */}
            <div className="flex-1 min-w-0 pt-0.5">
              <div className={cn(
                "text-[11px] font-semibold leading-tight transition-colors",
                isCurrent ? "text-foreground" : "text-muted-foreground group-hover:text-foreground/80"
              )}>
                {step.label}
              </div>
              <div className={cn(
                "text-[10px] mt-0.5 leading-tight",
                hasErrors ? "text-destructive" : "text-muted-foreground/70"
              )}>
                {hasErrors ? `${errors.length} problème${errors.length > 1 ? 's' : ''}` : step.description}
              </div>
            </div>
          </button>
        );
      })}
    </nav>
  );
};

export { WIZARD_STEPS };
