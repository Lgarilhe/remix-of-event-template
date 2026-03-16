import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Check, FileSearch, Filter, Search, BarChart3, type LucideIcon } from 'lucide-react';
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
  const [collapsed, setCollapsed] = useState(false);
  const prevThinking = useRef(isThinking);

  // Auto-collapse 1s after thinking ends
  useEffect(() => {
    if (prevThinking.current && !isThinking) {
      const timer = setTimeout(() => setCollapsed(true), 1000);
      return () => clearTimeout(timer);
    }
    if (isThinking) setCollapsed(false);
    prevThinking.current = isThinking;
  }, [isThinking]);

  if (steps.length === 0 && !isThinking) return null;

  const activeStep = steps.find(s => s.status === 'active');
  const doneCount = steps.filter(s => s.status === 'done').length;

  // Collapsed summary line
  if (collapsed && !isThinking) {
    return (
      <div className="animate-fade-in">
        <button
          onClick={() => setCollapsed(false)}
          className="w-full border border-brutal-accent/20 px-3.5 py-2.5 flex items-center gap-2 hover:bg-brutal-accent/5 transition-colors text-left"
        >
          <span className="text-xs">✅</span>
          <span className="text-xs text-muted-foreground">
            Réflexion terminée — {doneCount} étape{doneCount > 1 ? 's' : ''}
          </span>
        </button>
      </div>
    );
  }

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

        {/* Steps list */}
        {steps.length > 0 && (
          <div className="border-t border-brutal-accent/10 px-3.5 py-3 space-y-1 max-h-[calc(6*32px)] overflow-y-auto scrollbar-hide">
            {steps.map((step, i) => {
              const StepIcon = getStepIcon(step.label);
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-2.5 py-1 px-2 transition-colors animate-fade-in",
                    step.status === 'active' && "bg-brutal-accent/5"
                  )}
                  style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'backwards' }}
                >
                  {step.status === 'done' ? (
                    <Check className="w-3 h-3 shrink-0" style={{ color: 'hsl(142 71% 45%)' }} />
                  ) : step.status === 'active' ? (
                    <StepIcon className="w-3 h-3 text-brutal-accent shrink-0 animate-pulse" />
                  ) : (
                    <StepIcon className="w-3 h-3 text-muted-foreground/30 shrink-0" />
                  )}
                  <span className={cn(
                    "text-[11px] leading-relaxed font-mono",
                    step.status === 'active'
                      ? "text-foreground font-medium"
                      : step.status === 'done'
                        ? "text-foreground/70 line-through decoration-foreground/20"
                        : "text-muted-foreground/40"
                  )}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Streaming thinking — show only human-readable lines, hide technical noise */}
        {thinkingContent && (() => {
          const lines = thinkingContent.split('\n').filter(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.length < 10) return false;
            if (/^[\[{]/.test(trimmed)) return false;
            if (/^[→⇒>]\s/.test(trimmed)) return false;
            if (/^\|/.test(trimmed)) return false;
            if (/^```/.test(trimmed)) return false;
            if (/\{.*:.*\}/.test(trimmed)) return false;
            if (/"keywords"|"priority"|"scope"|"MUST_HAVE"|"DOESNT_HAVE"/i.test(trimmed)) return false;
            if (/COMPANY_KEYWORDS|SEARCH_PLAN|AGENT_ACTION|location_keywords|skills_filter|calculated_experience/i.test(trimmed)) return false;
            if (/NOT\s*\(.*OR.*\)/i.test(trimmed)) return false;
            if (/^\s*-\s*\*{2}[a-z_]+\*{2}/i.test(trimmed)) return false;
            return true;
          });

          const display = lines.slice(-3);
          if (display.length === 0) return null;

          return (
            <div className="border-t border-brutal-accent/10 px-3.5 py-2.5">
              {display.map((line, i) => {
                const cleaned = line.trim()
                  .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
                  .replace(/`([^`]+)`/g, '$1')
                  .replace(/^[-·•]\s*/, '');
                return (
                  <p key={i} className="text-[11px] text-muted-foreground/40 leading-relaxed truncate">
                    {cleaned}
                  </p>
                );
              })}
              <span className="inline-block w-[2px] h-3 bg-brutal-accent/40 animate-pulse align-middle mt-0.5" />
            </div>
          );
        })()}
      </div>
    </div>
  );
};
