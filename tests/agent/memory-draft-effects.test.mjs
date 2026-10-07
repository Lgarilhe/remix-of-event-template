import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../../src/types/agentMemory.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { isAgentMemoryDraftValid, canUseAgentMemoryEffect } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'),
);
const draft = { content: 'Privilégier les expériences SaaS B2B récentes.', kind: 'preference', scope: 'project', effects: ['search', 'scoring'] };

test('recruiting decisions can be confirmed for their recruitment or organization', () => {
  assert.equal(isAgentMemoryDraftValid(draft), true);
  assert.equal(isAgentMemoryDraftValid({ ...draft, scope: 'organization' }), true);
});

test('private recruiting decisions cannot become shared filters or candidate evaluations', () => {
  assert.equal(isAgentMemoryDraftValid({ ...draft, scope: 'user' }), false);
  assert.equal(isAgentMemoryDraftValid({ ...draft, scope: 'user', effects: ['assistant', 'search'] }), false);
  assert.equal(isAgentMemoryDraftValid({ ...draft, scope: 'user', effects: ['presentation', 'scoring'] }), false);
  assert.equal(canUseAgentMemoryEffect('user', 'search'), false);
  assert.equal(canUseAgentMemoryEffect('user', 'scoring'), false);
});

test('communication memories remain personal and require a concrete use', () => {
  assert.equal(isAgentMemoryDraftValid({ ...draft, scope: 'user', effects: ['assistant', 'presentation'] }), true);
  assert.equal(isAgentMemoryDraftValid({ ...draft, effects: [] }), false);
  assert.equal(isAgentMemoryDraftValid({ ...draft, content: 'Oui' }), false);
  assert.equal(isAgentMemoryDraftValid({ ...draft, effects: ['contacts'] }), false);
});
