import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Bot, CheckCircle2, MapPin, Calendar, Target, Brain, ChevronDown } from 'lucide-react';
import { AgentMessage } from '@/hooks/useAgentChat';
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
      <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/40 text-xs text-muted-foreground">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full bg-brutal-accent/60 rounded-full" />
          <span className="relative inline-flex h-2 w-2 bg-brutal-accent rounded-full" />
        </span>
        <span>{cleanContent}</span>
      </div>
    );
  }

  // ── User message ──
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-foreground text-background px-4 py-3 text-sm leading-relaxed">
          <div className="[&_p]:my-0">
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }

  // ── Assistant message ──
  return (
    <div className="flex gap-3 justify-start">
      <div className="h-7 w-7 bg-muted flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="w-4 h-4 text-foreground/70" />
      </div>

      <div className="flex-1 min-w-0 text-sm leading-relaxed text-foreground">
        {/* Thinking toggle for saved messages */}
        {thinking && <ThinkingToggle thinking={thinking} />}

        {cleanContent && (
          <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none [&_p]:my-1.5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:mt-2 [&_h3]:mb-1 [&_strong]:font-bold [&_hr]:my-3 [&_hr]:border-foreground/8 [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 text-sm">
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
        )}

        {searchPlan && <SearchPlanCard plan={searchPlan} />}

        {isStreaming && (
          <span className="inline-block w-0.5 h-4 bg-foreground/40 animate-pulse ml-0.5 mt-1" />
        )}
      </div>
    </div>
  );
};

function ThinkingToggle({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);

  const lines = thinking.split('\n').filter(l => l.trim() && l.trim().length > 5);
  const displayLines = lines.slice(0, 10).map(l => {
    const trimmed = l.trim();
    return trimmed.length > 100 ? trimmed.slice(0, 97) + '…' : trimmed;
  });

  if (displayLines.length === 0) return null;

  return (
    <div className="mb-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-left group"
      >
        <Brain className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
        <span className="text-xs text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
          {expanded ? 'Masquer' : 'Voir'} la réflexion ({displayLines.length} étapes)
        </span>
        <ChevronDown className={cn(
          "w-3 h-3 text-muted-foreground/30 transition-transform",
          expanded && "rotate-180"
        )} />
      </button>

      {expanded && (
        <div className="mt-2 ml-1 pl-3 border-l border-foreground/8 space-y-1">
          {displayLines.map((line, i) => (
            <div key={i} className="flex items-start gap-2 relative">
              <span className="absolute left-[-14.5px] top-[7px] h-1.5 w-1.5 rounded-full bg-foreground/15 shrink-0" />
              <p className="text-xs text-muted-foreground/50 leading-relaxed">{line}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchPlanCard({ plan }: { plan: Record<string, unknown> }) {
  const filters = (plan as any).filters || {};
  const stopConditions = (plan as any).stop_conditions || {};

  return (
    <div className="mt-4 border border-foreground/8 bg-muted/20 p-4 space-y-3">
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="w-4 h-4 text-brutal-accent" />
        <span className="text-xs font-bold uppercase tracking-wider text-foreground">
          Plan de recherche
        </span>
      </div>

      {(plan as any).summary && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {(plan as any).summary}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
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
  );
}

function PlanPill({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-foreground/8 bg-background text-xs text-foreground">
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <span>{label}</span>
    </div>
  );
}
