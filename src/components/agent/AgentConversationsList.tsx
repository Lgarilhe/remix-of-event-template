import React, { useEffect, useState } from 'react';
import { Bot, MessageSquare, Loader2 } from 'lucide-react';
import { AgentConversation } from '@/hooks/useAgentChat';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface Props {
  onSelect: (conv: AgentConversation) => void;
  listConversations: () => Promise<AgentConversation[]>;
}

const statusLabels: Record<string, { label: string; emoji: string }> = {
  calibrating: { label: 'Calibration', emoji: '⚙️' },
  plan_proposed: { label: 'Plan proposé', emoji: '📋' },
  running: { label: 'En cours', emoji: '🔄' },
  completed: { label: 'Terminé', emoji: '✅' },
  paused: { label: 'En pause', emoji: '⏸️' },
  failed: { label: 'Erreur', emoji: '❌' },
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
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Bot className="w-6 h-6 mb-2 opacity-30" />
        <p className="text-[10px] font-medium uppercase tracking-wider">Aucune conversation</p>
        <p className="text-[9px] mt-1">Sélectionnez un poste pour lancer un agent</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {conversations.map(conv => {
        const status = statusLabels[conv.status] || { label: conv.status, emoji: '❓' };
        return (
          <button
            key={conv.id}
            onClick={() => onSelect(conv)}
            className="w-full text-left px-3 py-2.5 border-b border-foreground/10 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start gap-2">
              <div className="h-6 w-6 bg-foreground text-background flex items-center justify-center shrink-0 mt-0.5">
                <MessageSquare className="w-3 h-3" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate text-foreground">
                  {conv.job_title || 'Conversation'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[9px]">{status.emoji}</span>
                  <span className="text-[9px] text-muted-foreground">{status.label}</span>
                  <span className="text-[9px] text-muted-foreground/60">
                    · {formatDistanceToNow(parseISO(conv.updated_at), { addSuffix: true, locale: fr })}
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
