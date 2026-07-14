import React, { createContext, useContext, useState, useCallback } from 'react';
import { Job } from '@/types/jobs';
import { useAppContext, type AppContext } from '@/hooks/useAppContext';

export type AgentContextMode = 'brief' | 'process' | 'sourcing' | 'outreach' | null;

interface AgentContextValue {
  isOpen: boolean;
  openAgent: (jobId?: string) => void;
  closeAgent: () => void;
  toggleAgent: () => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  /**
   * Ouvre le drawer sur une conversation existante (reprise depuis /agents ou
   * ailleurs). Incrémente openRequestNonce pour que le panel re-seed même
   * s'il est déjà monté.
   */
  openConversation: (conversationId: string) => void;
  /** Compteur bumpé par openConversation — le panel re-seed quand il change */
  openRequestNonce: number;
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
  /** LinkedIn account_id for real profile fetching */
  accountId: string | null;
  /** Passive app-location context (where the user currently is) */
  appContext: AppContext;
  openContextualAgent: (params: {
    mode: AgentContextMode;
    briefContext?: Record<string, unknown>;
    initialMessage?: string;
    job?: Job;
    projectId?: string;
    accountId?: string;
  }) => void;
}

const AgentContext = createContext<AgentContextValue>({
  isOpen: false,
  openAgent: () => {},
  closeAgent: () => {},
  toggleAgent: () => {},
  conversationId: null,
  setConversationId: () => {},
  openConversation: () => {},
  openRequestNonce: 0,
  initialJobId: null,
  unreadCount: 0,
  setUnreadCount: () => {},
  initialMessage: null,
  openAgentWithMessage: () => {},
  contextMode: null,
  briefContext: null,
  autoJob: null,
  projectId: null,
  accountId: null,
  appContext: { page: 'Application', path: '/', missionId: null, missionTitle: null, missionTab: null, candidateId: null },
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
  const [accountId, setAccountId] = useState<string | null>(null);

  // Passive: always reflects where the user currently is in the app
  const appContext = useAppContext();

  const openAgent = useCallback((jobId?: string) => {
    if (jobId) setInitialJobId(jobId);
    setContextMode(null);
    setBriefContext(null);
    setAutoJob(null);
    setProjectId(null);
    setAccountId(null);
    setIsOpen(true);
  }, []);

  const openAgentWithMessage = useCallback((message: string) => {
    setInitialMessage(message);
    setIsOpen(true);
  }, []);

  const [openRequestNonce, setOpenRequestNonce] = useState(0);
  const openConversation = useCallback((id: string) => {
    setConversationId(id);
    setInitialJobId(null);
    setInitialMessage(null);
    setContextMode(null);
    setBriefContext(null);
    setAutoJob(null);
    setProjectId(null);
    setAccountId(null);
    setOpenRequestNonce((n) => n + 1);
    setIsOpen(true);
  }, []);

  const openContextualAgent = useCallback((params: {
    mode: AgentContextMode;
    briefContext?: Record<string, unknown>;
    initialMessage?: string;
    job?: Job;
    projectId?: string;
    accountId?: string;
  }) => {
    setContextMode(params.mode);
    setBriefContext(params.briefContext || null);
    setInitialMessage(params.initialMessage || null);
    setAutoJob(params.job || null);
    setProjectId(params.projectId || null);
    setAccountId(params.accountId || null);
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
        openConversation,
        openRequestNonce,
        initialJobId,
        initialMessage,
        openAgentWithMessage,
        unreadCount,
        setUnreadCount,
        contextMode,
        briefContext,
        autoJob,
        projectId,
        accountId,
        appContext,
        openContextualAgent,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
};
