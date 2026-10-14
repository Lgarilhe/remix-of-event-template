import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Real handler; only authentication, database and provider transports are replaced.
async function preview({ status = 403, member = true } = {}) {
  let handler;
  const calls = [], rpcCalls = [], charges = [];
  const database = {
    from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { coresignal_enabled: true }, error: null }) }),
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return { data: name === 'reserve_base_konekt_included' ? 'reserved-search' : true, error: null };
    },
  };
  const dependencies = {
    'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check': { createClient: () => database },
    '../_shared/require-auth.ts': { requireAuth: async () => ({ userId: 'user-a' }), verifyOrgMembership: async () => member },
    '../_shared/resolve-org-credentials.ts': { resolveCoresignalCredentials: async () => ({ apiKey: 'fixture-only' }) },
    '../_shared/coresignal-mapping.ts': { mapFiltersToEsDsl: () => ({ query: { match_all: {} } }) },
    '../_shared/settle-credits.ts': { settleCredits: async args => { charges.push(args); return { success: true }; } },
    '../_shared/ai-config.ts': { ACTION_COSTS: {} },
    '../_shared/subscription-gate.ts': { getSubscriptionGate: async () => ({ effectivePlanId: 'pro' }) },
  };
  const source = readFileSync(new URL('../../supabase/functions/coresignal-search/index.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, {
    exports: {}, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; },
    Response, Request, AbortController, setTimeout, clearTimeout,
    console: { error() {}, log() {}, warn() {} },
    fetch: async url => { calls.push(url); return new Response(JSON.stringify({ message: 'You cannot consume this service' }), { status }); },
    Deno: { env: { get: () => 'fixture-only' }, serve: fn => { handler = fn; } },
  });
  const response = await handler(new Request('http://fixture.test', { method: 'POST', body: JSON.stringify({ action: 'preview', organization_id: 'org-a', filters: {} }) }));
  return { response, body: await response.json(), calls, rpcCalls, charges };
}

for (const [status, type] of [[403, 'PROVIDER_ACCESS_DENIED'], [401, 'PROVIDER_AUTH']]) {
  test(`Provider ${status} gives a support action, makes no retry and returns the included search`, async () => {
    const result = await preview({ status });
    assert.equal(result.response.status, 503);
    assert.equal(result.body.errorType, type);
    assert.equal(result.body.retryable, false);
    assert.match(result.body.error, /assistance/);
    assert.doesNotMatch(result.body.error, /Coresignal|clé|apikey|401|403|session expirée/i);
    assert.equal(result.calls.length, 1);
    assert.match(result.calls[0], /employee_multi_source\/search\/es_dsl$/);
    assert.deepEqual(result.charges, []);
    assert.equal(result.rpcCalls.filter(c => c.name === 'release_base_konekt_usage').length, 1);
    assert.equal(result.rpcCalls.find(c => c.name === 'release_base_konekt_usage').args.p_usage_id, 'reserved-search');
  });
}
test('Foreign organization never reaches the supplier or reserves a search', async () => {
  const result = await preview({ member: false });
  assert.equal(result.response.status, 403);
  assert.deepEqual(result.calls, []);
  assert.deepEqual(result.rpcCalls, []);
});

function credentials({ rows = {}, errors = {}, globalKey = 'global-fixture' } = {}) {
  let now = 0, reads = 0;
  const source = readFileSync(new URL('../../supabase/functions/_shared/resolve-org-credentials.ts', import.meta.url), 'utf8');
  const exports = {};
  const database = { from: () => {
    let org;
    return { select() { return this; }, eq(_field, value) { org = value; return this; }, single: async () => { reads++; return { data: rows[org] ? { coresignal_api_key: rows[org] } : null, error: errors[org] ?? null }; } };
  } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: () => ({ createClient: () => database }), Date: { now: () => now },
    console: { error() {}, log() {}, warn() {} }, Deno: { env: { get: name => name === 'CORESIGNAL_API_KEY' ? globalKey : undefined } },
  });
  return { resolve: id => exports.resolveCoresignalCredentials(id, database), advance: ms => { now += ms; }, reads: () => reads };
}
test('Repeated org searches keep the global key when no org key is configured', async () => {
  const h = credentials();
  for (let i = 0; i < 3; i++) assert.equal((await h.resolve('org-a')).apiKey, 'global-fixture');
  assert.equal(h.reads(), 1);
});
test('Org keys remain isolated; a new org key takes over after the negative cache expires', async () => {
  const rows = { 'org-b': 'org-b-fixture' };
  const h = credentials({ rows });
  assert.equal((await h.resolve('org-a')).apiKey, 'global-fixture');
  assert.equal((await h.resolve('org-b')).apiKey, 'org-b-fixture');
  assert.equal((await h.resolve('org-a')).apiKey, 'global-fixture');
  rows['org-a'] = 'org-a-fixture'; h.advance(60001);
  assert.equal((await h.resolve('org-a')).apiKey, 'org-a-fixture');
  assert.equal((await h.resolve('org-b')).apiKey, 'org-b-fixture');
});
test('Transient config read failure is not cached; a deployment with no key stays closed', async () => {
  const errors = { 'org-a': { code: '503' } }, rows = {};
  const h = credentials({ rows, errors });
  assert.equal((await h.resolve('org-a')).apiKey, 'global-fixture');
  delete errors['org-a']; rows['org-a'] = 'org-a-fixture';
  assert.equal((await h.resolve('org-a')).apiKey, 'org-a-fixture');
  assert.equal(h.reads(), 2);
  const empty = credentials({ globalKey: null });
  assert.equal(await empty.resolve('org-a'), null);
  assert.equal(await empty.resolve('org-a'), null);
});
