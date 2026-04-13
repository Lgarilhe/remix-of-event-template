import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { Job } from '@/types/jobs';
// filterThinking utilities used by display components directly

export interface AgentMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'status';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentConversation {
  id: string;
  organization_id: string;
  created_by: string;
  job_id: string | null;
  job_title: string | null;
  project_id: string | null;
  status: string;
  search_config: Record<string, unknown>;
  results_summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ThinkingPhase {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done';
}

export const useAgentChat = (conversationId: string | null) => {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const [thinkingPhases, setThinkingPhases] = useState<ThinkingPhase[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const isStreamingRef = useRef(false);
  const [conversation, setConversation] = useState<AgentConversation | null>(null);
  const { organizationId } = useOrganization();
  const abortRef = useRef<AbortController | null>(null);

  // Load conversation + messages
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setConversation(null);
      return;
    }

    const load = async () => {
      setLoading(true);
      const [convRes, msgRes] = await Promise.all([
        supabase.from('agent_conversations').select('*').eq('id', conversationId).single(),
        supabase.from('agent_messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true }),
      ]);
      if (convRes.data) setConversation(convRes.data as unknown as AgentConversation);
      if (msgRes.data) setMessages(msgRes.data as unknown as AgentMessage[]);
      setLoading(false);
    };
    load();
  }, [conversationId]);

  // Realtime subscription for messages + conversation status when search is running
  useEffect(() => {
    if (!conversationId) return;

    // Subscribe to new agent_messages for this conversation
    const messagesChannel = supabase
      .channel(`agent_messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'agent_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          // Skip Realtime inserts while streaming — the DB reload after stream
          // is the single source of truth, preventing duplicates.
          if (isStreamingRef.current) return;
          const newMsg = payload.new as unknown as AgentMessage;
          setMessages(prev => {
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .subscribe();

    // Subscribe to conversation status changes (running → completed/error)
    const convChannel = supabase
      .channel(`agent_conv:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'agent_conversations',
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          setConversation(prev => prev ? {
            ...prev,
            status: updated.status,
            results_summary: updated.results_summary ?? prev.results_summary,
          } : null);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(convChannel);
    };
  }, [conversationId]);

  // ── Phase detection — maps thinking keywords to clean user-facing labels ──
  const AGENT_PHASES: Array<{ id: string; label: string; triggers: RegExp }> = [
    {
      id: 'analyze',
      label: 'Analyse de la fiche de poste',
      triggers: /fiche de poste|job description|résumé du poste|poste.*demande|le client|profil recherché|mission|cahier des charges/i,
    },
    {
      id: 'titles',
      label: 'Définition des titres cibles',
      triggers: /titres?\s*(de poste|cible|à cibler)|engineering manager|lead|architecte|role.*keywords|variantes?\s*(fr|en)/i,
    },
    {
      id: 'filters',
      label: 'Construction des filtres LinkedIn',
      triggers: /keywords|boolean|filter|filtre|company_keywords|location_keywords|skills_filter|seniority|exclusion|NOT\s*\(/i,
    },
    {
      id: 'location',
      label: 'Paramétrage de la localisation',
      triggers: /localisation|location|géo|remote|hybrid|rayon|km|miles|île-de-france|paris|lyon/i,
    },
    {
      id: 'experience',
      label: 'Calibrage de l\'expérience',
      triggers: /expérience|experience|senior|junior|années?\s*d'xp|tenure|calculated_experience/i,
    },
    {
      id: 'companies',
      label: 'Ciblage des entreprises',
      triggers: /entreprise|company|GAFAM|startup|scale-?up|exclure.*client|company_keywords/i,
    },
    {
      id: 'plan',
      label: 'Finalisation du plan de recherche',
      triggers: /plan\s*(de recherche|final)|search_plan|récapitul|résumé.*plan|lancer.*recherche/i,
    },
    {
      id: 'scoring',
      label: 'Préparation du scoring',
      triggers: /scoring|score|évaluation|must.have|nice.to.have|critère/i,
    },
  ];

  const parseThinkingPhases = useCallback((thinking: string): ThinkingPhase[] => {
    if (!thinking || thinking.length < 20) return [];

    const phases: ThinkingPhase[] = AGENT_PHASES.map(p => ({
      id: p.id,
      label: p.label,
      status: 'pending' as const,
    }));

    // Scan thinking content to detect which phases have been triggered
    let lastTriggeredIndex = -1;
    for (let i = 0; i < AGENT_PHASES.length; i++) {
      if (AGENT_PHASES[i].triggers.test(thinking)) {
        phases[i].status = 'done';
        lastTriggeredIndex = i;
      }
    }

    // The last triggered phase is "active" (still being worked on)
    if (lastTriggeredIndex >= 0) {
      phases[lastTriggeredIndex].status = 'active';
    }

    // Only return phases that are triggered or the next pending one
    const firstPendingAfterDone = phases.findIndex(
      (p, i) => p.status === 'pending' && i > lastTriggeredIndex
    );
    const visibleEnd = firstPendingAfterDone >= 0
      ? Math.min(firstPendingAfterDone + 1, phases.length)
      : phases.length;

    return phases.slice(0, visibleEnd);
  }, []);

  // Send message with streaming
  const sendMessage = useCallback(async (content: string, jobContext?: Job | null, overrideConversationId?: string, modelOverride?: string | null, contextMode?: 'brief' | 'process' | 'sourcing' | 'outreach' | null, briefContext?: Record<string, unknown> | null, projectId?: string | null, accountId?: string | null) => {
    const convId = overrideConversationId || conversationId;
    if (!convId || !content.trim() || sending) return;

    isStreamingRef.current = true;
    setSending(true);
    setStreamingContent('');
    setThinkingContent('');
    setThinkingPhases([]);
    setIsThinking(false);

    // Optimistic user message
    const tempMsg: AgentMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: convId,
      role: 'user',
      content,
      metadata: {},
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempMsg]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const abortController = new AbortController();
      abortRef.current = abortController;

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search-agent-chat`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          conversation_id: convId,
          message: content,
          job_context: jobContext || undefined,
          _ai_model: modelOverride || undefined,
          _ai_action: contextMode === 'brief' ? 'agent_search_calibration' : 'agent_search_calibration',
          context_mode: contextMode || undefined,
          brief_context: briefContext || undefined,
          project_id: projectId || undefined,
          account_id: accountId || undefined,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error('Stream failed');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let accumulatedThinking = '';
      let serverConfirmedAction: Record<string, unknown> | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);

              // Server-side confirmation event (emitted after DB save)
              if (parsed.done === true) {
                if (parsed.agent_action) {
                  serverConfirmedAction = parsed.agent_action as Record<string, unknown>;
                }
                continue;
              }
              
              // Handle thinking content
              const thinkingText = parsed.choices?.[0]?.delta?.thinking;
              if (thinkingText) {
                accumulatedThinking += thinkingText;
                setThinkingContent(accumulatedThinking);
                setThinkingPhases(parseThinkingPhases(accumulatedThinking));
                setIsThinking(true);
                continue;
              }
              
              const text = parsed.choices?.[0]?.delta?.content;
              if (text) {
                // First content token = thinking is done
                if (isThinking || accumulatedThinking) {
                  setIsThinking(false);
                }
                accumulated += text;
                setStreamingContent(accumulated);
              }
            } catch {}
          }
        }
      }

      setStreamingContent('');
      setIsThinking(false);

      // Reload canonical messages from DB — the server already saved
      // both user + assistant messages, and Realtime may have pushed them too.
      // This single reload eliminates all duplicate/race issues.
      const { data: freshMessages } = await supabase
        .from('agent_messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });
      if (freshMessages) {
        setMessages(freshMessages as unknown as AgentMessage[]);
      }

      // Handle search trigger from accumulated content
      if (accumulated) {
        if (serverConfirmedAction && (serverConfirmedAction as any)?.action === 'start_search') {
          setConversation(prev => prev ? { ...prev, status: 'running' } : null);
          triggerSearch(convId);
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        toast.info('Streaming interrompu', { description: 'La réponse a été coupée. Le message partiel a été sauvegardé côté serveur.' });
      } else {
        console.error('[useAgentChat] Error:', err);
        toast.error('Erreur de communication', { description: 'Impossible de contacter l\'assistant. Réessayez.' });
      }
    } finally {
      isStreamingRef.current = false;
      setSending(false);
      setThinkingContent('');
      setThinkingPhases([]);
      abortRef.current = null;
    }
  }, [conversationId, sending, parseThinkingPhases]);

  const triggerSearch = useCallback(async (convId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-agent-search`;
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ conversation_id: convId }),
      }).catch(err => console.error('[useAgentChat] Search trigger failed:', err));
    } catch (err) {
      console.error('[useAgentChat] triggerSearch error:', err);
    }
  }, []);

  const createConversation = useCallback(async (job?: Job | null): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !organizationId) return null;

    const { data, error } = await supabase
      .from('agent_conversations')
      .insert({
        organization_id: organizationId,
        created_by: user.id,
        job_id: job?.id || null,
        job_title: job?.title || null,
        status: 'calibrating',
      })
      .select()
      .single();

    if (error || !data) {
      console.error('Failed to create conversation:', error);
      return null;
    }

    setConversation(data as unknown as AgentConversation);
    setMessages([]);
    return data.id;
  }, [organizationId]);

  const listConversations = useCallback(async (): Promise<AgentConversation[]> => {
    if (!organizationId) return [];
    const { data } = await supabase
      .from('agent_conversations')
      .select('*')
      .eq('organization_id', organizationId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(20);
    return (data || []) as unknown as AgentConversation[];
  }, [organizationId]);

  return {
    messages,
    loading,
    sending,
    streamingContent,
    thinkingContent,
    thinkingPhases,
    isThinking,
    conversation,
    sendMessage,
    createConversation,
    listConversations,
  };
};
