import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Run the actual provider handler and its normalizer. No database, external
// provider, authenticated session, or write is available to this harness.
const path = '../../supabase/functions/unipile-search/index.ts';
const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '');
const compiled = ts.transpileModule(source + '\nexports.getProfile = handleGetProfile;', {
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal(compiled.diagnostics?.length ?? 0, 0);

function harness(status = 200, body = {}) {
  const calls = [];
  const context = {
    exports: {}, Request, Response, URL, AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    Deno: { serve() {} },
    createClient() { throw new Error('Database access forbidden in profile handler test'); },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    },
  };
  vm.runInNewContext(compiled.outputText, context, { filename: path });
  return {
    calls,
    async get(params = { profile_id: 'candidate-a' }, beforeProvider) {
      const response = await context.exports.getProfile('https://linkedin.local.test/api/v1', 'test-key', 'account-a', params, beforeProvider);
      return { status: response.status, headers: response.headers, data: await response.json() };
    },
  };
}

test('documented user absence allows a strictly identified profile fallback', async () => {
  for (const body of [
    { type: 'errors/resource_not_found', detail: 'User not found.' },
    { type: 'errors/resource_not_found', detail: '  User not found  ' },
    { message: 'Profile not found.' },
  ]) {
    const h = harness(404, body);
    const result = await h.get();
    assert.equal(result.status, 404);
    assert.deepEqual(result.data, { success: false, errorType: 'PROFILE_NOT_FOUND',
      error: 'Ce profil est introuvable sur LinkedIn. Vérifiez le lien du candidat.' });
    assert.equal(h.calls.length, 1);
    assert.equal(result.headers.get('access-control-allow-origin'), '*');
    assert.equal(result.headers.get('content-type'), 'application/json');
  }
});

test('account, route and generic resource 404 errors never authorize a candidate fallback', async () => {
  for (const body of [
    { type: 'errors/resource_not_found', detail: 'Account not found.' },
    { type: 'errors/resource_not_found', detail: 'Resource not found.' },
    { type: 'errors/resource_not_found', message: 'Not found' },
    { type: 'errors/account_not_found', detail: 'User not found.' },
    { detail: 'Account not found.', message: 'User not found.' },
    { detail: 'User not found. Reconnect the account.' },
    { detail: '404 /users/candidate-a not found' },
    {}, null,
  ]) {
    const h = harness(404, body);
    const result = await h.get();
    assert.equal(result.status, 502, JSON.stringify(body));
    assert.equal(result.data.errorType, 'PROFILE_UNAVAILABLE');
    assert.equal(result.data.error, 'LinkedIn ne répond pas pour le moment. Réessayez dans quelques instants.');
    assert.equal(h.calls.length, 1);
  }
});

test('a disconnected provider account is distinct from an expired Konekt session', async () => {
  const result = await harness(401, { type: 'errors/unauthorized', message: 'Unipile invalid API key (private-secret)' }).get();
  assert.equal(result.status, 403);
  assert.equal(result.data.errorType, 'LINKEDIN_CONNECTION_REQUIRED');
  assert.equal(result.data.error, 'Reconnectez votre compte LinkedIn dans les paramètres pour consulter ce profil.');
  assert.doesNotMatch(JSON.stringify(result.data), /Unipile|private-secret|session/i);
});

test('provider access denial remains an access failure without a fallback or raw vendor text', async () => {
  const result = await harness(403, { detail: 'Unipile access denied (private-secret)' }).get();
  assert.equal(result.status, 403);
  assert.equal(result.data.errorType, 'ACCOUNT_ACCESS');
  assert.equal(result.data.error, 'Votre compte LinkedIn ne permet pas de consulter ce profil.');
  assert.doesNotMatch(JSON.stringify(result.data), /Unipile|private-secret/);
});

test('provider profile quota survives the edge transport as a rate limit', async () => {
  const result = await harness(429, { detail: 'Unipile quota exhausted' }).get();
  assert.equal(result.status, 429);
  assert.equal(result.data.errorType, 'RATE_LIMIT');
  assert.equal(result.data.error, 'La limite de consultation des profils LinkedIn est atteinte. Réessayez plus tard.');
  assert.doesNotMatch(JSON.stringify(result.data), /Unipile/);
});

test('other provider errors remain unavailable, including not-found text on non-404 responses', async () => {
  for (const status of [400, 422, 500, 502, 503, 504]) {
    const h = harness(status, { type: 'errors/resource_not_found', detail: 'User not found.', message: 'Unipile internal private-secret' });
    const result = await h.get();
    assert.equal(result.status, status === 503 ? 503 : 502);
    assert.equal(result.data.errorType, 'PROFILE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(result.data), /Unipile|private-secret|PROFILE_NOT_FOUND/);
    assert.equal(h.calls.length, 1);
  }
});

test('non-JSON provider error bodies stay safe and unavailable', async () => {
  for (const [status, expectedStatus] of [[404, 502], [500, 502], [503, 503], [401, 403], [429, 429]]) {
    const result = await harness(status, '<html>Unipile private-secret unavailable</html>').get();
    assert.equal(result.status, expectedStatus);
    assert.equal(result.data.success, false);
    assert.notEqual(result.data.errorType, 'PROFILE_NOT_FOUND');
    assert.doesNotMatch(JSON.stringify(result.data), /Unipile|private-secret|<html>/);
  }
});

test('a successful detailed profile keeps the existing normalization and visits the requested account once', async () => {
  const h = harness(200, {
    provider_id: 'candidate-a', first_name: 'Alice', last_name: 'Martin',
    is_open_to_work: true, network_distance: 'FIRST_DEGREE',
    work_experience: [{ position: 'Engineer', start: '2020-09', end: null, skills: ['Python'] }],
    education: [{ school: 'École', start: '2015', end: '2018' }],
  });
  const result = await h.get({ profile_id: 'candidate-a', profile_url: 'https://www.linkedin.com/in/alice-martin/' });
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.equal(result.data.profile.provider_id, 'candidate-a');
  assert.equal(result.data.profile.open_to_work, true);
  assert.equal(result.data.profile.network_distance, 'DISTANCE_1');
  assert.deepEqual(result.data.profile.work_experience[0], {
    position: 'Engineer', role: 'Engineer', start: { year: 2020, month: 9 }, end: null,
    skills: [{ name: 'Python', endorsement_count: 0 }],
  });
  assert.deepEqual(result.data.profile.education[0], { school: 'École', start: { year: 2015 }, end: { year: 2018 } });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://linkedin.local.test/api/v1/users/candidate-a?account_id=account-a');
  assert.equal(h.calls[0].options.headers['X-API-KEY'], 'test-key');
});

test('a URL-only profile lookup preserves the public-slug request', async () => {
  const h = harness(200, { first_name: 'Alice' });
  assert.equal((await h.get({ profile_url: 'https://www.linkedin.com/in/alice-martin/' })).status, 200);
  assert.equal(h.calls[0].url, 'https://linkedin.local.test/api/v1/users/alice-martin?account_id=account-a');
});

test('the continuous-sourcing provider guard blocks before any HTTP request', async () => {
  const h = harness();
  const quota = new Error('continuous sourcing guard denied');
  await assert.rejects(h.get({ profile_id: 'candidate-a' }, async () => { throw quota; }), error => error === quota);
  assert.equal(h.calls.length, 0);
});

test('missing profile identity is rejected before the provider guard or network', async () => {
  const h = harness();
  let guardCalls = 0;
  assert.equal((await h.get({}, async () => { guardCalls++; })).status, 400);
  assert.equal(guardCalls, 0);
  assert.equal(h.calls.length, 0);
});
