import React, { useEffect, useState } from 'react';
import { Bot, MessageSquare, Loader2, Settings2, CheckCircle2, Zap, PauseCircle, XCircle, Clock } from 'lucide-react';
import { AgentConversation } from '@/hooks/useAgentChat';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface Props {
  onSelect: (conv: AgentConversation) => void;
  listConversations: () => Promise<AgentConversation[]>;
}

const statusConfig: Record<string, { label: string; icon: React.ElementType; accent: boolean }> = {
  calibrating: { label: 'Calibration', icon: Settings2, accent: false },
  plan_proposed: { label: 'Plan proposé', icon: CheckCircle2, accent: true },
  running: { label: 'En cours', icon: Zap, accent: true },
  completed: { label: 'Terminé', icon: CheckCircle2, accent: false },
  paused: { label: 'En pause', icon: PauseCircle, accent: false },
  failed: { label: 'Erreur', icon: XCircle, accent: false },
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
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <div className="h-12 w-12 border border-foreground/10 flex items-center justify-center">
          <Bot className="w-6 h-6 opacity-20" />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-wider">Aucune conversation</p>
        <p className="text-[9px] opacity-60">Sélectionnez un poste pour lancer un agent</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto divide-y divide-foreground/5">
      {conversations.map(conv => {
        const cfg = statusConfig[conv.status] || { label: conv.status, icon: Settings2, accent: false };
        const Icon = cfg.icon;
        return (
          <button
            key={conv.id}
            onClick={() => onSelect(conv)}
            className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 border-2 border-foreground/10 group-hover:border-foreground/30 flex items-center justify-center shrink-0 transition-colors">
                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider truncate text-foreground">
                  {conv.job_title || 'Conversation'}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <div className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 border text-[8px] font-bold uppercase tracking-wider",
                    cfg.accent
                      ? "border-brutal-accent/30 text-brutal-accent bg-brutal-accent/5"
                      : "border-foreground/10 text-muted-foreground"
                  )}>
                    <Icon className="w-2.5 h-2.5" />
                    {cfg.label}
                  </div>
                  <span className="text-[9px] text-muted-foreground/50 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {formatDistanceToNow(parseISO(conv.updated_at), { addSuffix: true, locale: fr })}
                  </span>
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};
