/**
 * PhaseStepper — Stepper horizontal à 3 phases pour le parcours mission v2.
 *
 *   1. Cadrage (= brief + process + config)
 *   2. Sourcing & Outreach (= sourcing + outreach)
 *   3. Pipeline (= pipeline + insights)
 *
 * Remplace les 8 tabs actuels (qui faisaient se perdre les users).
 * Chaque phase peut être :
 *   - "done" (verte avec ✓)
 *   - "active" (highlight foreground + glow)
 *   - "todo" (muted)
 *
 * Cliquable pour naviguer entre phases (si non-locked).
 *
 * Design source : Claude Design "Mission Refonte v2" — adapté aux tokens
 * Konekt + intégré au système readiness existant.
 */

import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PhaseId = 1 | 2 | 3;
export type PhaseState = 'done' | 'active' | 'todo';

export interface Phase {
  id: PhaseId;
  label: string;
  desc: string;
}

const PHASES: Phase[] = [
  { id: 1, label: 'Cadrage', desc: 'Brief & process' },
  { id: 2, label: 'Sourcing & Outreach', desc: 'Recherche & contact' },
  { id: 3, label: 'Pipeline', desc: 'Entretiens & embauche' },
];

export interface PhaseStepperProps {
  /** Phase courante (1, 2, ou 3). */
  active: PhaseId;
  /** Callback quand une phase est cliquée. */
  onSelect?: (phase: PhaseId) => void;
  /** Contenu optionnel à droite du stepper (ex: Pill "Sourcing actif"). */
  rightSlot?: React.ReactNode;
  /** Permet de bloquer certaines phases (ex: brief incomplet → phase 2 lockée). */
  isPhaseLocked?: (phase: PhaseId) => boolean;
}

function getPhaseState(phaseId: PhaseId, active: PhaseId): PhaseState {
  if (phaseId < active) return 'done';
  if (phaseId === active) return 'active';
  return 'todo';
}

export const PhaseStepper: React.FC<PhaseStepperProps> = ({
  active,
  onSelect,
  rightSlot,
  isPhaseLocked,
}) => {
  return (
    <div className="border-b border-border bg-background">
      <div className="px-4 sm:px-5 py-1.5 flex items-center gap-1 overflow-x-auto scrollbar-hide">
        {PHASES.map((p, i) => {
          const state = getPhaseState(p.id, active);
          const locked = isPhaseLocked?.(p.id) ?? false;
          const clickable = !locked && onSelect;

          return (
            <React.Fragment key={p.id}>
              <button
                type="button"
                onClick={() => clickable && onSelect(p.id)}
                disabled={!clickable}
                className={cn(
                  'flex items-center gap-2 px-2.5 py-1 rounded-lg transition-all duration-300',
                  'flex-shrink-0',
                  clickable && 'hover:bg-accent/50 active:scale-[0.98]',
                  !clickable && 'cursor-default',
                  locked && 'opacity-50',
                )}
                style={{
                  background: state === 'active' ? 'hsl(var(--accent))' : 'transparent',
                }}
                aria-current={state === 'active' ? 'step' : undefined}
              >
                <span
                  className="h-5 w-5 rounded-full grid place-items-center text-[10px] font-bold flex-shrink-0 transition-all duration-300"
                  style={{
                    background:
                      state === 'done'
                        ? 'hsl(var(--status-success))'
                        : state === 'active'
                          ? 'hsl(var(--foreground))'
                          : 'hsl(var(--muted))',
                    color:
                      state === 'done' || state === 'active'
                        ? 'hsl(var(--background))'
                        : 'hsl(var(--muted-foreground))',
                    boxShadow: state === 'active' ? '0 0 0 3px hsl(var(--foreground) / 0.1)' : 'none',
                  }}
                >
                  {state === 'done' ? <Check className="w-2.5 h-2.5" strokeWidth={3} /> : p.id}
                </span>
                <p
                  className={cn(
                    'text-[12.5px] font-semibold leading-tight',
                    state === 'todo' && 'text-muted-foreground',
                  )}
                >
                  {p.label}
                </p>
              </button>
              {i < PHASES.length - 1 && (
                <div
                  className="flex-shrink-0 h-px w-3 sm:w-4 transition-all duration-500"
                  style={{
                    background: state === 'done' ? 'hsl(var(--status-success))' : 'hsl(var(--border))',
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
        {rightSlot && (
          <>
            <div className="flex-1" />
            <div className="flex items-center gap-2 flex-shrink-0">{rightSlot}</div>
          </>
        )}
      </div>
    </div>
  );
};
