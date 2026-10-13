import { useSyncExternalStore } from 'react';
import type { CandidateFixtureState, CandidateFixtureWindow, Operation, Row } from './types';
import { clearOrgIdCache } from '@/lib/orgContext';
const w = window as CandidateFixtureWindow;
let version = 0;
const listeners = new Set<() => void>();
const pendingReads = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
w.qaCandidatePatch = patch => { Object.assign(w.qaCandidateState, patch); if (patch.organizationId || patch.userId) { clearOrgIdCache(); w.qaCandidateTables.profiles = [{ user_id: w.qaCandidateState.userId, active_organization_id: w.qaCandidateState.organizationId, display_name: 'Laurent' }]; } version++; listeners.forEach(fn => fn()); };
w.qaCandidateQueries ??= [];
w.qaCandidateCalls ??= [];
w.qaCandidateWrites ??= [];
w.qaCandidateNotificationWrites ??= [];
w.qaCandidateFailures ??= [];
const useFixture = (): CandidateFixtureState => { useSyncExternalStore(subscribe, () => version); return w.qaCandidateState; };
const users = new Map<string, { id: string; email: string; user_metadata: { full_name: string } }>();
const sessions = new Map<string, { user: ReturnType<typeof user>; access_token: string }>();
function user() { const id = w.qaCandidateState.userId; if (!users.has(id)) users.set(id, { id, email: 'recruteur@example.test', user_metadata: { full_name: 'Laurent' } }); return users.get(id)!; }
function session() { const id = user().id; if (!sessions.has(id)) sessions.set(id, { user: user(), access_token: 'eyJhbGciOiJIUzI1NiJ9.' + btoa(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })) + '.fixture' }); return sessions.get(id)!; }
const reload = async () => { w.qaCandidatePatch({ accountsReady: true, mappingsReady: true }); };
const mappedAccount = (id: string) => id === w.qaCandidateState.userId ? w.qaCandidateState.accountId : id === 'colleague' ? 'account-colleague' : null;
export const useAuthReady = () => { useFixture(); return { user: user(), session: session(), isReady: true }; };
export const useOrganization = () => { const s = useFixture(); return { organizationId: s.organizationId, organization: { id: s.organizationId, name: s.organizationId === 'org-a' ? 'Cabinet Alpha' : 'Entreprise Bêta', type: s.organizationType, account_type: s.organizationType }, organizationType: s.organizationType, isAdmin: true }; };
export const useLinkedInAccounts = () => { const s = useFixture(); return { accounts: [...(s.accountId ? [{ id: s.accountId, name: 'Compte personnel', type: 'LINKEDIN', status: 'OK', connection_params: { im: { id: 'me' } } }] : []), { id: 'account-colleague', name: 'Compte collègue', type: 'LINKEDIN', status: 'OK' }], ready: s.accountsReady, loading: !s.accountsReady, loadError: false, reload }; };
export const useMemberLinkedInAccounts = () => { const s = useFixture(); return { mappings: [...(s.accountId ? [{ user_id: s.userId, linkedin_account_id: s.accountId, account_status: 'OK' }] : []), { user_id: 'colleague', linkedin_account_id: 'account-colleague', account_status: 'OK' }], getUserLinkedAccountId: mappedAccount, isReady: s.mappingsReady, isError: false, isLoading: !s.mappingsReady, refetch: reload }; };

interface QueryResult { data: Row | Row[] | null; error: Error | null; count?: number }
const methods = ['select', 'eq', 'neq', 'in', 'not', 'is', 'ilike', 'like', 'or', 'order', 'limit', 'range', 'gte', 'lte', 'gt', 'lt', 'contains', 'update', 'upsert', 'insert', 'delete'] as const;
type QueryBuilder = PromiseLike<QueryResult> & Record<typeof methods[number], (...args: unknown[]) => QueryBuilder> & { maybeSingle: () => QueryBuilder; single: () => QueryBuilder };
const columnValue = (row: Row, column: string) => column.includes('->>') ? (row[column.split('->>')[0]] as Row | undefined)?.[column.split('->>')[1]] : row[column];
function ilike(value: unknown, pattern: unknown) {
  const escaped = String(pattern).replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replaceAll('%', '.*').replaceAll('_', '.');
  return new RegExp('^' + escaped + '$', 'i').test(String(value ?? ''));
}
function query(table: string): QueryBuilder {
  const operations: Operation[] = [];
  let single = false;
  const result = async (): Promise<QueryResult> => {
    w.qaCandidateQueries.push({ table, operations });
    const mutation = operations.some(([method]) => ['insert', 'update', 'upsert', 'delete'].includes(method));
    if (mutation) {
      const item = { table, operations };
      if (table === 'notifications') { w.qaCandidateNotificationWrites.push(item); return { data: null, error: null }; }
      w.qaCandidateWrites.push(item);
      if (w.qaCandidateAllowedWrites?.includes(table) && table === 'candidate_notes') {
        const payload = operations.find(([method]) => method === 'insert')?.[1][0] as Row | undefined;
        if (payload) { const note = { ...payload, id: 'note-created-by-gesture', created_at: '2026-10-13T11:00:00Z' }; (w.qaCandidateTables[table] ??= []).push(note); return { data: single ? note : [note], error: null }; }
      }
      return { data: null, error: new Error('Écriture candidat interdite dans le harnais') };
    }
    let data = [...(w.qaCandidateTables?.[table] ?? [])];
    for (const [method, args] of operations) {
      const column = String(args[0]);
      if (method === 'eq') data = data.filter(row => columnValue(row, column) === args[1]);
      if (method === 'neq') data = data.filter(row => columnValue(row, column) !== args[1]);
      if (method === 'in') data = data.filter(row => Array.isArray(args[1]) && args[1].includes(columnValue(row, column)));
      if (method === 'not') data = data.filter(row => columnValue(row, column) != null);
      if (method === 'is') data = data.filter(row => args[1] === null ? columnValue(row, column) == null : columnValue(row, column) === args[1]);
      if (method === 'ilike' || method === 'like') data = data.filter(row => ilike(columnValue(row, column), args[1]));
      if (method === 'or') {
        const terms = [...column.matchAll(/([\w]+)\.(eq|ilike)\.(?:"([^"]*)"|([^,]+))/g)];
        if (terms.length) data = data.filter(row => terms.some(term => term[2] === 'eq' ? String(row[term[1]]) === (term[3] ?? term[4]) : ilike(row[term[1]], term[3] ?? term[4])));
      }
      if (method === 'order') { const asc = (args[1] as { ascending?: boolean } | undefined)?.ascending !== false; data.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (asc ? 1 : -1)); }
      if (method === 'limit') data = data.slice(0, Number(args[0]));
      if (method === 'range') data = data.slice(Number(args[0]), Number(args[1]) + 1);
    }
    const org = operations.find(([method, args]) => method === 'eq' && args[0] === 'organization_id')?.[1][1];
    if (w.qaCandidateDelayTable === table && (!w.qaCandidateDelayOrg || w.qaCandidateDelayOrg === org)) await new Promise<void>(resolve => { pendingReads.add(resolve); w.qaCandidateRelease = () => { for (const release of pendingReads) release(); pendingReads.clear(); }; });
    if (w.qaCandidateFailures.includes(table)) return { data: null, error: new Error('Lecture indisponible') };
    return { data: single ? data[0] ?? null : data, error: null, count: data.length };
  };
  const chain = Object.fromEntries(methods.map(method => [method, (...args: unknown[]) => { operations.push([method, args]); return builder; }])) as Record<typeof methods[number], (...args: unknown[]) => QueryBuilder>;
  const asSingle = () => { single = true; return builder; };
  const builder: QueryBuilder = { ...chain, then: (resolve, reject) => result().then(resolve, reject), maybeSingle: asSingle, single: asSingle };
  return builder;
}
export const supabase = {
  from: query,
  rpc: async (name: string, body: Row = {}) => { w.qaCandidateCalls.push({ name: 'rpc:' + name, body }); if (!['get_org_member_emails', 'get_subscription_state', 'get_org_contact_usage'].includes(name)) { w.qaCandidateWrites.push({ table: 'rpc:' + name, operations: [] }); return { data: null, error: new Error('Appel RPC interdit') }; } return { data: [], error: null }; },
  functions: { invoke: async (name: string, options: { body: Row }) => {
    w.qaCandidateCalls.push({ name, body: options.body });
    try {
      const response = await fetch('/qa-candidate-api/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) });
      const data: unknown = await response.clone().json();
      return { data, error: response.ok ? null : Object.assign(new Error('Lecture indisponible'), { context: response }) };
    } catch (error) { return { data: null, error }; }
  } },
  auth: { onAuthStateChange: (callback: (event: string, value: ReturnType<typeof session>) => void) => { queueMicrotask(() => callback('SIGNED_IN', session())); return { data: { subscription: { unsubscribe() {} } } }; }, getUser: async () => ({ data: { user: user() } }), getSession: async () => ({ data: { session: session() } }), refreshSession: async () => ({ data: { session: session() } }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {},
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: new Error('Aucun fichier fictif') }), download: async () => ({ data: null, error: new Error('Aucun fichier fictif') }) }) },
};
