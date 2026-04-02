import React, { useEffect, useState } from 'react';
import { Bot, ChevronRight, Target } from 'lucide-react';
import { AgentConversation } from '@/hooks/useAgentChat';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface Props {
  onSelect: (conv: AgentConversation) => void;
  listConversations: () => Promise<AgentConversation[]>;
}

const statusMap: Record<string, { label: string; className: string; pulse?: boolean }> = {
  calibrating: { label: 'Calibration', className: 'text-muted-foreground' },
  plan_proposed: { label: 'Plan proposé', className: 'text-foreground' },
  running: { label: 'En cours', className: 'text-primary', pulse: true },
  completed: { label: 'Terminé', className: 'text-emerald-600' },
  paused: { label: 'En pause', className: 'text-muted-foreground' },
  failed: { label: 'Erreur', className: 'text-destructive' },
};

export const AgentConversationsList: React.FC<Props> = ({ onSelect, listConversations }) => {
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listConversations().then(data => {
      setConversations(data);
      setLoading(false);
    });
  }, [listConversations]);

  if (loading) {
    return (
      <div className="flex-1 px-4 py-4 space-y-2">
        <div className="h-3 w-32 bg-muted/50 mb-3" />
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="border border-border/8 p-3 flex items-center gap-3 animate-fade-in"
            style={{ animationDelay: `${i * 100}ms`, animationFillMode: 'backwards' }}
          >
            <div className="w-2 h-2 bg-foreground/10 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 bg-muted relative overflow-hidden" style={{ width: `${60 + i * 10}%` }}>
                <div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/[0.04] to-transparent animate-[shimmer_1.8s_infinite]"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              </div>
              <div className="h-2.5 bg-muted/60 relative overflow-hidden" style={{ width: `${40 + i * 8}%` }}>
                <div
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/[0.04] to-transparent animate-[shimmer_1.8s_infinite]"
                  style={{ animationDelay: `${i * 150 + 100}ms` }}
                />
              </div>
            </div>
            <div className="w-3 h-3 bg-accent/50 shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="h-10 w-10 border-2 border-border flex items-center justify-center">
          <Bot className="w-5 h-5 text-muted-foreground/30" />
        </div>
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">Aucune conversation</p>
          <p className="text-xs mt-1 text-muted-foreground/50">Sélectionnez un poste pour commencer</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-hide">
      <div className="px-5 pt-5 pb-2">
        <p className="text-xs font-display font-black uppercase tracking-[0.18em] text-foreground/50">
          Conversations récentes
        </p>
      </div>
      <div className="px-4 space-y-0">
        {conversations.map((conv, i) => {
          const status = statusMap[conv.status] || { label: conv.status, className: 'text-muted-foreground' };
          const goCount = (conv.results_summary as any)?.go_count;
          const isRunning = conv.status === 'running';
          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv)}
              className={cn(
                "w-full text-left px-3 py-3 transition-all duration-150 group flex items-center gap-3",
                "border-b border-border/8 hover:bg-foreground/[0.02]",
                isRunning && "border-l-2 border-l-primary",
                conv.status === 'completed' && "border-l-2 border-l-emerald-500/50",
              )}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-foreground/80 group-hover:text-foreground transition-colors">
                  {conv.job_title || 'Conversation'}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  {/* Status */}
                  <div className="flex items-center gap-1.5">
                    {status.pulse ? (
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/50" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                      </span>
                    ) : (
                      <span className="h-1.5 w-1.5 bg-foreground/20 shrink-0" />
                    )}
                    <span className={cn("text-xs uppercase tracking-[0.12em] font-bold", status.className)}>
                      {status.label}
                    </span>
                  </div>
                  {goCount != null && (
                    <>
                      <span className="text-foreground/10">·</span>
                      <div className="flex items-center gap-1">
                        <Target className="w-3 h-3 text-foreground" />
                        <span className="text-xs font-bold text-foreground">{goCount} Go</span>
                      </div>
                    </>
                  )}
                  <span className="text-foreground/10">·</span>
                  <span className="text-xs text-muted-foreground/60">
                    il y a {formatDistanceToNow(parseISO(conv.updated_at), { locale: fr })}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0 text-foreground/15 group-hover:text-foreground/40 transition-colors" />
            </button>
          );
        })}
      </div>
    </div>
  );
};
