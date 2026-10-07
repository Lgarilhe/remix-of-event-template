import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const bundle = buildSync({ entryPoints: ['supabase/functions/_shared/candidate-actions/errors.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { projectCandidateActionError } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('SQL permission errors never become trusted through the fallback ACTION_UNAVAILABLE code', () => {
  const actual = projectCandidateActionError({ code: '42501', status: 403, message: 'permission denied for table users; private source text' });
  assert.equal(actual.status, 503);
  assert.equal(actual.payload.error_code, 'ACTION_UNAVAILABLE');
  assert.match(actual.payload.error, /Actualisez leur état/);
  assert.doesNotMatch(JSON.stringify(actual), /permission denied|users|private source/);
});

test('uncoded provider exceptions and unknown codes expose only the generic French error', () => {
  for (const error of [new Error('API failed with Bearer sensitive-token'), { code: 'STORE_ERROR', status: 400, message: 'SQL internal details' }]) {
    const actual = projectCandidateActionError(error);
    assert.equal(actual.status, 503);
    assert.equal(actual.payload.error_code, 'ACTION_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(actual), /sensitive-token|SQL internal/);
  }
});

test('audited context errors retain the actionable French explanation and HTTP status', () => {
  const actual = projectCandidateActionError({ code: 'CANDIDATE_ERASED', status: 403, message: 'Ce candidat a demandé l’effacement de ses données.' }, true);
  assert.equal(actual.status, 403);
  assert.equal(actual.payload.error_code, 'CANDIDATE_ERASED');
  assert.match(actual.payload.error, /effacement/);
});

test('application conflict hints retain their explanation, but invalid HTTP statuses cannot reach responses', () => {
  const actual = projectCandidateActionError({ code: 'ACTION_CONTEXT_CHANGED', status: 302, message: 'Le contexte a changé. Préparez une nouvelle proposition.' });
  assert.equal(actual.status, 409);
  assert.equal(actual.payload.error_code, 'ACTION_CONTEXT_CHANGED');
  assert.match(actual.payload.error, /Préparez/);
});
