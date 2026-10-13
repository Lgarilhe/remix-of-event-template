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

async function endpoint({ member = true, credits = true, authMethod = 'jwt', turn = { reply: 'Quel budget ?', patch: { title: 'React' } }, body = {} } = {}) {
  let handle; const events = [];
  const admin = { rpc: async () => ({ data: true, error: null }) };
  moduleAt('supabase/functions/sourcing-interview/index.ts', {
    'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check': { createClient: () => admin },
    '../_shared/require-auth.ts': { requireAuth: async () => ({ userId: 'fixture-user', method: authMethod }), verifyOrgMembership: async () => member },
    '../_shared/credit-guard.ts': { assertCredits: async () => { events.push('gate'); return { ok: credits }; }, creditGateResponse: () => new Response('{}', { status: 402 }) },
    '../_shared/call-claude.ts': { callClaudeCompat: async () => { events.push('model'); return { content: JSON.stringify(turn), model: 'haiku', usage: { input_tokens: 10, output_tokens: 20 } }; } },
    '../_shared/settle-usage.ts': { settleClaudeUsage: async () => { events.push('settle'); } },
    './contract.ts': contract,
  }, { Response, Deno: { env: { get: () => 'fixture-only' }, serve: fn => { handle = fn; } } });
  const response = await handle(new Request('http://fixture.test', { method: 'POST', body: JSON.stringify({ organization_id: 'org-a', message: 'React à Lyon', brief: {}, ...body }) }));
  return { response, events };
}
test('edge rejects service credentials, foreign org and insufficient credits before any model call', async () => {
  for (const [options, status] of [[{ authMethod: 'service_role' }, 401], [{ member: false }, 403], [{ credits: false }, 402]]) {
    const result = await endpoint(options);
    assert.equal(result.response.status, status);
    assert.ok(!result.events.includes('model'));
  }
});
test('edge validates output, settles consumed tokens even for malformed output, and writes no brief', async () => {
  const good = await endpoint();
  assert.equal(good.response.status, 200);
  assert.deepEqual(good.events, ['gate', 'model', 'settle']);
  const bad = await endpoint({ turn: { reply: 'ok', patch: { experience_min: -5 } } });
  assert.equal(bad.response.status, 400);
  assert.deepEqual(bad.events, ['gate', 'model', 'settle']);
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
