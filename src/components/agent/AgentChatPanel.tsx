import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Bot, Send, ArrowLeft, Plus, Loader2, Zap, Clock, CheckCircle2, Settings2, PauseCircle } from 'lucide-react';
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

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  calibrating: { label: 'Calibration', icon: Settings2, color: 'text-muted-foreground' },
  plan_proposed: { label: 'Plan proposé', icon: CheckCircle2, color: 'text-brutal-accent' },
  running: { label: 'En cours…', icon: Zap, color: 'text-brutal-accent' },
  completed: { label: 'Terminé', icon: CheckCircle2, color: 'text-foreground' },
  paused: { label: 'En pause', icon: PauseCircle, color: 'text-muted-foreground' },
};

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
  const statusCfg = conversation ? STATUS_CONFIG[conversation.status] : null;
  const StatusIcon = statusCfg?.icon || Settings2;

  // ── List view ──
  if (showList) {
    return (
      <div className="flex flex-col h-full bg-background">
        <AgentHeader onClose={onClose} />
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
  return (
    <div className="flex flex-col h-full bg-background relative">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-foreground/10 shrink-0 bg-background">
        <button
          onClick={() => setShowList(true)}
          className="h-7 w-7 border border-foreground flex items-center justify-center hover:bg-foreground hover:text-background transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <div className="h-7 w-7 bg-foreground text-background flex items-center justify-center">
          <Bot className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider truncate">
            {conversation?.job_title || 'Agent'}
          </p>
        </div>
        {statusCfg && (
          <div className={cn("flex items-center gap-1.5 px-2 py-1 border border-foreground/20", statusCfg.color)}>
            <StatusIcon className="w-3 h-3" />
            <span className="text-[9px] font-bold uppercase tracking-wider">{statusCfg.label}</span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-3">
              <div className="h-10 w-10 border-2 border-foreground flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Chargement…
              </span>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <AgentEmptyState />
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

      {/* Options */}
      <AgentOptionsSheet
        options={lastAssistantOptions}
        open={showOptions && !sending && lastAssistantOptions.length > 0}
        onSelect={handleQuickReply}
        onDismiss={() => setShowOptions(false)}
      />

      {/* Input */}
      <AgentInputBar
        input={input}
        sending={sending}
        onInputChange={setInput}
        onKeyDown={handleKeyDown}
        onSend={() => handleSend()}
        inputRef={inputRef}
      />
    </div>
  );
};

// ── Sub-components ──

function AgentHeader({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/10 bg-background">
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 bg-foreground text-background flex items-center justify-center">
          <Bot className="w-4 h-4" />
        </div>
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-foreground">Agent de recherche</span>
          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Sourcing automatisé</p>
        </div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors border border-foreground/10 px-2.5 py-1 hover:border-foreground/30"
        >
          Fermer
        </button>
      )}
    </div>
  );
}

function AgentEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <div className="h-16 w-16 border-2 border-foreground/10 flex items-center justify-center">
        <Bot className="w-8 h-8 text-muted-foreground/20" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Prêt à sourcer
        </p>
        <p className="text-[10px] text-muted-foreground/60 max-w-[200px]">
          Décrivez le profil recherché pour lancer la conversation
        </p>
      </div>
    </div>
  );
}

function AgentInputBar({
  input, sending, onInputChange, onKeyDown, onSend, inputRef,
}: {
  input: string; sending: boolean;
  onInputChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
}) {
  return (
    <div className="shrink-0 border-t border-foreground/10 p-3 bg-background z-10">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Décrivez le profil recherché…"
          rows={1}
          className="flex-1 resize-none px-3 py-2.5 text-xs border border-foreground/15 bg-muted/30 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40 focus:bg-background min-h-[38px] max-h-[100px] transition-colors"
          style={{ height: 'auto', overflow: 'auto' }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = Math.min(target.scrollHeight, 100) + 'px';
          }}
        />
        <button
          onClick={onSend}
          disabled={!input.trim() || sending}
          className={cn(
            "h-[38px] w-[38px] flex items-center justify-center border-2 border-foreground transition-all shrink-0",
            input.trim() && !sending
              ? "bg-foreground text-background hover:opacity-80"
              : "bg-muted text-muted-foreground cursor-not-allowed border-foreground/10"
          )}
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
