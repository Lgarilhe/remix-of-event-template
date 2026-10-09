import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real HTTP handler, not a copy of its request transformation.
// Every database read and provider request stays inside this local harness.
const source = readFileSync(new URL('../../supabase/functions/unipile-search/index.ts', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '');
const compiled = ts.transpileModule(source, {
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal(compiled.diagnostics?.length ?? 0, 0);
const booleanModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../../supabase/functions/_shared/search-boolean.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, booleanModule);

function harness(providerResponse = { items: [], paging: { total_count: 0 } }, providerStatus = 200) {
  const calls = { provider: [], writes: [] };
  let handler;
  const env = {
    SUPABASE_URL: 'https://supabase.local.test', SB_SECRET_KEY: 'fake-internal-key',
    UNIPILE_API_KEY: 'fake-provider-key', UNIPILE_DSN: 'linkedin.local.test',
  };
  const client = {
    from(table) {
      const result = () => ({ data: table === 'member_linkedin_accounts'
        ? [{ linkedin_account_id: 'owned-account' }] : null, error: null });
      const query = {
        select() { return query; }, eq() { return query; }, single: async () => result(),
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
        async insert(value) { calls.writes.push({ table, value }); return { error: null }; },
      };
      return query;
    },
  };
  vm.runInNewContext(compiled.outputText, {
    exports: {}, Request, Response, URL, AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} }, createClient: () => client, ...booleanModule.exports,
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
    fetch: async (url, init) => {
      assert.match(url, /^https:\/\/linkedin\.local\.test\/api\/v1\/linkedin\/search\?account_id=owned-account$/);
      calls.provider.push(JSON.parse(init.body));
      return new Response(JSON.stringify(providerResponse), { status: providerStatus });
    },
  });
  return { calls, async search(params) {
    const response = await handler(new Request('https://app.local.test/functions/v1/unipile-search', {
      method: 'POST', headers: { Authorization: 'Bearer fake-internal-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'search', organization_id: 'organization-a', account_id: 'owned-account',
        api: 'recruiter', category: 'people', keywords: 'Engineer', ...params }),
    }));
    return { status: response.status, data: await response.json() };
  } };
}

test('company name exclusions retain included and excluded Recruiter company IDs', async () => {
  const h = harness();
  assert.equal((await h.search({ company: { include: ['100', '200'], exclude: ['300'] }, company_keywords: [
    { keywords: 'Client actuel', priority: 'DOESNT_HAVE', scope: 'CURRENT' },
  ] })).status, 200);
  assert.deepEqual(h.calls.provider[0].company, [
    { id: '100', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' },
    { id: '200', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' },
    { id: '300', priority: 'DOESNT_HAVE', scope: 'CURRENT_OR_PAST' },
    { keywords: 'Client actuel', priority: 'DOESNT_HAVE', scope: 'CURRENT' },
  ]);
});

test('mixed Recruiter companies preserve every explicit priority and scope without mutating the input', async () => {
  const h = harness();
  const params = { company: [
    { id: '100', priority: 'MUST_HAVE', scope: 'PAST', name: 'Compagnie A' },
    { id: '200', priority: 'CAN_HAVE', scope: 'CURRENT' },
    { id: '300', priority: 'DOESNT_HAVE', scope: 'PAST_NOT_CURRENT' },
    { keywords: '"Conseil (France)"', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' },
  ], company_keywords: [{ keywords: 'Client', priority: 'DOESNT_HAVE', scope: 'CURRENT' }] };
  const original = structuredClone(params);
  assert.equal((await h.search(params)).status, 200);
  assert.deepEqual(h.calls.provider[0].company, [...params.company, ...params.company_keywords]);
  assert.deepEqual(params, original);
});

test('bare Recruiter company IDs mean alternatives while explicit MUST_HAVE stays mandatory', async () => {
  const h = harness();
  assert.equal((await h.search({ company: ['100', '200', { id: '300', priority: 'MUST_HAVE', scope: 'PAST' }] })).status, 200);
  assert.deepEqual(h.calls.provider[0].company, [
    { id: '100', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' },
    { id: '200', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' },
    { id: '300', priority: 'MUST_HAVE', scope: 'PAST' },
  ]);
});

test('company IDs and Sales Navigator exclusions keep their native formats', async () => {
  for (const [api, company] of [
    ['classic', ['100', '200']],
    ['sales_navigator', { include: ['100', '200'], exclude: ['300'] }],
  ]) {
    const h = harness();
    assert.equal((await h.search({ api, company })).status, 200);
    assert.deepEqual(h.calls.provider[0].company, company);
  }
});

test('past-company inclusions are alternatives and exclusions stay negative', async () => {
  for (const past_company of [['100', '200'], { include: ['100', '200'], exclude: ['300'] }]) {
    const h = harness();
    assert.equal((await h.search({ past_company })).status, 200);
    assert.deepEqual(h.calls.provider[0].past_company, [
      { id: '100', priority: 'CAN_HAVE' }, { id: '200', priority: 'CAN_HAVE' },
      ...(Array.isArray(past_company) ? [] : [{ id: '300', priority: 'DOESNT_HAVE' }]),
    ]);
  }
  const h = harness();
  const past_company = [{ id: '100', priority: 'MUST_HAVE' }, { id: '300', priority: 'DOESNT_HAVE' }];
  assert.equal((await h.search({ past_company })).status, 200);
  assert.deepEqual(h.calls.provider[0].past_company, past_company);
});

test('Classic and Sales Navigator reject oversized keywords before any provider request', async () => {
  for (const api of ['classic', 'sales_navigator']) {
    const h = harness();
    const keywords = 'Engineer '.repeat(24) + 'NOT "Client actuel"';
    const result = await h.search({ api, keywords });
    assert.equal(result.status, 400);
    assert.equal(result.data.error_code, 'KEYWORDS_TOO_LONG');
    assert.match(result.data.error, new RegExp(String(keywords.length)));
    assert.match(result.data.error, /200/);
    assert.equal(h.calls.provider.length, 0);
    assert.equal(h.calls.writes.length, 0);
  }
});

test('valid keyword strings keep all whitespace, quoted operators and punctuation', async () => {
  const queries = [
    '  ("Solution (Cloud) Engineer" OR "Sales AND support") AND NOT "Client actuel"  ',
    'NOT "Client actuel"', 'Python AND (Java OR Go)',
    '"OR" AND "NOT"', '"Ingénieur 🚀" OR "Data (R&D)"',
    'Research and development', 'head of sales or',
  ];
  for (const api of ['classic', 'sales_navigator', 'recruiter']) {
    for (const keywords of queries) {
      const h = harness();
      const result = await h.search({ api, keywords });
      assert.equal(result.status, 200, keywords);
      assert.equal(h.calls.provider[0].keywords, keywords);
    }
  }
});

test('a native search may omit keywords and valid 200-character Classic/Sales strings are unchanged', async () => {
  for (const api of ['classic', 'sales_navigator', 'recruiter']) {
    const h = harness();
    assert.equal((await h.search({ api, keywords: undefined, company: ['100'] })).status, 200);
    assert.equal(h.calls.provider[0].keywords, undefined);
  }
  for (const api of ['classic', 'sales_navigator']) {
    const h = harness();
    const keywords = 'a'.repeat(200);
    assert.equal((await h.search({ api, keywords })).status, 200);
    assert.equal(h.calls.provider[0].keywords, keywords);
  }
});

test('Recruiter keeps the full long query and every long company and role clause', async () => {
  const keywords = '("Solution Engineer" OR "Sales Engineer") AND ' + 'Cloud '.repeat(80) + 'NOT "Client actuel"';
  const h = harness();
  assert.equal((await h.search({ keywords,
    company_keywords: [{ keywords, priority: 'DOESNT_HAVE', scope: 'PAST' }],
    role: [{ keywords, priority: 'MUST_HAVE', scope: 'CURRENT' }],
  })).status, 200);
  assert.equal(h.calls.provider[0].keywords, keywords);
  assert.equal(h.calls.provider[0].company[0].keywords, keywords);
  assert.equal(h.calls.provider[0].role[0].keywords, keywords);
});

test('invalid Boolean delimiters and dangling operators return actionable 400 instead of being rewritten', async () => {
  for (const keywords of ['Python AND', '"Solution Engineer', '(Python OR Java', 'Python OR Java)', 'Python AND (Java OR)', 'Python AND (OR Java)']) {
    for (const api of ['classic', 'sales_navigator', 'recruiter']) {
      const h = harness();
      const result = await h.search({ api, keywords });
      assert.equal(result.status, 400, api + ': ' + keywords);
      assert.equal(result.data.error_code, 'INVALID_BOOLEAN_QUERY');
      assert.match(result.data.error, /[Gg]uillemet|[Pp]arenthèse|[Oo]pérateur/);
      assert.equal(h.calls.provider.length, 0);
      assert.equal(h.calls.writes.length, 0);
    }
  }
});

test('invalid company and role keywords are rejected on every Recruiter request path', async () => {
  for (const params of [
    { company_keywords: [{ keywords: 'Client AND', priority: 'DOESNT_HAVE', scope: 'CURRENT' }] },
    { company: [{ keywords: '(Client', priority: 'DOESNT_HAVE', scope: 'PAST' }] },
    { role: [{ keywords: 'Engineer OR', priority: 'CAN_HAVE', scope: 'CURRENT' }] },
    { job_title: [{ keywords: '(Engineer', priority: 'MUST_HAVE', scope: 'CURRENT' }] },
  ]) {
    const h = harness();
    const result = await h.search(params);
    assert.equal(result.status, 400);
    assert.equal(result.data.error_code, 'INVALID_BOOLEAN_QUERY');
    assert.equal(h.calls.provider.length, 0);
  }
});

test('Recruiter role IDs, keyword roles and past roles retain their priorities and scopes together', async () => {
  const h = harness();
  assert.equal((await h.search({
    job_title: [{ id: '100', priority: 'CAN_HAVE', scope: 'CURRENT', is_selection: true },
      { keywords: '"Solution (Cloud) Engineer"', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    role: [{ keywords: 'NOT "Sales AND support"', priority: 'DOESNT_HAVE', scope: 'PAST' }],
    past_job_title: [{ id: '200', priority: 'DOESNT_HAVE' }],
  })).status, 200);
  assert.deepEqual(h.calls.provider[0].role, [
    { id: '100', is_selection: true, priority: 'CAN_HAVE', scope: 'CURRENT' },
    { keywords: '"Solution (Cloud) Engineer"', priority: 'MUST_HAVE', scope: 'CURRENT' },
    { keywords: 'NOT "Sales AND support"', priority: 'DOESNT_HAVE', scope: 'PAST' },
    { id: '200', is_selection: false, priority: 'DOESNT_HAVE', scope: 'PAST' },
  ]);
});

test('provider rejection of a full valid Recruiter query is reported without a shortened retry', async () => {
  const h = harness({ type: 'errors/content_too_large', detail: 'Too large' }, 400);
  const keywords = 'Cloud '.repeat(80) + 'NOT "Client actuel"';
  const result = await h.search({ keywords });
  assert.equal(result.status, 400);
  assert.equal(result.data.errorType, 'CONTENT_TOO_LARGE');
  assert.equal(h.calls.provider.length, 1);
  assert.equal(h.calls.provider[0].keywords, keywords);
});
