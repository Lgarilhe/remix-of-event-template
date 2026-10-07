import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const compile = (path, prelude = '', globals = {}) => {
  const source = readFileSync(new URL(path, root), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/await import\(["']\.\.\/_shared\/user-memory\.ts["']\)/g, '__memory');
  const { outputText, diagnostics } = ts.transpileModule(prelude + source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path,
    reportDiagnostics: true,
  });
  assert.equal(diagnostics?.length ?? 0, 0);
  const context = { exports: {}, ...globals };
  vm.runInNewContext(outputText, context, { filename: path });
  return context.exports;
};
const pure = compile('supabase/functions/_shared/memory-proposals.ts');
const memory = compile('supabase/functions/_shared/user-memory.ts',
  'const { formatValidatedMemories, normalizeMemoryProposal, getMemorySourceText } = __pure;\n', { __pure: pure });

function harness(name, { failMemory = false, organizationId = 'organization-a' } = {}) {
  let handler;
  const memoryRequests = [];
  const modelCalls = [];
  const jwtHeader = 'Bearer recruiter-jwt';
  const dependencies = {
    createClient(_url, key, options) {
      return {
        rpc(name, params) {
          if (name === 'check_rate_limit') return Promise.resolve({ data: true });
          assert.equal(name, 'get_agent_memory_context');
          memoryRequests.push({ key, options, params });
          if (failMemory) return Promise.resolve({ data: null, error: new Error('Memory unavailable') });
          assert.equal(key, 'anon-key');
          assert.equal(options?.global?.headers?.Authorization, jwtHeader);
          return Promise.resolve({ data: { memories: [{
            id: 'memory-a', content: 'VALIDATED RULE', scope: 'organization',
            kind: 'constraint', version: 1, effects: ['assistant'],
          }] }, error: null });
        },
        from(table) {
          assert.equal(table, 'profiles');
          const query = {
            select() { return query; },
            eq() { return query; },
            maybeSingle() { return Promise.resolve({ data: { active_organization_id: organizationId } }); },
          };
          return query;
        },
      };
    },
    requireAuth: async () => ({ userId: 'recruiter-a', method: 'jwt' }),
    verifyOrgMembership: async () => true,
    loadAndBuildAiContext: async () => '',
    assertCredits: async () => ({ ok: true }),
    extractAIParams: () => ({ modelId: 'claude-haiku-4-5' }),
    callClaudeCompat: async (params) => {
      modelCalls.push(params);
      return { content: '{"text":"Bonjour"}', model: 'claude-haiku-4-5', usage: { input_tokens: 1, output_tokens: 1 } };
    },
    settleClaudeUsage: async () => {},
    settleCredits: async () => ({ charged: 1 }),
    ClaudeCompatError: class extends Error {},
  };
  const bindings = Object.keys(dependencies).join(', ');
  compile('supabase/functions/' + name + '/index.ts',
    'const { ' + bindings + ' } = __dependencies;\n', {
      __dependencies: dependencies,
      __memory: memory,
      Deno: {
        env: { get: (name) => ({ SUPABASE_URL: 'http://local.test', SUPABASE_ANON_KEY: 'anon-key', SB_SECRET_KEY: 'service-key' })[name] },
        serve(fn) { handler = fn; },
      },
      Request, Response,
      console: { error() {}, warn() {} },
    });
  const invoke = () => handler(new Request('http://local.test/handler', {
    method: 'POST', headers: { authorization: jwtHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(name === 'ai-chat-completion'
      ? { messages: [{ role: 'user', content: 'Bonjour' }] }
      : { action: 'proofread', text: 'Bonjour', organization_id: organizationId }),
  }));
  return { invoke, memoryRequests, modelCalls };
}

for (const name of ['ai-chat-completion', 'text-action']) {
  test(name + ': confirmed memory uses the recruiter JWT before generation', async () => {
    const { invoke, memoryRequests, modelCalls } = harness(name);
    const response = await invoke();
    assert.equal(response.status, 200);
    assert.equal(memoryRequests.length, 1);
    assert.equal(memoryRequests[0].params.p_organization_id, 'organization-a');
    assert.equal(memoryRequests[0].params.p_project_id, null);
    assert.equal(modelCalls.length, 1);
    assert.match(modelCalls[0].aiContext, /VALIDATED RULE/);
  });

  test(name + ': unavailable memory returns a retryable error without a model call', async () => {
    const { invoke, memoryRequests, modelCalls } = harness(name, { failMemory: true });
    const response = await invoke();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error_code, 'MEMORY_CONTEXT_UNAVAILABLE');
    assert.equal(memoryRequests.length, 1);
    assert.equal(modelCalls.length, 0);
  });

  test(name + ': a request without an organization preserves the existing memory-free flow', async () => {
    const { invoke, memoryRequests, modelCalls } = harness(name, { organizationId: null });
    const response = await invoke();
    assert.equal(response.status, 200);
    assert.equal(memoryRequests.length, 0);
    assert.equal(modelCalls.length, 1);
  });
}
