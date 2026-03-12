import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { CheckCircle2, MapPin, Calendar, Target, Brain, ChevronDown } from 'lucide-react';
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
      <div className="flex items-center gap-3 px-3 py-2 border border-foreground/10 bg-muted/30 text-xs text-muted-foreground">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brutal-accent/50" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brutal-accent" />
        </span>
        <span className="uppercase tracking-wider font-medium">{cleanContent}</span>
      </div>
    );
  }

  // ── User message ──
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] px-3 py-2.5 text-sm leading-relaxed bg-foreground text-background border-2 border-foreground">
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
      <div className="flex-1 min-w-0 text-sm leading-relaxed">
        {/* Thinking toggle for saved messages */}
        {thinking && <ThinkingToggle thinking={thinking} />}

        {cleanContent && (
          <div className="px-3 py-2.5 border border-foreground/10 bg-background">
            <div className="prose prose-sm max-w-none [&_p]:my-1.5 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-semibold [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:mt-2 [&_h3]:mb-1 [&_hr]:my-3 [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_li]:marker:text-foreground text-sm text-foreground/80 [&_strong]:text-foreground">
              <ReactMarkdown>{cleanContent}</ReactMarkdown>
            </div>
          </div>
        )}

        {searchPlan && <SearchPlanCard plan={searchPlan} />}

        {isStreaming && (
          <span className="inline-block w-0.5 h-4 bg-foreground animate-pulse ml-3 mt-1" />
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
        <div className={cn(
          "h-5 w-5 flex items-center justify-center border transition-colors",
          expanded ? "border-foreground bg-foreground text-background" : "border-foreground/20 text-muted-foreground"
        )}>
          <Brain className="w-2.5 h-2.5" />
        </div>
        <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
          {expanded ? 'Masquer' : 'Voir'} la réflexion ({displayLines.length} étapes)
        </span>
        <ChevronDown className={cn(
          "w-3 h-3 transition-transform text-muted-foreground",
          expanded && "rotate-180"
        )} />
      </button>

      {expanded && (
        <div className="mt-2 ml-1 pl-3 space-y-1 p-3 border-l-2 border-foreground/20 bg-muted/30">
          {displayLines.map((line, i) => (
            <div key={i} className="flex items-start gap-2 relative">
              <span className="absolute left-[-14.5px] top-[7px] h-1.5 w-1.5 bg-foreground/20 shrink-0" />
              <p className="text-[11px] leading-relaxed font-mono text-muted-foreground">
                {line}
              </p>
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
    <div className="mt-3 p-3 space-y-3 border-2 border-foreground">
      <div className="flex items-center gap-2.5">
        <CheckCircle2 className="w-4 h-4 text-foreground" />
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-foreground">
          Plan de recherche
        </span>
      </div>

      {(plan as any).summary && (
        <p className="text-sm leading-relaxed text-muted-foreground">
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
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border border-foreground/30 bg-muted text-foreground">
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </div>
  );
}
