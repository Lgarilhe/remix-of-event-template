import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Bot, User, CheckCircle2 } from 'lucide-react';
import { AgentMessage } from '@/hooks/useAgentChat';
import { cn } from '@/lib/utils';

interface AgentMessageBubbleProps {
  message: AgentMessage;
  isStreaming?: boolean;
}

export const AgentMessageBubble: React.FC<AgentMessageBubbleProps> = ({ message, isStreaming }) => {
  const isUser = message.role === 'user';
  const isStatus = message.role === 'status';

  // Clean content: remove [SEARCH_PLAN]...[/SEARCH_PLAN] and [AGENT_ACTION]...[/AGENT_ACTION] blocks
  const cleanContent = message.content
    .replace(/\[SEARCH_PLAN\][\s\S]*?\[\/SEARCH_PLAN\]/g, '')
    .replace(/\[AGENT_ACTION\][\s\S]*?\[\/AGENT_ACTION\]/g, '')
    .trim();

  const searchPlan = message.metadata?.search_plan as Record<string, unknown> | undefined;

  if (isStatus) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border border-foreground/10 text-[10px] text-muted-foreground">
        <span className="animate-pulse">●</span>
        <span>{cleanContent}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="h-5 w-5 bg-foreground text-background flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="w-2.5 h-2.5" />
        </div>
      )}

      <div className={cn(
        "max-w-[85%] text-xs leading-relaxed",
        isUser
          ? "bg-foreground text-background px-3 py-2"
          : "bg-muted/30 border border-foreground/10 px-3 py-2"
      )}>
        {cleanContent && (
          <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_li]:my-0.5 text-xs">
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
        )}

        {/* Search plan card */}
        {searchPlan && (
          <div className="mt-2 border border-foreground/20 bg-background p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <CheckCircle2 className="w-3 h-3 text-green-600" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Plan de recherche</span>
            </div>
            <p className="text-[10px] text-muted-foreground mb-2">
              {(searchPlan as any).summary || 'Plan généré'}
            </p>
            <div className="space-y-1 text-[9px]">
              {(searchPlan as any).filters?.location_keywords && (
                <div><span className="font-medium">📍</span> {((searchPlan as any).filters.location_keywords || []).join(', ')}</div>
              )}
              {(searchPlan as any).filters?.calculated_experience_min != null && (
                <div><span className="font-medium">📅</span> {(searchPlan as any).filters.calculated_experience_min}-{(searchPlan as any).filters.calculated_experience_max} ans</div>
              )}
              {(searchPlan as any).stop_conditions?.target_go_profiles && (
                <div><span className="font-medium">🎯</span> Objectif: {(searchPlan as any).stop_conditions.target_go_profiles} profils Go</div>
              )}
            </div>
            <p className="text-[9px] text-muted-foreground mt-2 italic">
              Répondez "go" pour lancer la recherche
            </p>
          </div>
        )}

        {isStreaming && (
          <span className="inline-block w-1.5 h-3 bg-foreground/60 animate-pulse ml-0.5" />
        )}
      </div>

      {isUser && (
        <div className="h-5 w-5 bg-muted border border-foreground/20 flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-2.5 h-2.5" />
        </div>
      )}
    </div>
  );
};
