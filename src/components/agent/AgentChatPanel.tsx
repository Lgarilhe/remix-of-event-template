import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { History, Plus, ChevronDown, Minus } from 'lucide-react';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { AgentConversationsList } from './AgentConversationsList';
import { Job } from '@/types/jobs';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { useAgent } from '@/contexts/AgentContext';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { useLocalRuntime, AssistantRuntimeProvider } from '@assistant-ui/react';
import { createSkalrChatAdapter } from '@/components/assistant-ui/chat-adapter';
import { SkalrThread } from '@/components/assistant-ui/thread';
import { SearchCandidatesToolUI, EnrichCompanyToolUI, WebSearchToolUI } from '@/components/assistant-ui/tool-uis';
import type { AgentConversation } from '@/hooks/useAgentChat';

interface AgentChatPanelProps {
  onClose?: () => void;
  contextMode?: 'brief' | 'process' | 'sourcing' | 'outreach' | null;
  briefContext?: Record<string, unknown> | null;
  initialMessage?: string | null;
  autoJob?: Job | null;
  projectId?: string | null;
  accountId?: string | null;
}

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({
  onClose,
  contextMode,
  briefContext,
  initialMessage,
  autoJob,
  projectId,
  accountId,
}) => {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const { data: jobs } = useNotionJobs();
  const { organizationId } = useOrganization();

  // Keep access token fresh
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAccessToken(session?.access_token || null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Refs for adapter (avoids recreating runtime on every state change)
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const adapter = useMemo(
    () =>
      createSkalrChatAdapter({
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        getConversationId: () => conversationIdRef.current || '',
        setConversationId: (id: string) => {
          conversationIdRef.current = id;
          setConversationId(id);
          setShowList(false);
        },
        getAccessToken: () => accessTokenRef.current || '',
        apiKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        modelOverride: selectedModel,
        contextMode,
        briefContext,
        projectId,
        accountId,
        organizationId: organizationId || undefined,
      }),
    [selectedModel, contextMode, briefContext, projectId, accountId, organizationId],
  );

  const runtime = useLocalRuntime(adapter);

  // List conversations for history
  const listConversations = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase
      .from('agent_conversations')
      .select('*')
      .eq('created_by', user.id)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(20);
    return (data || []) as unknown as AgentConversation[];
  }, []);

  const handleNewConversation = useCallback(async (job?: Job | null) => {
    setConversationId(null);
    setSelectedJob(job || null);
    setShowList(false);
    // Reset the assistant-ui thread to clear messages
    runtime.switchToNewThread();
  }, [runtime]);

  const handleSelectConversation = useCallback((conv: AgentConversation) => {
    setConversationId(conv.id);
    setShowList(false);
  }, []);

  // Handle initial message from AgentContext
  const { initialMessage: agentCtxMessage } = useAgent();
  const effectiveInitialMessage = initialMessage ?? agentCtxMessage;
  const initialMessageHandledRef = useRef<string | null>(null);

  useEffect(() => {
    if (effectiveInitialMessage && effectiveInitialMessage !== initialMessageHandledRef.current) {
      initialMessageHandledRef.current = effectiveInitialMessage;
      setShowList(false);
      // The message will be typed by the user or sent via suggestion
    }
  }, [effectiveInitialMessage]);



  // ── Chat view — assistant-ui is the sole runtime ──
  return (
    <div className="flex flex-col h-full bg-background relative">
      {/* Header — Notion-style */}
      <div className="flex items-center px-4 py-2.5 border-b border-border/40 shrink-0 bg-background">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {contextMode === 'sourcing' ? 'Sourcing Assistant' 
              : contextMode === 'brief' ? 'Brief Assistant'
              : contextMode === 'outreach' ? 'Outreach Assistant'
              : 'Nouvelle discussion avec l\'IA'}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => handleNewConversation()}
            className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-muted/60 transition-colors text-muted-foreground/70 hover:text-foreground"
            title="Nouvelle conversation"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-muted/60 transition-colors text-muted-foreground/70 hover:text-foreground"
            title="Historique"
          >
            <History className="w-4 h-4" />
          </button>
          <ModelPicker actionId="agent_search_calibration" value={selectedModel} onChange={setSelectedModel} compact />
          {onClose && (
            <button
              onClick={onClose}
              className="h-7 w-7 rounded-md flex items-center justify-center hover:bg-muted/60 transition-colors text-muted-foreground/70 hover:text-foreground ml-0.5"
            >
              <Minus className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* History drawer overlay */}
      {showHistory && (
        <div className="absolute inset-0 z-20 flex">
          <div className="absolute inset-0 bg-black/20" onClick={() => setShowHistory(false)} />
          <div className="relative ml-auto w-full max-w-xs bg-background border-l border-border h-full flex flex-col animate-slide-in-right">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h4 className="text-sm font-semibold">Historique</h4>
              <button onClick={() => setShowHistory(false)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
            </div>
            <div className="flex-1 overflow-hidden">
              <AgentConversationsList onSelect={(conv) => { handleSelectConversation(conv); setShowHistory(false); }} listConversations={listConversations} />
            </div>
          </div>
        </div>
      )}

      {/* Thread — assistant-ui handles everything */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <AssistantRuntimeProvider runtime={runtime}>
          <SkalrThread contextMode={contextMode} />
          <SearchCandidatesToolUI />
          <EnrichCompanyToolUI />
          <WebSearchToolUI />
        </AssistantRuntimeProvider>
      </div>
    </div>
  );
};
