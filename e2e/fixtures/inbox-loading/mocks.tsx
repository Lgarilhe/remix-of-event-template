import { useSyncExternalStore } from 'react';
import type { FixtureWindow, FixtureState, QueryOperation, Row } from './types';
const w = window as FixtureWindow;
const user = { id: 'user-a', email: 'laurent@example.test', user_metadata: { full_name: 'Laurent' } };
const session = { user, access_token: 'fixture' };
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const snapshot = () => version;
w.qaSetState = (patch: FixtureState) => { Object.assign(w.qaState, patch); version++; listeners.forEach(fn => fn()); };
w.qaState ??= {};
const useFixture = () => { useSyncExternalStore(subscribe, snapshot); return w.qaState; };
const reload = async () => { w.qaReloads = (w.qaReloads || 0) + 1; w.qaSetState({ accountsReady: true, accountsLoading: false, accountsError: false, mappingsReady: true, mappingsError: false }); };
const getUserLinkedAccountId = (id: string) => { const s = w.qaState; return s.mappingsReady && s.mapping !== false && id === 'user-a' ? 'account' : null; };
export const useAuthReady = () => { const s = useFixture(); return { user: s.authReady === false ? null : user, isReady: s.authReady !== false, session: s.authReady === false ? null : session }; };
export const useOrganization = () => { const s = useFixture(); return { organizationId: s.orgReady === false ? null : 'org-a', organization: { id: 'org-a', name: 'Konekt' }, isAdmin: true }; };
export const useLinkedInAccounts = () => { const s = useFixture(); return { accounts: s.accountsReady && s.mapping !== false ? [{ id: 'account', name: 'Laurent QA', type: 'LINKEDIN', status: 'OK', connection_params: { im: { id: 'me' } } }] : [], ready: !!s.accountsReady, loading: !!s.accountsLoading, loadError: !!s.accountsError, reload }; };
export const useMemberLinkedInAccounts = () => { const s = useFixture(); return { getUserLinkedAccountId, mappings: s.mappingsReady && s.mapping !== false ? [{ user_id: 'user-a', linkedin_account_id: 'account', account_status: 'OK' }] : [], isReady: !!s.mappingsReady, isError: !!s.mappingsError, isLoading: !s.mappingsReady, refetch: reload }; };
export const supabase = {
  from: query,
  rpc: async () => ({ data: [], error: null }),
  functions: { invoke: async (name: string, options: { body: Row }) => {
    w.qaCalls ??= [];
    w.qaCalls.push({ name, body: options.body, at: performance.now() });
    try {
      const response = await fetch('/qa-api/' + name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) });
      return { data: await response.json() as unknown, error: response.ok ? null : new Error('Fixture indisponible') };
    } catch (error) { return { data: null, error }; }
  } },
  auth: {
    onAuthStateChange: (callback: (event: string, value: typeof session) => void) => { queueMicrotask(() => callback('SIGNED_IN', session)); return { data: { subscription: { unsubscribe() {} } } }; },
    getUser: async () => ({ data: { user } }),
    getSession: async () => ({ data: { session } }),
    refreshSession: async () => ({ data: { session } }),
  },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }),
  removeChannel: () => {},
};
interface QueryResult { data: Row | Row[] | null; error: Error | null }
const methods = ['select', 'eq', 'in', 'not', 'ilike', 'order', 'or', 'range', 'is', 'update', 'upsert', 'insert', 'delete', 'limit', 'neq', 'gte', 'lte'] as const;
type QueryBuilder = PromiseLike<QueryResult> & Record<typeof methods[number], (...args: unknown[]) => QueryBuilder> & { maybeSingle: () => QueryBuilder; single: () => QueryBuilder };
function query(table: string): QueryBuilder {
  const operations: QueryOperation[] = [];
  let single = false;
  const result = (): Promise<QueryResult> => {
    w.qaQueries ??= [];
    w.qaQueries.push({ table, operations, at: performance.now() });
    let data = [...(w.qaTables?.[table] || [])];
    for (const [method, args] of operations) {
      const column = String(args[0]);
      if (method === 'eq') data = data.filter(row => row[column] === args[1]);
      if (method === 'neq') data = data.filter(row => row[column] !== args[1]);
      if (method === 'in') { const values = Array.isArray(args[1]) ? args[1] : []; data = data.filter(row => values.includes(row[column])); }
      if (method === 'not') data = data.filter(row => row[column] != null);
      if (method === 'ilike') data = data.filter(row => String(row[column]).includes(String(args[1]).replace(/%/g, '')));
      if (method === 'or' && table === 'sequence_enrollments') { const parts = [...column.matchAll(/(\w+)\.eq\."([^"]*)"/g)]; data = data.filter(row => parts.some(part => row[part[1]] === part[2])); }
    }
    const range = operations.find(([method]) => method === 'range')?.[1];
    if (range) data = data.slice(Number(range[0]), Number(range[1]) + 1);
    return new Promise(resolve => setTimeout(() => resolve(w.qaFailTable === table ? { data: null, error: new Error('Lecture indisponible') } : { data: single ? data[0] || null : data, error: null }), w.qaTableDelays?.[table] || 0));
  };
  const chain = Object.fromEntries(methods.map(method => [method, (...args: unknown[]) => { operations.push([method, args]); return builder; }])) as Record<typeof methods[number], (...args: unknown[]) => QueryBuilder>;
  const asSingle = () => { single = true; return builder; };
  const builder: QueryBuilder = { ...chain, then: (resolve, reject) => result().then(resolve, reject), maybeSingle: asSingle, single: asSingle };
  return builder;
}
