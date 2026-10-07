import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Run the actual handler and memory helpers. Every network/model path is blocked.
const root = new URL('../../', import.meta.url);
function compile(path, prelude = '', globals = {}) {
  const source = readFileSync(new URL(path, root), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/await import\((["'])(\.\.\/_shared\/[^"']+)\1\)/g, (_match, _quote, path) => '__dynamic[' + JSON.stringify(path) + ']');
  const { outputText, diagnostics } = ts.transpileModule(prelude + source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path, reportDiagnostics: true,
  });
  assert.equal(diagnostics?.length ?? 0, 0);
  const context = { exports: {}, ...globals };
  vm.runInNewContext(outputText, context, { filename: path });
  return context.exports;
}
const pure = compile('supabase/functions/_shared/memory-proposals.ts');
const memory = compile('supabase/functions/_shared/user-memory.ts',
  'const { formatValidatedMemories, normalizeMemoryProposal, getMemorySourceText } = __pure;\n', { __pure: pure });
const missionA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const missionB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function harness({ memoryError = null, malformed = false, invisibleProject = false,
  author = 'recruiter-a', linkedProject = missionA } = {}) {
  let handler;
  const requests = [];
  const memoryRequests = [];
  const creditCalls = [];
  const modelCalls = [];
  const writes = [];
  const jwtHeader = 'Bearer recruiter-jwt';
  const dependencies = {
    getRelevantInsights: memory.getRelevantInsights,
    registerMutatingTools() {}, registerReadTools() {}, registerEmailTools() {},
    normalizeModelId: (model) => model,
    assertCredits: async (params) => { creditCalls.push(params); return { ok: false }; },
    creditGateResponse: (_gate, headers) => new Response(JSON.stringify({ error: 'Insufficient credits' }), {
      status: 402, headers,
    }),
    createClient(_url, key, options) {
      return {
        auth: { getUser: async (token) => {
          assert.equal(token, 'recruiter-jwt');
          return { data: { user: { id: 'recruiter-a' } }, error: null };
        } },
        rpc(name, params) {
          assert.equal(name, 'get_agent_memory_context');
          memoryRequests.push({ key, options, params });
          assert.equal(key, 'anon-key');
          assert.equal(options?.global?.headers?.Authorization, jwtHeader);
          return Promise.resolve({ error: memoryError, data: malformed ? { memories: null } : { memories: [] } });
        },
        from(table) {
          const request = { table, key, options, filters: {} };
          requests.push(request);
          const query = {
            select() { return query; },
            eq(column, value) { request.filters[column] = value; return query; },
            insert(value) { writes.push({ table, value }); throw new Error('No write allowed before memory/credit guards'); },
            single() {
              assert.equal(table, 'agent_conversations');
              return Promise.resolve({ data: { organization_id: 'organization-a', created_by: author,
                project_id: linkedProject, summary: null }, error: null });
            },
            maybeSingle() {
              if (table === 'organization_members') return Promise.resolve({ data: { id: 'membership-a' }, error: null });
              assert.equal(table, 'sourcing_projects');
              assert.equal(key, 'anon-key');
              assert.equal(options?.global?.headers?.Authorization, jwtHeader);
              return Promise.resolve({ data: invisibleProject ? null : { id: request.filters.id }, error: null });
            },
          };
          return query;
        },
      };
    },
  };
  compile('supabase/functions/search-agent-chat/index.ts',
    'const { ' + Object.keys(dependencies).join(', ') + ' } = __dependencies;\n', {
      __dependencies: dependencies,
      __dynamic: {
        '../_shared/settle-credits.ts': { extractAIParams: () => ({ aiAction: 'agent_search_calibration', modelId: 'claude-sonnet-4-6' }) },
        '../_shared/ai-config.ts': { getAnthropicModelId: (model) => model },
        '../_shared/call-claude.ts': { callClaudeCompat(params) {
          modelCalls.push(params); throw new Error('No model call allowed before memory/credit guards');
        } },
      },
      Deno: {
        env: { get: (name) => ({ SUPABASE_URL: 'http://local.test', SUPABASE_ANON_KEY: 'anon-key', SB_SECRET_KEY: 'service-key' })[name] },
        serve(fn) { handler = fn; },
      },
      fetch(input) { modelCalls.push(input); throw new Error('No HTTP/model call allowed in this test'); },
      Request, Response,
      console: { error() {}, warn() {} },
    });
  const invoke = () => handler(new Request('http://local.test/search-agent-chat', {
    method: 'POST', headers: { authorization: jwtHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: 'conversation-a', message: 'Bonjour',
      project_id: missionB, app_context: { missionId: missionB, missionTitle: 'Mission B' } }),
  }));
  return { invoke, requests, memoryRequests, creditCalls, modelCalls, writes };
}

test('resumed mission A keeps its authenticated memory even while mission B is open', async () => {
  const h = harness();
  assert.equal((await h.invoke()).status, 402);
  assert.equal(h.memoryRequests.length, 1);
  assert.equal(h.memoryRequests[0].params.p_organization_id, 'organization-a');
  assert.equal(h.memoryRequests[0].params.p_project_id, missionA);
  const projectRequest = h.requests.find((r) => r.table === 'sourcing_projects');
  assert.equal(projectRequest.filters.id, missionA);
  assert.equal(projectRequest.filters.organization_id, 'organization-a');
  assert.equal(h.creditCalls.length, 1);
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

for (const [name, options] of [
  ['RPC permission refusal', { memoryError: { code: '42501', message: 'Forbidden' } }],
  ['RPC outage', { memoryError: { code: 'PGRST000', message: 'Database unavailable' } }],
  ['malformed RPC response', { malformed: true }],
]) {
  test(name + ' blocks before credits, models and user-message insertion', async () => {
    const h = harness(options);
    assert.equal((await h.invoke()).status, 503);
    assert.equal(h.memoryRequests.length, 1);
    assert.equal(h.creditCalls.length, 0);
    assert.equal(h.modelCalls.length, 0);
    assert.equal(h.writes.length, 0);
  });
}

test('an inaccessible conversation mission is refused before memory loading', async () => {
  const h = harness({ invisibleProject: true });
  assert.equal((await h.invoke()).status, 403);
  assert.equal(h.memoryRequests.length, 0);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('another author’s conversation is refused before any memory or mission lookup', async () => {
  const h = harness({ author: 'recruiter-b' });
  assert.equal((await h.invoke()).status, 403);
  assert.equal(h.requests.filter((r) => r.table !== 'agent_conversations').length, 0);
  assert.equal(h.memoryRequests.length, 0);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('an existing general conversation does not borrow the open mission’s memory', async () => {
  const h = harness({ linkedProject: null });
  assert.equal((await h.invoke()).status, 402);
  assert.equal(h.memoryRequests[0].params.p_project_id, null);
  assert.equal(h.requests.filter((r) => r.table === 'sourcing_projects').length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.modelCalls.length, 0);
});
