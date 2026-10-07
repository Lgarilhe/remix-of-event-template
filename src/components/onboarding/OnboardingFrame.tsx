import React from 'react';
import { KonektLogo } from '@/components/KonektLogo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface TrailStep {
  key: string;
  label: string;
}

/** Fil des étapes : un mot par étape, celle en cours soulignée. Rien ne bouge. */
const Trail: React.FC<{ steps: TrailStep[]; activeIndex: number }> = ({ steps, activeIndex }) => (
  <nav aria-label="Progression de la configuration">
    <ol className="flex items-center gap-5">
      {steps.map((step, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <li
            key={step.key}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'border-b-2 pb-1 text-xs',
              active ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground',
            )}
          >
            {step.label}
            {done && <span className="sr-only"> (terminé)</span>}
          </li>
        );
      })}
    </ol>
  </nav>
);

interface Props {
  steps: TrailStep[];
  activeIndex: number;
  /** Progression de 0 à 100 (trait fin du haut). */
  progress: number;
  /** Sortie discrète en haut à droite (« Terminer plus tard »), une fois l'espace créé. */
  onLeave?: () => void;
  children: React.ReactNode;
}

/**
 * Le cadre de l'onboarding : le logo, le fil des étapes, la scène en cours au
 * centre. Une colonne, sans décor ni mouvement (docs/design/01-direction.md, § 11).
 */
export const OnboardingFrame: React.FC<Props> = ({ steps, activeIndex, progress, onLeave, children }) => (
  <div className="flex min-h-screen flex-col bg-background">
    <div
      role="progressbar"
      aria-label="Progression de la configuration"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      className="fixed inset-x-0 top-0 z-sticky h-0.5 bg-border"
    >
      <div className="h-full bg-foreground" style={{ width: `${progress}%` }} />
    </div>
    <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-5 sm:px-10">
      <KonektLogo theme="auto" size={24} className="shrink-0" />
      <div className="hidden justify-center sm:flex">
        <Trail steps={steps} activeIndex={activeIndex} />
      </div>
      <div className="col-start-3 flex items-center justify-self-end gap-3">
        <p className="text-xs tabular-nums text-muted-foreground sm:hidden">
          {Math.min(activeIndex + 1, steps.length)} / {steps.length}
        </p>
        {onLeave && (
          <Button variant="ghost" size="sm" onClick={onLeave} className="hidden sm:inline-flex">
            Terminer plus tard
          </Button>
        )}
      </div>
    </header>
    <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-16 pt-4 sm:px-6">{children}</main>
  </div>
);
