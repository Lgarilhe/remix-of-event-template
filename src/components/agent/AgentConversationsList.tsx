import React, { useEffect, useState } from 'react';
import { Bot, Loader2, ChevronRight } from 'lucide-react';
import { AgentConversation } from '@/hooks/useAgentChat';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface Props {
  onSelect: (conv: AgentConversation) => void;
  listConversations: () => Promise<AgentConversation[]>;
}

const statusMap: Record<string, { label: string; dot: string }> = {
  calibrating: { label: 'Calibration', dot: 'bg-muted-foreground' },
  plan_proposed: { label: 'Plan proposé', dot: 'bg-brutal-accent' },
  running: { label: 'En cours', dot: 'bg-brutal-accent' },
  completed: { label: 'Terminé', dot: 'bg-foreground' },
  paused: { label: 'En pause', dot: 'bg-muted-foreground' },
  failed: { label: 'Erreur', dot: 'bg-destructive' },
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
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
        <Bot className="w-8 h-8 opacity-15" />
        <div className="text-center">
          <p className="text-sm font-medium">Aucune conversation</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Sélectionnez un poste pour commencer</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-5 pt-4 pb-2">
        <p className="text-xs font-medium text-muted-foreground">
          Conversations récentes
        </p>
      </div>
      <div className="px-3">
        {conversations.map(conv => {
          const status = statusMap[conv.status] || { label: conv.status, dot: 'bg-muted-foreground' };
          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv)}
              className="w-full text-left px-3 py-3 hover:bg-muted/40 transition-colors group flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-foreground group-hover:text-foreground">
                  {conv.job_title || 'Conversation'}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", status.dot)} />
                  <span className="text-xs text-muted-foreground">{status.label}</span>
                  <span className="text-xs text-muted-foreground/40">·</span>
                  <span className="text-xs text-muted-foreground/50">
                    {formatDistanceToNow(parseISO(conv.updated_at), { addSuffix: true, locale: fr })}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
};
