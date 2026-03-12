import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { Job } from '@/types/jobs';

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

export interface ThinkingStep {
  label: string;
  status: 'pending' | 'active' | 'done';
}

export const useAgentChat = (conversationId: string | null) => {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const [isThinking, setIsThinking] = useState(false);
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
          const newMsg = payload.new as unknown as AgentMessage;
          setMessages(prev => {
            // Avoid duplicates (optimistic messages or re-deliveries)
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

  // Parse thinking content into steps
  const parseThinkingSteps = useCallback((thinking: string): ThinkingStep[] => {
    if (!thinking) return [];
    
    // Split thinking into logical chunks (by sentences or paragraphs)
    const lines = thinking.split('\n').filter(l => l.trim());
    const steps: ThinkingStep[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 5) continue;
      
      // Detect step-like patterns
      let label = trimmed;
      if (label.length > 80) label = label.slice(0, 77) + '…';
      
      steps.push({ label, status: 'done' });
    }
    
    // Last step is active if we're still thinking
    if (steps.length > 0) {
      steps[steps.length - 1].status = 'active';
    }
    
    return steps.slice(-8); // Keep last 8 steps visible
  }, []);

  // Send message with streaming
  const sendMessage = useCallback(async (content: string, jobContext?: Job | null, overrideConversationId?: string) => {
    const convId = overrideConversationId || conversationId;
    if (!convId || !content.trim() || sending) return;

    setSending(true);
    setStreamingContent('');
    setThinkingContent('');
    setThinkingSteps([]);
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
                setThinkingSteps(parseThinkingSteps(accumulatedThinking));
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

      if (accumulated) {
        const metadata: Record<string, unknown> = {};
        if (accumulatedThinking) {
          metadata.thinking = accumulatedThinking;
        }
        const planMatch = accumulated.match(/\[SEARCH_PLAN\]\s*([\s\S]*?)\s*\[\/SEARCH_PLAN\]/);
        if (planMatch) {
          try { metadata.search_plan = JSON.parse(planMatch[1]); } catch {}
        }

        // Only trigger search if server confirmed the action (plan is saved in DB)
        if (serverConfirmedAction && (serverConfirmedAction as any)?.action === 'start_search') {
          metadata.agent_action = serverConfirmedAction;
          setConversation(prev => prev ? { ...prev, status: 'running' } : null);
          triggerSearch(convId);
        }

        setMessages(prev => [...prev, {
          id: `assistant-${Date.now()}`,
          conversation_id: convId,
          role: 'assistant',
          content: accumulated,
          metadata,
          created_at: new Date().toISOString(),
        }]);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        toast.info('Streaming interrompu', { description: 'La réponse a été coupée. Le message partiel a été sauvegardé côté serveur.' });
      } else {
        console.error('[useAgentChat] Error:', err);
        toast.error('Erreur de communication', { description: 'Impossible de contacter l\'assistant. Réessayez.' });
      }
    } finally {
      setSending(false);
      setThinkingContent('');
      setThinkingSteps([]);
      abortRef.current = null;
    }
  }, [conversationId, sending, parseThinkingSteps]);

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
    thinkingSteps,
    isThinking,
    conversation,
    sendMessage,
    createConversation,
    listConversations,
  };
};
