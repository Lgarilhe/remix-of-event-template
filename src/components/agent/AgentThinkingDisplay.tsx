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
      <div className="h-7 w-7 bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <Brain className="w-4 h-4 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        {/* Collapsed view - current step */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left group w-full"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {isThinking && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full bg-brutal-accent/50 rounded-full" />
                <span className="relative inline-flex h-2 w-2 bg-brutal-accent rounded-full" />
              </span>
            )}
            <span className="text-xs text-muted-foreground truncate">
              {isThinking
                ? (activeStep?.label || 'En train de réfléchir…')
                : `Réflexion terminée`
              }
            </span>
            {doneCount > 0 && (
              <span className="text-[10px] text-muted-foreground/50 shrink-0">
                {doneCount} étape{doneCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <ChevronDown className={cn(
            "w-3.5 h-3.5 text-muted-foreground/40 transition-transform shrink-0",
            expanded && "rotate-180"
          )} />
        </button>

        {/* Expanded view - all steps */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-2 pl-1 border-l border-foreground/8 space-y-0">
                {steps.map((step, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 py-1 pl-3 relative"
                  >
                    {/* Dot on the line */}
                    <span className={cn(
                      "absolute left-[-3px] top-[10px] h-1.5 w-1.5 rounded-full shrink-0",
                      step.status === 'active' ? "bg-brutal-accent" :
                      step.status === 'done' ? "bg-foreground/20" :
                      "bg-foreground/10"
                    )} />
                    <span className={cn(
                      "text-xs leading-relaxed",
                      step.status === 'active' ? "text-foreground" : "text-muted-foreground/60"
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
      <Brain className="w-3 h-3 text-muted-foreground/40 shrink-0" />
      <span className="text-[11px] text-muted-foreground/50">
        {expanded ? 'Masquer' : 'Voir'} la réflexion
      </span>
      <ChevronDown className={cn(
        "w-3 h-3 text-muted-foreground/30 transition-transform",
        expanded && "rotate-180"
      )} />

      {expanded && (
        <div className="absolute mt-1 top-full left-0 right-0 pl-5 border-l border-foreground/8 space-y-0.5">
          {displayLines.map((line, i) => (
            <p key={i} className="text-[11px] text-muted-foreground/40 py-0.5 pl-2">{line}</p>
          ))}
        </div>
      )}
    </button>
  );
};
