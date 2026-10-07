import { useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import type { AgentMemory, AgentMemoryAutomation, AgentMemoryAutomationMode, AgentMemoryContext, AgentMemoryDraft, AgentMemoryProposal } from '@/types/agentMemory';

const memoryKey = 'agent-memory';

function readMemoryAutomation(data: unknown): AgentMemoryAutomation {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Le mode de mémoire n’a pas pu être chargé.');
  const value = data as Record<string, unknown>;
  if ((value.mode !== 'manual' && value.mode !== 'automatic') || typeof value.version !== 'number'
    || typeof value.can_suggest !== 'boolean' || typeof value.calibration_count !== 'number'
    || typeof value.suggestion_dismissed !== 'boolean') throw new Error('Le mode de mémoire n’a pas pu être chargé.');
  return value as unknown as AgentMemoryAutomation;
}

/** The setting belongs to one user in one organization; it never falls back to another space. */
export function useAgentMemoryAutomation(enabled = true) {
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const scopeRef = useRef({ organizationId, userId });
  scopeRef.current = { organizationId, userId };
  const inFlight = useRef(false);
  const key = [memoryKey, 'automation', organizationId, userId];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (!organizationId || !userId) throw new Error('Reconnectez-vous pour consulter le mode de mémoire.');
      const { data, error } = await supabase.rpc('get_agent_memory_automation', { p_organization_id: organizationId });
      if (error) { console.error('[agent-memory-automation] read', error); throw new Error('Le mode de mémoire n’a pas pu être chargé.'); }
      return readMemoryAutomation(data);
    },
    enabled: enabled && Boolean(organizationId && userId),
    staleTime: 10_000,
    refetchInterval: enabled ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
  const mutation = useMutation({
    mutationFn: async ({ organizationId: targetOrganizationId, userId: targetUserId, mode, expectedVersion, dismissSuggestion }: {
      organizationId: string; userId: string; mode: AgentMemoryAutomationMode; expectedVersion: number; dismissSuggestion: boolean;
    }) => {
      if (scopeRef.current.organizationId !== targetOrganizationId || scopeRef.current.userId !== targetUserId) {
        throw new Error('L’espace actif a changé. Rouvrez les réglages de mémoire.');
      }
      const { data, error } = await supabase.rpc('set_agent_memory_automation', {
        p_organization_id: targetOrganizationId,
        p_expected_version: expectedVersion,
        p_mode: mode,
        p_dismiss_suggestion: dismissSuggestion,
      });
      if (error) {
        console.error('[agent-memory-automation] update', error);
        if (error.code === '40001') throw new Error('Le mode de mémoire a changé. Rechargez-le avant de réessayer.');
        throw new Error('Le mode de mémoire n’a pas pu être enregistré. Réessayez.');
      }
      return readMemoryAutomation(data);
    },
    onSuccess: (data, variables) => {
      const targetKey = [memoryKey, 'automation', variables.organizationId, variables.userId];
      queryClient.setQueryData(targetKey, data);
      void queryClient.invalidateQueries({ queryKey: targetKey, exact: true });
    },
  });
  const setMode = async (mode: AgentMemoryAutomationMode, expectedVersion: number, dismissSuggestion = false) => {
    if (!organizationId || !userId) throw new Error('Reconnectez-vous pour modifier le mode de mémoire.');
    if (inFlight.current) throw new Error('Cette action est déjà en cours.');
    inFlight.current = true;
    try { return await mutation.mutateAsync({ organizationId, userId, mode, expectedVersion, dismissSuggestion }); }
    finally { inFlight.current = false; }
  };
  return { ...query, setMode, isSaving: mutation.isPending };
}

function memoryError(error: { message?: string; code?: string; hint?: string } | null): Error {
  console.error('[agent-memory]', error);
  if (error?.code === '40001' || /version|conflict|changed|stale/i.test(`${error?.message ?? ''} ${error?.hint ?? ''}`)) {
    return new Error('Cette proposition a changé. Rechargez-la avant de confirmer.');
  }
  if (error?.code === '42501') return new Error('Vous n’avez pas les droits nécessaires pour ce niveau de mémoire.');
  return new Error('La mémoire n’a pas pu être enregistrée. Réessayez.');
}

export function useAgentMemoryContext(projectId: string | null, enabled = true) {
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  return useQuery({
    queryKey: [memoryKey, 'context', organizationId, user?.id, projectId],
    queryFn: async (): Promise<AgentMemoryContext> => {
      if (!organizationId) throw new Error('Organisation introuvable.');
      const { data, error } = await supabase.rpc('get_agent_memory_context', {
        p_organization_id: organizationId,
        p_project_id: projectId,
      });
      if (error) throw memoryError(error);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('La mémoire n’a pas pu être chargée.');
      const context = data as unknown as AgentMemoryContext;
      if (!Array.isArray(context.memories)) throw new Error('La mémoire n’a pas pu être chargée.');
      return context;
    },
    enabled: enabled && Boolean(organizationId && user),
    // Background additions must be visible as soon as the memory dialog reopens.
    staleTime: 0,
  });
}

/** Private proposals: either one conversation or the current mission/workspace. */
export function useAgentMemoryProposals(options: {
  conversationId?: string | null;
  projectId?: string | null;
  enabled?: boolean;
  conversationOnly?: boolean;
}) {
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const { conversationId = null, projectId = null, enabled = true, conversationOnly = false } = options;
  return useQuery({
    queryKey: [memoryKey, 'proposals', organizationId, user?.id, conversationId, projectId, conversationOnly],
    queryFn: async (): Promise<AgentMemoryProposal[]> => {
      if (!organizationId || !user) return [];
      let query = supabase.from('agent_memory_proposals').select('*')
        .eq('organization_id', organizationId).eq('created_by', user.id).eq('status', 'proposed');
      if (conversationId) query = query.eq('source_conversation_id', conversationId);
      else if (projectId) query = query.eq('project_id', projectId);
      else query = query.is('project_id', null);
      const { data, error } = await query.order('created_at', { ascending: false }).limit(30);
      if (error) throw memoryError(error);
      return (data ?? []) as AgentMemoryProposal[];
    },
    enabled: enabled && Boolean(organizationId && user) && (!conversationOnly || Boolean(conversationId)),
    // The extraction runs after the assistant response, independently of the stream.
    refetchInterval: enabled ? 15_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
  });
}

export function useAgentMemoryActions() {
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const queryClient = useQueryClient();
  const inFlight = useRef(new Set<string>());
  const mutation = useMutation({
    mutationFn: async (operation: () => Promise<unknown>) => operation(),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: [memoryKey] }); },
  });

  const run = useCallback(async (key: string, operation: () => Promise<unknown>) => {
    if (inFlight.current.has(key)) throw new Error('Cette action est déjà en cours.');
    inFlight.current.add(key);
    try { return await mutation.mutateAsync(operation); }
    finally { inFlight.current.delete(key); }
  }, [mutation]);

  const approve = useCallback(async (proposal: AgentMemoryProposal, draft: AgentMemoryDraft) => {
    return run(proposal.id, async () => {
      const { data, error } = await supabase.rpc('approve_agent_memory', {
        p_proposal_id: proposal.id,
        p_expected_version: proposal.version,
        p_content: draft.content.trim(),
        p_scope: draft.scope,
        p_kind: draft.kind,
        p_effects: draft.effects,
      });
      if (error) throw memoryError(error);
      if (!data) throw new Error('La mémoire n’a pas été confirmée. Rechargez les propositions.');
      return data;
    });
  }, [run]);

  const dismiss = useCallback(async (proposal: AgentMemoryProposal) => {
    return run(proposal.id, async () => {
      const { data, error } = await supabase.rpc('dismiss_agent_memory_proposal', {
        p_proposal_id: proposal.id,
        p_expected_version: proposal.version,
      });
      if (error) throw memoryError(error);
      if (!data) throw new Error('La proposition n’a pas été ignorée. Rechargez les propositions.');
      return data;
    });
  }, [run]);

  const archive = useCallback(async (memory: AgentMemory) => {
    return run(memory.id, async () => {
      const { data, error } = await supabase.rpc('archive_agent_memory', {
        p_memory_id: memory.id,
        p_expected_version: memory.version,
      });
      if (error) throw memoryError(error);
      if (!data) throw new Error('La mémoire n’a pas été désactivée. Rechargez la liste.');
      return data;
    });
  }, [run]);

  const createProposal = useCallback(async (draft: AgentMemoryDraft, projectId: string | null) => {
    return run('create', async () => {
      if (!organizationId || !user) throw new Error('Reconnectez-vous pour proposer une mémoire.');
      const { data, error } = await supabase.from('agent_memory_proposals').insert({
        organization_id: organizationId,
        created_by: user.id,
        project_id: projectId,
        content: draft.content.trim(),
        scope: draft.scope,
        kind: draft.kind,
        effects: draft.effects,
        source_excerpt: 'Proposition ajoutée manuellement.',
      }).select('*').single();
      if (error) throw memoryError(error);
      if (!data) throw new Error('La proposition n’a pas été enregistrée.');
      return data;
    }) as Promise<AgentMemoryProposal>;
  }, [organizationId, user, run]);

  return { approve, dismiss, archive, createProposal, isPending: mutation.isPending };
}
