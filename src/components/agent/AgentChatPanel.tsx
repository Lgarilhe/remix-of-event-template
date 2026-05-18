import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { History, Bot, ArrowLeft, SquarePen, X } from 'lucide-react';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { AgentConversationsList } from './AgentConversationsList';
import { Job } from '@/types/jobs';
import { useAgent } from '@/contexts/AgentContext';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { useLocalRuntime, AssistantRuntimeProvider } from '@assistant-ui/react';
import { createSkalrChatAdapter } from '@/components/assistant-ui/chat-adapter';
import { SkalrThread } from '@/components/assistant-ui/thread';
import { SearchCandidatesToolUI, EnrichCompanyToolUI, WebSearchToolUI } from '@/components/assistant-ui/tool-uis';
import type { AgentConversation } from '@/hooks/useAgentChat';
import { AgentToolApprovalCard } from './AgentToolApprovalCard';

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
  // Notion-AI-style: land directly in the chat. History/new conversation is
  // reachable from the header control, not a launcher screen.
  const [showList, setShowList] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

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

  // Lazily ensure a conversation row exists before the first message.
  // The backend 400s without a conversation_id and has no create path, so
  // we create it client-side (RLS-scoped) — same insert as useAgentChat.
  const ensureConversationId = useCallback(async (): Promise<string> => {
    if (conversationIdRef.current) return conversationIdRef.current;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !organizationId) throw new Error('Organisation introuvable. Reconnecte-toi.');
    const job = selectedJob ?? autoJob ?? null;
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
    if (error || !data) throw new Error(error?.message || 'Création de conversation impossible');
    conversationIdRef.current = data.id;
    setConversationId(data.id);
    setShowList(false);
    return data.id;
  }, [organizationId, selectedJob, autoJob]);

  const adapter = useMemo(
    () =>
      createSkalrChatAdapter({
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        ensureConversationId,
        getAccessToken: () => accessTokenRef.current || '',
        apiKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        modelOverride: selectedModel,
        contextMode,
        briefContext,
        projectId,
        accountId,
        organizationId: organizationId || undefined,
      }),
    [ensureConversationId, selectedModel, contextMode, briefContext, projectId, accountId, organizationId],
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
    // Just clear conversation — the adapter will auto-create on first message
    setConversationId(null);
    setSelectedJob(job || null);
    setShowList(false);
  }, []);

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

  // ── History view (Notion/Claude-style: back · new chat · recent list) ──
  if (showList) {
    return (
      <div className="flex flex-col h-full bg-background animate-slide-in-left">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 shrink-0 bg-background/80 backdrop-blur-sm">
          <button
            onClick={() => setShowList(false)}
            title="Retour au chat"
            className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-foreground" />
          </button>
          <AnimatedOrb size={24} speed={4} />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold truncate text-foreground">Conversations</h3>
            <p className="text-[11px] text-muted-foreground">Historique du Copilot</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              title="Fermer"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* New conversation */}
        <div className="px-4 pt-4 pb-2 shrink-0">
          <button
            onClick={() => handleNewConversation()}
            className="flex w-full items-center gap-2.5 rounded-2xl border border-border bg-card/40 px-4 py-3 text-left transition-all hover:border-primary/40 hover:bg-accent active:scale-[0.99]"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <SquarePen className="h-4 w-4" />
            </span>
            <span className="text-[13px] font-semibold text-foreground">Nouvelle conversation</span>
          </button>
        </div>

        {/* Recent conversations */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <AgentConversationsList onSelect={handleSelectConversation} listConversations={listConversations} />
        </div>
      </div>
    );
  }

  // ── Chat view — assistant-ui is the sole runtime ──
  return (
    <div className="flex flex-col h-full bg-background relative animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 shrink-0 bg-background/80 backdrop-blur-sm">
        <button
          onClick={() => setShowList(true)}
          title="Conversations & nouvelle discussion"
          className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
        >
          <History className="w-4 h-4 text-foreground" />
        </button>
        <AnimatedOrb size={24} speed={4}>
          <Bot className="w-3 h-3 text-foreground/70" />
        </AnimatedOrb>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate text-foreground">
            {contextMode === 'sourcing' ? 'Sourcing Assistant' 
              : contextMode === 'brief' ? 'Brief Assistant'
              : contextMode === 'outreach' ? 'Outreach Assistant'
              : 'Copilot IA'}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {contextMode ? 'Mode contextuel' : 'Conversation libre'}
          </p>
        </div>
      </div>

      {/* Tool approval banner — Sprint 1 (RAG_AGENT_AUDIT.md §8) */}
      <AgentToolApprovalCard conversationId={conversationId} />

      {/* Thread — assistant-ui handles everything */}
      <AssistantRuntimeProvider runtime={runtime}>
        <SkalrThread
          contextMode={contextMode}
          modelSlot={
            <ModelPicker
              actionId="agent_search_calibration"
              value={selectedModel}
              onChange={setSelectedModel}
              compact
            />
          }
        />
        <SearchCandidatesToolUI />
        <EnrichCompanyToolUI />
        <WebSearchToolUI />
      </AssistantRuntimeProvider>
    </div>
  );
};
