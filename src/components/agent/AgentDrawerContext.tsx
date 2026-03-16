import React, { createContext, useContext, useState, useCallback } from 'react';
import { AgentDrawer } from './AgentDrawer';

interface AgentDrawerContextType {
  openAgent: () => void;
  closeAgent: () => void;
  isOpen: boolean;
}

const AgentDrawerContext = createContext<AgentDrawerContextType>({
  openAgent: () => {},
  closeAgent: () => {},
  isOpen: false,
});

export const useAgentDrawer = () => useContext(AgentDrawerContext);

export const AgentDrawerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);

  const openAgent = useCallback(() => setIsOpen(true), []);
  const closeAgent = useCallback(() => setIsOpen(false), []);

  return (
    <AgentDrawerContext.Provider value={{ openAgent, closeAgent, isOpen }}>
      {children}
      <AgentDrawer open={isOpen} onOpenChange={setIsOpen} />
    </AgentDrawerContext.Provider>
  );
};
