import type { SourcingAgent, SourcingAgentSettings } from '@/types/sourcingAgent';

/** List metadata only: briefs, search snapshots and profile payloads stay in the detail view. */
export type SourcingAgentHubAgent = Pick<SourcingAgent,
  'id' | 'organization_id' | 'project_id' | 'created_by' | 'source' | 'account_id' | 'api' |
  'status' | 'revision' | 'approved_context_key' | 'next_run_at' | 'last_run_at' |
  'lease_until' | 'last_reason' | 'last_error' | 'daily_date' | 'profiles_used' |
  'credits_reserved' | 'credits_used' | 'created_at' | 'updated_at'> & {
  settings: SourcingAgentSettings;
  context_key: string | null;
};

export interface SourcingAgentHubMission {
  id: string;
  organization_id: string;
  created_by: string;
  name: string;
  status: string;
  client_name: string | null;
  job_title: string | null;
  updated_at: string;
}

export interface SourcingAgentHubCounts {
  /** Distinct stored suggestions, across all contexts. */
  total: number;
  /** The following counts describe the agent's saved current context. */
  discovered: number;
  evaluated: number;
  proposed: number;
  reviewed: number;
  fit: number;
  rejected: number;
  skipped: number;
  /** Interrupted evaluations across every context, requiring explicit resolution. */
  uncertain: number;
}

export interface SourcingAgentHubItem {
  agent: SourcingAgentHubAgent;
  mission: SourcingAgentHubMission | null;
  counts: SourcingAgentHubCounts;
  /** Latest persisted agent/candidate update, not an invented execution or run. */
  lastActivityAt: string | null;
}

export interface SourcingAgentsHubData {
  agents: SourcingAgentHubItem[];
  missions: SourcingAgentHubMission[];
}
