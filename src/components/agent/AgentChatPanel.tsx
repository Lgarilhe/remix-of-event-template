import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, ArrowLeft, Loader2, Bot, Target, Search, BarChart3, Sparkles } from 'lucide-react';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { useAgentChat, AgentConversation } from '@/hooks/useAgentChat';
import { AgentMessageBubble, extractOptions } from './AgentMessageBubble';
import { AgentOptionsSheet } from './AgentOptionsSheet';
import { AgentConversationsList } from './AgentConversationsList';
import { AgentJobSelector } from './AgentJobSelector';
import { AgentThinkingDisplay } from './AgentThinkingDisplay';
import { Job } from '@/types/jobs';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { useAgent } from '@/contexts/AgentContext';
import { cn } from '@/lib/utils';

const CHAT_LOADING_MESSAGES = [
  'Chargement des messages…',
  'Synchronisation en cours…',
  'Presque prêt…',
];

function LoadingMessages() {
  const [index, setIndex] = React.useState(0);
  const [fade, setFade] = React.useState(true);
  React.useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % CHAT_LOADING_MESSAGES.length);
        setFade(true);
      }, 200);
    }, 2400);
    return () => clearInterval(interval);
  }, []);
  return (
    <p className={cn(
      "text-xs text-muted-foreground uppercase tracking-[0.15em] font-medium transition-opacity duration-200",
      fade ? "opacity-100" : "opacity-0"
    )}>
      {CHAT_LOADING_MESSAGES[index]}
    </p>
  );
}

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
}

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({
  onClose,
  contextMode,
  briefContext,
  initialMessage,
  autoJob,
}) => {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showList, setShowList] = useState(true);
  const [input, setInput] = useState('');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [jobSentForConv, setJobSentForConv] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: jobs } = useNotionJobs();
  const {
    messages, loading, sending, streamingContent, conversation,
    sendMessage, createConversation, listConversations,
    thinkingPhases, isThinking, thinkingContent,
  } = useAgentChat(conversationId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, thinkingPhases]);

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
            sendMessage(initialMessage, job, id, selectedModel, contextMode, briefContext);
          }, 200);
        }
      };
      initContextAgent();
    }
  }, [contextMode, initialMessage, autoJob, createConversation, sendMessage, selectedModel, briefContext]);

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

  const handleSend = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || sending) return;
    setInput('');
    const jobCtx = conversationId !== jobSentForConv ? (autoJob || selectedJob) : null;
    if (jobCtx) setJobSentForConv(conversationId);
    await sendMessage(msg, jobCtx, undefined, selectedModel, contextMode, briefContext);
  }, [input, sending, sendMessage, selectedJob, autoJob, conversationId, jobSentForConv, selectedModel, contextMode, briefContext]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleQuickReply = useCallback((text: string) => {
    setShowOptions(false);
    handleSend(text);
  }, [handleSend]);

  const lastAssistantOptions = useMemo(() => {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant) return [];
    return extractOptions(lastAssistant.content);
  }, [messages]);

  useEffect(() => {
    if (lastAssistantOptions.length > 0) setShowOptions(true);
  }, [lastAssistantOptions]);

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
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground mt-0.5">
                  Votre assistant recrutement
                </p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground border border-border px-2.5 py-1 hover:border-border transition-all duration-150"
              >
                Fermer
              </button>
            )}
          </div>
        </div>

        {/* Quick Actions Grid */}
        <div className="px-4 py-4 border-b border-border shrink-0">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground mb-3">Actions rapides</p>
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
              "flex-1 py-3 text-xs font-bold uppercase tracking-[0.18em] transition-all duration-150 relative",
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
              "flex-1 py-3 text-xs font-bold uppercase tracking-[0.18em] transition-all duration-150 relative",
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
    : conversation?.status === 'plan_proposed' ? 'Plan proposé'
    : conversation?.status === 'running' ? 'En cours'
    : conversation?.status === 'completed' ? 'Terminé'
    : conversation?.status === 'paused' ? 'En pause'
    : null;

  const isActive = conversation?.status === 'running' || conversation?.status === 'calibrating';

  return (
    <div className="flex flex-col h-full bg-background relative animate-slide-in-right">
      {/* Chat header */}
      <div className="relative overflow-hidden flex items-center gap-3 px-4 py-3 border-b-2 border-border shrink-0">
        <div className="absolute inset-0 skalr-gradient-bg opacity-10" />
        <button
          onClick={() => setShowList(true)}
          className="relative z-10 h-8 w-8 flex items-center justify-center border border-border hover:bg-accent/10 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <AnimatedOrb size={28} speed={4}>
          <Bot className="w-3 h-3 text-foreground/70" />
        </AnimatedOrb>
        <div className="flex-1 min-w-0 relative z-10">
          <h3 className="text-sm font-bold uppercase tracking-wider truncate text-foreground">
            {conversation?.job_title || 'Agent'}
          </h3>
          {statusLabel && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {isActive && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent/50" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
              )}
              <p className={cn(
                "text-xs uppercase tracking-wider",
                isActive ? "text-primary" : "text-muted-foreground"
              )}>
                {statusLabel}
              </p>
            </div>
          )}
        </div>
        <ModelPicker actionId="agent_search_calibration" value={selectedModel} onChange={setSelectedModel} compact />
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 scrollbar-hide">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-6">
            {/* Brutal square scanner */}
            <div className="relative">
              <div className="h-12 w-12 border-2 border-border relative">
                <div
                  className="absolute inset-x-1 h-[2px] animate-[scan_1.5s_ease-in-out_infinite]"
                  style={{ background: 'linear-gradient(90deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)))' }}
                />
                <div className="absolute -top-1 -left-1 w-2 h-2 bg-foreground" />
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-foreground" />
                <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-foreground" />
                <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-foreground" />
              </div>
            </div>
            <LoadingMessages />
            <div className="w-full max-w-[280px] space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-10 border border-border bg-muted relative overflow-hidden"
                  style={{ animationDelay: `${i * 150}ms` }}
                >
                  <div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/[0.04] to-transparent animate-[shimmer_1.8s_infinite]"
                    style={{ animationDelay: `${i * 200}ms` }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-6 px-2">
            <AnimatedOrb size={56} speed={8}>
              <Bot className="w-6 h-6 text-muted-foreground" />
            </AnimatedOrb>
            <div className="text-center space-y-1.5">
              <h2 className="text-2xl font-black font-display text-foreground">Skalr Agent</h2>
              <p className="text-sm text-muted-foreground">
                Votre copilot de sourcing IA
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 w-full max-w-[360px]">
              {[
                { icon: Target, title: 'Sourcer un profil', desc: 'Décrivez le poste et laissez l\'agent chercher', prompt: 'Je cherche un profil pour un poste à pourvoir.' },
                { icon: Search, title: 'Affiner une recherche', desc: 'Optimisez vos filtres LinkedIn Recruiter', prompt: 'Aide-moi à affiner mes filtres de recherche LinkedIn.' },
                { icon: BarChart3, title: 'Analyser un pipe', desc: 'Obtenez des insights sur votre pipeline', prompt: 'Analyse mon pipeline de candidats et donne-moi des recommandations.' },
                { icon: Sparkles, title: 'Rédiger un message', desc: 'Générez un InMail personnalisé', prompt: 'Aide-moi à rédiger un message d\'approche personnalisé.' },
              ].map((starter) => (
                <button
                  key={starter.title}
                  onClick={() => handleSend(starter.prompt)}
                  className="border border-border hover:border-border p-4 transition-all duration-200 hover:bg-muted cursor-pointer group text-left"
                >
                  <starter.icon className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  <p className="text-sm font-semibold text-foreground mt-2">{starter.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{starter.desc}</p>
                </button>
              ))}
            </div>
            {activeJobs.length > 0 && (
              <div className="w-full max-w-[360px] space-y-2 mt-1">
                <p className="text-xs text-muted-foreground">ou lancez sur un poste actif :</p>
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {activeJobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => handleNewConversation(job)}
                      className="border border-border px-3 py-1.5 text-xs hover:bg-foreground hover:text-background transition-colors cursor-pointer truncate max-w-[200px] shrink-0"
                    >
                      {job.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          messages.map((msg) => (
            <AgentMessageBubble key={msg.id} message={msg} />
          ))
        )}

        {/* Live thinking display */}
        {(isThinking || thinkingPhases.length > 0) && !streamingContent && (
          <AgentThinkingDisplay
            steps={thinkingPhases}
            isThinking={isThinking}
            thinkingContent={thinkingContent}
          />
        )}

        {/* Streaming response */}
        {streamingContent && (
          <AgentMessageBubble
            message={{
              id: 'streaming',
              conversation_id: conversationId || '',
              role: 'assistant',
              content: streamingContent,
              metadata: {},
              created_at: new Date().toISOString(),
            }}
            isStreaming
          />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick replies */}
      <AgentOptionsSheet
        options={lastAssistantOptions}
        open={showOptions && !sending && lastAssistantOptions.length > 0}
        onSelect={handleQuickReply}
        onDismiss={() => setShowOptions(false)}
      />

      {/* Input bar */}
      <div className="shrink-0 bg-background border-t border-border px-4 py-3 z-10 space-y-2">
        {selectedJob && conversationId !== jobSentForConv && (
          <div className="flex items-center gap-1.5">
            <span className="bg-accent/10 text-xs px-2 py-1 border border-accent/30 flex items-center gap-1.5 truncate max-w-full">
              <span>📋</span>
              <span className="truncate">{selectedJob.title}</span>
              <button
                onClick={() => setSelectedJob(null)}
                className="ml-0.5 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Retirer le job"
              >
                ✕
              </button>
            </span>
          </div>
        )}
        <div className="flex items-end gap-2 border border-border focus-within:border-border focus-within:shadow-sm transition-all duration-200 px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !conversation ? "Décrivez le profil que vous cherchez…"
                : conversation.status === 'calibrating' ? "Affinez les critères…"
                : conversation.status === 'running' ? "Posez une question sur les résultats…"
                : "Écrivez votre message…"
            }
            rows={1}
            className="flex-1 resize-none text-sm bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:outline-none min-h-[24px] max-h-[120px]"
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || sending}
            className={cn(
              "h-7 w-7 flex items-center justify-center shrink-0 transition-all duration-150 active:scale-90",
              input.trim() && !sending
                ? "bg-foreground text-background hover:bg-accent"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {sending ? (
              <div className="h-7 w-7 flex items-center justify-center relative">
                <div className="h-5 w-5 border border-border relative">
                  <div
                    className="absolute w-[5px] h-[5px] -top-[2.5px] -left-[2.5px] skalr-gradient-bg animate-[spin_1.5s_linear_infinite]"
                    style={{ transformOrigin: '12.5px 12.5px' }}
                  />
                </div>
              </div>
            ) : (
              <Send className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
