import type { AgentMemoryKind, AgentMemoryScope } from './agentMemory';

export interface SourcingMemoryProvenance {
  id: string;
  version: number;
  scope: Exclude<AgentMemoryScope, 'user'>;
  project_id: string | null;
  kind: AgentMemoryKind;
  content: string;
  effects: string[];
}

export interface ScoringContextMetadata {
  fingerprint: string;
  /** Canonical criteria, model and trusted organization/mission actually evaluated. */
  inputVersionKey: string;
  memory: {
    fingerprint: string;
    versionKey: string;
    provenance: SourcingMemoryProvenance[];
  };
}
