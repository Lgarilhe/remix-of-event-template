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
      {/* Thinking Orb */}
      <div className="relative h-8 w-8 flex items-center justify-center shrink-0 mt-0.5">
        {isThinking && (
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: 'conic-gradient(from 0deg, #00f0ff, #7c3aed, #f43f5e, #00f0ff)',
              animation: 'agent-spin 2s linear infinite',
            }}
          />
        )}
        <div
          className="relative rounded-full flex items-center justify-center"
          style={{
            width: isThinking ? 26 : 32,
            height: isThinking ? 26 : 32,
            background: '#0a0a0f',
            border: isThinking ? 'none' : '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <Brain className="w-3.5 h-3.5" style={{ color: isThinking ? '#00f0ff' : 'rgba(255,255,255,0.3)' }} />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        {/* Collapsed view */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left group w-full"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {isThinking && (
              <div className="flex gap-0.5 shrink-0">
                {[0, 1, 2, 3, 4].map(i => (
                  <span
                    key={i}
                    className="h-[3px] w-[3px] rounded-full bg-[#00f0ff]"
                    style={{
                      animation: 'agent-pulse-dot 1.5s ease-in-out infinite',
                      animationDelay: `${i * 0.15}s`,
                    }}
                  />
                ))}
              </div>
            )}
            <span className="text-xs truncate" style={{ color: isThinking ? '#00f0ff' : 'rgba(255,255,255,0.4)' }}>
              {isThinking
                ? (activeStep?.label || 'Analyse en cours…')
                : `Réflexion terminée`
              }
            </span>
            {doneCount > 0 && (
              <span className="text-[10px] shrink-0" style={{ color: 'rgba(255,255,255,0.2)' }}>
                {doneCount} étape{doneCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <ChevronDown className={cn(
            "w-3.5 h-3.5 transition-transform shrink-0",
            expanded && "rotate-180"
          )} style={{ color: 'rgba(255,255,255,0.2)' }} />
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
              <div className="mt-2 pl-1 space-y-0" style={{ borderLeft: '2px solid rgba(0,240,255,0.15)' }}>
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5 py-1 pl-3 relative">
                    <span
                      className="absolute left-[-4px] top-[10px] h-1.5 w-1.5 rounded-full shrink-0"
                      style={{
                        background: step.status === 'active' ? '#00f0ff'
                          : step.status === 'done' ? 'rgba(255,255,255,0.2)'
                          : 'rgba(255,255,255,0.06)',
                        boxShadow: step.status === 'active' ? '0 0 6px rgba(0,240,255,0.5)' : 'none',
                      }}
                    />
                    <span
                      className="text-xs leading-relaxed"
                      style={{
                        color: step.status === 'active' ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)',
                      }}
                    >
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
      <Brain className="w-3 h-3 shrink-0" style={{ color: 'rgba(255,255,255,0.25)' }} />
      <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
        {expanded ? 'Masquer' : 'Voir'} la réflexion
      </span>
      <ChevronDown className={cn(
        "w-3 h-3 transition-transform",
        expanded && "rotate-180"
      )} style={{ color: 'rgba(255,255,255,0.2)' }} />

      {expanded && (
        <div
          className="absolute mt-1 top-full left-0 right-0 pl-5 space-y-0.5 rounded-lg p-2"
          style={{
            borderLeft: '2px solid rgba(0,240,255,0.15)',
            background: 'rgba(0,240,255,0.02)',
          }}
        >
          {displayLines.map((line, i) => (
            <p
              key={i}
              className="text-[11px] py-0.5 pl-2"
              style={{
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                color: 'rgba(255,255,255,0.3)',
              }}
            >
              {line}
            </p>
          ))}
        </div>
      )}
    </button>
  );
};
