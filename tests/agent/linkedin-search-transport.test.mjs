import assert from 'node:assert/strict';
import test from 'node:test';
import { bootHandler, fakeDatabase } from './unipile-search-harness.mjs';

// Le vrai point d'entrée HTTP de unipile-search (index.ts et ses modules, sur le client partagé de l'API v2) :
// la base, les plafonds et le prestataire sont des doublures locales, aucun réseau.
const ACCOUNT = 'acc_owned';
const SEARCH_PATHS = {
  recruiter: `/${ACCOUNT}/linkedin/recruiter/search/people`,
  classic: `/${ACCOUNT}/linkedin/search/people`,
  sales_navigator: `/${ACCOUNT}/linkedin/sales-navigator/search/people`,
};
const CONTRACTS = { contracts: [
  { object: 'Contract', id: 'c1', name: 'Recruiter', product: 'recruiter', selected: true },
] };
const SALES_CONTRACTS = { contracts: [
  { object: 'Contract', id: 'c2', name: 'Sales', product: 'sales_navigator', selected: true },
] };

async function harness(providerReply = { status: 200, body: { data: [], total_count: 0 } }) {
  const { client, calls } = fakeDatabase({ rows: table => table === 'member_linkedin_accounts' ? [{ id: 'row-1', user_id: 'user-1' }] : [] });
  const h = await bootHandler({
    env: { SUPABASE_URL: 'https://supabase.local.test', SB_SECRET_KEY: 'fake-internal-key', UNIPILE_V2_API_KEY: 'fake-provider-key' },
    createClient: () => client,
  });
  const provider = [];
  const handler = request => {
    if (request.path.endsWith('/linkedin/contracts')) return { body: request.path.startsWith(`/${ACCOUNT}`) && h.licence === 'sales_navigator' ? SALES_CONTRACTS : CONTRACTS };
    if (request.method === 'POST' && request.path.includes('/search/people')) {
      provider.push({ path: request.path, query: Object.fromEntries(request.query), body: request.body });
      return providerReply;
    }
    return { status: 404, body: {} };
  };
  return { calls, provider, h, async search(params) {
    return h.withMockTransport(handler, async () => {
      const response = await h.handler(new Request('https://app.local.test/functions/v1/unipile-search', {
        method: 'POST', headers: { Authorization: 'Bearer fake-internal-key', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search', organization_id: 'organization-a', account_id: ACCOUNT,
          api: 'recruiter', category: 'people', keywords: 'Engineer', ...params }),
      }));
      return { status: response.status, data: await response.json() };
    });
  } };
}

test('company name exclusions retain included and excluded Recruiter company IDs', async () => {
  const h = await harness();
  assert.equal((await h.search({ company: { include: ['100', '200'], exclude: ['300'] }, company_keywords: [
    { keywords: 'Client actuel', priority: 'DOESNT_HAVE', scope: 'CURRENT' },
  ] })).status, 200);
  assert.equal(h.provider[0].path, SEARCH_PATHS.recruiter);
  assert.deepEqual(h.provider[0].body.company, [
    { name: '100', id: '100', priority: 'CAN_HAVE', preferences: 'CURRENT_OR_PAST' },
    { name: '200', id: '200', priority: 'CAN_HAVE', preferences: 'CURRENT_OR_PAST' },
    { name: '300', id: '300', priority: 'DOESNT_HAVE', preferences: 'CURRENT_OR_PAST' },
    { name: 'Client actuel', priority: 'DOESNT_HAVE', preferences: 'CURRENT' },
  ]);
});

test('mixed Recruiter companies preserve every explicit priority and scope without mutating the input', async () => {
  const h = await harness();
  const params = { company: [
    { id: '100', priority: 'MUST_HAVE', scope: 'PAST', name: 'Compagnie A' },
    { id: '200', priority: 'CAN_HAVE', scope: 'CURRENT' },
    { id: '300', priority: 'DOESNT_HAVE', scope: 'PAST_NOT_CURRENT' },
    { keywords: '"Conseil (France)"', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' },
  ], company_keywords: [{ keywords: 'Client', priority: 'DOESNT_HAVE', scope: 'CURRENT' }] };
  const original = structuredClone(params);
  assert.equal((await h.search(params)).status, 200);
  assert.deepEqual(h.provider[0].body.current_company, [{ id: '200', priority: 'CAN_HAVE' }]);
  assert.deepEqual(h.provider[0].body.company, [
    { name: 'Compagnie A', id: '100', priority: 'MUST_HAVE', preferences: 'PAST' },
    { name: '300', id: '300', priority: 'DOESNT_HAVE', preferences: 'PAST_NOT_CURRENT' },
    { name: 'Client', priority: 'DOESNT_HAVE', preferences: 'CURRENT' },
    { name: '"Conseil (France)"', priority: 'CAN_HAVE', preferences: 'CURRENT_OR_PAST' },
  ]);
  assert.deepEqual(params, original);
});

test('bare Recruiter company IDs mean alternatives while explicit MUST_HAVE stays mandatory', async () => {
  const h = await harness();
  assert.equal((await h.search({ company: ['100', '200', { id: '300', priority: 'MUST_HAVE', scope: 'PAST' }] })).status, 200);
  assert.deepEqual(h.provider[0].body.company, [
    { name: '100', id: '100', priority: 'CAN_HAVE', preferences: 'CURRENT_OR_PAST' },
    { name: '200', id: '200', priority: 'CAN_HAVE', preferences: 'CURRENT_OR_PAST' },
    { name: '300', id: '300', priority: 'MUST_HAVE', preferences: 'PAST' },
  ]);
});

test('company IDs and Sales Navigator exclusions keep their native formats', async () => {
  for (const [api, company] of [
    ['classic', ['100', '200']],
    ['sales_navigator', { include: ['100', '200'], exclude: ['300'] }],
  ]) {
    const h = await harness();
    h.h.licence = api;
    assert.equal((await h.search({ api, company })).status, 200);
    assert.equal(h.provider[0].path, SEARCH_PATHS[api]);
    assert.deepEqual(h.provider[0].body.current_company, company);
  }
});

test('past-company inclusions are alternatives and exclusions stay negative', async () => {
  for (const past_company of [['100', '200'], { include: ['100', '200'], exclude: ['300'] }]) {
    const h = await harness();
    assert.equal((await h.search({ past_company })).status, 200);
    assert.deepEqual(h.provider[0].body.past_company, [
      { id: '100', priority: 'CAN_HAVE' }, { id: '200', priority: 'CAN_HAVE' },
      ...(Array.isArray(past_company) ? [] : [{ id: '300', priority: 'DOESNT_HAVE' }]),
    ]);
  }
  const h = await harness();
  const past_company = [{ id: '100', priority: 'MUST_HAVE' }, { id: '300', priority: 'DOESNT_HAVE' }];
  assert.equal((await h.search({ past_company })).status, 200);
  assert.deepEqual(h.provider[0].body.past_company, past_company);
});

test('Classic and Sales Navigator reject oversized keywords before any provider request', async () => {
  for (const api of ['classic', 'sales_navigator']) {
    const h = await harness();
    const keywords = 'Engineer '.repeat(24) + 'NOT "Client actuel"';
    const result = await h.search({ api, keywords });
    assert.equal(result.status, 400);
    assert.equal(result.data.error_code, 'KEYWORDS_TOO_LONG');
    assert.match(result.data.error, new RegExp(String(keywords.length)));
    assert.match(result.data.error, /200/);
    assert.equal(h.provider.length, 0);
    assert.equal(h.calls.inserts.length, 0);
  }
});

test('valid keyword strings keep their operators, quotes and inner punctuation', async () => {
  const queries = [
    '("Solution (Cloud) Engineer" OR "Sales AND support") AND NOT "Client actuel"',
    'NOT "Client actuel"', 'Python AND (Java OR Go)',
    '"OR" AND "NOT"', '"Ingénieur 🚀" OR "Data (R&D)"',
    'Research and development', 'head of sales or',
  ];
  for (const api of ['classic', 'sales_navigator', 'recruiter']) {
    for (const keywords of queries) {
      const h = await harness();
      h.h.licence = api;
      const result = await h.search({ api, keywords: `  ${keywords}  ` });
      assert.equal(result.status, 200, keywords);
      assert.equal(h.provider[0].body.keywords, keywords);
    }
  }
});

test('a native search may omit keywords and valid 200-character Classic/Sales strings are unchanged', async () => {
  for (const api of ['classic', 'sales_navigator', 'recruiter']) {
    const h = await harness();
    h.h.licence = api;
    assert.equal((await h.search({ api, keywords: undefined, company: ['100'] })).status, 200);
    assert.equal(h.provider[0].body.keywords, undefined);
  }
  for (const api of ['classic', 'sales_navigator']) {
    const h = await harness();
    h.h.licence = api;
    const keywords = 'a'.repeat(200);
    assert.equal((await h.search({ api, keywords })).status, 200);
    assert.equal(h.provider[0].body.keywords, keywords);
  }
});

test('Recruiter keeps the full long query and every long company and role clause', async () => {
  const keywords = '("Solution Engineer" OR "Sales Engineer") AND ' + 'Cloud '.repeat(80) + 'NOT "Client actuel"';
  const h = await harness();
  assert.equal((await h.search({ keywords,
    company_keywords: [{ keywords, priority: 'DOESNT_HAVE', scope: 'PAST' }],
    role: [{ keywords, priority: 'MUST_HAVE', scope: 'CURRENT' }],
  })).status, 200);
  assert.equal(h.provider[0].body.keywords, keywords);
  assert.equal(h.provider[0].body.company[0].name, keywords);
  assert.equal(h.provider[0].body.job_title[0].name, keywords);
});

test('invalid Boolean delimiters and dangling operators return actionable 400 instead of being rewritten', async () => {
  for (const keywords of ['Python AND', '"Solution Engineer', '(Python OR Java', 'Python OR Java)', 'Python AND (Java OR)', 'Python AND (OR Java)']) {
    for (const api of ['classic', 'sales_navigator', 'recruiter']) {
      const h = await harness();
      const result = await h.search({ api, keywords });
      assert.equal(result.status, 400, api + ': ' + keywords);
      assert.equal(result.data.error_code, 'INVALID_BOOLEAN_QUERY');
      assert.match(result.data.error, /[Gg]uillemet|[Pp]arenthèse|[Oo]pérateur/);
      assert.equal(h.provider.length, 0);
      assert.equal(h.calls.inserts.length, 0);
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
    const h = await harness();
    const result = await h.search(params);
    assert.equal(result.status, 400);
    assert.equal(result.data.error_code, 'INVALID_BOOLEAN_QUERY');
    assert.equal(h.provider.length, 0);
  }
});

test('Recruiter role IDs, keyword roles and past roles retain their priorities and scopes together', async () => {
  const h = await harness();
  assert.equal((await h.search({
    job_title: [{ id: '100', name: 'Ingénieur', priority: 'CAN_HAVE', scope: 'CURRENT', is_selection: true },
      { keywords: '"Solution (Cloud) Engineer"', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    role: [{ keywords: 'NOT "Sales AND support"', priority: 'DOESNT_HAVE', scope: 'PAST' }],
    past_job_title: [{ id: '200', priority: 'DOESNT_HAVE' }],
  })).status, 200);
  assert.deepEqual(h.provider[0].body.job_title, [
    { name: 'Ingénieur', id: '100', priority: 'CAN_HAVE', preferences: 'CURRENT' },
    { name: '"Solution (Cloud) Engineer"', priority: 'MUST_HAVE', preferences: 'CURRENT' },
    { name: 'NOT "Sales AND support"', priority: 'DOESNT_HAVE', preferences: 'PAST' },
    { name: '200', id: '200', priority: 'DOESNT_HAVE', preferences: 'PAST' },
  ]);
});

test('provider rejection of a full valid Recruiter query is reported without a shortened retry', async () => {
  const h = await harness({ status: 400, body: { type: 'errors/content_too_large', detail: 'Too large' } });
  const keywords = 'Cloud '.repeat(80) + 'NOT "Client actuel"';
  const result = await h.search({ keywords });
  assert.equal(result.status, 400);
  assert.equal(result.data.errorType, 'CONTENT_TOO_LARGE');
  assert.equal(h.provider.length, 1);
  assert.equal(h.provider[0].body.keywords, keywords);
  assert.equal(h.calls.inserts[0].table, 'search_failure_log');
});

test('the provider payload never carries a key of the previous generation and the page size is a query parameter', async () => {
  const h = await harness();
  assert.equal((await h.search({ limit: 40, cursor: undefined })).status, 200);
  for (const key of ['api', 'category', 'limit', 'cursor']) assert.ok(!(key in h.provider[0].body), key);
  assert.equal(h.provider[0].query.limit, '40');
});

test('a filter the licence cannot apply is reported to the screen, with its French label', async () => {
  const h = await harness();
  h.h.licence = 'sales_navigator';
  const result = await h.search({ api: 'sales_navigator', skills: [{ id: '42', name: 'Python', priority: 'MUST_HAVE' }], company: ['100'] });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.filters_dropped, [{ filter: 'skills', label: 'Compétences', reason: 'unsupported' }]);
});
