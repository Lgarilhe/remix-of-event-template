import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Bot, User, CheckCircle2, MapPin, Calendar, Target } from 'lucide-react';
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

  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="h-6 w-6 bg-foreground text-background flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="w-3 h-3" />
        </div>
      )}

      <div className={cn(
        "max-w-[85%] text-[11px] leading-relaxed",
        isUser
          ? "bg-foreground text-background px-3 py-2"
          : "border-2 border-foreground/10 px-3 py-2"
      )}>
        {cleanContent && (
          <div className="prose prose-xs prose-neutral dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0 [&_h1]:text-xs [&_h2]:text-[11px] [&_h3]:text-[11px] [&_h1]:my-1.5 [&_h2]:my-1.5 [&_h3]:my-1 [&_strong]:font-bold text-[11px]">
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
        )}

        {searchPlan && <SearchPlanCard plan={searchPlan} />}

        {isStreaming && (
          <span className="inline-block w-1.5 h-3 bg-brutal-accent animate-pulse ml-0.5" />
        )}
      </div>

      {isUser && (
        <div className="h-6 w-6 border-2 border-foreground/20 flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-3 h-3 text-muted-foreground" />
        </div>
      )}
    </div>
  );
};

function SearchPlanCard({ plan }: { plan: Record<string, unknown> }) {
  const filters = (plan as any).filters || {};
  const stopConditions = (plan as any).stop_conditions || {};

  return (
    <div className="mt-2 border-2 border-foreground bg-background p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 bg-foreground text-background flex items-center justify-center">
          <CheckCircle2 className="w-3 h-3" />
        </div>
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
    <div className="flex items-center gap-1 px-2 py-1 border border-foreground/20 bg-muted/30 text-[9px] font-medium text-foreground">
      <Icon className="w-2.5 h-2.5 text-muted-foreground" />
      {label}
    </div>
  );
}
