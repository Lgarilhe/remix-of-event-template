import { useState, useEffect, useCallback, useRef } from 'react';
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

export const useAgentChat = (conversationId: string | null) => {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
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

  // Realtime subscription for new messages
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`agent-messages-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'agent_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const newMsg = payload.new as unknown as AgentMessage;
        setMessages(prev => {
          // Skip if already exists by real id
          if (prev.some(m => m.id === newMsg.id)) return prev;
          // Replace temp messages of same role that match content
          const hasTempMatch = prev.some(m => 
            m.id.startsWith('temp-') && m.role === 'user' && newMsg.role === 'user' && m.content === newMsg.content
          ) || prev.some(m =>
            m.id.startsWith('assistant-') && m.role === 'assistant' && newMsg.role === 'assistant'
          );
          if (hasTempMatch) {
            return prev.map(m => {
              if (m.id.startsWith('temp-') && m.role === 'user' && newMsg.role === 'user' && m.content === newMsg.content) return newMsg;
              if (m.id.startsWith('assistant-') && m.role === 'assistant' && newMsg.role === 'assistant') return newMsg;
              return m;
            });
          }
          return [...prev, newMsg];
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId]);

  // Send message with streaming
  const sendMessage = useCallback(async (content: string, jobContext?: Job | null, overrideConversationId?: string) => {
    const convId = overrideConversationId || conversationId;
    if (!convId || !content.trim() || sending) return;

    setSending(true);
    setStreamingContent('');

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
              const text = parsed.choices?.[0]?.delta?.content;
              if (text) {
                accumulated += text;
                setStreamingContent(accumulated);
              }
            } catch {}
          }
        }
      }

      setStreamingContent('');
      // The message is saved server-side and will arrive via realtime
      // But add it immediately for responsiveness
      if (accumulated) {
        // Extract metadata
        const metadata: Record<string, unknown> = {};
        const planMatch = accumulated.match(/\[SEARCH_PLAN\]\s*([\s\S]*?)\s*\[\/SEARCH_PLAN\]/);
        if (planMatch) {
          try { metadata.search_plan = JSON.parse(planMatch[1]); } catch {}
        }
        const actionMatch = accumulated.match(/\[AGENT_ACTION\]\s*([\s\S]*?)\s*\[\/AGENT_ACTION\]/);
        if (actionMatch) {
          try { metadata.agent_action = JSON.parse(actionMatch[1]); } catch {}
          // Update conversation status
          if ((metadata.agent_action as any)?.action === 'start_search') {
            setConversation(prev => prev ? { ...prev, status: 'running' } : null);
          }
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
      if ((err as Error).name !== 'AbortError') {
        console.error('[useAgentChat] Error:', err);
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [conversationId, sending]);

  // Create new conversation
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

  // List conversations
  const listConversations = useCallback(async (): Promise<AgentConversation[]> => {
    if (!organizationId) return [];
    const { data } = await supabase
      .from('agent_conversations')
      .select('*')
      .eq('organization_id', organizationId)
      .order('updated_at', { ascending: false })
      .limit(20);
    return (data || []) as unknown as AgentConversation[];
  }, [organizationId]);

  return {
    messages,
    loading,
    sending,
    streamingContent,
    conversation,
    sendMessage,
    createConversation,
    listConversations,
  };
};
