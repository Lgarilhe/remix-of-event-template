import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Bot, Send, ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import { useAgentChat, AgentConversation } from '@/hooks/useAgentChat';
import { AgentMessageBubble, extractOptions } from './AgentMessageBubble';
import { AgentOptionsSheet } from './AgentOptionsSheet';
import { AgentConversationsList } from './AgentConversationsList';
import { AgentJobSelector } from './AgentJobSelector';
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
  } = useAgentChat(conversationId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

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
        {/* Header */}
        <div className="px-5 py-4 border-b border-foreground/8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 bg-foreground text-background flex items-center justify-center">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold tracking-tight text-foreground">Agent de recherche</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Sourcing automatisé par IA</p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Fermer
              </button>
            )}
          </div>
        </div>

        <AgentJobSelector
          jobs={activeJobs}
          selectedJob={selectedJob}
          onSelectJob={setSelectedJob}
          onLaunch={() => handleNewConversation(selectedJob)}
        />
        <AgentConversationsList
          onSelect={handleSelectConversation}
          listConversations={listConversations}
        />
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

  return (
    <div className="flex flex-col h-full bg-background relative">
      {/* Chat header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-foreground/8 shrink-0">
        <button
          onClick={() => setShowList(true)}
          className="h-8 w-8 flex items-center justify-center border border-foreground/15 hover:border-foreground/40 hover:bg-muted/50 transition-all"
        >
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold tracking-tight truncate text-foreground">
            {conversation?.job_title || 'Agent'}
          </h3>
          {statusLabel && (
            <p className="text-xs text-muted-foreground mt-0.5">{statusLabel}</p>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Chargement…</span>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="h-14 w-14 bg-muted/50 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-muted-foreground/30" />
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-sm font-semibold text-muted-foreground">Prêt à sourcer</p>
              <p className="text-xs text-muted-foreground/60 max-w-[240px] leading-relaxed">
                Décrivez le profil recherché pour lancer la conversation avec l'agent
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <AgentMessageBubble key={msg.id} message={msg} />
          ))
        )}

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
      <div className="shrink-0 border-t border-foreground/8 px-4 py-3 bg-background z-10">
        <div className="flex items-end gap-2.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Écrivez votre message…"
            rows={1}
            className="flex-1 resize-none px-3.5 py-2.5 text-sm border border-foreground/12 bg-muted/20 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/30 focus:bg-background min-h-[40px] max-h-[120px] transition-all"
            style={{ height: 'auto', overflow: 'auto' }}
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
              "h-[40px] w-[40px] flex items-center justify-center transition-all shrink-0",
              input.trim() && !sending
                ? "bg-foreground text-background hover:opacity-80"
                : "bg-muted/50 text-muted-foreground/40 cursor-not-allowed"
            )}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};
