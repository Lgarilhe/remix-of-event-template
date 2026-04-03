import React, { useState, useEffect, useRef } from 'react';
import { ThinkingPhase } from '@/hooks/useAgentChat';
import { cn } from '@/lib/utils';

interface AgentThinkingDisplayProps {
  steps: ThinkingPhase[];
  isThinking: boolean;
  thinkingContent: string;
}

export const AgentThinkingDisplay: React.FC<AgentThinkingDisplayProps> = ({
  steps, isThinking, thinkingContent,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const prevThinking = useRef(isThinking);

  useEffect(() => {
    if (prevThinking.current && !isThinking) {
      const timer = setTimeout(() => setCollapsed(true), 1000);
      return () => clearTimeout(timer);
    }
    if (isThinking) setCollapsed(false);
    prevThinking.current = isThinking;
  }, [isThinking]);

  if (steps.length === 0 && !isThinking) return null;

  const doneCount = steps.filter(s => s.status === 'done').length;
  const totalTriggered = steps.filter(s => s.status !== 'pending').length;

  if (collapsed && !isThinking) {
    return (
      <div className="animate-fade-in flex gap-2.5">
        <div className="w-6 h-6 rounded-full bg-primary/10 shrink-0" />
        <button
          onClick={() => setCollapsed(false)}
          className="flex-1 border border-border/50 rounded-lg px-3.5 py-2.5 flex items-center gap-2.5 hover:bg-muted/30 transition-colors text-left"
        >
          <PhaseCircle status="done" />
          <span className="text-xs text-muted-foreground">
            Réflexion terminée — {totalTriggered} phase{totalTriggered > 1 ? 's' : ''}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in flex gap-2.5">
      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        {isThinking && (
          <div className="w-3 h-3 rounded-full border-2 border-transparent border-t-primary animate-spin" />
        )}
      </div>
      <div
        className={cn(
          "flex-1 border border-border/50 rounded-xl overflow-hidden transition-shadow duration-300",
          isThinking && "shadow-sm"
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 px-3.5 py-2.5">
          {isThinking ? (
            <PhaseCircle status="active" />
          ) : (
            <PhaseCircle status="done" />
          )}
          <span className={cn(
            "text-xs font-medium flex-1 min-w-0 truncate",
            isThinking ? "text-foreground" : "text-muted-foreground"
          )}>
            {isThinking
              ? (steps.find(s => s.status === 'active')?.label || 'Réflexion en cours…')
              : 'Réflexion terminée'
            }
          </span>
          {doneCount > 0 && (
            <span className="text-[10px] text-muted-foreground/50 shrink-0 tabular-nums font-mono">
              {doneCount}/{steps.length}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {steps.length > 0 && (
          <div className="h-[2px] bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full skalr-gradient-bg transition-all duration-500 ease-out",
                isThinking && "animate-[shimmer_1.5s_ease-in-out_infinite]"
              )}
              style={{ width: `${(doneCount / Math.max(steps.length, 1)) * 100}%` }}
            />
          </div>
        )}

        {/* Phase list */}
        {steps.length > 0 && (
          <div className="px-3.5 py-2.5 space-y-0.5">
            {steps.map((phase, i) => (
              <div
                key={phase.id}
                className={cn(
                  "flex items-center gap-2.5 py-1 px-2 rounded-md transition-colors animate-fade-in",
                  phase.status === 'active' && "bg-primary/5"
                )}
                style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'backwards' }}
              >
                <PhaseCircle status={phase.status} />
                <span className={cn(
                  "text-xs leading-relaxed",
                  phase.status === 'active'
                    ? "text-foreground font-medium"
                    : phase.status === 'done'
                      ? "text-foreground/60 line-through decoration-foreground/15"
                      : "text-muted-foreground/40"
                )}>
                  {phase.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function PhaseCircle({ status }: { status: 'pending' | 'active' | 'done' }) {
  if (status === 'done') {
    return (
      <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'hsl(142 71% 45%)' }} />
      </span>
    );
  }

  if (status === 'active') {
    return (
      <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        <span className="absolute h-3.5 w-3.5 rounded-full border-2 border-primary/20" />
        <span className="absolute h-3.5 w-3.5 rounded-full border-2 border-transparent border-t-primary animate-spin" />
        <span className="h-1.5 w-1.5 rounded-full bg-primary/50" />
      </span>
    );
  }

  return (
    <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <span className="h-2.5 w-2.5 rounded-full border border-border/60" />
    </span>
  );
}
