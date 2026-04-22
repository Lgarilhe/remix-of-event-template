import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, Bot } from 'lucide-react';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { AgentConversationsList } from './AgentConversationsList';
import { AgentJobSelector } from './AgentJobSelector';
import { Job } from '@/types/jobs';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { useAgent } from '@/contexts/AgentContext';
import { cn } from '@/lib/utils';
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
  const [showList, setShowList] = useState(!contextMode);
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

  const activeJobs = (jobs || []).filter(j => !['Archivé', 'Fermé', 'Perdu'].includes(j.status));
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');

  const QUICK_ACTIONS = [
    { emoji: '🔍', label: 'Sourcer des candidats', prompt: 'Je cherche des candidats pour un poste. Aide-moi à définir les critères.' },
    { emoji: '✍️', label: 'Rédiger un message', prompt: "Aide-moi à rédiger un message d'approche personnalisé." },
    { emoji: '📊', label: 'Analyser un poste', prompt: 'Analyse les postes ouverts et identifie les priorités.' },
    { emoji: '🧠', label: 'Que sais-tu sur...', prompt: 'Que sais-tu sur ce candidat/poste ? (tape un nom ou un titre)' },
    { emoji: '📝', label: 'Résumer un candidat', prompt: "Résume le profil et l'historique d'un candidat." },
    { emoji: '💡', label: 'Suggérer des actions', prompt: "Quelles actions devrais-je prioriser aujourd'hui ?" },
  ];

  // ── List view ──
  if (showList) {
    return (
      <div className="flex flex-col h-full bg-background animate-slide-in-left">
        <div className="relative overflow-hidden px-5 py-4 border-b-2 border-border">
          <div className="absolute inset-0 skalr-gradient-bg opacity-5" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AnimatedOrb size={32} />
              <div>
                <h2 className="text-sm font-display font-black uppercase tracking-wider text-foreground">Copilot IA</h2>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mt-0.5">
                  Votre assistant recrutement
                </p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border px-2.5 py-1 hover:border-border transition-all duration-150"
              >
                Fermer
              </button>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="px-4 py-4 border-b border-border shrink-0">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Actions rapides</p>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map((qa) => (
              <button
                key={qa.label}
                onClick={() => handleNewConversation()}
                className="border border-border hover:border-border p-3 text-left transition-all duration-150 hover:bg-muted/50 active:scale-[0.97] group"
              >
                <span className="text-base">{qa.emoji}</span>
                <p className="text-xs font-bold uppercase tracking-wider text-foreground mt-1.5 leading-tight group-hover:text-primary transition-colors">
                  {qa.label}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b-2 border-border shrink-0">
          <button
            onClick={() => setActiveTab('new')}
            className={cn(
              "flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all duration-150 relative",
              activeTab === 'new' ? "text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground"
            )}
          >
            Nouveau
            {activeTab === 'new' && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              "flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all duration-150 relative",
              activeTab === 'history' ? "text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground"
            )}
          >
            Historique
            {activeTab === 'history' && <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />}
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'new' ? (
            <AgentJobSelector jobs={activeJobs} selectedJob={selectedJob} onSelectJob={setSelectedJob} onLaunch={() => handleNewConversation(selectedJob)} />
          ) : (
            <AgentConversationsList onSelect={handleSelectConversation} listConversations={listConversations} />
          )}
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
          className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-foreground" />
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
        <ModelPicker actionId="agent_search_calibration" value={selectedModel} onChange={setSelectedModel} compact />
      </div>

      {/* Tool approval banner — Sprint 1 (RAG_AGENT_AUDIT.md §8) */}
      <AgentToolApprovalCard conversationId={conversationId} />

      {/* Thread — assistant-ui handles everything */}
      <AssistantRuntimeProvider runtime={runtime}>
        <SkalrThread contextMode={contextMode} />
        <SearchCandidatesToolUI />
        <EnrichCompanyToolUI />
        <WebSearchToolUI />
      </AssistantRuntimeProvider>
    </div>
  );
};
