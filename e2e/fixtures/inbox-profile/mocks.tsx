import { useSyncExternalStore } from 'react';
import type { ProfileFixtureState, ProfileFixtureWindow, QueryOperation, Row } from './types';

const w = window as ProfileFixtureWindow;
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
w.qaProfilePatch = patch => { Object.assign(w.qaProfileState, patch); version++; listeners.forEach(fn => fn()); };
w.qaProfileQueries ??= [];
w.qaProfileCalls ??= [];
w.qaProfileQuota ??= [];
window.addEventListener('quota:record', event => w.qaProfileQuota.push((event as CustomEvent).detail));
export function useFixture(): ProfileFixtureState { useSyncExternalStore(subscribe, () => version); return w.qaProfileState; }
export const useAuthReady = () => { const s = useFixture(); return { user: s.userId ? { id: s.userId } : null, isReady: !!s.userId }; };
export const useOrganization = () => { const s = useFixture(); return { organizationId: s.organizationId }; };
export const useLinkedInAccounts = () => { const s = useFixture(); return { accounts: s.accountId ? [{ id: s.accountId, status: 'OK' }] : [], ready: s.accountsReady, loadError: false }; };
export const useMemberLinkedInAccounts = () => { const s = useFixture(); return { mappings: s.accountId && s.userId ? [{ user_id: s.userId, linkedin_account_id: s.accountId, account_status: 'OK' }] : [], isReady: s.mappingsReady, isError: false }; };

interface QueryResult { data: Row[] | null; error: Error | null }
const methods = ['select', 'eq', 'in', 'not', 'ilike', 'order', 'limit'] as const;
type QueryBuilder = PromiseLike<QueryResult> & Record<typeof methods[number], (...args: unknown[]) => QueryBuilder>;
function query(table: string): QueryBuilder {
  const operations: QueryOperation[] = [];
  const result = async (): Promise<QueryResult> => {
    w.qaProfileQueries.push({ table, operations });
    const missingColumn = w.qaProfileMissingColumns?.find(column => operations.some(([method, args]) => (method === 'select' && String(args[0]).split(',').map(value => value.trim()).includes(column)) || (method === 'order' && args[0] === column)));
    const error = missingColumn ? new Error(`column ${table}.${missingColumn} does not exist`) : w.qaProfileQueryErrors?.includes(table) ? new Error('Lecture indisponible') : null;
    let data = [...(w.qaProfileTables?.[table] || [])];
    for (const [method, args] of operations) {
      const column = String(args[0]);
      if (method === 'eq') data = data.filter(row => row[column] === args[1]);
      if (method === 'in') data = data.filter(row => Array.isArray(args[1]) && args[1].includes(row[column]));
      if (method === 'not') data = data.filter(row => row[column] != null);
      if (method === 'ilike') {
        const needle = String(args[1]).replace(/^%|%$/g, '').replace(/\\([\\%_])/g, '$1').toLowerCase();
        data = data.filter(row => String(row[column]).toLowerCase().includes(needle));
      }
      if (method === 'limit') data = data.slice(0, Number(args[0]));
    }
    if (w.qaProfileQueryDelay) await new Promise(resolve => setTimeout(resolve, w.qaProfileQueryDelay));
    return { data: error ? null : data, error };
  };
  const chain = Object.fromEntries(methods.map(method => [method, (...args: unknown[]) => { operations.push([method, args]); return builder; }])) as Record<typeof methods[number], (...args: unknown[]) => QueryBuilder>;
  const builder: QueryBuilder = { ...chain, then: (resolve, reject) => result().then(resolve, reject) };
  return builder;
}
export const supabase = {
  from: query,
  functions: { invoke: async (_name: string, options: { body: Row }) => {
    w.qaProfileCalls.push(options.body);
    try {
      const response = await fetch('/qa-profile-api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) });
      const data: unknown = await response.clone().json();
      return { data, error: response.ok ? null : Object.assign(new Error('Lecture indisponible'), { context: response }) };
    } catch (error) { return { data: null, error }; }
  } },
};
