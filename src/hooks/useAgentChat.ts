// Types only — the `useAgentChat` hook was replaced by the streaming flow in
// `AgentChatPanel.tsx` (direct fetch + Realtime subscription). These interfaces
// are still imported by AgentChatPanel / AgentConversationsList /
// AgentMessageBubble / AgentThinkingDisplay.

export interface AgentMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'status';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentConversation {
  id: string;
  organization_id: string;
  created_by: string;
  job_id: string | null;
  job_title: string | null;
  project_id: string | null;
  status: string;
  search_config: Record<string, unknown>;
  results_summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ThinkingPhase {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done';
}
