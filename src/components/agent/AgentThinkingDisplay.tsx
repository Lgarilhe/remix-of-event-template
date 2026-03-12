import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Brain } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);

  if (steps.length === 0 && !isThinking) return null;

  const activeStep = steps.find(s => s.status === 'active');
  const doneCount = steps.filter(s => s.status === 'done').length;

  return (
    <div className="flex gap-3 justify-start">
      {/* Thinking indicator */}
      <div className={cn(
        "h-8 w-8 flex items-center justify-center shrink-0 mt-0.5 border",
        isThinking ? "border-foreground bg-foreground text-background" : "border-foreground/20 text-muted-foreground"
      )}>
        <Brain className="w-3.5 h-3.5" />
      </div>

      <div className="flex-1 min-w-0">
        {/* Collapsed view */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left group w-full"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {isThinking && (
              <div className="relative h-4 w-4 shrink-0">
                <div className="absolute inset-0 border-2 border-foreground border-t-transparent animate-spin" />
              </div>
            )}
            <span className={cn(
              "text-xs uppercase tracking-wider font-medium truncate",
              isThinking ? "text-foreground" : "text-muted-foreground"
            )}>
              {isThinking
                ? (activeStep?.label || 'Analyse en cours…')
                : `Réflexion terminée`
              }
            </span>
            {doneCount > 0 && (
              <span className="text-[10px] shrink-0 text-muted-foreground">
                {doneCount} étape{doneCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <ChevronDown className={cn(
            "w-3.5 h-3.5 transition-transform shrink-0 text-muted-foreground",
            expanded && "rotate-180"
          )} />
        </button>

        {/* Expanded view */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-2 pl-1 space-y-0 border-l-2 border-foreground/20">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5 py-1 pl-3 relative">
                    <span className={cn(
                      "absolute left-[-4px] top-[10px] h-1.5 w-1.5 shrink-0",
                      step.status === 'active' ? "bg-foreground" : "bg-foreground/20"
                    )} />
                    <span className={cn(
                      "text-xs leading-relaxed",
                      step.status === 'active' ? "text-foreground font-medium" : "text-muted-foreground"
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

/** Inline thinking display for saved messages with thinking metadata */
export const AgentThinkingSaved: React.FC<{ thinking: string }> = ({ thinking }) => {
  const [expanded, setExpanded] = useState(false);

  if (!thinking) return null;

  const lines = thinking.split('\n').filter(l => l.trim() && l.trim().length > 5);
  const displayLines = lines.slice(0, 8).map(l => l.trim().length > 80 ? l.trim().slice(0, 77) + '…' : l.trim());

  return (
    <button
      onClick={() => setExpanded(!expanded)}
      className="flex items-center gap-2 text-left mt-1 mb-2 group"
    >
      <Brain className="w-3 h-3 shrink-0 text-muted-foreground" />
      <span className="text-[11px] text-muted-foreground">
        {expanded ? 'Masquer' : 'Voir'} la réflexion
      </span>
      <ChevronDown className={cn(
        "w-3 h-3 transition-transform text-muted-foreground",
        expanded && "rotate-180"
      )} />

      {expanded && (
        <div className="absolute mt-1 top-full left-0 right-0 pl-5 space-y-0.5 p-2 border-l-2 border-foreground/20 bg-muted/30">
          {displayLines.map((line, i) => (
            <p
              key={i}
              className="text-[11px] py-0.5 pl-2 font-mono text-muted-foreground"
            >
              {line}
            </p>
          ))}
        </div>
      )}
    </button>
  );
};
