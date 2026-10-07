import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real handler and shared context loader, blocking every remote call.
function compile(path, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/await import\((["'])(\.\.\/_shared\/[^"']+)\1\)/g, (_, _quote, name) => '__dynamic[' + JSON.stringify(name) + ']');
  const prelude = 'const { ' + Object.keys(dependencies).join(', ') + ' } = __dependencies;\n';
  const output = ts.transpileModule(prelude + source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {}, __dependencies: dependencies, crypto: webcrypto, TextEncoder, ...globals };
  vm.runInNewContext(output, context, { filename: path });
  return context.exports;
}
const pure = compile('supabase/functions/_shared/memory-proposals.ts');
const memory = compile('supabase/functions/_shared/sourcing-memory.ts', pure);
const mission = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rule = { id: 'rule-a', content: 'Privilégier les profils ayant travaillé en scale-up.', scope: 'project',
  project_id: mission, kind: 'preference', version: 1, effects: ['search'] };

function harness({ rows = [rule], memoryError = null, malformed = false, service = false,
  latestRows,
  parsed = { keywords: 'Python', role_keywords: ['Data Engineer'], memory_conflicts: [] },
  modelText, aiAction = 'filter_generation' } = {}) {
  let handler;
  const calls = { memory: [], credits: [], models: [], settlements: [], rate: [] };
  const dependencies = {
    ...memory,
    requireAuth: async () => ({ userId: service ? null : 'recruiter-a', method: service ? 'service_role' : 'jwt' }),
    assertCredits: async params => { calls.credits.push(params); return { ok: true }; },
    creditGateResponse() { throw new Error('Unexpected credit failure'); },
    gen5Params: () => ({}), isGen5Model: () => false, withThinkingHeadroom: (_model, tokens) => tokens,
    textFromContent: blocks => blocks.filter(block => block.type === 'text').map(block => block.text).join(''),
    createClient(_url, key, options) {
      return {
        rpc(name, params) {
          if (name === 'check_rate_limit') { calls.rate.push(params); return Promise.resolve({ data: true }); }
          calls.memory.push({ name, params, key, options });
          return Promise.resolve({ data: malformed ? { memories: null } : { memories: calls.memory.length > 1 && latestRows ? latestRows : rows }, error: memoryError });
        },
        from(table) {
          assert.equal(table, 'profiles');
          const query = { select() { return query; }, eq() { return query; },
            maybeSingle: async () => ({ data: { active_organization_id: 'org-a' } }) };
          return query;
        },
      };
    },
  };
  compile('supabase/functions/generate-search-filters/index.ts', dependencies, {
    __dynamic: {
      '../_shared/settle-credits.ts': {
        extractAIParams: () => ({ aiAction, modelId: 'claude-sonnet-4-6', description: 'test' }),
        settleCredits: async (_client, params) => calls.settlements.push(params),
      },
      '../_shared/ai-config.ts': { getAnthropicModelId: model => model },
      '../_shared/require-auth.ts': { verifyOrgMembership: async (_client, actor, organization) => {
        assert.equal(actor, 'recruiter-a'); assert.equal(organization, 'org-a'); return true;
      } },
    },
    Deno: { env: { get: name => ({ SUPABASE_URL: 'http://local.test', SUPABASE_ANON_KEY: 'anon-key',
      SB_SECRET_KEY: 'service-key', ANTHROPIC_API_KEY: 'fake-model-key' })[name] }, serve(fn) { handler = fn; } },
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      calls.models.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ content: [{ type: 'text', text: modelText ?? JSON.stringify(parsed) }],
        usage: { input_tokens: 200, output_tokens: 100 } }));
    },
    Request, Response, AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
  });
  const invoke = (body = {}) => handler(new Request('http://local.test/generate-search-filters', {
    method: 'POST', headers: { authorization: service ? 'Bearer service-key' : 'Bearer recruiter-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ job: { id: 'external-job', title: 'Data Engineer', description: 'Python requis. Scale-up souhaitée.' },
      organization_id: 'org-a', project_id: mission, ...(service ? { user_id_override: 'recruiter-a' } : {}), ...body }),
  }));
  return { calls, invoke };
}

test('generation uses confirmed shared search memories, caller JWT and explicit mission', async () => {
  const writing = { ...rule, id: 'writing', scope: 'user', project_id: null, content: 'PRIVATE WRITING', effects: ['presentation'] };
  const scoring = { ...rule, id: 'scoring', content: 'SCORING ONLY', effects: ['scoring'] };
  const h = harness({ rows: [scoring, rule, writing] });
  const response = await h.invoke({ user_id_override: 'forged-user' });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(h.calls.memory[0].key, 'anon-key');
  assert.equal(h.calls.memory[0].options.global.headers.Authorization, 'Bearer recruiter-jwt');
  assert.equal(h.calls.memory[0].params.p_project_id, mission);
  assert.equal(h.calls.credits[0].userId, 'recruiter-a');
  assert.equal(h.calls.credits[0].organizationId, 'org-a');
  assert.equal(h.calls.settlements[0].organizationId, 'org-a');
  assert.match(h.calls.models[0].system[0].text, /Une préférence ouvre un angle/);
  assert.ok(h.calls.models[0].system[0].text.includes(rule.content));
  assert.ok(!h.calls.models[0].system[0].text.includes(writing.content));
  assert.ok(!h.calls.models[0].system[0].text.includes(scoring.content));
  assert.deepEqual(data.memory_context.provenance.map(row => row.id), ['rule-a']);
  assert.match(data.memory_context.fingerprint, /^[0-9a-f]{64}$/);
});

for (const [name, settings, status] of [
  ['foreign mission', { memoryError: { code: '42501' } }, 403],
  ['unavailable memory', { memoryError: { code: 'PGRST000' } }, 503],
  ['malformed context', { malformed: true }, 503],
  ['another mission in rows', { rows: [{ ...rule, project_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }] }, 503],
]) test(name + ' blocks before paid analysis', async () => {
  const h = harness(settings);
  assert.equal((await h.invoke()).status, status);
  assert.equal(h.calls.credits.length, 0);
  assert.equal(h.calls.models.length, 0);
  assert.equal(h.calls.settlements.length, 0);
});

test('trusted internal calls use the service actor RPC', async () => {
  const h = harness({ service: true });
  assert.equal((await h.invoke()).status, 200);
  assert.equal(h.calls.memory[0].name, 'get_agent_sourcing_memory_context');
  assert.equal(h.calls.memory[0].params.p_user_id, 'recruiter-a');
  assert.equal(h.calls.memory[0].params.p_organization_id, 'org-a');
});

test('synthetic jobs retain their mission while invalid explicit context is rejected', async () => {
  const h = harness();
  assert.equal((await h.invoke({ project_id: undefined, job: { id: 'project:' + mission, title: 'Data Engineer' } })).status, 200);
  assert.equal(h.calls.memory[0].params.p_project_id, mission);
  const invalid = harness();
  assert.equal((await invalid.invoke({ project_id: 'not-a-uuid' })).status, 400);
  assert.equal(invalid.calls.memory.length, 0);
  assert.equal(invalid.calls.credits.length, 0);
});

test('a null mission cannot bypass synthetic mission memory and a mismatch is rejected', async () => {
  const h = harness();
  assert.equal((await h.invoke({ project_id: null, job: { id: 'project:' + mission, title: 'Data Engineer' } })).status, 200);
  assert.equal(h.calls.memory[0].params.p_project_id, mission);
  const mismatch = harness();
  assert.equal((await mismatch.invoke({ project_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    job: { id: 'project:' + mission, title: 'Data Engineer' } })).status, 400);
  assert.equal(mismatch.calls.memory.length, 0);
  assert.equal(mismatch.calls.credits.length, 0);
});

test('conflicts explain confirmed rule IDs, settle analysis and return no filters', async () => {
  const h = harness({ parsed: { memory_conflicts: [{ memory_ids: ['rule-a'], reason: 'Le brief exige un grand groupe.' }] } });
  const response = await h.invoke();
  assert.equal(response.status, 409);
  const data = await response.json();
  assert.equal(data.code, 'MEMORY_CONFLICT');
  assert.equal(data.filters, undefined);
  assert.deepEqual(data.memory_conflicts[0].memory_ids, ['rule-a']);
  assert.equal(h.calls.settlements.length, 1);
});

for (const [name, parsed] of [
  ['missing acknowledgment', { keywords: 'Python' }],
  ['invented rule', { memory_conflicts: [{ memory_ids: ['invented'], reason: 'Conflit.' }] }],
  ['malformed acknowledgment', { memory_conflicts: null }],
]) test(name + ' never claims to have applied memory', async () => {
  const h = harness({ parsed });
  const response = await h.invoke();
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.code, 'MEMORY_ANALYSIS_INCOMPLETE');
  assert.equal(data.filters, undefined);
  assert.equal(h.calls.settlements.length, 1);
});

test('draft brief analysis remains faithful to source, without recruiting defaults', async () => {
  const h = harness({ aiAction: 'brief_analysis', parsed: { role_keywords: ['Data Engineer'] } });
  const response = await h.invoke();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.memory_context.provenance.length, 0);
  assert.ok(!h.calls.models[0].system[0].text.includes(rule.content));
  assert.equal(h.calls.memory.length, 1);
});

test('a rule changed during paid analysis is rejected before filters are delivered', async () => {
  const h = harness({ latestRows: [{ ...rule, content: 'La scale-up n’est plus privilégiée.', version: 2 }] });
  const response = await h.invoke();
  assert.equal(response.status, 409);
  const data = await response.json();
  assert.equal(data.code, 'MEMORY_CONTEXT_CHANGED');
  assert.equal(data.filters, undefined);
  assert.equal(h.calls.settlements.length, 1);
});

test('desired certifications and domains never become mandatory skill filters', async () => {
  const h = harness({ parsed: { keywords: 'Python', skills_to_search: ['Python'], certifications: ['AWS bonus'],
    domain_expertise: ['scale-up'], memory_conflicts: [] } });
  const data = await (await h.invoke()).json();
  assert.deepEqual(data.filters.skills_keywords, ['Python']);
});

test('a confirmed current-company exclusion preserves its exact native temporal scope', async () => {
  const constraint = { ...rule, kind: 'constraint', content: 'Exclure uniquement les employés actuels de Beta.' };
  const h = harness({ rows: [constraint], parsed: { keywords: 'Python', memory_conflicts: [],
    company_keywords: [{ keywords: 'Beta', priority: 'DOESNT_HAVE', scope: 'CURRENT', memory_ids: ['rule-a'] }] } });
  const data = await (await h.invoke({ job: { id: 'external-job', title: 'Data Engineer', client: { name: 'Alpha' } } })).json();
  assert.deepEqual(data.filters.company_keywords, [
    { keywords: 'Beta', priority: 'DOESNT_HAVE', scope: 'CURRENT' },
    { keywords: 'Alpha', priority: 'DOESNT_HAVE', scope: 'CURRENT_OR_PAST' },
  ]);
});

test('a company preference cannot be promoted to a mandatory native filter', async () => {
  const h = harness({ parsed: { memory_conflicts: [], company_keywords: [
    { keywords: 'Beta', priority: 'MUST_HAVE', scope: 'CURRENT', memory_ids: ['rule-a'] },
  ] } });
  const response = await h.invoke();
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.code, 'SEARCH_CRITERIA_INCOMPLETE');
  assert.equal(data.filters, undefined);
  assert.equal(h.calls.settlements.length, 1);
});

test('role memory can broaden search to past roles without being forced back to current', async () => {
  const h = harness({ parsed: { role_keywords: ['Data Engineer'], role_scope: 'CURRENT_OR_PAST', memory_conflicts: [] } });
  const data = await (await h.invoke()).json();
  assert.equal(data.filters.role[0].scope, 'CURRENT_OR_PAST');
});

test('an explicit current-client exclusion is never widened by the default exclusion', async () => {
  const constraint = { ...rule, kind: 'constraint', content: 'Exclure uniquement les employés actuels de Alpha.' };
  const h = harness({ rows: [constraint], parsed: { memory_conflicts: [], company_keywords: [
    { keywords: 'Alpha', priority: 'DOESNT_HAVE', scope: 'CURRENT', memory_ids: ['rule-a'] },
  ] } });
  const data = await (await h.invoke({ job: { id: 'external-job', title: 'Data Engineer', client: { name: 'Alpha' } } })).json();
  assert.deepEqual(data.filters.company_keywords, [{ keywords: 'Alpha', priority: 'DOESNT_HAVE', scope: 'CURRENT' }]);
});
