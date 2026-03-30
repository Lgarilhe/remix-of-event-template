import React, { createContext, useContext, useState, useCallback } from 'react';

interface AgentContextValue {
  isOpen: boolean;
  openAgent: (jobId?: string) => void;
  closeAgent: () => void;
  toggleAgent: () => void;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  initialJobId: string | null;
  initialMessage: string | null;
  openAgentWithMessage: (message: string) => void;
  unreadCount: number;
  setUnreadCount: (count: number) => void;
}

const AgentContext = createContext<AgentContextValue>({
  isOpen: false,
  openAgent: () => {},
  closeAgent: () => {},
  toggleAgent: () => {},
  conversationId: null,
  setConversationId: () => {},
  initialJobId: null,
  initialMessage: null,
  openAgentWithMessage: () => {},
  unreadCount: 0,
  setUnreadCount: () => {},
});

export const useAgent = () => useContext(AgentContext);

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [initialJobId, setInitialJobId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  const openAgent = useCallback((jobId?: string) => {
    if (jobId) setInitialJobId(jobId);
    setIsOpen(true);
  }, []);

  const closeAgent = useCallback(() => {
    setIsOpen(false);
    setInitialJobId(null);
  }, []);

  const toggleAgent = useCallback(() => {
    setIsOpen(prev => {
      if (prev) setInitialJobId(null);
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
        unreadCount,
        setUnreadCount,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
};
