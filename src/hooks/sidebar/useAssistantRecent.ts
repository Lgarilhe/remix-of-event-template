/**
 * Conversations récentes de l'onglet Assistant (§5.1). Lecture lancée
 * seulement quand le panneau Assistant est monté (seul appelant), rafraîchie
 * par le canal temps réel de la barre (clé ['sidebar', 'assistant-recent']).
 *
 * Aucune exclusion par statut : le panneau retire, par identifiant, les
 * conversations déjà affichées dans À valider et En cours. Un plan ancien ou
 * une recherche bloquée, sortis de ces sections, restent ainsi visibles ici.
 */
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { queryState, type SectionState } from '@/lib/sidebarSection';
import type { AgentConversationItem } from './useAgentSignals';

export const assistantRecentQueryKey = (userId: string | null, organizationId: string | null) =>
  ['sidebar', 'assistant-recent', userId, organizationId] as const;

export interface AssistantRecent {
  data: AgentConversationItem[] | undefined;
  status: SectionState;
  stale: boolean;
  retry: () => void;
}

export function useAssistantRecent(): AssistantRecent {
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: assistantRecentQueryKey(userId, organizationId),
    queryFn: async (): Promise<AgentConversationItem[]> => {
      if (!userId || !organizationId) throw new Error('Organisation inconnue');
      const { data, error } = await supabase
        .from('agent_conversations')
        .select('id, title, job_title, project_id, status, updated_at')
        .eq('created_by', userId)
        .eq('organization_id', organizationId)
        .is('archived_at', null)
        .order('updated_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!userId && !!organizationId,
    staleTime: 60_000,
    retry: 1,
  });

  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  const { state, stale } = queryState({ data: query.data, isError: query.isError, fetchStatus: query.fetchStatus });
  return { data: query.data, status: state, stale, retry };
}
