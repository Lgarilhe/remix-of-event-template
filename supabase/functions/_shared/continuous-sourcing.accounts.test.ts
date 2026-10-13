// Comptes LinkedIn d'un agent de sourcing continu (API v2 du prestataire) : état réel du compte et
// licences lues dans ses contrats, un identifiant d'avant la migration jamais envoyé au prestataire,
// barrière `beforeProvider` avant CHAQUE appel.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/continuous-sourcing.accounts.test.ts

import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { ContinuousError, readOwnAgentAccounts, requireAccount } from './continuous-sourcing.ts';
import { fixtures, jsonResponse, type MockHandler, withMockTransport } from './unipile/testing.ts';

const ORG = 'org-1';
const USER = 'user-1';

// deno-lint-ignore no-explicit-any
function adminWith(rows: Array<{ linkedin_account_id: string; linkedin_account_name?: string; account_status?: string }>): any {
  const filters: Record<string, string> = {};
  // deno-lint-ignore no-explicit-any
  const query: any = {
    select: () => query,
    eq: (column: string, value: string) => {
      filters[column] = value;
      return query;
    },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({
        data: rows.filter((row) => !filters.linkedin_account_id || row.linkedin_account_id === filters.linkedin_account_id),
        error: null,
      }).then(resolve, reject),
  };
  return { from: () => query };
}

const contract = (product: string, name = 'Contrat', selected = true) => ({ object: 'Contract', id: `c_${product}`, product, name, selected });
const contracts = (...items: unknown[]) => jsonResponse({ object: 'AvailableContracts', contracts: items });

function provider(accounts: Record<string, Record<string, unknown>>, contractAnswers: Record<string, () => Response | { status: number; body?: unknown }>): MockHandler {
  return (request) => {
    const account = /^\/accounts\/(acc_[\w-]+)$/.exec(request.path);
    if (account) return accounts[account[1]] ? jsonResponse(accounts[account[1]]) : { status: 404, body: { error: 'not found' } };
    const listed = /^\/(acc_[\w-]+)\/linkedin\/contracts$/.exec(request.path);
    if (listed) return (contractAnswers[listed[1]] ?? (() => contracts()))();
    return { status: 500, body: { error: 'unexpected path ' + request.path } };
  };
}

Deno.test('licences lues dans les contrats : Recruiter, Sales Navigator, les deux', async () => {
  const accounts = { acc_r: fixtures.account({ id: 'acc_r', name: 'Camille' }), acc_s: fixtures.account({ id: 'acc_s' }), acc_b: fixtures.account({ id: 'acc_b' }) };
  const answers = {
    acc_r: () => contracts(contract('recruiter', 'Recruiter Corporate')),
    acc_s: () => contracts(contract('sales_navigator')),
    acc_b: () => contracts(contract('recruiter', 'Recruiter', false), contract('sales_navigator', 'Sales Navigator', false)),
  };
  const admin = adminWith([{ linkedin_account_id: 'acc_r' }, { linkedin_account_id: 'acc_s' }, { linkedin_account_id: 'acc_b' }]);
  await withMockTransport(provider(accounts, answers), async () => {
    const list = await readOwnAgentAccounts(admin, USER, ORG);
    deepStrictEqual(list.map((a) => [a.id, a.status, a.apis]), [
      ['acc_r', 'OK', ['classic', 'recruiter']],
      ['acc_s', 'OK', ['classic', 'sales_navigator']],
      ['acc_b', 'OK', ['classic', 'recruiter', 'sales_navigator']],
    ]);
    strictEqual(list[0].name, 'Camille');
  });
});

Deno.test('contrats exclusifs : seul le contrat sélectionné ouvre sa recherche (F1)', async () => {
  const accounts = { acc_s: fixtures.account({ id: 'acc_s' }), acc_r: fixtures.account({ id: 'acc_r' }) };
  const answers = {
    acc_s: () => contracts(contract('recruiter', 'Recruiter', false), contract('sales_navigator', 'Sales Navigator', true)),
    acc_r: () => contracts(contract('recruiter', 'Recruiter', true), contract('sales_navigator', 'Sales Navigator', false)),
  };
  const admin = adminWith([{ linkedin_account_id: 'acc_s' }, { linkedin_account_id: 'acc_r' }]);
  await withMockTransport(provider(accounts, answers), async () => {
    const list = await readOwnAgentAccounts(admin, USER, ORG);
    deepStrictEqual(list.map((a) => [a.id, a.apis]), [['acc_s', ['classic', 'sales_navigator']], ['acc_r', ['classic', 'recruiter']]]);
    const agent = { source: 'linkedin' as const, account_id: 'acc_s', api: 'recruiter' as const };
    let thrown: unknown;
    try { requireAccount(agent, list); } catch (error) { thrown = error; }
    strictEqual((thrown as ContinuousError).code, 'LICENSE_UNAVAILABLE');
  });
});

Deno.test('un contrat Recruiter Lite n’ouvre pas la recherche Recruiter complète', async () => {
  const accounts = { acc_l: fixtures.account({ id: 'acc_l' }) };
  const answers = { acc_l: () => contracts(contract('recruiter', 'Recruiter Lite')) };
  await withMockTransport(provider(accounts, answers), async () => {
    const list = await readOwnAgentAccounts(adminWith([{ linkedin_account_id: 'acc_l' }]), USER, ORG);
    deepStrictEqual(list[0].apis, ['classic']);
  });
});

Deno.test('un compte sans contrat (refus du prestataire) reste en recherche classique', async () => {
  for (const status of [404, 403, 422]) {
    const accounts = { acc_c: fixtures.account({ id: 'acc_c' }) };
    await withMockTransport(provider(accounts, { acc_c: () => ({ status, body: { error: 'no contract' } }) }), async () => {
      const list = await readOwnAgentAccounts(adminWith([{ linkedin_account_id: 'acc_c' }]), USER, ORG);
      deepStrictEqual(list.map((a) => [a.status, a.apis]), [['OK', ['classic']]], `statut ${status}`);
    });
  }
});

Deno.test('contrats illisibles (service indisponible) : compte à revérifier, jamais rétrogradé en classique', async () => {
  const accounts = { acc_c: fixtures.account({ id: 'acc_c' }) };
  await withMockTransport(provider(accounts, { acc_c: () => ({ status: 503, body: { error: 'down' } }) }), async () => {
    const list = await readOwnAgentAccounts(adminWith([{ linkedin_account_id: 'acc_c' }]), USER, ORG);
    deepStrictEqual(list.map((a) => [a.status, a.apis]), [['UNAVAILABLE', []]]);
  });
});

Deno.test('état du compte : déconnecté, limité, verrouillé = pas de licence, pas de lecture des contrats', async () => {
  const accounts = {
    acc_d: fixtures.account({ id: 'acc_d', status: 'disconnected' }),
    acc_p: fixtures.account({ id: 'acc_p', status: 'partial' }),
    acc_k: fixtures.account({ id: 'acc_k', status: 'running', is_locked: true }),
  };
  const admin = adminWith([{ linkedin_account_id: 'acc_d' }, { linkedin_account_id: 'acc_p' }, { linkedin_account_id: 'acc_k' }]);
  await withMockTransport(provider(accounts, {}), async (mock) => {
    const list = await readOwnAgentAccounts(admin, USER, ORG);
    deepStrictEqual(list.map((a) => [a.id, a.status, a.apis]), [
      ['acc_d', 'CREDENTIALS', []],
      ['acc_p', 'PARTIAL', []],
      ['acc_k', 'LOCKED', []],
    ]);
    strictEqual(mock.calls.some((c) => c.path.endsWith('/contracts')), false);
  });
});

Deno.test('ancien identifiant (sans acc_) : listé à reconnecter, jamais envoyé au prestataire', async () => {
  const admin = adminWith([{ linkedin_account_id: 'oldIdentifier123456', linkedin_account_name: 'Mon ancien compte' }]);
  let fences = 0;
  await withMockTransport(() => ({ status: 500 }), async (mock) => {
    const list = await readOwnAgentAccounts(admin, USER, ORG, async () => { fences++; });
    deepStrictEqual(list, [{ id: 'oldIdentifier123456', name: 'Mon ancien compte', status: 'UNAVAILABLE', apis: [] }]);
    strictEqual(mock.calls.length, 0);
    strictEqual(fences, 0);
  });
});

Deno.test('lecture du compte en échec : listé indisponible, les autres comptes continuent', async () => {
  const accounts = { acc_ok: fixtures.account({ id: 'acc_ok' }) };
  const admin = adminWith([{ linkedin_account_id: 'acc_gone', linkedin_account_name: 'Disparu' }, { linkedin_account_id: 'acc_ok' }]);
  await withMockTransport(provider(accounts, {}), async () => {
    const list = await readOwnAgentAccounts(admin, USER, ORG);
    deepStrictEqual(list.map((a) => [a.id, a.status]), [['acc_gone', 'UNAVAILABLE'], ['acc_ok', 'OK']]);
    strictEqual(list[0].name, 'Disparu');
  });
});

Deno.test('un compte d’une autre messagerie ou d’un autre identifiant est écarté', async () => {
  const accounts = {
    acc_mail: fixtures.account({ id: 'acc_mail', provider: 'outlook' }),
    acc_swap: fixtures.account({ id: 'acc_other', provider: 'linkedin' }),
  };
  const admin = adminWith([{ linkedin_account_id: 'acc_mail' }, { linkedin_account_id: 'acc_swap' }]);
  await withMockTransport(provider(accounts, {}), async () => {
    deepStrictEqual(await readOwnAgentAccounts(admin, USER, ORG), []);
  });
});

Deno.test('compte choisi : seul ce compte est lu, la barrière précède chaque appel', async () => {
  const accounts = { acc_a: fixtures.account({ id: 'acc_a' }), acc_b: fixtures.account({ id: 'acc_b' }) };
  const answers = { acc_a: () => contracts(contract('recruiter')), acc_b: () => contracts() };
  const admin = adminWith([{ linkedin_account_id: 'acc_a' }, { linkedin_account_id: 'acc_b' }]);
  const order: string[] = [];
  await withMockTransport(provider(accounts, answers), async (mock) => {
    const list = await readOwnAgentAccounts(admin, USER, ORG, async () => { order.push(`fence@${mock.calls.length}`); }, 'acc_a');
    deepStrictEqual(list.map((a) => a.id), ['acc_a']);
    deepStrictEqual(order, ['fence@0', 'fence@1'], 'une barrière avant la lecture du compte, une avant celle des contrats');
    deepStrictEqual(mock.calls.map((c) => c.path), ['/accounts/acc_a', '/acc_a/linkedin/contracts']);
  });
});

Deno.test('barrière qui refuse (agent mis en pause) : rien n’est envoyé au prestataire', async () => {
  const admin = adminWith([{ linkedin_account_id: 'acc_a' }]);
  await withMockTransport(() => jsonResponse(fixtures.account({ id: 'acc_a' })), async (mock) => {
    await rejects(readOwnAgentAccounts(admin, USER, ORG, async () => { throw new Error('LEASE_LOST'); }), /LEASE_LOST/);
    strictEqual(mock.calls.length, 0);
  });
});

const requireCode = (agent: Parameters<typeof requireAccount>[0], list: Awaited<ReturnType<typeof readOwnAgentAccounts>>): string | null => {
  try { requireAccount(agent, list); return null; } catch (error) { return (error as ContinuousError).code; }
};

Deno.test('panne passagère du prestataire : le compte est à réessayer, jamais bloquant (F2)', async () => {
  for (const status of [500, 503, 429]) {
    const accounts = { acc_a: fixtures.account({ id: 'acc_a' }) };
    await withMockTransport(provider(accounts, { acc_a: () => ({ status, body: { error: 'down' } }) }), async () => {
      const list = await readOwnAgentAccounts(adminWith([{ linkedin_account_id: 'acc_a' }]), USER, ORG);
      strictEqual(list[0].status, 'UNAVAILABLE', `contrats ${status}`);
      strictEqual(list[0].retryable, true, `contrats ${status}`);
      strictEqual(requireCode({ source: 'linkedin', account_id: 'acc_a', api: 'classic' }, list), 'RETRY_LATER');
    });
  }
  await withMockTransport(() => ({ status: 503, body: { error: 'down' } }), async () => {
    const list = await readOwnAgentAccounts(adminWith([{ linkedin_account_id: 'acc_a' }]), USER, ORG);
    strictEqual(requireCode({ source: 'linkedin', account_id: 'acc_a', api: 'classic' }, list), 'RETRY_LATER', 'lecture du compte');
  });
});

Deno.test('compte introuvable ou ancien identifiant : reconnexion demandée, pas de nouvel essai (F2)', async () => {
  await withMockTransport(() => ({ status: 404, body: { error: 'gone' } }), async () => {
    const list = await readOwnAgentAccounts(adminWith([{ linkedin_account_id: 'acc_gone' }, { linkedin_account_id: 'oldIdentifier123456' }]), USER, ORG);
    deepStrictEqual(list.map((a) => a.retryable === true), [false, false]);
    strictEqual(requireCode({ source: 'linkedin', account_id: 'acc_gone', api: 'classic' }, list), 'ACCOUNT_RECONNECT');
    strictEqual(requireCode({ source: 'linkedin', account_id: 'oldIdentifier123456', api: 'classic' }, list), 'ACCOUNT_RECONNECT');
  });
});

Deno.test('compte limité : sert les produits encore en marche, jamais les autres (F2)', async () => {
  const running = { classic: 'running', recruiter: 'errored' };
  const accounts = {
    acc_d: fixtures.account({ id: 'acc_d', status: 'degraded', metadata: { products_connection_status: running } }),
    acc_p: fixtures.account({ id: 'acc_p', status: 'partial', metadata: { products_connection_status: { classic: 'running', recruiter: 'disconnected' } } }),
    acc_n: fixtures.account({ id: 'acc_n', status: 'degraded' }),
  };
  const answers = {
    acc_d: () => contracts(contract('recruiter', 'Recruiter')),
    acc_p: () => contracts(contract('recruiter', 'Recruiter')),
  };
  const admin = adminWith([{ linkedin_account_id: 'acc_d' }, { linkedin_account_id: 'acc_p' }, { linkedin_account_id: 'acc_n' }]);
  await withMockTransport(provider(accounts, answers), async () => {
    const list = await readOwnAgentAccounts(admin, USER, ORG);
    deepStrictEqual(list.map((a) => [a.id, a.status, a.apis]), [['acc_d', 'DEGRADED', ['classic']], ['acc_p', 'PARTIAL', ['classic']], ['acc_n', 'DEGRADED', []]]);
    const need = (id: string, api: 'classic' | 'recruiter') => requireCode({ source: 'linkedin', account_id: id, api }, list);
    strictEqual(need('acc_d', 'classic'), null);
    strictEqual(need('acc_d', 'recruiter'), 'RETRY_LATER', 'dégradé : revient seul');
    strictEqual(need('acc_p', 'classic'), null);
    strictEqual(need('acc_p', 'recruiter'), 'ACCOUNT_RECONNECT', 'limité : une reconnexion règle le produit');
    strictEqual(need('acc_n', 'classic'), 'RETRY_LATER', 'dégradé sans détail par produit');
  });
});
