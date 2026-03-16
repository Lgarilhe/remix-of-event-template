import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, ArrowLeft, Loader2, Bot, Target, Search, BarChart3, Sparkles } from 'lucide-react';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { useAgentChat, AgentConversation } from '@/hooks/useAgentChat';
import { AgentMessageBubble, extractOptions } from './AgentMessageBubble';
import { AgentOptionsSheet } from './AgentOptionsSheet';
import { AgentConversationsList } from './AgentConversationsList';
import { AgentJobSelector } from './AgentJobSelector';
import { AgentThinkingDisplay } from './AgentThinkingDisplay';
import { Job } from '@/types/jobs';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { cn } from '@/lib/utils';

interface AgentChatPanelProps {
  onClose?: () => void;
}

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({ onClose }) => {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [showList, setShowList] = useState(true);
  const [input, setInput] = useState('');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [jobSentForConv, setJobSentForConv] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: jobs } = useNotionJobs();
  const {
    messages, loading, sending, streamingContent, conversation,
    sendMessage, createConversation, listConversations,
    thinkingSteps, isThinking, thinkingContent,
  } = useAgentChat(conversationId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, thinkingSteps]);

  const handleNewConversation = useCallback(async (job?: Job | null) => {
    const id = await createConversation(job);
    if (id) {
      setConversationId(id);
      setSelectedJob(job || null);
      setShowList(false);
      setJobSentForConv(null);
      if (job) {
        setTimeout(async () => {
          await sendMessage(
            `Analyse cette fiche de poste et propose-moi un plan de recherche LinkedIn optimisé.`,
            job, id
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
    const jobCtx = conversationId !== jobSentForConv ? selectedJob : null;
    if (jobCtx) setJobSentForConv(conversationId);
    await sendMessage(msg, jobCtx);
  }, [input, sending, sendMessage, selectedJob, conversationId, jobSentForConv]);

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

  // ── List view ──
  if (showList) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="px-4 py-3 border-b-2 border-foreground">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AnimatedOrb size={36}>
                <Bot className="w-4 h-4 text-foreground" />
              </AnimatedOrb>
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Agent IA</h2>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Sourcing automatisé
                </p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                Fermer
              </button>
            )}
          </div>
        </div>
        <AgentJobSelector jobs={activeJobs} selectedJob={selectedJob} onSelectJob={setSelectedJob} onLaunch={() => handleNewConversation(selectedJob)} />
        <AgentConversationsList onSelect={handleSelectConversation} listConversations={listConversations} />
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
    <div className="flex flex-col h-full bg-background relative">
      {/* Chat header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b-2 border-foreground shrink-0">
        <button
          onClick={() => setShowList(true)}
          className="h-8 w-8 flex items-center justify-center border border-foreground hover:bg-brutal-accent/10 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold uppercase tracking-wider truncate text-foreground">
            {conversation?.job_title || 'Agent'}
          </h3>
          {statusLabel && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {isActive && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brutal-accent/50" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brutal-accent" />
                </span>
              )}
              <p className={cn(
                "text-[10px] uppercase tracking-wider",
                isActive ? "text-brutal-accent" : "text-muted-foreground"
              )}>
                {statusLabel}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 scrollbar-hide">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <AnimatedOrb size={32} speed={3}>
                <Bot className="w-3.5 h-3.5 text-foreground/50" />
              </AnimatedOrb>
              <span className="text-xs text-muted-foreground">Chargement…</span>
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
                  className="border border-foreground/10 hover:border-brutal-accent/50 p-4 transition-all duration-200 hover:bg-brutal-accent/5 glass-subtle cursor-pointer group text-left"
                >
                  <starter.icon className="w-5 h-5 text-muted-foreground group-hover:text-brutal-accent transition-colors" />
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
                      className="border border-foreground/15 px-3 py-1.5 text-xs hover:bg-foreground hover:text-background transition-colors cursor-pointer truncate max-w-[200px] shrink-0"
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
        {(isThinking || thinkingSteps.length > 0) && !streamingContent && (
          <AgentThinkingDisplay
            steps={thinkingSteps}
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
      <div className="shrink-0 border-t border-foreground/10 px-4 py-3 z-10">
        <div className="flex items-end gap-2 border border-foreground/20 focus-within:border-foreground/50 transition-colors px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Écrivez votre message…"
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
              "h-7 w-7 flex items-center justify-center shrink-0 transition-colors",
              input.trim() && !sending
                ? "bg-foreground text-background hover:bg-brutal-accent"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {sending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
