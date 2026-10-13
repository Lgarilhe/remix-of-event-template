import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
function moduleAt(file, dependencies = {}, globals = {}) {
  const exports = {};
  const js = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports, require: name => {
    if (!(name in dependencies)) throw new Error('Unmocked dependency ' + name);
    return dependencies[name];
  }, console: { error() {}, log() {}, warn() {} }, ...globals });
  return exports;
}
const contract = moduleAt('supabase/functions/sourcing-interview/contract.ts');
const plain = value => JSON.parse(JSON.stringify(value));

test('AI changes accept real criteria and weights, remove unknown access fields and reject malformed turns', () => {
  const turn = contract.readInterviewTurn({ reply: 'Critère renforcé. Quel budget ?', patch: {
    organization_id: 'other', title: 'React', evaluation_criteria: [{ id: 'react', label: 'React', description: 'Application en production', weight: 3, category: 'technical', deal_breaker: true }],
    evaluation_weights: { technical: 60, soft_skill: 10, culture_fit: 10, motivation: 5, experience: 15 },
  } });
  assert.equal(turn.patch.organization_id, undefined);
  assert.equal(turn.patch.evaluation_criteria[0].weight, 3);
  assert.equal(turn.patch.evaluation_weights.technical, 60);
  for (const invalid of [null, { reply: '', patch: {} }, { reply: 'ok', patch: { salary_min: '70000' } },
    { reply: 'ok', patch: { evaluation_criteria: [{ id: 'a', label: 'A', description: '', category: 'technical', weight: 4 }] } },
    { reply: 'ok', patch: { evaluation_weights: { technical: 100, soft_skill: 10, culture_fit: 10, motivation: 10, experience: 10 } } }]) {
    assert.throws(() => contract.readInterviewTurn(invalid));
  }
});
test('inverted ranges and invalid manually edited percentages cannot launch; zero experience is known', () => {
  assert.throws(() => contract.validateBriefRanges({ experience_min: 10, experience_max: 3 }));
  assert.throws(() => contract.validateBriefRanges({ salary_min: 100000, salary_max: 50000 }));
  assert.throws(() => contract.validateBriefRanges({ evaluation_weights: { technical: 90, soft_skill: 5, culture_fit: 5, motivation: 5, experience: 5 } }));
  assert.doesNotMatch(contract.nextBriefQuestion({ title: 'React', location: 'Lyon', experience_min: 0, skills_must_have: ['React'] }), /niveau d’expérience/);
});

async function endpoint({ member = true, credits = true, authMethod = 'jwt', turn = { reply: 'Quel budget ?', patch: { title: 'React' } }, turns, body = {}, callModel, modelIds = ['claude-haiku-4-5-20251001'] } = {}) {
  let handle, modelCalls = 0, gateCalls = 0; const events = [], settlements = [], requests = [], logs = [];
  const admin = { rpc: async () => ({ data: true, error: null }) };
  moduleAt('supabase/functions/sourcing-interview/index.ts', {
    'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check': { createClient: () => admin },
    '../_shared/require-auth.ts': { requireAuth: async () => ({ userId: 'fixture-user', method: authMethod }), verifyOrgMembership: async () => member },
    '../_shared/credit-guard.ts': { assertCredits: async () => {
      events.push('gate'); return { ok: Array.isArray(credits) ? credits[Math.min(gateCalls++, credits.length - 1)] : credits };
    }, creditGateResponse: () => new Response('{}', { status: 402 }) },
    '../_shared/call-claude.ts': { callClaudeCompat: async options => {
      events.push('model'); requests.push(options);
      if (callModel) return callModel(options);
      const next = turns ? turns[Math.min(modelCalls, turns.length - 1)] : turn;
      const model = modelIds[Math.min(modelCalls++, modelIds.length - 1)];
      return { content: '', toolCall: { name: contract.SOURCING_INTERVIEW_TOOL, input: next }, model, usage: { input_tokens: 10, output_tokens: 20 } };
    } },
    '../_shared/settle-usage.ts': { settleClaudeUsage: async usage => { events.push('settle'); settlements.push(plain(usage)); } },
    './contract.ts': contract,
  }, { Response, console: { error: (...items) => logs.push(items), warn: (...items) => logs.push(items) }, Deno: { env: { get: () => 'fixture-only' }, serve: fn => { handle = fn; } } });
  const response = await handle(new Request('http://fixture.test', { method: 'POST', body: JSON.stringify({ organization_id: 'org-a', message: 'React à Lyon', brief: {}, ...body }) }));
  return { response, events, settlements, requests, logs };
}
test('edge rejects service credentials, foreign org and insufficient credits before any model call', async () => {
  for (const [options, status] of [[{ authMethod: 'service_role' }, 401], [{ member: false }, 403], [{ credits: false }, 402]]) {
    const result = await endpoint(options);
    assert.equal(result.response.status, status);
    assert.ok(!result.events.includes('model'));
  }
});
test('edge bills one valid delivered exchange and does not bill an invalid model response', async () => {
  const good = await endpoint();
  assert.equal(good.response.status, 200);
  assert.deepEqual(good.events, ['gate', 'model', 'settle']);
  const bad = await endpoint({ turn: { reply: 'ok', patch: { experience_min: -5 } } });
  assert.equal(bad.response.status, 502);
  assert.deepEqual(bad.events, ['gate', 'model', 'gate', 'model']);
  assert.equal(bad.settlements.length, 0);
  assert.equal((await bad.response.json()).error_code, 'SOURCING_INVALID_MODEL_OUTPUT');
  assert.ok(bad.logs.some(([, diagnostic]) => diagnostic.code === 'invalid_number' && diagnostic.phase === 'output_validation'));
});
test('existing unnamed Cadrage rows can be discussed, but AI cannot generate unnamed criteria', async () => {
  const unnamed = { id: 'draft', label: '', description: '', category: 'technical', weight: 2 };
  const result = await endpoint({ body: { brief: { evaluation_criteria: [unnamed] } } });
  assert.equal(result.response.status, 200);
  assert.ok(result.events.includes('model'));
  const generated = await endpoint({ turn: { reply: 'Critère mis à jour', patch: { evaluation_criteria: [unnamed] } } });
  assert.equal(generated.response.status, 502);
});

test('one correction fixes merged ranges, gates both attempts, and aggregates one settlement', async () => {
  const result = await endpoint({ body: { brief: { experience_min: 3, experience_max: 5 } }, turns: [
    { reply: 'Plage mise à jour.', patch: { experience_min: 8 } },
    { reply: '8 à 12 ans. Quel contexte ?', patch: { experience_min: 8, experience_max: 12 } },
  ] });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.events, ['gate', 'model', 'gate', 'model', 'settle']);
  assert.equal(result.settlements.length, 1);
  assert.deepEqual(result.settlements[0].usage, { input_tokens: 20, output_tokens: 40 });
  assert.equal(result.settlements[0].modelId, 'claude-haiku-4-5-20251001');
  assert.equal(JSON.parse(result.requests[1].messages[1].content).correction.includes('inverted_range'), true);
});

test('correction cannot bypass a new credit refusal and failed provider diagnostics never expose its body', async () => {
  const refused = await endpoint({ credits: [true, false], turn: { reply: 'ok', patch: { experience_min: -1 } } });
  assert.equal(refused.response.status, 402);
  assert.deepEqual(refused.events, ['gate', 'model', 'gate']);
  assert.equal(refused.settlements.length, 0);
  const failed = await endpoint({ callModel: async () => { throw new Error('provider private response content'); } });
  assert.equal(failed.response.status, 502);
  assert.equal(failed.settlements.length, 0);
  assert.equal(JSON.stringify(failed.logs).includes('provider private response content'), false);
  assert.equal(failed.logs[0][1].phase, 'model');
});

test('settlement uses the provider model and never aggregates different models across a correction', async () => {
  const delivered = await endpoint({ modelIds: ['claude-haiku-4-5'] });
  assert.equal(delivered.response.status, 200);
  assert.equal(delivered.settlements[0].modelId, 'claude-haiku-4-5');
  assert.equal(delivered.requests[0].model, 'claude-haiku-4-5-20251001');
  const changed = await endpoint({ modelIds: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'], turns: [
    { reply: 'Invalide', patch: { experience_min: -1 } },
    { reply: 'Corrigé', patch: {} },
  ] });
  assert.equal(changed.response.status, 502);
  assert.equal(changed.settlements.length, 0);
  assert.equal(changed.logs.at(-1)[1].code, 'inconsistent_models');
});

const capturedBriefShape = {
  title: 'Développeur Go', location: 'Paris', context: 'Recrutement backend Go pour une équipe produit.',
  seniority: 'Confirmé', salary_min: 65, salary_max: 75, experience_min: 3, experience_max: 5,
  remote_policy: 'hybrid', salary_currency: 'EUR', brief_source: 'ai_structured', urgency: 'medium',
  skills_to_avoid: ['ESN', 'SSII', 'Freelance', 'GAFAM', 'CAC40'], skills_must_have: ['Go', 'API REST', 'Microservices', 'Backend', 'GCP'],
  evaluation_criteria: ['API REST', 'Microservices', 'Backend', 'GCP'].map((label, i) => ({
    id: `criterion-captured-${i}`, label, weight: 3, category: 'technical', description: '',
  })),
};

test('captured mission input uses the actual Claude transport and structured correction without duplicate credit floors', async () => {
  // The exact authorized mission snapshot stays outside the repository. CI
  // exercises its same field/type/range shape with neutral text and IDs.
  const captured = process.env.SOURCING_REAL_INPUT_FIXTURE
    ? JSON.parse(readFileSync(process.env.SOURCING_REAL_INPUT_FIXTURE, 'utf8'))
    : { brief: capturedBriefShape, message: 'Account Manager SaaS B2B, 8–12 ans, grands comptes, Île-de-France, pas d’ESN', source: 'database' };
  assert.equal(captured.brief.title, 'Développeur Go');
  assert.equal(captured.brief.experience_min, 3);
  assert.equal(captured.brief.experience_max, 5);
  assert.doesNotThrow(() => contract.readBriefPatch(captured.brief, false, true));
  const config = moduleAt('supabase/functions/_shared/ai-config.ts');
  const payloads = [];
  const turn = { reply: 'Account Manager, 8 à 12 ans, Île-de-France et ESN exclues. Quels critères sont indispensables ?',
    patch: { title: 'Account Manager SaaS B2B', location: 'Île-de-France', experience_min: 8, experience_max: 12, skills_to_avoid: ['ESN'] } };
  const helper = moduleAt('supabase/functions/_shared/call-claude.ts', {
    './ai-config.ts': config,
    './gen5-models.ts': moduleAt('supabase/functions/_shared/gen5-models.ts'),
    './anti-ai-style.ts': moduleAt('supabase/functions/_shared/anti-ai-style.ts'),
  }, { AbortController, setTimeout, clearTimeout,
    Deno: { env: { get: () => 'fixture-only' } },
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      const payload = JSON.parse(options.body); payloads.push(payload);
      const first = payloads.length === 1;
      return new Response(JSON.stringify({ model: 'claude-haiku-4-5-20251001', stop_reason: 'tool_use',
        usage: { input_tokens: 1208, output_tokens: first ? 98 : 135 },
        content: [{ type: 'tool_use', id: 'fixture-tool', name: contract.SOURCING_INTERVIEW_TOOL,
          input: first ? { reply: 'Plage mise à jour.', patch: { experience_min: 8 } } : turn }],
      }), { status: 200 });
    },
  });
  const result = await endpoint({ body: captured, callModel: helper.callClaudeCompat });
  assert.equal(result.response.status, 200);
  assert.deepEqual(plain((await result.response.json()).patch), turn.patch);
  assert.equal(payloads.length, 2);
  for (const payload of payloads) {
    assert.equal(payload.model, 'claude-haiku-4-5-20251001');
    assert.deepEqual(payload.tool_choice, { type: 'tool', name: contract.SOURCING_INTERVIEW_TOOL });
    assert.equal(payload.tools[0].input_schema.properties.patch.properties.experience_max.type, 'number');
    assert.equal(JSON.parse(payload.messages[0].content).brief.title, 'Développeur Go');
  }
  assert.equal(result.settlements.length, 1);
  const usage = result.settlements[0].usage;
  assert.deepEqual(usage, { input_tokens: 2416, output_tokens: 233 });
  assert.equal(config.calculateTokenCredits(usage.input_tokens, usage.output_tokens, result.settlements[0].modelId, 'sourcing_interview').credits, 1);
  assert.equal(result.logs.some(items => JSON.stringify(items).includes(captured.message)), false);
  assert.equal(result.logs.some(items => JSON.stringify(items).includes(captured.brief.context)), false);
});

test('generated database places are visible chips, require no LinkedIn parameter lookup and keep user locations', async () => {
  let lookups = 0;
  const mapping = moduleAt('src/components/outreach/search/generateFiltersFromJob.ts', {
    '@/lib/invokeUnipile': { invokeUnipile: async () => { lookups++; throw new Error('LinkedIn forbidden'); } },
    '@/lib/invokeWithCredits': {}, '@/types/agentMemory': {}, '@/components/outreach/types': {}, '@/types/jobs': {},
  });
  for (const accountId of [null, 'linked-account']) {
    const result = await mapping.mapGeneratedFilters({ location_keywords: ['Lyon', 'Paris'] }, { accountId, api: 'database' });
    assert.deepEqual(plain(result.update.location).map(v => v.name), ['Lyon', 'Paris']);
  }
  const result = await mapping.mapGeneratedFilters({ location_keywords: ['Paris'] }, { accountId: null, api: 'database', currentLocation: [{ id: 'database:Lyon', name: 'Lyon', priority: 'MUST_HAVE', scope: 'CURRENT' }] });
  assert.equal(result.update.location, undefined);
  assert.equal(lookups, 0);
});
