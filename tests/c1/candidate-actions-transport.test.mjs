import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const helpers = {
  'resolve-org-credentials.ts': 'export const resolveUnipileCredentials = async () => ({ apiKey: "test-key", dsn: "https://provider.example.test" });',
  'get-or-fetch-contact.ts': 'export const isCandidateErasedForOrg = async () => false;',
  'linkedin-quotas.ts': 'export const enforceLinkedInAction = async () => {}; export const recordUsageSignal = async () => {}; export const parseUsagePct = () => null;',
  'candidate-stage-events.ts': 'export const candidateRef = value => value; export const recordOutbound = async () => ({ ok: true });',
  'sequence-send-rules.ts': 'export const classifySendStatus = () => "ok";',
  'email-tool-policy.mjs': 'export const sanitizeEmailBody = value => value;',
  'interview-followup.ts': 'export const textToHtml = value => value;',
  'message-scope.ts': 'export const resolveCandidateActionMessageScope = async () => ({ candidate_id: "ACo-candidate", project_id: null });',
};
const compiled = await build({
  entryPoints: [`${root}supabase/functions/_shared/candidate-actions/transport.ts`],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'transport-dependencies', setup(builder) {
    builder.onResolve({ filter: /\.(ts|mjs)$/ }, args => {
      const name = args.path.split('/').pop();
      return helpers[name] ? { path: name, namespace: 'test-helper' } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: 'test-helper' }, args => ({ contents: helpers[args.path] }));
  } }],
});
const { loadCandidateActionTargets, CandidateActionTransportError } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const scope = { organization_id: 'organization', candidate_id: 'ACo-candidate', project_id: null };
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

function accountClient() {
  const tables = {
    member_email_accounts: [{ user_id: 'user', organization_id: scope.organization_id, account_status: 'CONNECTED', email_account_id: 'outlook-account', email_address: 'recruiter@example.test', provider: 'OUTLOOK' }],
    member_linkedin_accounts: [{ user_id: 'user', organization_id: scope.organization_id, account_status: 'CONNECTED', linkedin_account_id: 'linkedin-account' }],
    member_whatsapp_accounts: [],
  };
  return { from(table) {
    const filters = [];
    const query = {
      select() { return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      order() { return query; },
      limit() { return query; },
      insert() { throw new Error('Une découverte de canal ne doit jamais écrire'); },
      update() { throw new Error('Une découverte de canal ne doit jamais écrire'); },
      then(resolve, reject) { return Promise.resolve({ data: tables[table].filter(row => filters.every(filter => filter(row))), error: null }).then(resolve, reject); },
    };
    return query;
  } };
}

function discoveryResponse(status, body) {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options.method || 'GET' });
    assert.equal(new URL(url).pathname, '/api/v1/chat_attendees/ACo-candidate/chats');
    assert.equal(new URL(url).searchParams.get('account_id'), 'linkedin-account');
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return requests;
}

for (const status of [500, 404]) test(`la découverte LinkedIn HTTP ${status} ne devient pas une absence normale de conversation`, async () => {
  const requests = discoveryResponse(status, { items: [] });
  const admin = accountClient();
  await assert.rejects(
    loadCandidateActionTargets(admin, admin, 'user', scope, [{ email: 'candidate@example.test' }], []),
    error => error instanceof CandidateActionTransportError && error.code === 'CHAT_DISCOVERY_UNAVAILABLE' && error.message.includes('LinkedIn'),
  );
  assert.equal(requests.length, 1);
  assert.ok(requests.every(request => request.method === 'GET'));
});

test('une découverte LinkedIn 200 vide conserve la cible Outlook sans inventer de panne ou de conversation', async () => {
  const requests = discoveryResponse(200, { items: [] });
  const admin = accountClient();
  const targets = await loadCandidateActionTargets(admin, admin, 'user', scope, [{ email: 'candidate@example.test' }], []);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].channel, 'email');
  assert.equal(targets[0].service, 'outlook');
  assert.equal(targets[0].senderAccountId, 'outlook-account');
  assert.equal(targets[0].recipient, 'candidate@example.test');
  assert.equal(requests.length, 1);
});
