import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Actual generation helper with both external services replaced; no network or writes.
const source = readFileSync(new URL('../../src/components/outreach/search/generateFiltersFromJob.ts', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length ?? 0, 0);

const missionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rule = {
  id: 'rule-client-exclusion', version: 3, content: 'Exclure les salariés du client actuel.',
  scope: 'project', project_id: missionId, kind: 'constraint', effects: ['search'],
};
function memoryContext(rows = [rule]) {
  return {
    fingerprint: 'verified-server-digest',
    versionKey: JSON.stringify({ effect: 'search', memories: rows }),
    effect: 'search', provenance: rows,
  };
}
const generatedFilters = {
  keywords: 'Python', location_keywords: ['Paris'], years_of_experience_min: 0,
  years_of_experience_max: 5, skills_keywords: ['Python'],
};
const plain = value => JSON.parse(JSON.stringify(value));

function harness(response = { data: { success: true, filters: generatedFilters, memory_context: memoryContext() }, error: null }) {
  const calls = [];
  const locations = [];
  const sandbox = {
    exports: {},
    console: { warn() {} },
    invokeWithCredits: async (...args) => { calls.push(args); return response; },
    invokeUnipile: async (args) => {
      locations.push(args);
      return { data: { success: true, items: [{ id: '123', title: 'Paris' }] }, error: null };
    },
  };
  vm.runInNewContext(compiled.outputText, sandbox, { filename: 'generateFiltersFromJob.ts' });
  const generate = overrides => sandbox.exports.generateFiltersFromJob({
    job: { id: 'external-job-id', title: 'Data engineer', description: 'Le brief complet.' },
    accountId: 'linkedin-account', searchSource: 'linkedin',
    organizationId: 'organization-a', projectId: missionId,
    ...overrides,
  });
  return { api: sandbox.exports, generate, calls, locations };
}

test('a mission keeps its own explicit context even when the brief uses an external job ID', async () => {
  const h = harness();
  const result = await h.generate();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][2].organization_id, 'organization-a');
  assert.equal(h.calls[0][2].project_id, missionId);
  assert.equal(h.calls[0][2].job.id, 'external-job-id');
  assert.equal(h.calls[0][2].job.description, 'Le brief complet.');
  assert.deepEqual(plain(result.memoryContext), memoryContext());
  assert.equal(result.update.calculated_experience_min, 0);
  assert.equal(result.update.location[0].id, '123');
});

test('a degraded successful response never reaches LinkedIn parameter resolution', async () => {
  const h = harness({ data: { success: true, degraded: true, filters: generatedFilters, memory_context: memoryContext() }, error: null });
  await assert.rejects(h.generate(), /analyse est incomplète/);
  assert.equal(h.locations.length, 0);
});

test('memory conflicts retain the French server message and business code', async () => {
  const conflict = Object.assign(new Error('Une règle de la mission contredit le brief. Clarifie la décision avant de continuer.'), {
    status: 409, code: 'MEMORY_CONFLICT',
  });
  const h = harness({ data: { success: false, filters: generatedFilters }, error: conflict });
  await assert.rejects(h.generate(), error => error === conflict && error.code === 'MEMORY_CONFLICT');
  assert.equal(h.locations.length, 0);
});

test('missing generated filters cannot be reported as applied', async () => {
  const h = harness({ data: { success: true, memory_context: memoryContext() }, error: null });
  await assert.rejects(h.generate(), /Réponse invalide/);
  assert.equal(h.locations.length, 0);
});

test('a legacy draft response never fabricates memory provenance', async () => {
  const h = harness({ data: { success: true, filters: { keywords: 'Python' } }, error: null });
  const result = await h.generate({ organizationId: undefined, projectId: null, accountId: null });
  assert.equal(h.calls[0][2].project_id, null);
  assert.equal(result.memoryContext, undefined);
  assert.equal(result.update.keywords, 'Python');
});

test('generation preserves a manually selected valid location', async () => {
  const h = harness();
  const result = await h.generate({ currentLocation: [{ id: '456', name: 'Lyon' }] });
  assert.equal(h.locations.length, 0);
  assert.equal(result.update.location, undefined);
});

for (const [label, context] of [
  ['a private recruiting preference', memoryContext([{ ...rule, scope: 'user', project_id: null }])],
  ['a changed rule with an old version key', { ...memoryContext(), provenance: [{ ...rule, content: 'Exclure les entreprises du secteur.' }] }],
  ['an unknown effect', memoryContext([{ ...rule, effects: ['search', 'unknown'] }])],
  ['a duplicated rule', memoryContext([rule, rule])],
  ['a different effect', { ...memoryContext(), effect: 'scoring' }],
]) {
  test(label + ' is refused before any external lookup', async () => {
    const h = harness({ data: { success: true, filters: generatedFilters, memory_context: context }, error: null });
    assert.equal(h.api.readGeneratedSearchMemoryContext(context), null);
    await assert.rejects(h.generate(), /mémoire n’ont pas pu être vérifiées/);
    assert.equal(h.locations.length, 0);
  });
}

test('an empty authenticated memory context remains distinguishable from a legacy response', async () => {
  const h = harness({ data: { success: true, filters: { keywords: 'Python' }, memory_context: memoryContext([]) }, error: null });
  const result = await h.generate();
  assert.deepEqual(plain(result.memoryContext.provenance), []);
  assert.equal(result.memoryContext.versionKey, JSON.stringify({ effect: 'search', memories: [] }));
});
