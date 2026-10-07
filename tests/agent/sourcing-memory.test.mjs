import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real Edge helper; no network, provider, model, or remote DB.
function compile(path, prelude = '', globals = {}) {
  const source = readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '');
  const { outputText, diagnostics } = ts.transpileModule(prelude + source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path, reportDiagnostics: true,
  });
  assert.equal(diagnostics?.length ?? 0, 0);
  const context = { exports: {}, crypto: webcrypto, TextEncoder, ...globals };
  vm.runInNewContext(outputText, context, { filename: path });
  return context.exports;
}
const pure = compile('supabase/functions/_shared/memory-proposals.ts');
const { createSourcingMemoryContext, loadSourcingMemoryContext, parseSourcingMemoryConflicts } =
  compile('supabase/functions/_shared/sourcing-memory.ts',
    'const { readValidatedMemories } = __pure;\n', { __pure: pure });
const copy = (value) => JSON.parse(JSON.stringify(value));
const projectRule = { id: 'project-rule', version: 2, content: 'Prefer product teams',
  scope: 'project', project_id: 'mission-a', kind: 'preference', effects: ['search', 'scoring'] };
const orgRule = { id: 'org-rule', version: 1, content: 'Unknown data must be verified',
  scope: 'organization', project_id: null, kind: 'constraint', effects: ['scoring'] };
const personalRule = { id: 'personal-rule', version: 1, content: 'Answer in French',
  scope: 'user', kind: 'preference', effects: ['assistant', 'presentation'] };
const params = { userId: 'actor-a', organizationId: 'org-a', projectId: 'mission-a', effect: 'scoring' };

test('JWT sourcing loads the authorized mission and only recruiting effects reach scoring', async () => {
  const calls = [];
  const client = { rpc: async (...args) => {
    calls.push(args);
    return { data: { memories: [personalRule, projectRule, orgRule] }, error: null };
  } };
  const context = await loadSourcingMemoryContext(client, params);
  assert.deepEqual(copy(calls), [['get_agent_memory_context', { p_organization_id: 'org-a', p_project_id: 'mission-a' }]]);
  assert.deepEqual(copy(context.provenance.map((rule) => rule.id)), ['org-rule', 'project-rule']);
  assert.match(context.prompt, /Unknown data must be verified/);
  assert.match(context.prompt, /Prefer product teams/);
  assert.doesNotMatch(context.prompt, /Answer in French/);
  assert.match(context.fingerprint, /^[0-9a-f]{64}$/);
});

test('service sourcing uses only the service actor RPC and returns traceable shared decisions', async () => {
  const calls = [];
  const client = { rpc: async (...args) => {
    calls.push(args);
    return { data: { memories: [{ ...projectRule, source_excerpt: 'PRIVATE SOURCE',
      source_conversation_id: 'private-conversation', owner_user_id: 'other-user' }] }, error: null };
  } };
  const context = await loadSourcingMemoryContext(client, { ...params, serviceRole: true });
  assert.deepEqual(copy(calls), [['get_agent_sourcing_memory_context', {
    p_organization_id: 'org-a', p_project_id: 'mission-a', p_user_id: 'actor-a',
  }]]);
  assert.deepEqual(copy(context.provenance), [{ ...projectRule, effects: [...projectRule.effects].sort() }]);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE SOURCE|private-conversation|other-user/);
});

test('another mission, malformed recruiting scope, and unavailable memory never fall back to empty context', async () => {
  for (const rule of [{ ...projectRule, project_id: 'mission-b' },
    { ...projectRule, scope: 'user', project_id: null }]) {
    await assert.rejects(loadSourcingMemoryContext({ rpc: async () => ({ data: { memories: [rule] }, error: null }) }, params), /Invalid memory/);
  }
  const unavailable = { code: '42501', message: 'Project unavailable' };
  await assert.rejects(loadSourcingMemoryContext({ rpc: async () => ({ data: null, error: unavailable }) }, params), (error) => error === unavailable);
  await assert.rejects(loadSourcingMemoryContext({ rpc: async () => ({ data: null, error: null }) }, params), /Invalid memory context/);
});

test('fingerprints are stable across RPC ordering and preserve all relevant confirmed constraints', async () => {
  const first = await createSourcingMemoryContext([projectRule, orgRule], 'scoring');
  const reordered = await createSourcingMemoryContext([{ ...orgRule, effects: ['scoring', 'scoring'] }, projectRule], 'scoring');
  assert.equal(first.versionKey, reordered.versionKey);
  assert.equal(first.fingerprint, reordered.fingerprint);
  const rules = Array.from({ length: 60 }, (_, index) => ({ ...orgRule, id: 'rule-' + index }));
  const many = await createSourcingMemoryContext(rules, 'scoring');
  assert.equal(many.memories.length, 60);
  assert.equal(many.provenance.length, 60);
});

test('scoring cache identity changes for criteria changes and removals; presentation/search-only updates do not affect it', async () => {
  const before = await createSourcingMemoryContext([projectRule, orgRule], 'scoring');
  for (const change of [{ ...projectRule, version: 3 }, { ...projectRule, content: 'Require product teams' },
    { ...projectRule, kind: 'constraint' }, { ...projectRule, effects: ['search'] }]) {
    const after = await createSourcingMemoryContext([change, orgRule], 'scoring');
    assert.notEqual(after.fingerprint, before.fingerprint);
  }
  const removed = await createSourcingMemoryContext([orgRule], 'scoring');
  assert.notEqual(removed.fingerprint, before.fingerprint);
  const independent = await createSourcingMemoryContext([projectRule, orgRule, personalRule,
    { ...projectRule, id: 'search-only', effects: ['search'] }], 'scoring');
  assert.equal(independent.fingerprint, before.fingerprint);
});

test('preferences remain preferences, missing evidence is verified, and incompatible decisions require clarification', async () => {
  const search = await createSourcingMemoryContext([projectRule], 'search');
  const scoring = await createSourcingMemoryContext([projectRule, orgRule], 'scoring');
  assert.match(search.prompt, /sans devenir un filtre éliminatoire/);
  assert.match(scoring.prompt, /information absente est à vérifier/);
  assert.match(scoring.prompt, /memory_conflicts/);
  assert.match(scoring.prompt, /Respecte le brief explicite/);
  assert.ok(scoring.prompt.indexOf(orgRule.content) < scoring.prompt.indexOf(projectRule.content));
});

test('conflict analysis must acknowledge the loaded rules and cannot invent IDs or unbounded reasons', () => {
  assert.deepEqual(copy(parseSourcingMemoryConflicts(undefined, [])), []);
  assert.deepEqual(copy(parseSourcingMemoryConflicts([], [orgRule])), []);
  assert.deepEqual(copy(parseSourcingMemoryConflicts([{ memory_ids: ['org-rule', 'org-rule'], reason: '  Brief incompatible  ' }], [orgRule])),
    [{ memory_ids: ['org-rule'], reason: 'Brief incompatible' }]);
  for (const value of [undefined, null, false, {}, [{ memory_ids: ['invented'], reason: 'Conflict' }],
    [{ memory_ids: [], reason: 'Conflict' }], [{ memory_ids: ['org-rule'], reason: '' }],
    [{ memory_ids: ['org-rule'], reason: 'x'.repeat(501) }]]) {
    assert.throws(() => parseSourcingMemoryConflicts(value, [orgRule]), /memory conflict analysis/);
  }
});
