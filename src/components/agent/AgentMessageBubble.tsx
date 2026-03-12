import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Bot, CheckCircle2, MapPin, Calendar, Target } from 'lucide-react';
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

  const cleanContent = message.content
    .replace(/\[SEARCH_PLAN\][\s\S]*?\[\/SEARCH_PLAN\]/g, '')
    .replace(/\[AGENT_ACTION\][\s\S]*?\[\/AGENT_ACTION\]/g, '')
    .replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/g, '')
    .trim();

  const searchPlan = message.metadata?.search_plan as Record<string, unknown> | undefined;

  if (isStatus) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 border-l-2 border-brutal-accent bg-brutal-accent/5 text-[10px] text-foreground/70">
        <span className="h-1.5 w-1.5 bg-brutal-accent rounded-full animate-pulse" />
        <span className="font-medium">{cleanContent}</span>
      </div>
    );
  }

  // ── User message: simple right-aligned, subtle bg ──
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-muted text-foreground px-3.5 py-2.5 text-[11px] leading-relaxed">
          <ReactMarkdown className="prose prose-xs prose-neutral dark:prose-invert max-w-none [&_p]:my-0.5 text-[11px]">
            {cleanContent}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  // ── Assistant message: left-aligned, no border, clean ──
  return (
    <div className="flex gap-2.5 justify-start">
      <div className="h-6 w-6 bg-foreground text-background flex items-center justify-center shrink-0 mt-1">
        <Bot className="w-3 h-3" />
      </div>

      <div className="max-w-[85%] text-[11px] leading-relaxed text-foreground">
        {cleanContent && (
          <div className="prose prose-xs prose-neutral dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_h1]:text-xs [&_h2]:text-[11px] [&_h3]:text-[11px] [&_h1]:my-1.5 [&_h2]:my-1.5 [&_h3]:my-1 [&_strong]:font-bold [&_hr]:my-2 [&_hr]:border-foreground/10 text-[11px]">
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
        )}

        {searchPlan && <SearchPlanCard plan={searchPlan} />}

        {isStreaming && (
          <span className="inline-block w-1.5 h-3 bg-brutal-accent animate-pulse ml-0.5 mt-1" />
        )}
      </div>
    </div>
  );
};

function SearchPlanCard({ plan }: { plan: Record<string, unknown> }) {
  const filters = (plan as any).filters || {};
  const stopConditions = (plan as any).stop_conditions || {};

  return (
    <div className="mt-3 border border-foreground/10 bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-brutal-accent" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground">
          Plan de recherche
        </span>
      </div>

      {(plan as any).summary && (
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {(plan as any).summary}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {filters.location_keywords?.length > 0 && (
          <PlanPill icon={MapPin} label={filters.location_keywords.join(', ')} />
        )}
        {filters.calculated_experience_min != null && (
          <PlanPill icon={Calendar} label={`${filters.calculated_experience_min}-${filters.calculated_experience_max} ans`} />
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
    <div className="flex items-center gap-1 px-2 py-1 border border-foreground/10 bg-background text-[9px] font-medium text-foreground">
      <Icon className="w-2.5 h-2.5 text-muted-foreground" />
      {label}
    </div>
  );
}
