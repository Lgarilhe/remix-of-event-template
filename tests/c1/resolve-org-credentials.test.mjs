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
const credentialModule = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const { resolveApolloCredentials, clearCredentialCaches } = credentialModule;
let environment;
globalThis.Deno = { env: { get: key => environment[key] } };
test.beforeEach(() => {
  clearCredentialCaches();
  environment = { APOLLO_API_KEY: 'environment-key' };
});

function database(responses) {
  let count = 0;
  return {
    get count() { return count; },
    from() { return { select() { return this; }, eq() { return this; }, async single() { return responses[Math.min(count++, responses.length - 1)]; } }; },
  };
}

test('a missing org key is looked up once and the first read falls back to the environment', async () => {
  const db = database([{ data: null, error: { code: 'PGRST116' } }]);
  assert.deepEqual(await resolveApolloCredentials('org-a', db), { apiKey: 'environment-key' });
  assert.equal(db.count, 1);
});

test('a positive org key wins and cannot leak into another org', async () => {
  const db = database([
    { data: { apollo_api_key: 'org-key' }, error: null },
    { data: null, error: { code: 'PGRST116' } },
  ]);
  assert.equal((await resolveApolloCredentials('org-a', db)).apiKey, 'org-key');
  assert.equal((await resolveApolloCredentials('org-a', db)).apiKey, 'org-key');
  assert.equal((await resolveApolloCredentials('org-b', db)).apiKey, 'environment-key');
  assert.equal(db.count, 2);
});

test('a database failure does not poison the next org key lookup', async () => {
  const db = database([
    { data: null, error: { code: '08006' } },
    { data: { apollo_api_key: 'recovered-key' }, error: null },
  ]);
  assert.equal((await resolveApolloCredentials('org-a', db)).apiKey, 'environment-key');
  assert.equal((await resolveApolloCredentials('org-a', db)).apiKey, 'recovered-key');
  assert.equal(db.count, 2);
});

test('an absent org key and environment key resolve to null', async () => {
  const db = database([{ data: null, error: null }]);
  environment = {};
  assert.equal(await resolveApolloCredentials('org-a', db), null);
});

test('the module no longer exports a LinkedIn credential resolver', () => {
  assert.deepEqual(Object.keys(credentialModule).filter((name) => /unipile/i.test(name)), []);
});
