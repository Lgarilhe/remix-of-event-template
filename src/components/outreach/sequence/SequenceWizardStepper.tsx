import React from 'react';
import { cn } from '@/lib/utils';
import { Check, Info, Users, Layers, Shield, Eye } from 'lucide-react';

export type WizardStep = 'info' | 'senders' | 'steps' | 'guardrails' | 'review';

const WIZARD_STEPS: { id: WizardStep; label: string; icon: typeof Info; description: string }[] = [
  { id: 'info', label: 'Informations', icon: Info, description: 'Nom et objectif' },
  { id: 'senders', label: 'Expéditeurs', icon: Users, description: 'Comptes & rotation' },
  { id: 'steps', label: 'Étapes', icon: Layers, description: 'Actions & messages' },
  { id: 'guardrails', label: 'Garde-fous', icon: Shield, description: 'Limites & sécurité' },
  { id: 'review', label: 'Vérification', icon: Eye, description: 'Aperçu & activation' },
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
  return (
    <nav className="flex flex-col gap-1">
      {WIZARD_STEPS.map((step, index) => {
        const isCurrent = currentStep === step.id;
        const isCompleted = completedSteps.has(step.id);
        const errors = validationErrors.get(step.id) || [];
        const hasErrors = errors.length > 0;
        const StepIcon = step.icon;

        return (
          <button
            key={step.id}
            onClick={() => onStepChange(step.id)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 text-left transition-all border-l-2",
              isCurrent
                ? "bg-foreground/5 border-l-foreground"
                : isCompleted
                  ? "border-l-green-500 hover:bg-muted/50"
                  : "border-l-transparent hover:bg-muted/30"
            )}
          >
            <div className={cn(
              "w-7 h-7 flex items-center justify-center shrink-0 text-xs font-bold",
              isCurrent
                ? "bg-foreground text-background"
                : isCompleted
                  ? "bg-green-100 text-green-700"
                  : hasErrors
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground"
            )}>
              {isCompleted && !hasErrors ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <StepIcon className="w-3.5 h-3.5" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className={cn(
                "text-xs font-bold uppercase tracking-wider",
                isCurrent ? "text-foreground" : "text-muted-foreground"
              )}>
                {step.label}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {hasErrors ? (
                  <span className="text-destructive">{errors.length} problème{errors.length > 1 ? 's' : ''}</span>
                ) : (
                  step.description
                )}
              </div>
            </div>
          </button>
        );
      })}
    </nav>
  );
};

export { WIZARD_STEPS };
