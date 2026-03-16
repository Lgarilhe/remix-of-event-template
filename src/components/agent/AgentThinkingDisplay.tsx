import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Sparkles, Check, Loader2 } from 'lucide-react';
import { ThinkingStep } from '@/hooks/useAgentChat';
import { cn } from '@/lib/utils';

interface AgentThinkingDisplayProps {
  steps: ThinkingStep[];
  isThinking: boolean;
  thinkingContent: string;
}

export const AgentThinkingDisplay: React.FC<AgentThinkingDisplayProps> = ({
  steps, isThinking, thinkingContent,
}) => {
  const [expanded, setExpanded] = useState(true);

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
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left hover:bg-brutal-accent/5 transition-colors"
        >
          {isThinking ? (
            <div className="h-5 w-5 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-brutal-accent animate-pulse" />
            </div>
          ) : (
            <div className="h-5 w-5 flex items-center justify-center">
              <Check className="w-3.5 h-3.5 text-brutal-accent" />
            </div>
          )}

          <span className={cn(
            "text-xs font-semibold flex-1 min-w-0 truncate uppercase tracking-wider",
            isThinking ? "text-foreground" : "text-muted-foreground"
          )}>
            {isThinking
              ? (activeStep?.label || 'Réflexion en cours…')
              : `Réflexion terminée`
            }
          </span>

          {doneCount > 0 && (
            <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums font-mono">
              {doneCount}/{steps.length}
            </span>
          )}

          <ChevronDown className={cn(
            "w-3.5 h-3.5 transition-transform shrink-0 text-muted-foreground/40",
            expanded && "rotate-180"
          )} />
        </button>

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

        {/* Expanded steps */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 'auto' }}
              exit={{ height: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="border-t border-brutal-accent/10 px-3.5 py-3 space-y-1.5 max-h-[220px] overflow-y-auto scrollbar-hide">
                {steps.map((step, i) => (
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
                      <div className="w-3 h-3 flex items-center justify-center shrink-0">
                        <div className="h-1 w-1 bg-foreground/20" />
                      </div>
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
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
