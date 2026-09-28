/**
 * Agents — page « Assistant » (/agents) : toutes les conversations avec
 * l'assistant. Même nom que l'onglet de la barre latérale et l'entrée de la
 * palette ; plus d'« agents » ni de « Nouvel agent » (revue design E-35).
 *
 * Mes conversations seulement, comme l'historique du tiroir. « Nouvelle
 * conversation » ouvre le tiroir de l'assistant. Une lecture en échec
 * s'affiche comme une erreur avec « Réessayer », jamais comme un vide.
 */

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, MessageSquare, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useAgent } from '@/contexts/AgentContext';
import { useAuthReady } from '@/hooks/useAuthReady';
import { SEOHead } from '@/components/SEOHead';
import { EmptyState, ErrorState, PageHeader, PageLayout, Section } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { agentConversationStatus, agentResultsSummary } from '@/lib/agentConversations';
import { timeAgo } from '@/lib/relativeTime';

interface ConversationRow {
  id: string;
  status: string | null;
  title: string | null;
  job_title: string | null;
  search_config: { summary?: string } | null;
  results_summary: unknown;
  updated_at: string | null;
}

const AgentsPage = () => {
  const { organizationId } = useOrganization();
  const { openConversation, startNewConversation } = useAgent();
  const { user } = useAuthReady();
  const userId = user?.id;

  const {
    data: conversations = [],
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['agent-conversations', organizationId, userId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('agent_conversations')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('created_by', userId)
        .is('archived_at', null)
        .order('updated_at', { ascending: false }) as any);
      if (error) throw error;
      return (data || []) as ConversationRow[];
    },
    enabled: !!organizationId && !!userId,
    staleTime: 30_000,
  });

  const running = useMemo(() => conversations.filter((c) => c.status === 'running'), [conversations]);
  const others = useMemo(() => conversations.filter((c) => c.status !== 'running'), [conversations]);

  const newConversation = (
    <Button type="button" variant="primary" onClick={startNewConversation}>
      <Plus aria-hidden="true" />
      Nouvelle conversation
    </Button>
  );

  return (
    <PageLayout maxWidth="lg">
      <SEOHead title="Assistant | Konekt" description="Vos conversations avec l'assistant" />

      <PageHeader
        title="Assistant"
        subtitle="Toutes vos conversations avec l'assistant, et les recherches qu'il mène pour vous."
        actions={newConversation}
      />

      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Chargement des conversations">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Impossible de charger vos conversations"
          description="Vérifiez votre connexion, puis réessayez. Vos conversations ne sont pas perdues."
          detail={error instanceof Error ? error.message : null}
          onRetry={() => refetch()}
          retrying={isRefetching}
        />
      ) : conversations.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Aucune conversation"
          description="Posez une question à l'assistant ou confiez-lui une recherche."
          action={newConversation}
        />
      ) : (
        <div className="space-y-4">
          {running.length > 0 && (
            <Section headingLevel={2} title="En cours" subtitle={String(running.length)}>
              <ul className="divide-y divide-border">
                {running.map((c) => (
                  <ConversationRowItem key={c.id} conversation={c} onOpen={openConversation} />
                ))}
              </ul>
            </Section>
          )}
          {others.length > 0 && (
            <Section headingLevel={2} title="Historique" subtitle={String(others.length)}>
              <ul className="divide-y divide-border">
                {others.map((c) => (
                  <ConversationRowItem key={c.id} conversation={c} onOpen={openConversation} />
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </PageLayout>
  );
};

function ConversationRowItem({
  conversation,
  onOpen,
}: {
  conversation: ConversationRow;
  onOpen: (conversationId: string) => void;
}) {
  const status = agentConversationStatus(conversation.status);
  const title = conversation.title || conversation.job_title || conversation.search_config?.summary || 'Conversation sans titre';
  const results = agentResultsSummary(conversation.results_summary);
  const updated = timeAgo(conversation.updated_at);

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(conversation.id)}
        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{title}</span>
            <Badge variant={status.tone} className="shrink-0">
              {status.label}
            </Badge>
          </span>
          {(results || updated) && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {[results, updated].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />
      </button>
    </li>
  );
}

export default AgentsPage;
