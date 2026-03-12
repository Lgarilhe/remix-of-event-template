import React, { useEffect, useState } from 'react';
import { Bot, Loader2, ChevronRight, Target } from 'lucide-react';
import { AgentConversation } from '@/hooks/useAgentChat';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Props {
  onSelect: (conv: AgentConversation) => void;
  listConversations: () => Promise<AgentConversation[]>;
}

const statusMap: Record<string, { label: string; color: string; pulse?: boolean }> = {
  calibrating: { label: 'Calibration', color: 'rgba(255,255,255,0.4)' },
  plan_proposed: { label: 'Plan proposé', color: '#00f0ff' },
  running: { label: 'En cours', color: '#00f0ff', pulse: true },
  completed: { label: 'Terminé', color: '#34d399' },
  paused: { label: 'En pause', color: 'rgba(255,255,255,0.4)' },
  failed: { label: 'Erreur', color: '#f43f5e' },
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
        <Loader2 className="w-5 h-5 animate-spin text-[#00f0ff]/40" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Bot className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.08)' }} />
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>Aucune conversation</p>
          <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.2)' }}>Sélectionnez un poste pour commencer</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto agent-scrollbar">
      <div className="px-5 pt-4 pb-2">
        <p className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Conversations récentes
        </p>
      </div>
      <div className="px-3 space-y-1">
        {conversations.map(conv => {
          const status = statusMap[conv.status] || { label: conv.status, color: 'rgba(255,255,255,0.4)' };
          const goCount = (conv.results_summary as any)?.go_count;
          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv)}
              className="w-full text-left px-3 py-3 rounded-lg transition-all duration-200 group flex items-center gap-3"
              style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-white/80 group-hover:text-white transition-colors">
                  {conv.job_title || 'Conversation'}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  {/* Status pill */}
                  <div className="flex items-center gap-1.5">
                    {status.pulse ? (
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full" style={{ background: status.color, opacity: 0.5 }} />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: status.color }} />
                      </span>
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: status.color }} />
                    )}
                    <span className="text-xs" style={{ color: status.color }}>{status.label}</span>
                  </div>
                  {goCount != null && (
                    <>
                      <span style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
                      <div className="flex items-center gap-1">
                        <Target className="w-3 h-3 text-[#00f0ff]" />
                        <span className="text-xs text-[#00f0ff]">{goCount} Go</span>
                      </div>
                    </>
                  )}
                  <span style={{ color: 'rgba(255,255,255,0.1)' }}>·</span>
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
                    {formatDistanceToNow(parseISO(conv.updated_at), { addSuffix: true, locale: fr })}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0 transition-colors" style={{ color: 'rgba(255,255,255,0.15)' }} />
            </button>
          );
        })}
      </div>
    </div>
  );
};
