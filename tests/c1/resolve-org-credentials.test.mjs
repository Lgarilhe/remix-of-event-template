import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const compiled = await build({
  entryPoints: [`${root}supabase/functions/_shared/resolve-org-credentials.ts`],
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'supabase-test', setup(builder) {
    builder.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase/ }, () => ({ path: 'supabase', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const createClient = () => { throw new Error("Use the supplied client"); };' }));
  } }],
});
const { resolveUnipileCredentials, clearCredentialCaches } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
let environment;
globalThis.Deno = { env: { get: key => environment[key] } };
test.beforeEach(() => {
  clearCredentialCaches();
  environment = { UNIPILE_API_KEY: 'environment-key', UNIPILE_DSN: 'provider.test/' };
});

function database(responses) {
  let count = 0;
  return {
    get count() { return count; },
    from() { return { select() { return this; }, eq() { return this; }, async single() { return responses[Math.min(count++, responses.length - 1)]; } }; },
  };
}

test('a cached missing org connection retains the environment fallback on every read', async () => {
  const db = database([{ data: null, error: { code: 'PGRST116' } }]);
  const expected = { apiKey: 'environment-key', dsn: 'https://provider.test' };
  assert.deepEqual(await resolveUnipileCredentials('org-a', db), expected);
  assert.deepEqual(await resolveUnipileCredentials('org-a', db), expected);
  assert.deepEqual(await resolveUnipileCredentials('org-a', db), expected);
  assert.equal(db.count, 1, 'negative org lookup is still cached');
});

test('a positive org connection wins and cannot leak into another org', async () => {
  const db = database([
    { data: { unipile_connected: true, unipile_api_key: 'org-key', unipile_dsn: 'org-provider.test' }, error: null },
    { data: null, error: { code: 'PGRST116' } },
  ]);
  assert.equal((await resolveUnipileCredentials('org-a', db)).apiKey, 'org-key');
  assert.equal((await resolveUnipileCredentials('org-a', db)).apiKey, 'org-key');
  assert.equal((await resolveUnipileCredentials('org-b', db)).apiKey, 'environment-key');
  assert.equal(db.count, 2);
});

test('a database failure does not poison the next org connection lookup', async () => {
  const db = database([
    { data: null, error: { code: '08006' } },
    { data: { unipile_connected: true, unipile_api_key: 'recovered-key', unipile_dsn: 'recovered.test' }, error: null },
  ]);
  assert.equal((await resolveUnipileCredentials('org-a', db)).apiKey, 'environment-key');
  assert.equal((await resolveUnipileCredentials('org-a', db)).apiKey, 'recovered-key');
  assert.equal(db.count, 2);
});

test('an absent environment connection stays unavailable and its rotation is read through a negative cache', async () => {
  const db = database([{ data: null, error: null }]);
  environment = {};
  assert.equal(await resolveUnipileCredentials('org-a', db), null);
  environment = { UNIPILE_API_KEY: 'new-key', UNIPILE_DSN: 'new.test' };
  assert.deepEqual(await resolveUnipileCredentials('org-a', db), { apiKey: 'new-key', dsn: 'https://new.test' });
  assert.equal(db.count, 1);
});
