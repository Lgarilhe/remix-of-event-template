import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { CheckCircle2, MapPin, Calendar, Target, Brain, ChevronDown, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentMessage } from '@/hooks/useAgentChat';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { cn } from '@/lib/utils';

interface AgentMessageBubbleProps {
  message: AgentMessage;
  isStreaming?: boolean;
}

export function extractOptions(content: string): string[] {
  const match = content.match(/\[OPTIONS\]\s*(\[[\s\S]*?\])\s*\[\/OPTIONS\]/);
  if (!match) return [];
  try { return JSON.parse(match[1]); } catch { return []; }
}

export const AgentMessageBubble: React.FC<AgentMessageBubbleProps> = ({ message, isStreaming }) => {
  const isUser = message.role === 'user';
  const isStatus = message.role === 'status';
  const thinking = message.metadata?.thinking as string | undefined;

  const cleanContent = message.content
    .replace(/\[SEARCH_PLAN\][\s\S]*?\[\/SEARCH_PLAN\]/g, '')
    .replace(/\[AGENT_ACTION\][\s\S]*?\[\/AGENT_ACTION\]/g, '')
    .replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/g, '')
    .trim();

  const searchPlan = message.metadata?.search_plan as Record<string, unknown> | undefined;

  // ── Status message ──
  if (isStatus) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 border border-foreground/8 bg-muted/20 text-xs animate-fade-in">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brutal-accent/50" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brutal-accent" />
        </span>
        <span className="text-muted-foreground font-medium">{cleanContent}</span>
      </div>
    );
  }

  // ── User message ──
  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed bg-foreground text-background">
          <div className="[&_p]:my-0">
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  // ── Assistant message ──
  return (
    <div className="space-y-2 animate-fade-in">
      {/* Thinking card for saved messages */}
      {thinking && <ThinkingCard thinking={thinking} />}

      {cleanContent && (
        <div className="text-sm leading-relaxed">
          <div className="prose prose-sm max-w-none [&_p]:my-1.5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:mt-2 [&_h3]:mb-1 [&_hr]:my-3 [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_li]:marker:text-foreground/50 text-sm text-foreground/80 [&_strong]:text-foreground">
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
        </div>
      )}

      {searchPlan && <SearchPlanCard plan={searchPlan} />}

      {isStreaming && (
        <span className="inline-block w-0.5 h-4 bg-foreground animate-pulse" />
      )}
    </div>
  );
};

// ── Thinking Card (for saved messages with thinking metadata) ──
function ThinkingCard({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);

  const lines = thinking.split('\n').filter(l => l.trim() && l.trim().length > 5);
  const displayLines = lines.slice(0, 12).map(l => {
    const trimmed = l.trim();
    return trimmed.length > 120 ? trimmed.slice(0, 117) + '…' : trimmed;
  });

  if (displayLines.length === 0) return null;

  return (
    <div className="border border-foreground/10 bg-muted/20 overflow-hidden">
      {/* Toggle header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="h-[18px] w-[18px] flex items-center justify-center border border-foreground/15">
          <Brain className="w-2.5 h-2.5 text-muted-foreground" />
        </div>
        <span className="text-xs text-muted-foreground font-medium flex-1">
          Réflexion terminée
        </span>
        <span className="text-[10px] text-muted-foreground/50 tabular-nums">
          {displayLines.length} étapes
        </span>
        <ChevronDown className={cn(
          "w-3 h-3 transition-transform text-muted-foreground/40",
          expanded && "rotate-180"
        )} />
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-foreground/8 px-3 py-2.5 space-y-0.5 max-h-[240px] overflow-y-auto scrollbar-hide">
              {displayLines.map((line, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <span className="mt-[6px] h-1 w-1 bg-foreground/15 shrink-0" />
                  <p className="text-[11px] leading-relaxed font-mono text-muted-foreground/70">
                    {line}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Search Plan Card ──
function SearchPlanCard({ plan }: { plan: Record<string, unknown> }) {
  const filters = (plan as any).filters || {};
  const stopConditions = (plan as any).stop_conditions || {};

  return (
    <div className="border border-foreground/10 bg-muted/20 overflow-hidden">
      <div className="px-3 py-2.5 flex items-center gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-foreground/60" />
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground/70">
          Plan de recherche
        </span>
      </div>

      <div className="border-t border-foreground/8 px-3 py-2.5 space-y-2.5">
        {(plan as any).summary && (
          <p className="text-sm leading-relaxed text-foreground/70">
            {(plan as any).summary}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {filters.location_keywords?.length > 0 && (
            <PlanPill icon={MapPin} label={filters.location_keywords.join(', ')} />
          )}
          {filters.calculated_experience_min != null && (
            <PlanPill icon={Calendar} label={`${filters.calculated_experience_min}–${filters.calculated_experience_max} ans`} />
          )}
          {stopConditions.target_go_profiles && (
            <PlanPill icon={Target} label={`${stopConditions.target_go_profiles} profils Go`} />
          )}
        </div>
      </div>
    </div>
  );
}

function PlanPill({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium border border-foreground/15 bg-background text-foreground/70">
      <Icon className="w-3 h-3" />
      <span>{label}</span>
    </div>
  );
}
