import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Check, AlertCircle, Info, Users, Layers, Shield, Eye } from 'lucide-react';

export type WizardStep = 'info' | 'senders' | 'steps' | 'guardrails' | 'review';

const WIZARD_STEPS: { id: WizardStep; label: string; icon: typeof Info; description: string }[] = [
  { id: 'info', label: 'Informations', icon: Info, description: 'Nom et objectif' },
  { id: 'senders', label: 'Expéditeurs', icon: Users, description: 'Comptes et répartition' },
  { id: 'steps', label: 'Étapes', icon: Layers, description: 'Actions et messages' },
  { id: 'guardrails', label: 'Garde-fous', icon: Shield, description: "Conditions d'arrêt" },
  { id: 'review', label: 'Vérification', icon: Eye, description: 'Relecture finale' },
];

interface SequenceWizardStepperProps {
  currentStep: WizardStep;
  onStepChange: (step: WizardStep) => void;
  completedSteps: Set<WizardStep>;
  validationErrors: Map<WizardStep, string[]>;
}

const problemsLabel = (count: number) => `${count} problème${count > 1 ? 's' : ''}`;

/** Pastille d'une étape : numéro, coche ou alerte ; l'état est aussi écrit à côté. */
function StepMarker({ index, isCurrent, isDone, hasErrors }: { index: number; isCurrent: boolean; isDone: boolean; hasErrors: boolean }) {
  return (
    <span
      className={cn(
        'grid h-6 w-6 shrink-0 place-items-center rounded-full border text-3xs font-semibold transition-colors duration-150',
        isCurrent
          ? 'border-foreground bg-foreground text-background'
          : hasErrors
            ? 'border-danger/40 bg-danger-muted text-danger'
            : isDone
              ? 'border-success/40 bg-success-muted text-success'
              : 'border-border bg-background text-muted-foreground',
      )}
      aria-hidden="true"
    >
      {!isCurrent && hasErrors ? (
        <AlertCircle className="h-3 w-3" />
      ) : !isCurrent && isDone ? (
        <Check className="h-3 w-3" />
      ) : (
        index + 1
      )}
    </span>
  );
}

/** Étapes de l'assistant, en colonne (grands écrans). */
export const SequenceWizardStepper: React.FC<SequenceWizardStepperProps> = ({
  currentStep,
  onStepChange,
  completedSteps,
  validationErrors,
}) => {
  const currentIndex = WIZARD_STEPS.findIndex(s => s.id === currentStep);
  const progress = (currentIndex / Math.max(WIZARD_STEPS.length - 1, 1)) * 100;

  return (
    <nav className="relative" aria-label="Étapes de l'assistant">
      {/* Ligne de progression */}
      <div className="absolute bottom-5 left-5 top-5 w-px bg-border" aria-hidden="true">
        <div className="w-px bg-foreground transition-[height] duration-200 ease-out" style={{ height: `${progress}%` }} />
      </div>

      <ol className="relative flex flex-col">
        {WIZARD_STEPS.map((step, index) => {
          const isCurrent = currentStep === step.id;
          const errors = validationErrors.get(step.id) || [];
          const hasErrors = errors.length > 0;
          const isDone = completedSteps.has(step.id);

          return (
            <li key={step.id}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onStepChange(step.id)}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'h-auto w-full items-start justify-start gap-3 whitespace-normal px-2 py-3 text-left font-normal hover:bg-transparent [&_svg]:size-3',
                  isCurrent ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <StepMarker index={index} isCurrent={isCurrent} isDone={isDone} hasErrors={hasErrors} />
                <span className="min-w-0 flex-1 pt-0.5">
                  <span className={cn('block text-xs font-semibold leading-tight', isCurrent ? 'text-foreground' : 'text-foreground-secondary')}>
                    {step.label}
                  </span>
                  <span className={cn('mt-0.5 block text-2xs leading-tight', hasErrors ? 'text-danger' : 'text-muted-foreground')}>
                    {hasErrors ? problemsLabel(errors.length) : step.description}
                  </span>
                </span>
              </Button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

/**
 * Étapes de l'assistant, en ligne (sous 1 024 px) : le numéro de chaque étape
 * et son libellé, celui de l'étape courante toujours écrit (revue design D-39).
 */
export const SequenceWizardStepperCompact: React.FC<SequenceWizardStepperProps & { className?: string }> = ({
  currentStep,
  onStepChange,
  completedSteps,
  validationErrors,
  className,
}) => (
  <nav aria-label="Étapes de l'assistant" className={className}>
    <ol className="flex items-center gap-1">
      {WIZARD_STEPS.map((step, index) => {
        const isCurrent = currentStep === step.id;
        const errors = validationErrors.get(step.id) || [];
        const hasErrors = errors.length > 0;
        const isDone = completedSteps.has(step.id);
        return (
          <li key={step.id} className="flex min-w-0 items-center gap-1">
            {index > 0 && <span className="hidden h-px w-3 shrink-0 bg-border sm:block" aria-hidden="true" />}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onStepChange(step.id)}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={`Étape ${index + 1} : ${step.label}${hasErrors ? ` (${problemsLabel(errors.length)})` : ''}`}
              className={cn(
                'min-w-8 gap-1.5 px-1 text-xs max-md:h-11 max-md:min-w-11 [&_svg]:size-3',
                isCurrent ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <StepMarker index={index} isCurrent={isCurrent} isDone={isDone} hasErrors={hasErrors} />
              <span className={cn('truncate pr-1', !isCurrent && 'hidden md:inline')}>{step.label}</span>
            </Button>
          </li>
        );
      })}
    </ol>
  </nav>
);

export { WIZARD_STEPS };
