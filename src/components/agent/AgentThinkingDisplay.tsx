import React from 'react';
import { Sparkles, Check, Loader2, FileSearch, Filter, Search, BarChart3, type LucideIcon } from 'lucide-react';
import { ThinkingStep } from '@/hooks/useAgentChat';
import { cn } from '@/lib/utils';

interface AgentThinkingDisplayProps {
  steps: ThinkingStep[];
  isThinking: boolean;
  thinkingContent: string;
}

const stepIconMap: Array<{ test: RegExp; icon: LucideIcon }> = [
  { test: /analyse|fiche/i, icon: FileSearch },
  { test: /filtre|linkedin/i, icon: Filter },
  { test: /recherche|profil/i, icon: Search },
  { test: /score|évaluation/i, icon: BarChart3 },
];

function getStepIcon(label: string): LucideIcon {
  return stepIconMap.find(m => m.test.test(label))?.icon ?? Sparkles;
}

export const AgentThinkingDisplay: React.FC<AgentThinkingDisplayProps> = ({
  steps, isThinking, thinkingContent,
}) => {
  if (steps.length === 0 && !isThinking) return null;

  const activeStep = steps.find(s => s.status === 'active');
  const doneCount = steps.filter(s => s.status === 'done').length;

  return (
    <div className="animate-fade-in">
      <div
        className={cn(
          "border border-brutal-accent/20 overflow-hidden transition-shadow duration-300",
          isThinking && "shadow-[0_0_20px_-4px_hsl(var(--brutal-accent)/0.25)]"
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          {isThinking ? (
            <Sparkles className="w-3.5 h-3.5 text-brutal-accent animate-pulse shrink-0" />
          ) : (
            <Check className="w-3.5 h-3.5 text-brutal-accent shrink-0" />
          )}

          <span className={cn(
            "text-xs font-semibold flex-1 min-w-0 truncate uppercase tracking-wider",
            isThinking ? "text-foreground" : "text-muted-foreground"
          )}>
            {isThinking
              ? (activeStep?.label || 'Réflexion en cours…')
              : 'Réflexion terminée'
            }
          </span>

          {doneCount > 0 && (
            <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums font-mono">
              {doneCount}/{steps.length}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {steps.length > 0 && (
          <div className="h-[2px] bg-foreground/5 overflow-hidden">
            <div
              className={cn(
                "h-full skalr-gradient-bg transition-all duration-500 ease-out",
                isThinking && "animate-[shimmer_1.5s_ease-in-out_infinite]"
              )}
              style={{ width: `${(doneCount / Math.max(steps.length, 1)) * 100}%` }}
            />
          </div>
        )}

        {/* Steps list — always visible */}
        {steps.length > 0 && (
          <div className="border-t border-brutal-accent/10 px-3.5 py-3 space-y-1.5 max-h-[220px] overflow-y-auto scrollbar-hide">
            {steps.map((step, i) => {
              const StepIcon = getStepIcon(step.label);
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-2.5 py-1 px-2 transition-colors",
                    step.status === 'active' && "bg-brutal-accent/5"
                  )}
                >
                  {step.status === 'done' ? (
                    <Check className="w-3 h-3 text-brutal-accent shrink-0" />
                  ) : step.status === 'active' ? (
                    <Loader2 className="w-3 h-3 text-brutal-accent shrink-0 animate-spin" />
                  ) : (
                    <StepIcon className="w-3 h-3 text-foreground/20 shrink-0" />
                  )}
                  <span className={cn(
                    "text-[11px] leading-relaxed font-mono",
                    step.status === 'active'
                      ? "text-foreground"
                      : step.status === 'done'
                        ? "text-muted-foreground"
                        : "text-muted-foreground/40"
                  )}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
