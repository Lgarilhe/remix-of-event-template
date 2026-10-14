import { useSyncExternalStore } from 'react';
import type { SourcingProject, UpdateProjectInput, CreateProjectInput } from '@/hooks/useSourcingProjects';
import type { FixtureState, FixtureWindow } from './types';

// Only identity and remote data boundaries are simulated. The search screen,
// React scheduler, cache, account selection and search actions remain real.
const w = window as FixtureWindow;
w.qaState ??= {};
w.qaProjects ??= {};
w.qaWrites ??= [];
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const snapshot = () => version;
const notify = () => { version++; listeners.forEach(fn => fn()); };
w.qaPatch = patch => { Object.assign(w.qaState, patch); notify(); };
w.qaSetProject = project => { w.qaProjects[project.id] = project; notify(); };
export function useFixture(): FixtureState { useSyncExternalStore(subscribe, snapshot); return w.qaState; }
const noop = () => {};
const user = () => ({ id: w.qaState.userId ?? 'user-a', email: 'fixture@example.test', user_metadata: { full_name: 'Recruteur QA' } });
const session = () => ({ access_token: 'fixture-only', user: user() });
export const useAuthReady = () => { useFixture(); return { user: user(), session: session(), isReady: true }; };
export const useAuth = useAuthReady;
export const useOrganization = () => {
  const state = useFixture();
  const id = state.organizationId ?? 'org-a';
  return { organizationId: id, orgType: state.orgType ?? 'agency', organization: { id, name: 'Organisation QA' }, isAdmin: !state.collaborator, isOwner: !state.collaborator, isCollaborator: !!state.collaborator, isLoading: false };
};
const allAccounts = [
  { id: 'account-a', name: 'Compte Alice', status: 'OK', type: 'LINKEDIN', subscriptions: { recruiter: true }, connection_params: { im: { id: 'fixture-a' } } },
  { id: 'account-b', name: 'Compte Béatrice', status: 'OK', type: 'LINKEDIN', subscriptions: { recruiter: true }, connection_params: { im: { id: 'fixture-b' } } },
];
export const useLinkedInAccounts = () => {
  const state = useFixture();
  return { accounts: state.accountIds ? allAccounts.filter(account => state.accountIds!.includes(account.id)) : allAccounts,
    loading: state.accountsReady === false, ready: state.accountsReady !== false, reload: noop };
};
export const useMemberLinkedInAccounts = () => ({
  getUserLinkedAccountId: () => 'account-a', isLoading: false, isReady: true, isError: false,
  getMappingForAccount: (accountId: string) => ({ user_id: user().id, linkedin_account_id: accountId, account_status: 'OK' }),
  mappings: [{ user_id: user().id, linkedin_account_id: 'account-a' }], refetch: noop,
});
export const useAgent = () => ({ openContextualAgent: noop });

export const useAgentMemoryContext = () => {
  const state = useFixture();
  const ready = state.memoryReady !== false;
  const memories = state.memoryRevision ? [{ id: 'memory-rule', version: state.memoryRevision, content: 'Connaissance métier', scope: 'organization', kind: 'preference', effects: ['search'], status: 'confirmed', updated_at: `2026-10-12T00:00:0${state.memoryRevision}Z` }] : [];
  return { data: ready ? { memories, can_manage_org: true, can_manage_project: true } : undefined,
    isSuccess: ready, isPending: !ready, isFetching: !ready, isError: false, refetch: noop };
};
export const useAgentMemoryProposals = () => ({ data: [], isPending: false, isError: false, refetch: noop });
export const useAgentMemoryActions = () => ({ archiveMemory: noop, createMemory: noop, confirmProposal: noop, dismissProposal: noop });
export const useAgentMemoryAutomation = () => ({ data: { mode: 'manual', version: 1, can_suggest: false, calibration_count: 0, suggestion_dismissed: false }, isPending: false, isError: false, isSaving: false, setMode: noop });

const heldWrites: Array<() => void> = [];
w.qaReleaseWrites = () => { heldWrites.splice(0).forEach(fn => fn()); };
const updateProject = (payload: UpdateProjectInput) => {
  if (w.qaState.failSave) return Promise.reject(new Error('Enregistrement indisponible. Réessayez.'));
  if (payload.expectedUpdatedAt && payload.expectedUpdatedAt !== w.qaProjects[payload.id]?.updated_at) return Promise.reject(new Error('Mission modifiée ailleurs.'));
  w.qaWrites.push(structuredClone(payload));
  return new Promise<SourcingProject>(resolve => {
    const finish = () => {
      const { expectedUpdatedAt: _expected, ...fields } = payload;
      const project = { ...w.qaProjects[payload.id], ...fields, updated_at: new Date().toISOString() } as SourcingProject;
      w.qaProjects[payload.id] = project;
      notify(); resolve(project);
    };
    if (w.qaState.holdWrites) heldWrites.push(finish); else queueMicrotask(finish);
  });
};
const createProject = async (payload: CreateProjectInput) => {
  if (w.qaState.failSave) throw new Error('Enregistrement indisponible. Réessayez.');
  const project = { id: 'search-guided', organization_id: 'org-a', created_by: 'user-a', status: 'active', updated_at: new Date().toISOString(), filters_snapshot: {}, ...payload } as SourcingProject;
  w.qaProjects[project.id] = project; notify(); return project;
};
export const useSourcingProjects = () => ({ updateProject, createProject, projects: Object.values(w.qaProjects), findOrCreateForJob: noop });
// Same query contract as the real hook; read the current fixture state when
// invoked, including writes performed after these options were created.
export function sourcingProjectQueryOptions(projectId: string, userId: string | null) {
  return {
    queryKey: ['sourcing-project', projectId] as ['sourcing-project', string],
    queryFn: async (): Promise<SourcingProject | null> => {
      if (!projectId) return null;
      if (!userId) throw new Error('Not authenticated');
      return w.qaProjects[projectId] ?? null;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  };
}
export const useSourcingProject = (id?: string) => { useFixture(); return { data: id ? w.qaProjects[id] : undefined, isLoading: false, error: null }; };

const statuses = new Map(Object.entries(w.qaStatuses ?? {}));
const empty = new Set<string>();
const batchSaveScores = async (rows: Array<{ id: string; name?: string; score: number; recommendation: string; scoringDetails?: Record<string, unknown>; linkedinProfileData?: unknown }>) => {
  w.qaScoreWrites ??= [];
  w.qaScoreWrites.push(structuredClone(rows));
  for (const row of rows) statuses.set(row.id, {
    candidate_id: row.id, candidate_name: row.name ?? row.id, status: 'scored',
    score: row.score, recommendation: row.recommendation,
    scoring_details: row.scoringDetails, linkedin_profile_data: row.linkedinProfileData,
  });
  notify();
};
export const useJobCandidateStatus = () => ({
  statuses, treatedIds: empty, dismissedIds: empty, shortlistedIds: empty, messagedIds: empty,
  getStatus: (id: string) => statuses.get(id), isLoading: false, batchDiscover: async () => {},
  saveScore: async () => {}, batchSaveScores, updateStatus: async () => {},
  batchUpdateStatus: async () => {}, markDiscovered: async () => {},
});

// Local Supabase double: no credentials, external URLs or production writes.
function from(table: string) {
  let single = false;
  let id = '';
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'in', 'is', 'not', 'order', 'limit', 'range', 'or', 'ilike', 'gte', 'lte', 'insert', 'update', 'upsert', 'delete', 'match']) chain[method] = () => chain;
  chain.eq = (key: string, value: string) => { if (key === 'id') id = value; return chain; };
  chain.single = chain.maybeSingle = () => { single = true; return chain; };
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve({ data: table === 'sourcing_projects' && single ? w.qaProjects[id] ?? null : single ? null : [], error: null, count: 0 }).then(resolve, reject);
  return chain;
}
export const supabase = {
  from,
  rpc: async (name: string) => ({ data: name === 'get_base_konekt_state' ? { enabled: !!w.qaState.baseEnabled, plan_allows: w.qaState.basePlanAllows ?? !!w.qaState.baseEnabled, included_remaining: 10, credits_per_search: 2 } : null, error: null }),
  auth: { getUser: async () => ({ data: { user: user() } }), getSession: async () => ({ data: { session: session() } }), refreshSession: async () => ({ data: { session: session() } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }) },
  functions: { invoke: async (name: string, options: { body: unknown }) => {
    const response = await fetch('/qa-api/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) });
    return { data: await response.json(), error: response.ok ? null : new Error('Fixture refusée') };
  } },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: noop,
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
};
