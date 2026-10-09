/** Confirmed agent memories are scoped to stable application identities. */
export type AgentMemoryScope = 'organization' | 'project' | 'user';
export type AgentMemoryKind = 'constraint' | 'preference' | 'method' | 'context';
export type AgentMemoryEffect = 'assistant' | 'search' | 'scoring' | 'presentation';
export type AgentMemoryAutomationMode = 'manual' | 'automatic';

export interface AgentMemoryAutomation {
  mode: AgentMemoryAutomationMode;
  version: number;
  can_suggest: boolean;
  calibration_count: number;
  suggestion_dismissed: boolean;
  enabled_at: string | null;
}

export interface AgentMemoryDraft {
  content: string;
  scope: AgentMemoryScope;
  kind: AgentMemoryKind;
  effects: AgentMemoryEffect[];
}

export interface AgentMemoryProposal extends AgentMemoryDraft {
  id: string;
  organization_id: string;
  created_by: string;
  project_id: string | null;
  source_conversation_id: string | null;
  source_message_id: string | null;
  source_excerpt: string | null;
  legacy_insight_id?: string | null;
  status: 'proposed' | 'approved' | 'dismissed';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AgentMemory extends AgentMemoryDraft {
  id: string;
  organization_id: string;
  proposal_id: string | null;
  project_id: string | null;
  owner_user_id: string | null;
  created_by: string;
  confirmed_by: string;
  confirmed_at: string;
  activation_mode: AgentMemoryAutomationMode;
  automation_version: number | null;
  automation_key: 'response_language' | 'response_length' | 'response_format' | null;
  automation_source_created_at: string | null;
  status: 'active' | 'archived';
  version: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentMemoryContext {
  memories: AgentMemory[];
  can_manage_organization: boolean;
  can_manage_project: boolean;
}

export const AGENT_MEMORY_KIND_LABEL: Record<AgentMemoryKind, string> = {
  constraint: 'Contrainte',
  preference: 'Préférence',
  method: 'Méthode',
  context: 'Contexte',
};

export const AGENT_MEMORY_EFFECT_LABEL: Record<AgentMemoryEffect, string> = {
  assistant: 'Réponses de l’assistant',
  presentation: 'Présentation des résultats',
  search: 'Recherche',
  scoring: 'Évaluation des profils',
};

export const EDITABLE_AGENT_MEMORY_EFFECTS: readonly AgentMemoryEffect[] = ['assistant', 'presentation', 'search', 'scoring'];

/** Shared recruiting decisions must not depend on one recruiter's private preferences. */
export function canUseAgentMemoryEffect(scope: AgentMemoryScope, effect: AgentMemoryEffect): boolean {
  return scope !== 'user' || (effect !== 'search' && effect !== 'scoring');
}

export function isAgentMemoryDraftValid(value: AgentMemoryDraft): boolean {
  return value.content.trim().length >= 5 && value.content.trim().length <= 2000
    && value.effects.length > 0 && value.effects.every((effect) => EDITABLE_AGENT_MEMORY_EFFECTS.includes(effect)
      && canUseAgentMemoryEffect(value.scope, effect));
}

export function agentMemoryScopeLabel(
  scope: AgentMemoryScope,
  orgType: 'agency' | 'enterprise' | 'freelance' | null,
): string {
  if (scope === 'project') return orgType === 'enterprise' ? 'Ce poste' : 'Cette mission';
  if (scope === 'user') return 'Pour moi';
  if (orgType === 'agency') return 'Mon cabinet';
  if (orgType === 'enterprise') return 'Mon entreprise';
  if (orgType === 'freelance') return 'Mon activité';
  return 'Mon organisation';
}

/** Selection is explicit; missing permissions must never imply edit access. */
export function canManageAgentMemory(
  scope: AgentMemoryScope,
  context: Pick<AgentMemoryContext, 'can_manage_organization' | 'can_manage_project'> | undefined,
): boolean {
  if (scope === 'user') return true;
  if (scope === 'organization') return context?.can_manage_organization === true;
  return context?.can_manage_project === true;
}
