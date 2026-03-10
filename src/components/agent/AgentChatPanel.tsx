import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, ArrowLeft, Plus, Loader2 } from 'lucide-react';
import { useAgentChat, AgentConversation } from '@/hooks/useAgentChat';
import { AgentMessageBubble } from './AgentMessageBubble';
import { AgentConversationsList } from './AgentConversationsList';
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: jobs } = useNotionJobs();
  const {
    messages,
    loading,
    sending,
    streamingContent,
    conversation,
    sendMessage,
    createConversation,
    listConversations,
  } = useAgentChat(conversationId);

  // Auto-scroll
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

      // Agent takes initiative: auto-send first message with job context
      if (job) {
        // Small delay to let state settle
        setTimeout(async () => {
          await sendMessage(
            `Analyse cette fiche de poste et propose-moi un plan de recherche LinkedIn optimisé.`,
            job
          );
        }, 100);
        setJobSentForConv(id);
      }
    }
  }, [createConversation, sendMessage]);

  const handleSelectConversation = useCallback((conv: AgentConversation) => {
    setConversationId(conv.id);
    setShowList(false);
    setJobSentForConv(conv.id); // Already initialized
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput('');

    // Send job context only on first message of a conversation
    const jobCtx = conversationId !== jobSentForConv ? selectedJob : null;
    if (jobCtx) setJobSentForConv(conversationId);

    await sendMessage(text, jobCtx);
  }, [input, sending, sendMessage, selectedJob, conversationId, jobSentForConv]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Job selector for new conversation
  const activeJobs = (jobs || []).filter(j => !['Archivé', 'Fermé', 'Perdu'].includes(j.status));

  if (showList) {
    return (
      <div className="flex flex-col h-full bg-background">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-foreground">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 bg-foreground text-background flex items-center justify-center">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold uppercase tracking-wider">Agent de recherche</span>
          </div>
          {onClose && (
            <button onClick={onClose} className="text-[10px] font-medium uppercase text-muted-foreground hover:text-foreground">
              Fermer
            </button>
          )}
        </div>

        {/* New conversation with job selector */}
        <div className="p-3 border-b border-foreground/20">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Nouveau sourcing
          </p>
          <select
            value={selectedJob?.id || ''}
            onChange={(e) => {
              const job = activeJobs.find(j => j.id === e.target.value);
              setSelectedJob(job || null);
            }}
            className="w-full h-8 px-2 text-xs border border-foreground bg-background text-foreground mb-2"
          >
            <option value="">Sélectionner un poste…</option>
            {activeJobs.map(job => (
              <option key={job.id} value={job.id}>
                {job.title} — {job.client?.name || 'N/A'}
              </option>
            ))}
          </select>
          <button
            onClick={() => handleNewConversation(selectedJob)}
            disabled={!selectedJob}
            className={cn(
              "w-full h-8 text-[10px] font-bold uppercase tracking-wider border border-foreground flex items-center justify-center gap-1.5 transition-colors",
              selectedJob
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <Plus className="w-3 h-3" />
            Lancer un agent
          </button>
        </div>

        {/* Conversation list */}
        <AgentConversationsList
          onSelect={handleSelectConversation}
          listConversations={listConversations}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-foreground shrink-0">
        <button onClick={() => setShowList(true)} className="hover:bg-muted p-1 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <div className="h-6 w-6 bg-foreground text-background flex items-center justify-center">
          <Bot className="w-3 h-3" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider truncate">
            {conversation?.job_title || 'Agent'}
          </p>
          <p className="text-[9px] text-muted-foreground">
            {conversation?.status === 'calibrating' && '⚙️ Calibration'}
            {conversation?.status === 'plan_proposed' && '📋 Plan proposé'}
            {conversation?.status === 'running' && '🔄 En cours…'}
            {conversation?.status === 'completed' && '✅ Terminé'}
            {conversation?.status === 'paused' && '⏸️ En pause'}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <Bot className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Décrivez le profil recherché pour commencer
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <AgentMessageBubble key={msg.id} message={msg} />
          ))
        )}

        {/* Streaming indicator */}
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

      {/* Input */}
      <div className="shrink-0 border-t border-foreground p-2">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Décrivez le profil recherché…"
            rows={1}
            className="flex-1 resize-none px-2.5 py-2 text-xs border border-foreground bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-foreground min-h-[34px] max-h-[100px]"
            style={{ height: 'auto', overflow: 'auto' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 100) + 'px';
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className={cn(
              "h-[34px] w-[34px] flex items-center justify-center border border-foreground transition-colors shrink-0",
              input.trim() && !sending
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};
