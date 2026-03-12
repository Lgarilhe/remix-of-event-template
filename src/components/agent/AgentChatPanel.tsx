import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Send, ArrowLeft, Loader2, Sparkles, Target } from 'lucide-react';
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
      <div className="flex flex-col h-full agent-dark-bg">
        {/* Header with animated orb */}
        <div className="px-5 py-5 border-b border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              {/* Animated orb */}
              <div className="relative h-10 w-10 flex items-center justify-center">
                <div
                  className="absolute inset-0 rounded-full opacity-60 blur-[3px]"
                  style={{
                    background: 'conic-gradient(from 180deg, #00f0ff, #7c3aed, #f43f5e, #00f0ff)',
                    animation: 'agent-spin 6s linear infinite',
                  }}
                />
                <div className="relative h-9 w-9 rounded-full bg-[#0a0a12] flex items-center justify-center">
                  <Sparkles
                    className="w-4 h-4 text-[#00f0ff]"
                    style={{ animation: 'agent-float 3s ease-in-out infinite' }}
                  />
                </div>
              </div>
              <div>
                <h2 className="text-sm font-bold tracking-tight text-white">Agent IA</h2>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  Sourcing automatisé par IA
                </p>
              </div>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-xs transition-colors"
                style={{ color: 'rgba(255,255,255,0.35)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.35)')}
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
    <div className="flex flex-col h-full agent-dark-bg relative">
      {/* Chat header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06] shrink-0">
        <button
          onClick={() => setShowList(true)}
          className="h-8 w-8 flex items-center justify-center rounded-lg transition-all"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
            e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
          }}
        >
          <ArrowLeft className="w-4 h-4 text-white/60" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold tracking-tight truncate text-white">
            {conversation?.job_title || 'Agent'}
          </h3>
          {statusLabel && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {isActive && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00f0ff]/50" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#00f0ff]" />
                </span>
              )}
              <p className="text-xs" style={{ color: isActive ? '#00f0ff' : 'rgba(255,255,255,0.4)' }}>
                {statusLabel}
              </p>
            </div>
          )}
        </div>
        {/* Model badge */}
        <div
          className="px-2.5 py-1 rounded-full text-[10px] font-medium"
          style={{
            background: 'rgba(0,240,255,0.06)',
            border: '1px solid rgba(0,240,255,0.15)',
            color: '#00f0ff',
          }}
        >
          Sonnet 4.5
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5 agent-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-[#00f0ff]/50" />
              <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Chargement…</span>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="relative h-14 w-14 flex items-center justify-center">
              <div
                className="absolute inset-0 rounded-full opacity-30 blur-[4px]"
                style={{
                  background: 'conic-gradient(from 180deg, #00f0ff, #7c3aed, #f43f5e, #00f0ff)',
                  animation: 'agent-spin 6s linear infinite',
                }}
              />
              <div className="relative h-12 w-12 rounded-full bg-[#0a0a12] flex items-center justify-center">
                <Sparkles className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.2)' }} />
              </div>
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-sm font-semibold text-white/50">Prêt à sourcer</p>
              <p className="text-xs max-w-[240px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.3)' }}>
                Décrivez le profil recherché pour lancer la conversation avec l'agent
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <AgentMessageBubble key={msg.id} message={msg} />
          ))
        )}

        {/* Thinking display */}
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
      <div className="shrink-0 border-t border-white/[0.06] px-4 py-3 z-10">
        <div
          className="flex items-end gap-2.5 rounded-xl px-3.5 py-2.5 transition-all"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Écrivez votre message…"
            rows={1}
            className="flex-1 resize-none text-sm bg-transparent text-white/90 placeholder:text-white/25 focus:outline-none min-h-[24px] max-h-[120px]"
            style={{ caretColor: '#00f0ff' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 120) + 'px';
            }}
            onFocus={() => {
              const container = inputRef.current?.parentElement;
              if (container) container.style.borderColor = 'rgba(0,240,255,0.3)';
            }}
            onBlur={() => {
              const container = inputRef.current?.parentElement;
              if (container) container.style.borderColor = 'rgba(255,255,255,0.08)';
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || sending}
            className="h-8 w-8 flex items-center justify-center rounded-lg shrink-0 transition-all"
            style={
              input.trim() && !sending
                ? {
                    background: 'linear-gradient(135deg, #00f0ff, #7c3aed)',
                    boxShadow: '0 0 16px rgba(0,240,255,0.3)',
                  }
                : {
                    background: 'rgba(255,255,255,0.06)',
                  }
            }
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin text-white/40" />
            ) : (
              <Send className="w-3.5 h-3.5 text-white" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
