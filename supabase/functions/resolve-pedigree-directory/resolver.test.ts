// deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/resolve-pedigree-directory/resolver.test.ts
import { deepStrictEqual, strictEqual } from 'node:assert';
import { fixtures, jsonResponse, withMockTransport } from '../_shared/unipile/testing.ts';
import { userSafeMessage } from '../_shared/unipile/index.ts';
import {
  PARAMETERS_LIMIT,
  pickBestMatch,
  pickResolverAccount,
  probeResolverAccount,
  RESOLVER_ACCOUNT_MISSING_MESSAGE,
  RESOLVER_ACCOUNT_OUTDATED_MESSAGE,
  RESOLVER_ACCOUNT_UNKNOWN_MESSAGE,
  resolveBatch,
  resolveOne,
  resolverAbortMessage,
  type ResolveResult,
} from './resolver.ts';

const ACC = 'acc_abc123';

function parameter(id: string, name: string): Record<string, unknown> {
  return { object: 'SearchParameter', id, name };
}

Deno.test('pickBestMatch: exact name, accents ignored, then containment, then alias', () => {
  const items = [{ id: '1', title: 'Ecole Polytechnique Federale' }, { id: '2', title: 'École Polytechnique' }];
  strictEqual(pickBestMatch(items, 'Ecole Polytechnique', [])?.id, '2');
  strictEqual(pickBestMatch([{ id: '1', title: 'Polytechnique Paris' }], 'Polytechnique', [])?.id, '1');
  strictEqual(pickBestMatch([{ id: '9', title: 'X Paris' }], 'Ecole Polytechnique', ['X'])?.id, '9');
  strictEqual(pickBestMatch([{ id: '3', title: 'HEC' }], 'ESSEC', []), null);
  strictEqual(pickBestMatch([], 'HEC', []), null);
});

Deno.test('resolveOne asks the Recruiter parameters route (SEARCH source, same id space as the stored ids), never the classic list', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([parameter('14034', 'École Polytechnique'), parameter('77', 'Autre')])), async (mock) => {
    const result = await resolveOne(ACC, 'SCHOOL', 'Ecole Polytechnique', []);
    deepStrictEqual(result, { id: '14034', matchedTitle: 'École Polytechnique', error: null });
    strictEqual(mock.calls.length, 1);
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/recruiter/search/parameters`);
    deepStrictEqual(mock.calls[0].body, { source: 'SEARCH', type: 'SCHOOL', keywords: 'Ecole Polytechnique' });
    strictEqual(mock.calls[0].query.get('limit'), String(PARAMETERS_LIMIT));
    strictEqual(mock.calls[0].query.has('service'), false);
    strictEqual(mock.calls[0].query.has('account_id'), false);
    strictEqual(mock.calls[0].url.startsWith('https://api.unipile.com/v2/'), true);
    strictEqual(mock.calls.some((c) => c.path === `/${ACC}/linkedin/search/parameters`), false);
  });
});

Deno.test('resolveOne: companies use the COMPANY type; no match reports the number of items', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([parameter('5', 'Autre société')])), async (mock) => {
    const result = await resolveOne(ACC, 'COMPANY', 'Doctolib', []);
    strictEqual(result.id, null);
    strictEqual(result.error, 'No match in 1 items');
    deepStrictEqual((mock.calls[0].body as Record<string, unknown>).type, 'COMPANY');
  });
});

Deno.test('resolveOne: a failure of the service is an error string, never a throw, and carries no id', async () => {
  for (const status of [403, 429, 500]) {
    await withMockTransport(() => ({ status, body: { message: 'refus' } }), async () => {
      const result = await resolveOne(ACC, 'SCHOOL', 'HEC', []);
      strictEqual(result.id, null);
      strictEqual(typeof result.error, 'string');
    });
  }
});

Deno.test('resolveOne flags account or access failures as systemic (the run stops), not name failures', async () => {
  const cases: Array<[number, unknown, boolean]> = [
    [401, { message: 'refus' }, true],
    [403, { message: 'refus' }, true],
    [429, { message: 'refus' }, true],
    // un compte inconnu ou supprimé répond 404 à chaque appel : toute la série échouerait de même
    [404, { message: 'refus' }, true],
    // quota de recherche atteint en cours de série
    [429, { message: 'search limit reached' }, true],
    [422, { message: 'refus' }, false],
    [500, { message: 'refus' }, false],
  ];
  for (const [status, body, systemic] of cases) {
    await withMockTransport(() => ({ status, body }), async () => {
      const result = await resolveOne(ACC, 'COMPANY', 'Doctolib', []);
      strictEqual(result.systemic === true, systemic, `status ${status}`);
      strictEqual(result.kind !== undefined, systemic, `kind carried only for a systemic failure, status ${status}`);
    });
  }
  await withMockTransport(() => jsonResponse(fixtures.page([parameter('5', 'Autre société')])), async () => {
    strictEqual((await resolveOne(ACC, 'COMPANY', 'Doctolib', [])).systemic, undefined, 'no match is a name failure');
  });
});

Deno.test('resolveOne carries the kind of a systemic failure (auth stays auth, a quota stays provider_limit, 404 stays not_found)', async () => {
  const cases: Array<[number, unknown, string]> = [
    [401, { message: 'refus' }, 'auth'],
    [404, { message: 'refus' }, 'not_found'],
    [429, { message: 'search limit reached' }, 'provider_limit'],
  ];
  for (const [status, body, kind] of cases) {
    await withMockTransport(() => ({ status, body }), async () => {
      strictEqual((await resolveOne(ACC, 'SCHOOL', 'HEC', [])).kind, kind, `status ${status}`);
    });
  }
});

Deno.test('resolveOne: an empty name makes no call, an outdated account id makes no call', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([parameter('1', 'HEC')])), async (mock) => {
    strictEqual((await resolveOne(ACC, 'SCHOOL', '   ', [])).id, null);
    const outdated = await resolveOne('ancien-id', 'SCHOOL', 'HEC', []);
    strictEqual(outdated.id, null);
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('pickResolverAccount: a configured account id in the current format is used, with its organisation', () => {
  const pick = pickResolverAccount(
    [{ key: 'pedigree_resolver_account_id', value: ACC }, { key: 'pedigree_resolver_org_id', value: 'org-1' }],
    [{ linkedin_account_id: 'acc_other', organization_id: 'org-2' }],
  );
  deepStrictEqual(pick, { ok: true, context: { accountId: ACC, orgId: 'org-1' } });
});

Deno.test('pickResolverAccount: a configured account id in the previous format is refused, no silent fallback', () => {
  const pick = pickResolverAccount(
    [{ key: 'pedigree_resolver_account_id', value: 'AbCdEfGhIjKlMnOpQrStUv' }, { key: 'pedigree_resolver_org_id', value: 'org-1' }],
    [{ linkedin_account_id: 'acc_other', organization_id: 'org-2' }],
  );
  deepStrictEqual(pick, { ok: false, message: RESOLVER_ACCOUNT_OUTDATED_MESSAGE });
  strictEqual(/unipile/i.test(RESOLVER_ACCOUNT_OUTDATED_MESSAGE), false);
});

Deno.test('pickResolverAccount: a configured value that is not text is refused', () => {
  strictEqual(pickResolverAccount([{ key: 'pedigree_resolver_account_id', value: { id: ACC } }], []).ok, false);
  strictEqual(pickResolverAccount([{ key: 'pedigree_resolver_account_id', value: 42 }], []).ok, false);
});

Deno.test('pickResolverAccount: without configuration, the oldest linked account in the current format', () => {
  const pick = pickResolverAccount(
    [],
    [
      { linkedin_account_id: 'ancienne-valeur-v1', organization_id: 'org-0' },
      { linkedin_account_id: 'acc_first', organization_id: 'org-1' },
      { linkedin_account_id: 'acc_second', organization_id: 'org-2' },
    ],
  );
  deepStrictEqual(pick, { ok: true, context: { accountId: 'acc_first', orgId: 'org-1' } });
});

Deno.test('pickResolverAccount: no usable account at all gives the neutral message', () => {
  deepStrictEqual(pickResolverAccount([], [{ linkedin_account_id: 'ancien', organization_id: 'o' }]), {
    ok: false,
    message: RESOLVER_ACCOUNT_MISSING_MESSAGE,
  });
  deepStrictEqual(pickResolverAccount([{ key: 'pedigree_resolver_account_id', value: '' }], []), { ok: false, message: RESOLVER_ACCOUNT_MISSING_MESSAGE });
  strictEqual(/unipile/i.test(RESOLVER_ACCOUNT_MISSING_MESSAGE), false);
});

Deno.test('probeResolverAccount: one real Recruiter search; an answer, even an empty one, means the account can resolve', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([])), async (mock) => {
    deepStrictEqual(await probeResolverAccount(ACC), { ok: true });
    strictEqual(mock.calls.length, 1);
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, `/${ACC}/linkedin/recruiter/search/parameters`);
    strictEqual(mock.calls[0].query.get('limit'), '1');
  });
});

Deno.test('probeResolverAccount: an unknown account (404), a refusal or an invalid request stop the run with the real kind', async () => {
  const cases: Array<[number, string]> = [[404, 'not_found'], [403, 'forbidden'], [401, 'auth'], [422, 'validation']];
  for (const [status, kind] of cases) {
    await withMockTransport(() => ({ status, body: { message: 'refus' } }), async () => {
      const probe = await probeResolverAccount(ACC);
      strictEqual(probe.ok, false, `status ${status}`);
      if (!probe.ok) {
        strictEqual(probe.kind, kind, `status ${status}`);
        strictEqual(typeof probe.error, 'string');
      }
    });
  }
});

Deno.test('resolverAbortMessage: the message follows the real kind, never says "limited" for a refused key, no vendor name', () => {
  strictEqual(resolverAbortMessage('not_found'), RESOLVER_ACCOUNT_UNKNOWN_MESSAGE);
  strictEqual(resolverAbortMessage('auth').includes('temporairement limité'), false);
  strictEqual(resolverAbortMessage('auth'), userSafeMessage('auth'));
  strictEqual(resolverAbortMessage('account_degraded'), userSafeMessage('account_degraded'));
  strictEqual(resolverAbortMessage('provider_limit'), userSafeMessage('provider_limit'));
  for (const kind of ['not_found', 'auth', 'forbidden', 'config', 'rate_limited', 'provider_limit', 'account_disconnected', 'account_degraded'] as const) {
    strictEqual(/unipile/i.test(resolverAbortMessage(kind)), false, kind);
  }
});

const found = (id: string): ResolveResult => ({ id, matchedTitle: id, error: null });
const noMatch: ResolveResult = { id: null, matchedTitle: null, error: 'No match in 0 items', systemic: false };
const systemic = (kind: ResolveResult['kind']): ResolveResult => ({ id: null, matchedTitle: null, error: 'refus', systemic: true, kind });

Deno.test('resolveBatch: resolved and unmatched rows are saved and counted, a complete run returns no abort', async () => {
  const saved: string[] = [];
  const stats = { processed: 0, resolved: 0, failed: 0 };
  const results = new Map<string, ResolveResult>([['a', found('1')], ['b', noMatch], ['c', found('3')]]);
  const abort = await resolveBatch(['a', 'b', 'c'], stats, {
    resolve: (row) => Promise.resolve(results.get(row)!),
    save: (row) => { saved.push(row); return Promise.resolve(); },
    throttleMs: 0,
  });
  strictEqual(abort, null);
  deepStrictEqual(saved, ['a', 'b', 'c']);
  deepStrictEqual(stats, { processed: 3, resolved: 2, failed: 1 });
});

Deno.test('resolveBatch: a systemic failure mid-run keeps earlier rows, saves nothing for the failing and remaining rows, returns the kind', async () => {
  const saved: Array<[string, string | null]> = [];
  const asked: string[] = [];
  const stats = { processed: 0, resolved: 0, failed: 0 };
  const results = new Map<string, ResolveResult>([['a', found('1')], ['b', systemic('provider_limit')], ['c', found('3')]]);
  const abort = await resolveBatch(['a', 'b', 'c'], stats, {
    resolve: (row) => { asked.push(row); return Promise.resolve(results.get(row)!); },
    save: (row, result) => { saved.push([row, result.id]); return Promise.resolve(); },
    throttleMs: 0,
  });
  deepStrictEqual(abort, { kind: 'provider_limit', error: 'refus' });
  deepStrictEqual(saved, [['a', '1']], 'only the row resolved before the stop is written; nothing is marked failed');
  deepStrictEqual(asked, ['a', 'b'], 'the remaining rows are not asked');
  deepStrictEqual(stats, { processed: 1, resolved: 1, failed: 0 });
});

Deno.test('resolveBatch end to end: an unknown account (every call 404) writes no row and stops on the first one', async () => {
  const saved: string[] = [];
  const stats = { processed: 0, resolved: 0, failed: 0 };
  await withMockTransport(() => ({ status: 404, body: { message: 'not found' } }), async (mock) => {
    const abort = await resolveBatch(['HEC', 'ESSEC', 'INSEAD'], stats, {
      resolve: (name) => resolveOne(ACC, 'SCHOOL', name, []),
      save: (name) => { saved.push(name); return Promise.resolve(); },
      throttleMs: 0,
    });
    strictEqual(abort?.kind, 'not_found');
    strictEqual(mock.calls.length, 1);
  });
  deepStrictEqual(saved, []);
  deepStrictEqual(stats, { processed: 0, resolved: 0, failed: 0 });
});
