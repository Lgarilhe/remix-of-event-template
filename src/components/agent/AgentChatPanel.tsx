import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, Bot } from 'lucide-react';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { useAgentChat, AgentConversation } from '@/hooks/useAgentChat';
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


interface AgentChatPanelProps {
  onClose?: () => void;
  /** Contextual mode: adapts the agent's behavior per mission step */
  contextMode?: 'brief' | 'process' | 'sourcing' | 'outreach' | null;
  /** Brief data to inject as context when contextMode='brief' */
  briefContext?: Record<string, unknown> | null;
  /** Initial message to send automatically when agent opens */
  initialMessage?: string | null;
  /** Job to auto-select (skip job selector) */
  autoJob?: Job | null;
  /** sourcing_projects.id when opened from a mission context */
  projectId?: string | null;
  /** LinkedIn account_id for real profile fetching */
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
  const [showList, setShowList] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [jobSentForConv, setJobSentForConv] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const { data: jobs } = useNotionJobs();
  const {
    conversation,
    sendMessage, createConversation, listConversations,
  } = useAgentChat(conversationId);

  // Keep access token fresh for the adapter
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAccessToken(session?.access_token || null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Build chat adapter for assistant-ui — use getter refs so the adapter
  // always reads the latest values without needing to be recreated.
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
        organizationId: undefined, // will set below
      }),
    [selectedModel, contextMode, briefContext, projectId, accountId],
  );

  const runtime = useLocalRuntime(adapter);

  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, []);

  // Auto-start conversation in contextual mode (brief, process, etc.)
  const contextInitRef = useRef(false);
  useEffect(() => {
    if (contextMode && initialMessage && !contextInitRef.current) {
      contextInitRef.current = true;
      const initContextAgent = async () => {
        const job = autoJob || null;
        const id = await createConversation(job);
        if (id) {
          setConversationId(id);
          setShowList(false);
          setJobSentForConv(null);
          setTimeout(() => {
            sendMessage(initialMessage, job, id, selectedModel, contextMode, briefContext, projectId, accountId);
          }, 200);
        }
      };
      initContextAgent();
    }
  }, [contextMode, initialMessage, autoJob, createConversation, sendMessage, selectedModel, briefContext, projectId, accountId]);

  const handleNewConversation = useCallback(async (job?: Job | null) => {
    const id = await createConversation(job);
    if (id) {
      setConversationId(id);
      setSelectedJob(job || null);
      setShowList(false);
      setJobSentForConv(null);
      if (job) {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = setTimeout(() => {
          pendingTimerRef.current = null;
          sendMessage(
            `Analyse cette fiche de poste et propose-moi un plan de recherche LinkedIn optimisé.`,
            job, id, selectedModel
          );
        }, 100);
        setJobSentForConv(id);
      }
    }
  }, [createConversation, sendMessage]);

  const handleSelectConversation = useCallback((conv: AgentConversation) => {
    setConversationId(conv.id);
    setShowList(false);
    setJobSentForConv(conv.id);
  }, []);

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

  const handleQuickAction = useCallback(async (prompt: string) => {
    const id = await createConversation();
    if (id) {
      setConversationId(id);
      setShowList(false);
      setJobSentForConv(null);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null;
        sendMessage(prompt, null, id, selectedModel);
      }, 100);
    }
  }, [createConversation, sendMessage]);

  // ── Handle initialMessage from AgentContext ──
  const { initialMessage: agentCtxMessage } = useAgent();
  const initialMessageHandledRef = useRef<string | null>(null);
  const effectiveInitialMessage = initialMessage ?? agentCtxMessage;

  useEffect(() => {
    if (contextMode) return;
    if (effectiveInitialMessage && effectiveInitialMessage !== initialMessageHandledRef.current) {
      initialMessageHandledRef.current = effectiveInitialMessage;
      handleQuickAction(effectiveInitialMessage);
    }
  }, [effectiveInitialMessage, handleQuickAction, contextMode]);

  if (showList) {
    return (
      <div className="flex flex-col h-full bg-background animate-slide-in-left">
        {/* Header */}
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

        {/* Quick Actions Grid */}
        <div className="px-4 py-4 border-b border-border shrink-0">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Actions rapides</p>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_ACTIONS.map((qa) => (
              <button
                key={qa.label}
                onClick={() => handleQuickAction(qa.prompt)}
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
              activeTab === 'new'
                ? "text-foreground"
                : "text-muted-foreground/50 hover:text-muted-foreground"
            )}
          >
            Nouveau
            {activeTab === 'new' && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              "flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all duration-150 relative",
              activeTab === 'history'
                ? "text-foreground"
                : "text-muted-foreground/50 hover:text-muted-foreground"
            )}
          >
            Historique
            {activeTab === 'history' && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
            )}
          </button>
        </div>

        {/* Tab content */}
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

  // ── Chat view ──
  const statusLabel = conversation?.status === 'calibrating' ? 'Calibration'
    : conversation?.status === 'plan_proposed' ? 'Plan propose'
    : conversation?.status === 'running' ? 'En cours'
    : conversation?.status === 'completed' ? 'Termine'
    : conversation?.status === 'paused' ? 'En pause'
    : null;

  const isActive = conversation?.status === 'running' || conversation?.status === 'calibrating';

  return (
    <div className="flex flex-col h-full bg-background relative animate-slide-in-right">
      {/* Chat header */}
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
            {conversation?.job_title || 'Agent'}
          </h3>
          {statusLabel && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {isActive && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/50" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
              )}
              <p className={cn(
                "text-[11px]",
                isActive ? "text-primary font-medium" : "text-muted-foreground"
              )}>
                {statusLabel}
              </p>
            </div>
          )}
        </div>
        <ModelPicker actionId="agent_search_calibration" value={selectedModel} onChange={setSelectedModel} compact />
      </div>

      {/* assistant-ui Thread */}
      <AssistantRuntimeProvider runtime={runtime}>
        <SkalrThread />
        <SearchCandidatesToolUI />
        <EnrichCompanyToolUI />
        <WebSearchToolUI />
      </AssistantRuntimeProvider>
    </div>
  );
};
