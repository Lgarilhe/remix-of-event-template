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
    <div className={cn("flex gap-1.5", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="h-4 w-4 bg-foreground text-background flex items-center justify-center shrink-0 mt-1 rounded-sm">
          <Bot className="w-2 h-2" />
        </div>
      )}

      <div className={cn(
        "max-w-[88%] text-[11px] leading-[1.5]",
        isUser
          ? "bg-foreground text-background px-2.5 py-1.5"
          : "bg-muted/30 border border-foreground/10 px-2.5 py-1.5"
      )}>
        {cleanContent && (
          <div className="prose prose-xs prose-neutral dark:prose-invert max-w-none [&_p]:my-0.5 [&_ul]:my-0.5 [&_li]:my-0 [&_h1]:text-xs [&_h2]:text-[11px] [&_h3]:text-[11px] [&_h1]:my-1 [&_h2]:my-1 [&_h3]:my-0.5 [&_strong]:font-semibold text-[11px]">
            <ReactMarkdown>{cleanContent}</ReactMarkdown>
          </div>
        )}

        {/* Search plan card */}
        {searchPlan && (
          <div className="mt-1.5 border border-foreground/20 bg-background p-2">
            <div className="flex items-center gap-1 mb-1">
              <CheckCircle2 className="w-2.5 h-2.5 text-green-600" />
              <span className="text-[9px] font-bold uppercase tracking-wider">Plan de recherche</span>
            </div>
            <p className="text-[9px] text-muted-foreground mb-1">
              {(searchPlan as any).summary || 'Plan généré'}
            </p>
            <div className="space-y-0.5 text-[9px]">
              {(searchPlan as any).filters?.location_keywords && (
                <div>📍 {((searchPlan as any).filters.location_keywords || []).join(', ')}</div>
              )}
              {(searchPlan as any).filters?.calculated_experience_min != null && (
                <div>📅 {(searchPlan as any).filters.calculated_experience_min}-{(searchPlan as any).filters.calculated_experience_max} ans</div>
              )}
              {(searchPlan as any).stop_conditions?.target_go_profiles && (
                <div>🎯 {(searchPlan as any).stop_conditions.target_go_profiles} profils Go</div>
              )}
            </div>
            <p className="text-[8px] text-muted-foreground mt-1 italic">
              Répondez "go" pour lancer
            </p>
          </div>
        )}

        {isStreaming && (
          <span className="inline-block w-1 h-2.5 bg-foreground/60 animate-pulse ml-0.5" />
        )}
      </div>

      {isUser && (
        <div className="h-4 w-4 bg-muted border border-foreground/20 flex items-center justify-center shrink-0 mt-1 rounded-sm">
          <User className="w-2 h-2" />
        </div>
      )}
    </div>
  );
};
