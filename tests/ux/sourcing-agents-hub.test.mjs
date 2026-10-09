import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
function compile(path, globals = {}) {
  const source = readFileSync(new URL(path, root), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '');
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
  });
  assert.equal(diagnostics?.length ?? 0, 0);
  const context = { exports: {}, Date, Error, fetch() { throw new Error('No network in hub tests'); }, ...globals };
  vm.runInNewContext(outputText, context, { filename: path });
  return context.exports;
}
const settings = compile('src/types/sourcingAgent.ts');
const helperGlobals = { validSourcingAgentSettings: settings.validSourcingAgentSettings };
const hub = compile('src/hooks/useSourcingAgentsHub.ts', helperGlobals);
const today = new Date().toISOString().slice(0, 10);
const agent = (id = 'agent-a', patch = {}) => ({
  id, organization_id: 'org-a', project_id: 'mission-' + id, created_by: 'user-a', source: 'pool', account_id: null,
  api: null, status: 'active', revision: 2, settings: plain(settings.DEFAULT_SOURCING_AGENT_SETTINGS),
  approved_context_key: 'context-a', context_snapshot: { context_key: 'context-a', private_brief: 'PRIVATE_BRIEF' },
  next_run_at: '2026-10-09T06:00:00Z', last_run_at: '2026-10-08T10:00:00Z', lease_until: null,
  last_reason: null, last_error: null, daily_date: today, profiles_used: 7, credits_reserved: 12, credits_used: 24,
  created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T11:00:00Z', ...patch,
});
const mission = (id = 'mission-agent-a', patch = {}) => ({
  id, organization_id: 'org-a', created_by: 'user-a', kind: 'mission', name: id, status: 'active',
  client_name: 'Client', job_title: 'Engineer', updated_at: '2026-10-08T11:00:00Z', ...patch,
});
const count = (agentId = 'agent-a', patch = {}) => ({
  agent_id: agentId, context_key: 'context-a', total: 0, discovered: 0, evaluated: 0, proposed: 0,
  reviewed: 0, fit: 0, rejected: 0, skipped: 0, uncertain: 0, last_activity_at: '2026-10-08T11:00:00Z', ...patch,
});
function clientFixture(rows = {}, options = {}) {
  const calls = [];
  return { calls,
    rpc(name, args) {
      const call = { rpc: name, args }; calls.push(call);
      assert.equal(name, 'sourcing_agent_hub_counts');
      assert.ok(args.p_agent_ids.length <= 100);
      const result = options.rpcRows ?? (rows.sourcing_agents || []).filter(row =>
        args.p_agent_ids.includes(row.id) && row.organization_id === args.p_organization_id && row.created_by === (options.authUserId || 'user-a'))
        .map(row => count(row.id, { context_key: row.context_snapshot?.context_key ?? null,
          ...(options.countRows || []).find(value => value.agent_id === row.id) }));
      const query = {
        abortSignal(signal) { call.signal = signal; return query; },
        async then(resolve, reject) {
          await options.beforeRpc?.(call);
          return Promise.resolve({ data: options.rpcError ? null : result, error: options.rpcError || null }).then(resolve, reject);
        },
      };
      return query;
    },
    from(table) {
    assert.notEqual(table, 'sourcing_agent_candidates', 'the hub must never transport candidate history');
    const call = { table, filters: {} }; calls.push(call);
    const query = {
      select(columns) { call.columns = columns; return query; },
      eq(key, value) { call.filters[key] = value; return query; },
      in(key, values) { call.in = [key, values]; return query; },
      order(key) { call.order = key; return query; }, limit(value) { call.limit = value; return query; },
      gt(key, value) { call.gt = [key, value]; return query; },
      abortSignal(signal) { call.signal = signal; return query; },
      returns() { return query; },
      async then(resolve, reject) {
        await options.beforeRead?.(call);
        if (options.readError?.table === table) return resolve({ data: null, error: options.readError });
        let result = [...(rows[table] || [])];
        if (!options.ignoreScope) result = result.filter(row => Object.entries(call.filters).every(([key, value]) => row[key] === value));
        if (call.in) result = result.filter(row => call.in[1].includes(row[call.in[0]]));
        if (call.gt) result = result.filter(row => row[call.gt[0]] > call.gt[1]);
        result.sort((a, b) => a[call.order].localeCompare(b[call.order]));
        result = result.slice(0, call.limit).map(row => Object.fromEntries(call.columns.split(',').map(column => {
          if (!column.includes(':')) return [column, row[column]];
          const [alias, path] = column.split(':');
          const [field, leaf] = path.split('->>');
          return [alias, row[field]?.[leaf] ?? null];
        })));
        return Promise.resolve({ data: result, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
}
const read = (client, organizationId = 'org-a', userId = 'user-a', signal = new AbortController().signal, current) =>
  hub.fetchSourcingAgentsHub(client, organizationId, userId, signal, current);

test('hub reads only personal metadata in the active space, including for administrators', async () => {
  const client = clientFixture({
    sourcing_agents: [agent(), agent('other-owner', { created_by: 'another-admin' }), agent('other-org', { organization_id: 'org-b' })],
    sourcing_projects: [mission(), mission('other-owner', { created_by: 'another-admin' }), mission('other-org', { organization_id: 'org-b' }), mission('search', { kind: 'search' })],
  }, { countRows: [count('agent-a', { total: 1, proposed: 1, evaluated: 1 })] });
  const result = await read(client);
  assert.equal(result.agents.length, 1);
  assert.equal(result.missions.length, 1);
  assert.equal(result.agents[0].counts.total, 1);
  assert.equal(result.agents[0].mission.id, 'mission-agent-a');
  for (const call of client.calls) {
    if (call.rpc) {
      assert.equal(call.args.p_organization_id, 'org-a');
      assert.deepEqual(plain(call.args.p_agent_ids), ['agent-a']);
      continue;
    }
    assert.equal(call.filters.organization_id, 'org-a');
    if (call.in) assert.ok(call.in[1].every(id => result.agents.some(item => item.agent.project_id === id)));
    else assert.equal(call.filters.created_by, 'user-a');
  }
  const serialized = JSON.stringify(result);
  for (const privateValue of ['PRIVATE_BRIEF', 'PRIVATE_PROFILE', 'PRIVATE_SCORE']) assert.equal(serialized.includes(privateValue), false);
  for (const call of client.calls.filter(value => value.table)) assert.equal(call.columns.split(',').some(column => ['*', 'profile', 'result', 'context_snapshot', 'provenance'].includes(column)), false);
});

test('a permissive or stale response still cannot surface another creator or organization', async () => {
  const client = clientFixture({ sourcing_agents: [agent(), agent('other-owner', { created_by: 'other-user' }), agent('other-org', { organization_id: 'org-b' })],
    sourcing_projects: [mission(), mission('other-owner', { created_by: 'other-user' })] },
  { ignoreScope: true, countRows: [count('agent-a', { total: 1, proposed: 1, evaluated: 1 })] });
  const result = await read(client);
  assert.deepEqual(plain(result.agents.map(item => item.agent.id)), ['agent-a']);
  assert.equal(result.missions.length, 1);
  assert.equal(result.agents[0].counts.total, 1);
});

test('205 agents and a 50k-profile history require three aggregate calls and zero candidate reads', async () => {
  const agents = Array.from({ length: 205 }, (_, i) => agent('agent-' + String(i).padStart(3, '0')));
  const missions = agents.map(row => mission(row.project_id));
  const client = clientFixture({ sourcing_agents: agents, sourcing_projects: missions },
    { countRows: [count(agents[0].id, { total: 50_000, proposed: 1050, evaluated: 1050 })] });
  const result = await read(client);
  assert.equal(result.agents.length, 205);
  assert.equal(result.missions.length, 205);
  assert.equal(result.agents.find(item => item.agent.id === agents[0].id).counts.proposed, 1050);
  assert.equal(result.agents.find(item => item.agent.id === agents[0].id).counts.total, 50_000);
  assert.equal(client.calls.filter(call => call.table === 'sourcing_agents').length, 2);
  assert.equal(client.calls.filter(call => call.rpc).length, 3);
  assert.deepEqual(client.calls.filter(call => call.rpc).map(call => call.args.p_agent_ids.length), [100, 100, 5]);
  assert.equal(client.calls.some(call => call.table === 'sourcing_agent_candidates'), false);
});

test('counts use the saved calibration context while interrupted older scores always require attention', async () => {
  const result = await read(clientFixture({ sourcing_agents: [agent()], sourcing_projects: [mission()] },
    { countRows: [count('agent-a', { total: 8, discovered: 1, evaluated: 4, proposed: 1, reviewed: 2, fit: 1, rejected: 1, skipped: 1, uncertain: 2, last_activity_at: '2026-10-08T14:00:00Z' })] }));
  assert.deepEqual(plain(result.agents[0].counts), { total: 8, discovered: 1, evaluated: 4, proposed: 1, reviewed: 2, fit: 1, rejected: 1, skipped: 1, uncertain: 2 });
  assert.equal(result.agents[0].lastActivityAt, '2026-10-08T14:00:00Z');
});

test('today counters reset after UTC midnight and outstanding reservations remain visible', async () => {
  const result = await read(clientFixture({ sourcing_agents: [agent('yesterday', { daily_date: '2020-01-01' })] }));
  assert.equal(result.agents[0].agent.profiles_used, 0);
  assert.equal(result.agents[0].agent.credits_used, 0);
  assert.equal(result.agents[0].agent.credits_reserved, 12);
});

test('read failures are errors instead of fabricated empty or zero results', async () => {
  const client = clientFixture({ sourcing_agents: [agent()], sourcing_projects: [mission()] }, { rpcError: { code: '42501' } });
  await assert.rejects(read(client), /ne peuvent pas être chargés/);
});

test('foreign, missing and duplicate aggregate agent IDs cannot fabricate management data', async () => {
  for (const rpcRows of [[count('another-user-agent')], [], [count(), count()]]) {
    const client = clientFixture({ sourcing_agents: [agent()] }, { rpcRows });
    await assert.rejects(read(client), /ne correspondent pas|plus accessible/);
    assert.deepEqual(plain(client.calls.find(call => call.rpc).args.p_agent_ids), ['agent-a']);
  }
});

test('a calibration race or malformed counter is rejected instead of mixing contexts', async () => {
  for (const rpcRows of [[count('agent-a', { context_key: 'context-b' })], [count('agent-a', { proposed: -1 })], [count('agent-a', { proposed: '8' })]]) {
    await assert.rejects(read(clientFixture({ sourcing_agents: [agent()] }, { rpcRows })), /cadrage.*changé|ne peuvent pas être vérifiés/);
  }
});

test('a personal agent on an accessible shared mission gets its name without enumerating other missions', async () => {
  const client = clientFixture({ sourcing_agents: [agent('mine', { project_id: 'shared-mission' })],
    sourcing_projects: [mission('shared-mission', { created_by: 'other-member', name: 'Shared engineer mandate' }),
      mission('unrelated-mission', { created_by: 'other-member', name: 'PRIVATE_UNRELATED_MISSION' })] });
  const result = await read(client);
  assert.equal(result.agents[0].mission.id, 'shared-mission');
  assert.equal(result.agents[0].mission.name, 'Shared engineer mandate');
  assert.deepEqual(plain(result.missions.map(value => value.id)), ['shared-mission']);
  assert.equal(JSON.stringify(result).includes('PRIVATE_UNRELATED_MISSION'), false);
  const linked = client.calls.find(call => call.table === 'sourcing_projects' && call.in);
  assert.deepEqual(plain(linked.in), ['id', ['shared-mission']]);
  assert.equal(linked.filters.organization_id, 'org-a');
  assert.equal(linked.filters.kind, 'mission');
  assert.equal(linked.filters.created_by, undefined, 'access to the linked mission comes from RLS rather than creator identity');
});

test('linked mission names cannot cross organizations or include a search instead of a mission', async () => {
  const rows = { sourcing_agents: [agent('foreign', { project_id: 'foreign-mission' }), agent('search', { project_id: 'search' })],
    sourcing_projects: [mission('foreign-mission', { created_by: 'other-member', organization_id: 'org-b', name: 'PRIVATE_OTHER_ORG' }),
      mission('search', { created_by: 'other-member', kind: 'search', name: 'PRIVATE_SEARCH' })] };
  // Also exercise the local scope validation if a stale/permissive response
  // ignores request filters; neither private name can enter card metadata.
  const result = await read(clientFixture(rows, { ignoreScope: true }));
  assert.equal(result.missions.length, 0);
  assert.ok(result.agents.every(item => item.mission === null));
  assert.equal(JSON.stringify(result).includes('PRIVATE_'), false);
});

test('a cancelled shared-mission read cannot populate names or proceed to aggregate requests', async () => {
  const controller = new AbortController();
  const client = clientFixture({ sourcing_agents: [agent('mine', { project_id: 'shared-mission' })],
    sourcing_projects: [mission('shared-mission', { created_by: 'other-member' })] }, { beforeRead: call => {
    if (call.table === 'sourcing_projects' && call.in) controller.abort();
  } });
  await assert.rejects(read(client, 'org-a', 'user-a', controller.signal), /contexte a changé/);
  assert.equal(client.calls.some(call => call.rpc), false);
});

function hookFixture(initial = {}) {
  let state = { organizationId: 'org-a', userId: 'user-a', isReady: true, organizationLoading: false, organizationError: false, ...initial };
  let options;
  const ref = { current: null };
  const cache = new Map();
  const client = clientFixture({ sourcing_agents: [agent(), agent('agent-b', { organization_id: 'org-b' })] });
  const hook = compile('src/hooks/useSourcingAgentsHub.ts', { ...helperGlobals, supabase: client,
    useRef: value => { if (!ref.current) ref.current = value; return ref; },
    useOrganization: () => ({ organizationId: state.organizationId, isLoading: state.organizationLoading, isError: state.organizationError }),
    useAuthReady: () => ({ user: state.userId ? { id: state.userId } : null, isReady: state.isReady }),
    useQuery: value => { options = value; return { data: cache.get(JSON.stringify(value.queryKey)), isLoading: value.enabled, isFetching: false, isError: false, error: null, refetch: () => {} }; },
  });
  return { client, query: () => options, seed: value => cache.set(JSON.stringify(options.queryKey), value),
    render(next = {}) { state = { ...state, ...next }; return hook.useSourcingAgentsHub(); } };
}

test('hook cache is scoped by active organization and actor and disappears while auth is unavailable', async () => {
  const h = hookFixture();
  h.render();
  const orgA = plain(h.query().queryKey);
  h.seed({ agents: [{ agent: agent() }], missions: [mission()] });
  assert.equal(h.render().agents.length, 1);
  assert.equal(h.render({ organizationId: 'org-b' }).agents.length, 0);
  assert.notDeepEqual(plain(h.query().queryKey), orgA);
  assert.equal(h.render({ organizationId: 'org-a', userId: 'user-b' }).agents.length, 0);
  assert.notDeepEqual(plain(h.query().queryKey), orgA);
  assert.equal(h.render({ userId: 'user-a', isReady: false }).agents.length, 0);
  assert.equal(h.query().enabled, false);
  assert.throws(() => h.query().queryFn({ signal: new AbortController().signal }), /Ouvrez un espace/);
  assert.equal(h.client.calls.length, 0);
});

test('A to B to A navigation rejects an old request even if it returns to the original cache key', async () => {
  const h = hookFixture();
  h.render();
  const initial = h.query();
  h.render({ organizationId: 'org-b' });
  h.render({ organizationId: 'org-a' });
  await assert.rejects(initial.queryFn({ signal: new AbortController().signal }), /contexte a changé/);
  assert.equal(h.client.calls.length, 0);
});

test('an aborted browser read cannot publish data or continue requesting later pages', async () => {
  const controller = new AbortController();
  const agents = Array.from({ length: 201 }, (_, i) => agent('agent-' + i));
  const client = clientFixture({ sourcing_agents: agents }, { beforeRead: call => {
    if (call.table === 'sourcing_agents') controller.abort();
  } });
  await assert.rejects(read(client, 'org-a', 'user-a', controller.signal), /contexte a changé/);
  assert.equal(client.calls.filter(call => call.table === 'sourcing_agents').length, 1);
  assert.equal(client.calls.some(call => call.table === 'sourcing_agent_candidates'), false);
  assert.equal(client.calls.some(call => call.rpc), false);
});

test('an aborted aggregate read cannot publish counts or request subsequent batches', async () => {
  const controller = new AbortController();
  const agents = Array.from({ length: 101 }, (_, i) => agent('agent-' + i));
  const client = clientFixture({ sourcing_agents: agents }, { beforeRpc: () => controller.abort() });
  await assert.rejects(read(client, 'org-a', 'user-a', controller.signal), /contexte a changé/);
  assert.equal(client.calls.filter(call => call.rpc).length, 1);
});
