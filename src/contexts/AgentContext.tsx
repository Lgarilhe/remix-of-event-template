import React, { createContext, useContext, useState, useCallback } from 'react';
import { Job } from '@/types/jobs';

export type AgentContextMode = 'brief' | 'process' | 'sourcing' | 'outreach' | null;

interface AgentContextValue {
  isOpen: boolean;
  openAgent: (jobId?: string) => void;
  closeAgent: () => void;
  toggleAgent: () => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  initialJobId: string | null;
  unreadCount: number;
  setUnreadCount: (count: number) => void;
  // Simple message-based open (Lovable's addition)
  initialMessage: string | null;
  openAgentWithMessage: (message: string) => void;
  // Contextual agent (our addition)
  contextMode: AgentContextMode;
  briefContext: Record<string, unknown> | null;
  autoJob: Job | null;
  /** sourcing_projects.id when opened from a mission */
  projectId: string | null;
  openContextualAgent: (params: {
    mode: AgentContextMode;
    briefContext?: Record<string, unknown>;
    initialMessage?: string;
    job?: Job;
    projectId?: string;
  }) => void;
}

const AgentContext = createContext<AgentContextValue>({
  isOpen: false,
  openAgent: () => {},
  closeAgent: () => {},
  toggleAgent: () => {},
  conversationId: null,
  setConversationId: () => {},
  initialJobId: null,
  unreadCount: 0,
  setUnreadCount: () => {},
  initialMessage: null,
  openAgentWithMessage: () => {},
  contextMode: null,
  briefContext: null,
  autoJob: null,
  projectId: null,
  openContextualAgent: () => {},
});

export const useAgent = () => useContext(AgentContext);

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [initialJobId, setInitialJobId] = useState<string | null>(null);
  const [initialMessage, setInitialMessage] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  // Contextual agent state
  const [contextMode, setContextMode] = useState<AgentContextMode>(null);
  const [briefContext, setBriefContext] = useState<Record<string, unknown> | null>(null);
  const [autoJob, setAutoJob] = useState<Job | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const openAgent = useCallback((jobId?: string) => {
    if (jobId) setInitialJobId(jobId);
    setContextMode(null);
    setBriefContext(null);
    setAutoJob(null);
    setProjectId(null);
    setIsOpen(true);
  }, []);

  const openAgentWithMessage = useCallback((message: string) => {
    setInitialMessage(message);
    setIsOpen(true);
  }, []);

  const openContextualAgent = useCallback((params: {
    mode: AgentContextMode;
    briefContext?: Record<string, unknown>;
    initialMessage?: string;
    job?: Job;
    projectId?: string;
  }) => {
    setContextMode(params.mode);
    setBriefContext(params.briefContext || null);
    setInitialMessage(params.initialMessage || null);
    setAutoJob(params.job || null);
    setProjectId(params.projectId || null);
    setConversationId(null);
    setIsOpen(true);
  }, []);

  const closeAgent = useCallback(() => {
    setIsOpen(false);
    setInitialJobId(null);
    setInitialMessage(null);
    setContextMode(null);
    setBriefContext(null);
    setAutoJob(null);
    setProjectId(null);
  }, []);

  const toggleAgent = useCallback(() => {
    setIsOpen(prev => {
      if (prev) {
        setInitialJobId(null);
        setInitialMessage(null);
        setContextMode(null);
        setBriefContext(null);
        setAutoJob(null);
        setProjectId(null);
      }
      return !prev;
    });
  }, []);

  return (
    <AgentContext.Provider
      value={{
        isOpen,
        openAgent,
        closeAgent,
        toggleAgent,
        conversationId,
        setConversationId,
        initialJobId,
        initialMessage,
        openAgentWithMessage,
        unreadCount,
        setUnreadCount,
        contextMode,
        briefContext,
        autoJob,
        projectId,
        openContextualAgent,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
};
