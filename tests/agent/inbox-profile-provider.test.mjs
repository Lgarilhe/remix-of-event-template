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
      const providerBody = typeof body === 'function' ? body(new URL(url)) : body;
      return new Response(typeof providerBody === 'string' ? providerBody : JSON.stringify(providerBody), { status });
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

test('explicit detailed lookup retrieves the five profile sections without notifying the candidate', async () => {
  const identity = { provider_id: 'candidate-a', first_name: 'Alice', last_name: 'Martin' };
  const sections = ['about', 'experience', 'education', 'skills', 'languages'];
  const h = harness(200, url => {
    // Reproduce the documented provider contract: an identity-only request
    // cannot return any of these details, even when the profile has them.
    if (!sections.every(section => url.searchParams.getAll('linkedin_sections').includes(section))) return identity;
    return { ...identity, summary: 'Cloud engineer',
      work_experience: [{ position: 'Engineer', start: '2020-09', end: null }],
      education: [{ school: 'École', start: '2015', end: '2018' }],
      skills: ['Python'], languages: [{ name: 'French', proficiency: 'Native' }] };
  });
  const basic = await h.get({ profile_id: 'candidate-a' });
  assert.deepEqual(basic.data.profile, identity);
  const detailed = await h.get({ profile_id: 'candidate-a', include_details: true });
  assert.equal(detailed.status, 200);
  assert.equal(detailed.data.success, true);
  assert.equal(detailed.data.profile.summary, 'Cloud engineer');
  assert.equal(detailed.data.profile.work_experience[0].role, 'Engineer');
  assert.deepEqual(detailed.data.profile.work_experience[0].start, { year: 2020, month: 9 });
  assert.equal(detailed.data.profile.education[0].school, 'École');
  assert.deepEqual(detailed.data.profile.skills, ['Python']);
  assert.deepEqual(detailed.data.profile.languages, [{ name: 'French', proficiency: 'Native' }]);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url, 'https://linkedin.local.test/api/v1/users/candidate-a?account_id=account-a');
  const query = new URL(h.calls[1].url).searchParams;
  assert.deepEqual([...query.entries()], [
    ['account_id', 'account-a'], ...sections.map(section => ['linkedin_sections', section]), ['notify', 'false'],
  ]);
});

test('only boolean true opts into detail sections; legacy and malformed flags keep the identity-only request', async () => {
  for (const include_details of [undefined, null, false, 'true', 'all', 1, [], {}]) {
    const h = harness(200, url => url.searchParams.has('linkedin_sections')
      ? { first_name: 'Alice', summary: 'Unexpected detail request' } : { first_name: 'Alice' });
    const result = await h.get({ profile_id: 'candidate-a', include_details });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.profile, { first_name: 'Alice' });
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, 'https://linkedin.local.test/api/v1/users/candidate-a?account_id=account-a');
  }
});

test('a detailed response with throttled sections preserves available details and the provider limitation', async () => {
  const h = harness(200, url => {
    assert.deepEqual(url.searchParams.getAll('linkedin_sections'), ['about', 'experience', 'education', 'skills', 'languages']);
    return { provider_id: 'candidate-a', summary: 'Cloud engineer',
      work_experience: [{ position: 'Engineer', start: '2020-09', end: null }],
      throttled_sections: ['skills', 'languages'] };
  });
  const result = await h.get({ profile_id: 'candidate-a', include_details: true });
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.equal(result.data.profile.summary, 'Cloud engineer');
  assert.equal(result.data.profile.work_experience[0].role, 'Engineer');
  assert.deepEqual(result.data.profile.throttled_sections, ['skills', 'languages']);
  assert.equal(result.data.profile.skills, undefined);
  assert.equal(result.data.profile.languages, undefined);
  assert.equal(h.calls.length, 1, 'partial sections do not cause an automatic provider retry');
});

test('the continuous-sourcing provider guard blocks before any HTTP request', async () => {
  for (const include_details of [undefined, true]) {
    const h = harness();
    const quota = new Error('continuous sourcing guard denied');
    await assert.rejects(h.get({ profile_id: 'candidate-a', include_details }, async () => { throw quota; }), error => error === quota);
    assert.equal(h.calls.length, 0);
  }
});

test('missing profile identity is rejected before the provider guard or network', async () => {
  const h = harness();
  let guardCalls = 0;
  assert.equal((await h.get({}, async () => { guardCalls++; })).status, 400);
  assert.equal(guardCalls, 0);
  assert.equal(h.calls.length, 0);
});
