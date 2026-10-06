import React, { useCallback, useEffect, useState } from 'react';
import { ChevronRight, MessageSquare } from 'lucide-react';
import { AgentConversation } from '@/types/agentChat';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/layout';
import { agentConversationStatus, agentResultsSummary } from '@/lib/agentConversations';
import { timeAgo } from '@/lib/relativeTime';

/**
 * Historique des conversations dans le tiroir de l'assistant. Une lecture en
 * échec s'affiche avec « Réessayer » au lieu d'un squelette sans fin (revue
 * design E-39) ; statuts partagés avec la page /agents.
 */

interface Props {
  onSelect: (conv: AgentConversation) => void;
  listConversations: () => Promise<AgentConversation[]>;
}

export const AgentConversationsList: React.FC<Props> = ({ onSelect, listConversations }) => {
  const [conversations, setConversations] = useState<AgentConversation[]>([]);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');

  const load = useCallback(() => {
    setState('loading');
    listConversations()
      .then((data) => {
        setConversations(data);
        setState('ready');
      })
      .catch((e) => {
        console.error('[AgentConversations] List failed:', e);
        setState('error');
      });
  }, [listConversations]);

  useEffect(() => {
    load();
  }, [load]);

  if (state === 'loading') {
    return (
      <div className="flex-1 space-y-2 px-4 py-4" role="status" aria-label="Chargement des conversations">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex-1 px-4 py-6">
        <ErrorState
          variant="compact"
          title="Impossible de charger vos conversations"
          description="Vérifiez votre connexion, puis réessayez."
          onRetry={load}
        />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex-1 px-4 py-6">
        <EmptyState
          variant="compact"
          icon={MessageSquare}
          title="Aucune conversation"
          description="Posez une question à l'assistant ou confiez-lui une recherche."
          className="border-0 bg-transparent"
        />
      </div>
    );
  }

  return (
    <div className="scrollbar-hide flex-1 overflow-y-auto">
      <h3 className="eyebrow px-5 pb-2 pt-5">Conversations récentes</h3>
      <ul className="px-2">
        {conversations.map((conv) => {
          const status = agentConversationStatus(conv.status);
          const results = agentResultsSummary(conv.results_summary);
          const updated = timeAgo(conv.updated_at);
          return (
            <li key={conv.id}>
              <button
                type="button"
                onClick={() => onSelect(conv)}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {conv.title || conv.job_title || 'Conversation sans titre'}
                  </span>
                  <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={status.tone} className="shrink-0">
                      {status.label}
                    </Badge>
                    <span className="truncate">{[results, updated].filter(Boolean).join(' · ')}</span>
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                  aria-hidden="true"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
