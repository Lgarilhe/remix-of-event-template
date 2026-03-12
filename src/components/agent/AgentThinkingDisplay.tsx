import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Brain, Sparkles } from 'lucide-react';
import { ThinkingStep } from '@/hooks/useAgentChat';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { cn } from '@/lib/utils';

interface AgentThinkingDisplayProps {
  steps: ThinkingStep[];
  isThinking: boolean;
  thinkingContent: string;
}

export const AgentThinkingDisplay: React.FC<AgentThinkingDisplayProps> = ({
  steps, isThinking, thinkingContent,
}) => {
  const [expanded, setExpanded] = useState(false);

  if (steps.length === 0 && !isThinking) return null;

  const activeStep = steps.find(s => s.status === 'active');
  const doneCount = steps.filter(s => s.status === 'done').length;

  return (
    <div className="animate-fade-in">
      <div className="border border-foreground/10 bg-muted/20 overflow-hidden">
        {/* Header — always visible */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
        >
          {isThinking ? (
            <AnimatedOrb size={22} speed={3}>
              <Sparkles className="w-2.5 h-2.5 text-foreground/60" />
            </AnimatedOrb>
          ) : (
            <div className="h-[22px] w-[22px] flex items-center justify-center border border-foreground/15">
              <Brain className="w-3 h-3 text-muted-foreground" />
            </div>
          )}

          <span className={cn(
            "text-xs font-medium flex-1 min-w-0 truncate",
            isThinking ? "text-foreground" : "text-muted-foreground"
          )}>
            {isThinking
              ? (activeStep?.label || 'Réflexion en cours…')
              : `Réflexion terminée`
            }
          </span>

          {doneCount > 0 && !isThinking && (
            <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
              {doneCount} étape{doneCount > 1 ? 's' : ''}
            </span>
          )}

          <ChevronDown className={cn(
            "w-3.5 h-3.5 transition-transform shrink-0 text-muted-foreground/40",
            expanded && "rotate-180"
          )} />
        </button>

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
              <div className="border-t border-foreground/8 px-3 py-2.5 space-y-0.5 max-h-[200px] overflow-y-auto scrollbar-hide">
                {steps.map((step, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 py-0.5"
                  >
                    <span className={cn(
                      "mt-[6px] h-1 w-1 shrink-0",
                      step.status === 'active' ? "bg-brutal-accent" : "bg-foreground/15"
                    )} />
                    <span className={cn(
                      "text-[11px] leading-relaxed font-mono",
                      step.status === 'active' ? "text-foreground/80" : "text-muted-foreground/60"
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
