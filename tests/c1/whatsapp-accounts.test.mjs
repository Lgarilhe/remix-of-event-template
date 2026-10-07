import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { transformSync } from 'esbuild';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const helperSource = read('supabase/functions/_shared/whatsapp-account.ts');
const helper = await import(`data:text/javascript;base64,${Buffer.from(transformSync(helperSource, { loader: 'ts', format: 'esm' }).code).toString('base64')}`);
const handlerSource = transformSync(read('supabase/functions/unipile-accounts/index.ts').replace(/^\uFEFF/, '').replace(/^import .*?;\r?\n/gm, ''), { loader: 'ts', format: 'esm' }).code;

function fixture(options = {}) {
  const own = { id: 'mapping-own', organization_id: 'org-a', user_id: 'user-a', whatsapp_account_id: 'wa-own', name: 'My account', phone_number: '33612345678', account_status: 'OK' };
  const tables = {
    member_whatsapp_accounts: [own,
      { ...own, id: 'mapping-peer', user_id: 'user-peer', whatsapp_account_id: 'wa-peer' },
      { ...own, id: 'mapping-foreign', organization_id: 'org-b', whatsapp_account_id: 'wa-foreign' }],
    member_linkedin_accounts: [],
    member_email_accounts: [
      { id: '91111111-1111-4111-8111-111111111111', organization_id: 'org-a', user_id: 'user-a', email_account_id: 'email-own' },
      { id: '92222222-2222-4222-8222-222222222222', organization_id: 'org-a', user_id: 'user-peer', email_account_id: 'email-peer' },
      { id: '93333333-3333-4333-8333-333333333333', organization_id: 'org-b', user_id: 'user-a', email_account_id: 'email-foreign' },
    ],
    organization_members: [{ id: 'membership', organization_id: 'org-a', user_id: 'user-a', role: 'admin' }],
    organization_integrations: options.noCredentials ? [] : [{ organization_id: 'org-a', unipile_connected: true, unipile_api_key: 'fixture-api-key', unipile_dsn: 'provider.test' }],
  };
  class Query {
    constructor(table) { this.table = table; this.filters = []; }
    select() { return this; }
    eq(key, value) { this.filters.push(row => row[key] === value); return this; }
    order() { return this; }
    update(value) { this.value = value; return this; }
    delete() { this.deleted = true; return this; }
    run(single = false) {
      const rows = (tables[this.table] ?? []).filter(row => this.filters.every(filter => filter(row)));
      if (this.value) rows.forEach(row => Object.assign(row, this.value));
      if (this.deleted) tables[this.table] = tables[this.table].filter(row => !rows.includes(row));
      return { data: single ? rows[0] ?? null : rows, error: null };
    }
    single() { return Promise.resolve(this.run(true)); }
    maybeSingle() { return Promise.resolve(this.run(true)); }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
  }
  const requests = [], logs = [];
  let handler;
  const variables = { SUPABASE_URL: 'https://supabase.fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key', UNIPILE_WEBHOOK_SECRET: 'fixture-webhook-secret' };
  const context = {
    Response, Request, URL, TextEncoder, FormData, crypto: webcrypto, AbortController, setTimeout, clearTimeout,
    ...helper,
    createClient: () => ({ from: table => new Query(table) }),
    requireAuth: async () => ({ userId: 'user-a', method: 'jwt' }),
    stopLinkedInAccountSending: async () => ({}),
    console: { log: (...args) => logs.push(args), warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    Deno: { env: { get: key => variables[key] }, serve: fn => { handler = fn; } },
    fetch: async (url, init = {}) => {
      requests.push({ url, init });
      if (options.upstreamError) return new Response('{}', { status: 503 });
      if (init.method === 'DELETE') return new Response(null, { status: options.missing ? 404 : 204 });
      if (url.endsWith('/hosted/accounts/link')) return Response.json({ url: 'https://account.provider.test/fixture-hosted-token' });
      return Response.json({ id: url.split('/').at(-1), name: 'Recruiter', type: 'WHATSAPP', connection_params: { im: { phone_number: '33612345678', session_token: 'private-token' } }, sources: [{ status: 'OK' }] });
    },
  };
  vm.runInNewContext(handlerSource, context);
  return {
    requests, tables, logs,
    invoke: async body => {
      const response = await handler(new Request('https://supabase.fixture/functions/v1/unipile-accounts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organization_id: 'org-a', ...body }),
      }));
      return { status: response.status, data: await response.json() };
    },
  };
}

test('WhatsApp projection exposes only identity and status, for array and keyed sources', () => {
  const input = { id: 'wa', type: 'WHATSAPP', name: 'Recruiter', connection_params: { im: { phone_number: '33612345678', token: 'secret' }, session: 'secret' }, sources: { MESSAGING: { status: 'OK' } }, proxy: { password: 'secret' } };
  assert.deepEqual(helper.projectWhatsAppAccount(input), { id: 'wa', type: 'WHATSAPP', name: 'Recruiter', identifier: '33612345678', status: 'OK' });
  assert.equal(helper.projectWhatsAppAccount({ ...input, type: 'LINKEDIN' }), null);
  assert.equal(helper.projectWhatsAppAccount({ ...input, connection_params: {}, sources: [] }).identifier, null);
  assert.equal(helper.projectWhatsAppAccount({ ...input, sources: [{ status: 'CREDENTIALS' }] }).status, 'CREDENTIALS');
});

test('WhatsApp account list fetches exact own account IDs within the requested organization', async () => {
  const f = fixture();
  const result = await f.invoke({ action: 'list_whatsapp' });
  assert.equal(result.status, 200);
  assert.equal(result.data.accounts.length, 1);
  assert.deepEqual(f.requests.map(request => request.url), ['https://provider.test/api/v1/accounts/wa-own']);
  assert.equal(result.data.accounts[0].identifier, '33612345678');
  assert.doesNotMatch(JSON.stringify(result.data), /private-token|session_token|fixture-api-key|fixture-service-key/);
});

test('WhatsApp list failures are errors rather than a successful empty list', async () => {
  const f = fixture({ upstreamError: true });
  const result = await f.invoke({ action: 'list_whatsapp' });
  assert.equal(result.status, 502);
  assert.equal(result.data.success, false);
  assert.equal(result.data.accounts, undefined);
  const unavailable = await fixture({ noCredentials: true }).invoke({ action: 'list_whatsapp' });
  assert.equal(unavailable.data.success, false);
  assert.match(unavailable.data.error, /WhatsApp/);
});

test('Even an organization admin cannot disconnect or read a colleague personal WhatsApp', async () => {
  for (const action of ['disconnect_whatsapp', 'disconnect', 'get_account_details']) {
    const f = fixture();
    const result = await f.invoke({ action, account_id: 'wa-peer' });
    assert.equal(result.status, 403, action);
    assert.equal(f.requests.length, 0, action);
  }
  const f = fixture();
  const result = await f.invoke({ action: 'disconnect_whatsapp', account_id: 'wa-foreign' });
  assert.equal(result.status, 403);
  assert.equal(f.requests.length, 0);
});

test('Disconnecting own WhatsApp revokes the provider account and keeps its ownership tombstone', async () => {
  for (const missing of [false, true]) {
    const f = fixture({ missing });
    const result = await f.invoke({ action: 'disconnect_whatsapp', account_id: 'wa-own' });
    assert.equal(result.data.success, true);
    assert.equal(f.requests[0].init.method, 'DELETE');
    assert.equal(f.tables.member_whatsapp_accounts[0].account_status, 'DELETED');
    assert.equal(f.tables.member_whatsapp_accounts.length, 3);
  }
});

test('Hosted WhatsApp reconnect uses the exact owned account and signed provider-specific callback', async () => {
  const f = fixture();
  const result = await f.invoke({ action: 'hosted_auth_link', providers: ['WHATSAPP'], reconnect_account_id: 'wa-own' });
  assert.equal(result.data.success, true);
  const body = JSON.parse(f.requests[0].init.body);
  assert.deepEqual(body.providers, ['WHATSAPP']);
  assert.equal(body.type, 'reconnect');
  assert.equal(body.reconnect_account, 'wa-own');
  assert.match(body.name, /user:user-a\|org:org-a\|providers:WHATSAPP\|expires:\d+\|reconnect:wa-own/);
  assert.match(body.notify_url, /\/functions\/v1\/unipile-webhook\?hosted_sig=[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(f.logs), /fixture-hosted-token|hosted_sig|fixture-api-key|fixture-webhook-secret/);
  assert.deepEqual(Object.keys(result.data).sort(), ['success', 'url']);
});

test('Hosted WhatsApp rejects orphan, peer and foreign account reconnects before contacting provider', async () => {
  for (const accountId of ['wa-peer', 'wa-foreign', 'wa-orphan']) {
    const f = fixture();
    const result = await f.invoke({ action: 'hosted_auth_link', providers: ['WHATSAPP'], reconnect_account_id: accountId });
    assert.equal(result.status, 403, accountId);
    assert.equal(f.requests.length, 0);
  }
});

test('WhatsApp return URL stays within this app and mixed provider flows are rejected', async () => {
  assert.equal(helper.whatsappReturnUrl('https://evil.test/path'), null);
  assert.equal(helper.whatsappReturnUrl('https://konekt-app-navy.vercel.app/other?token=x'), 'https://konekt-app-navy.vercel.app/settings/account/connections#whatsapp');
  assert.equal(helper.whatsappReturnUrl('https://konekt-app-git-test-lgarilhe-konektfrs-projects.vercel.app/foo'), 'https://konekt-app-git-test-lgarilhe-konektfrs-projects.vercel.app/settings/account/connections#whatsapp');
  for (const params of [{ providers: ['WHATSAPP'], success_redirect_url: 'https://evil.test' }, { providers: ['WHATSAPP', 'LINKEDIN'] }]) {
    const f = fixture();
    const result = await f.invoke({ action: 'hosted_auth_link', ...params });
    assert.equal(result.status, 400);
    assert.equal(f.requests.length, 0);
  }
});

test('Email dissociation uses an exact owned binding without provider credentials or remote deletion', async () => {
  const f = fixture({ noCredentials: true });
  const result = await f.invoke({ action: 'unlink_email_account', mapping_id: '91111111-1111-4111-8111-111111111111', expected_account_id: 'email-own' });
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.deepEqual(f.tables.member_email_accounts.map(row => row.email_account_id), ['email-peer', 'email-foreign']);
  assert.equal(f.requests.length, 0);
});

test('Email dissociation refuses peer, foreign and stale bindings even for an organization admin', async () => {
  for (const [mappingId, expectedAccountId, status] of [
    ['92222222-2222-4222-8222-222222222222', 'email-peer', 403],
    ['93333333-3333-4333-8333-333333333333', 'email-foreign', 403],
    ['91111111-1111-4111-8111-111111111111', 'repointed-account', 409],
    ['91111111-1111-4111-8111-111111111111', '', 400],
  ]) {
    const f = fixture();
    const result = await f.invoke({ action: 'unlink_email_account', mapping_id: mappingId, expected_account_id: expectedAccountId });
    assert.equal(result.status, status);
    assert.equal(f.tables.member_email_accounts.length, 3);
    assert.equal(f.requests.length, 0);
  }
});
