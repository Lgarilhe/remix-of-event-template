import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

// Types for Copilot context
export type CopilotPage = 'outreach' | 'ats' | 'candidates' | 'messages' | 'jobs' | 'other';

export interface CopilotProfile {
  id: string;
  name: string;
  headline?: string;
  profileUrl?: string;
  [key: string]: any;
}

export interface CopilotJob {
  id: string;
  title: string;
  client?: string;
  [key: string]: any;
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  actions?: CopilotAction[];
  data?: any;
}

export interface CopilotAction {
  id: string;
  type: 'apply_filters' | 'send_message' | 'add_to_pipeline' | 'update_stage' | 'score_profile' | 'custom';
  label: string;
  data?: any;
  executed?: boolean;
}

export interface CopilotContextState {
  // Panel state
  isOpen: boolean;
  isMinimized: boolean;
  
  // Current context
  currentPage: CopilotPage;
  selectedProfiles: CopilotProfile[];
  activeJob: CopilotJob | null;
  activeConversation: any | null;
  currentFilters: any | null;
  
  // Conversation
  messages: CopilotMessage[];
  isLoading: boolean;
  
  // Suggestions
  suggestions: CopilotAction[];
}

interface CopilotContextValue extends CopilotContextState {
  // Panel controls
  open: () => void;
  close: () => void;
  toggle: () => void;
  minimize: () => void;
  
  // Context registration (called by pages)
  registerPage: (page: CopilotPage) => void;
  setSelectedProfiles: (profiles: CopilotProfile[]) => void;
  setActiveJob: (job: CopilotJob | null) => void;
  setActiveConversation: (conversation: any | null) => void;
  setCurrentFilters: (filters: any | null) => void;
  
  // Chat
  sendMessage: (message: string) => Promise<void>;
  clearMessages: () => void;
  
  // Actions
  executeAction: (action: CopilotAction) => Promise<void>;
  setSuggestions: (suggestions: CopilotAction[]) => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function CopilotProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CopilotContextState>({
    isOpen: false,
    isMinimized: false,
    currentPage: 'other',
    selectedProfiles: [],
    activeJob: null,
    activeConversation: null,
    currentFilters: null,
    messages: [],
    isLoading: false,
    suggestions: [],
  });

  // Panel controls
  const open = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: true, isMinimized: false }));
  }, []);

  const close = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: false }));
  }, []);

  const toggle = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: !prev.isOpen, isMinimized: false }));
  }, []);

  const minimize = useCallback(() => {
    setState(prev => ({ ...prev, isMinimized: !prev.isMinimized }));
  }, []);

  // Context registration
  const registerPage = useCallback((page: CopilotPage) => {
    setState(prev => ({ ...prev, currentPage: page }));
  }, []);

  const setSelectedProfiles = useCallback((profiles: CopilotProfile[]) => {
    setState(prev => ({ ...prev, selectedProfiles: profiles }));
  }, []);

  const setActiveJob = useCallback((job: CopilotJob | null) => {
    setState(prev => ({ ...prev, activeJob: job }));
  }, []);

  const setActiveConversation = useCallback((conversation: any | null) => {
    setState(prev => ({ ...prev, activeConversation: conversation }));
  }, []);

  const setCurrentFilters = useCallback((filters: any | null) => {
    setState(prev => ({ ...prev, currentFilters: filters }));
  }, []);

  // Chat functionality
  const sendMessage = useCallback(async (message: string) => {
    const userMessage: CopilotMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isLoading: true,
    }));

    try {
      // Build context for the copilot edge function
      const context = {
        page: state.currentPage,
        selectedJobId: state.activeJob?.id,
        selectedProfiles: state.selectedProfiles,
        activeConversation: state.activeConversation,
        currentFilters: state.currentFilters,
      };

      const history = state.messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copilot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          message,
          context,
          history,
          action: 'chat',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response from Copilot');
      }

      const data = await response.json();

      const assistantMessage: CopilotMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message || 'Je n\'ai pas pu traiter ta demande.',
        timestamp: new Date(),
        actions: data.actions,
        data: data.data,
      };

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
        isLoading: false,
        suggestions: data.actions || [],
      }));
    } catch (error) {
      console.error('Copilot error:', error);
      
      const errorMessage: CopilotMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Désolé, une erreur s\'est produite. Réessaie dans quelques instants.',
        timestamp: new Date(),
      };

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, errorMessage],
        isLoading: false,
      }));
    }
  }, [state.currentPage, state.activeJob, state.selectedProfiles, state.activeConversation, state.currentFilters, state.messages]);

  const clearMessages = useCallback(() => {
    setState(prev => ({ ...prev, messages: [], suggestions: [] }));
  }, []);

  // Action execution
  const executeAction = useCallback(async (action: CopilotAction) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copilot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          message: `Execute action: ${action.type}`,
          context: {
            page: state.currentPage,
            selectedJobId: state.activeJob?.id,
            selectedProfiles: state.selectedProfiles,
          },
          history: [],
          action: 'execute',
          actionData: action,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to execute action');
      }

      const data = await response.json();

      // Add execution result as a message
      const resultMessage: CopilotMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message || `Action "${action.label}" exécutée.`,
        timestamp: new Date(),
        data: data.executed,
      };

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, resultMessage],
      }));
    } catch (error) {
      console.error('Action execution error:', error);
    }
  }, [state.currentPage, state.activeJob, state.selectedProfiles]);

  const setSuggestions = useCallback((suggestions: CopilotAction[]) => {
    setState(prev => ({ ...prev, suggestions }));
  }, []);

  // Keyboard shortcut (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape' && state.isOpen) {
        close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle, close, state.isOpen]);

  const value: CopilotContextValue = {
    ...state,
    open,
    close,
    toggle,
    minimize,
    registerPage,
    setSelectedProfiles,
    setActiveJob,
    setActiveConversation,
    setCurrentFilters,
    sendMessage,
    clearMessages,
    executeAction,
    setSuggestions,
  };

  return (
    <CopilotContext.Provider value={value}>
      {children}
    </CopilotContext.Provider>
  );
}

export function useCopilot() {
  const context = useContext(CopilotContext);
  if (!context) {
    throw new Error('useCopilot must be used within a CopilotProvider');
  }
  return context;
}

// Hook for pages to register their context
export function useRegisterCopilotContext(page: CopilotPage) {
  const { registerPage } = useCopilot();
  
  useEffect(() => {
    registerPage(page);
  }, [page, registerPage]);
}
