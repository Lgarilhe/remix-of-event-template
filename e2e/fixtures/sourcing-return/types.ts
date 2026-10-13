import type { SourcingProject } from '@/hooks/useSourcingProjects';

export interface FixtureState {
  organizationId?: string;
  userId?: string;
  orgType?: 'agency' | 'enterprise' | 'freelance';
  collaborator?: boolean;
  memoryReady?: boolean;
  memoryRevision?: number;
  holdWrites?: boolean;
  accountsReady?: boolean;
  accountIds?: string[];
  projectId?: string;
  baseEnabled?: boolean;
  failSave?: boolean;
}
export interface FixtureCandidateStatus {
  candidate_id: string;
  candidate_name: string;
  status: string;
  score?: number;
  recommendation?: string;
  scoring_details?: Record<string, unknown>;
  linkedin_profile_data?: unknown;
}
export interface FixtureWindow extends Window {
  qaState: FixtureState;
  qaProjects: Record<string, SourcingProject>;
  qaWrites: Array<{ id: string; filters_snapshot?: Record<string, unknown>; job_details?: unknown; expectedUpdatedAt?: string }>;
  qaStatuses?: Record<string, FixtureCandidateStatus>;
  qaScoreWrites?: Array<Array<{ id: string; score: number }>>;
  qaSourceHashes?: Record<string, string>;
  qaPatch: (patch: FixtureState) => void;
  qaReleaseWrites: () => void;
  qaSetProject: (project: SourcingProject) => void;
}
