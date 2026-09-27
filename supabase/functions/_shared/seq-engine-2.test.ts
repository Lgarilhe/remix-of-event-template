// Moteur de séquences, lot « engine-2 » : gate de quota LinkedIn en panne.
//
// quota-enforce-fail-closed : en mode automatique (moteur de séquences), une
// erreur ou une exception de la RPC check_linkedin_action_quota refuse l'action
// (fail-closed, scope 'rpc_error' ou 'exception') ; en mode manuel elle est
// autorisée. process-sequences (checkQuotaForAction) range ces deux scopes en
// 'infrastructure', que quotaBlockedRetryAt reporte de 30 min.
//
//   deno test --no-check supabase/functions/_shared/seq-engine-2.test.ts

import { deepStrictEqual, strictEqual } from 'node:assert';
import { DEFAULT_USER_QUOTAS, enforceLinkedInAction } from './linkedin-quotas.ts';
import { quotaBlockedRetryAt } from './sequence-cycle-rules.ts';

type RpcImpl = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Client simulé : lectures vides (ancienneté du compte inconnue), RPC scriptée. */
function fakeAdmin(rpc: RpcImpl) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'gte']) chain[m] = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  const admin = {
    from: () => chain,
    rpc: (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return rpc(fn, args); },
  };
  return { admin, calls };
}

const rpcError: RpcImpl = () => Promise.resolve({ data: null, error: { message: 'connection refused' } });
const rpcThrows: RpcImpl = () => Promise.reject(new Error('fetch failed'));

const baseOpts = { accountId: 'acc_e2e_quota', actionType: 'message' as const, quotas: DEFAULT_USER_QUOTAS, source: 'sequence' };

Deno.test('quota-enforce-fail-closed : mode automatique, erreur de la RPC → refus, scope rpc_error', async () => {
  const { admin, calls } = fakeAdmin(rpcError);
  // deno-lint-ignore no-explicit-any
  const r = await enforceLinkedInAction(admin as any, { ...baseOpts, mode: 'auto' });
  strictEqual(r.allowed, false);
  strictEqual(r.scope, 'rpc_error');
  strictEqual(calls.length, 1);
  strictEqual(calls[0].fn, 'check_linkedin_action_quota');
});

Deno.test('quota-enforce-fail-closed : mode automatique, exception de la RPC → refus, scope exception', async () => {
  const { admin } = fakeAdmin(rpcThrows);
  // deno-lint-ignore no-explicit-any
  const r = await enforceLinkedInAction(admin as any, { ...baseOpts, mode: 'auto' });
  strictEqual(r.allowed, false);
  strictEqual(r.scope, 'exception');
});

Deno.test('quota-enforce-fail-closed : sans mode précisé (moteur de séquences), comportement automatique', async () => {
  for (const rpc of [rpcError, rpcThrows]) {
    const { admin } = fakeAdmin(rpc);
    // deno-lint-ignore no-explicit-any
    const r = await enforceLinkedInAction(admin as any, { ...baseOpts });
    strictEqual(r.allowed, false, 'fail-closed par défaut');
  }
});

Deno.test('quota-enforce-fail-closed : mode manuel, erreur ou exception de la RPC → autorisé', async () => {
  const expected: Array<[RpcImpl, string]> = [[rpcError, 'rpc_error'], [rpcThrows, 'exception']];
  for (const [rpc, scope] of expected) {
    const { admin } = fakeAdmin(rpc);
    // deno-lint-ignore no-explicit-any
    const r = await enforceLinkedInAction(admin as any, { ...baseOpts, mode: 'manual' });
    strictEqual(r.allowed, true);
    strictEqual(r.scope, scope);
  }
});

Deno.test('quota-enforce-fail-closed : réponse normale de la RPC relayée telle quelle', async () => {
  const { admin } = fakeAdmin(() => Promise.resolve({ data: { allowed: false, reason: 'Plafond du jour atteint', scope: 'daily_visible', count: 20 }, error: null }));
  // deno-lint-ignore no-explicit-any
  const r = await enforceLinkedInAction(admin as any, { ...baseOpts, mode: 'auto' });
  deepStrictEqual([r.allowed, r.scope, r.reason], [false, 'daily_visible', 'Plafond du jour atteint']);
});

Deno.test("quota-enforce-fail-closed : refus d'infrastructure reporté de 30 min par le moteur", () => {
  const now = new Date('2026-09-27T16:00:00Z');
  strictEqual(quotaBlockedRetryAt('infrastructure', now, 'Europe/Paris', 8).getTime(), now.getTime() + 30 * 60_000);
});
