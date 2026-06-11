// Types du chat agent (table agent_conversations).
// Anciennement déclarés dans src/hooks/useAgentChat.ts (hook legacy supprimé,
// remplacé par le flux streaming AgentChatPanel + assistant-ui).

export interface AgentConversation {
  id: string;
  organization_id: string;
  created_by: string;
  job_id: string | null;
  job_title: string | null;
  title: string | null;
  project_id: string | null;
  status: string;
  search_config: Record<string, unknown>;
  results_summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
