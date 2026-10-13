// Action list_recruiter_projects et filtre de projet de la recherche : liste du sélecteur (forme, pagination par
// décalage), licence Recruiter exigée, refus en français sans le nom du prestataire, et `recruiter_project_id`
// de l'action search (filtre `project` de la recherche de personnes Recruiter).
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-search/recruiter-projects.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { withMockTransport, type MockReply, type RecordedRequest } from '../_shared/unipile/testing.ts';
import { clearLicenceCache } from './licence.ts';
import {
  clampLimit,
  clearProjectTitleCache,
  handleListRecruiterProjects,
  offsetOfCursor,
  recruiterProjectsProblem,
  toProjectOption,
} from './recruiter-projects.ts';
import { compileSearchRequest } from './search-request.ts';
import { handleSearch } from './search.ts';
import { UnipileInputError } from './responses.ts';

const ACC = 'acc_test1';
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
console.log = console.warn = console.error = () => {};
addEventListener('unload', () => Object.assign(console, originalConsole));

type Routes = Record<string, MockReply | ((request: RecordedRequest) => MockReply)>;
function router(routes: Routes) {
  return (request: RecordedRequest): MockReply => {
    const entry = routes[`${request.method} ${request.path}`];
    if (entry === undefined) return { status: 404, body: { error: 'route inconnue' } };
    return typeof entry === 'function' ? entry(request) : entry;
  };
}
const contracts = (...list: Array<[string, boolean]>) => ({
  object: 'AvailableContracts',
  contracts: list.map(([product, selected], i) => ({ object: 'Contract', id: `c${i}`, name: product, product, selected })),
});
const RECRUITER = { body: contracts(['recruiter', true]) };
const CONTRACTS_PATH = `GET /${ACC}/linkedin/contracts`;
const PROJECTS_PATH = `GET /${ACC}/linkedin/recruiter/projects`;

const project = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  object: 'HiringProject', id, name, readonly: false, archived: false, visibility: 'PRIVATE',
  created_at: '2026-09-01T08:00:00.000Z', last_modified_at: '2026-10-01T09:30:00.000Z',
  owner: { id: 'o1', seat_id: 's1', name: 'Claire Martin' },
  metadata: { locations: [], industries: [] }, talent_pool: { channels: [] }, pipeline: { enabled: true, stages: [] },
  ...extra,
});

async function call(response: Response) {
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

Deno.test('liste : projets du sélecteur, forme réduite, requête sans curseur ni état inutile', async () => {
  clearLicenceCache();
  await withMockTransport(
    router({
      [CONTRACTS_PATH]: RECRUITER,
      [PROJECTS_PATH]: { body: { data: [project('101', 'CTO Fintech', { visibility: 'SHARED' }), project('102', 'Dev Rust')], total_count: 2 } },
    }),
    async (mock) => {
      const { status, body } = await call(await handleListRecruiterProjects(ACC, {}));
      strictEqual(status, 200);
      strictEqual(body.success, true);
      deepStrictEqual(body.projects, [
        { id: '101', name: 'CTO Fintech', archived: false, shared: true, owner_name: 'Claire Martin', created_at: '2026-09-01T08:00:00.000Z', last_modified_at: '2026-10-01T09:30:00.000Z' },
        { id: '102', name: 'Dev Rust', archived: false, shared: false, owner_name: 'Claire Martin', created_at: '2026-09-01T08:00:00.000Z', last_modified_at: '2026-10-01T09:30:00.000Z' },
      ]);
      strictEqual(body.cursor, null);
      strictEqual(body.total, 2);
      const list = mock.calls.find((c) => c.path.endsWith('/recruiter/projects'))!;
      strictEqual(list.query.get('limit'), '50');
      strictEqual(list.query.get('cursor'), null);
      strictEqual(list.query.get('keywords'), null);
      ok(!JSON.stringify(body).includes('talent_pool'), 'aucun champ du prestataire hors de la forme réduite');
    },
  );
});

Deno.test('liste : pagination par décalage, curseur offset:<n>, filtre par nom', async () => {
  clearLicenceCache();
  const page = (n: number) => Array.from({ length: n }, (_, i) => project(String(200 + i), `Projet ${i}`));
  await withMockTransport(
    router({
      [CONTRACTS_PATH]: RECRUITER,
      [PROJECTS_PATH]: (request) => ({ body: { data: page(Number(request.query.get('offset')) === 0 ? 2 : 1), total_count: 3 } }),
    }),
    async (mock) => {
      const first = await call(await handleListRecruiterProjects(ACC, { limit: 2, keywords: '  Fintech  ' }));
      strictEqual(first.body.cursor, 'offset:2');
      const second = await call(await handleListRecruiterProjects(ACC, { limit: 2, cursor: first.body.cursor }));
      strictEqual(second.body.cursor, null);
      const lists = mock.calls.filter((c) => c.path.endsWith('/recruiter/projects'));
      strictEqual(lists[0].query.get('offset'), '0');
      strictEqual(lists[0].query.get('limit'), '2');
      strictEqual(lists[0].query.get('keywords'), 'Fintech');
      strictEqual(lists[1].query.get('offset'), '2');
    },
  );
});

Deno.test('liste : sans total, une page pleine annonce une suite, une page courte la fin', async () => {
  clearLicenceCache();
  await withMockTransport(
    router({ [CONTRACTS_PATH]: RECRUITER, [PROJECTS_PATH]: { body: { data: [project('1', 'A'), project('2', 'B')] } } }),
    async () => {
      strictEqual((await call(await handleListRecruiterProjects(ACC, { limit: 2 }))).body.cursor, 'offset:2');
      strictEqual((await call(await handleListRecruiterProjects(ACC, { limit: 3 }))).body.cursor, null);
    },
  );
});

Deno.test('liste : curseur illisible refusé avant tout appel', async () => {
  clearLicenceCache();
  await withMockTransport(router({}), async (mock) => {
    for (const cursor of ['AbCd', 'offset:abc', 'offset:-1', 42]) {
      const { status, body } = await call(await handleListRecruiterProjects(ACC, { cursor }));
      strictEqual(status, 400);
      strictEqual(body.errorType, 'INVALID_CURSOR');
    }
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('liste : un compte sans licence Recruiter ne voit pas les projets, texte français neutre, aucun appel de liste', async () => {
  clearLicenceCache();
  await withMockTransport(router({ [CONTRACTS_PATH]: { body: contracts(['sales_navigator', true]) } }), async (mock) => {
    const { status, body } = await call(await handleListRecruiterProjects(ACC, {}));
    strictEqual(status, 400);
    strictEqual(body.errorType, 'LICENCE_UNAVAILABLE');
    ok(String(body.error).startsWith('Ce compte LinkedIn n’a pas de licence Recruiter'), String(body.error));
    ok(!/unipile/i.test(JSON.stringify(body)));
    ok(mock.calls.every((c) => c.path.endsWith('/contracts')), 'seule la lecture des contrats est partie');
  });
  clearLicenceCache();
  // Compte Classic, sans aucun contrat.
  await withMockTransport(router({ [CONTRACTS_PATH]: { body: contracts() } }), async () => {
    const { status, body } = await call(await handleListRecruiterProjects(ACC, {}));
    strictEqual(status, 400);
    strictEqual(body.errorType, 'LICENCE_UNAVAILABLE');
  });
});

Deno.test('liste : contrat actif Sales Navigator, le message dit quoi activer', async () => {
  clearLicenceCache();
  await withMockTransport(router({ [CONTRACTS_PATH]: { body: contracts(['recruiter', false], ['sales_navigator', true]) } }), async (mock) => {
    const { status, body } = await call(await handleListRecruiterProjects(ACC, {}));
    strictEqual(status, 400);
    strictEqual(body.error, 'Le contrat LinkedIn actif sur ce compte est Sales Navigator. Activez le contrat Recruiter pour voir vos projets.');
    ok(mock.calls.every((c) => c.path.endsWith('/contracts')));
  });
});

Deno.test('liste : lecture des contrats passagèrement impossible, la liste est tentée ; échec de la liste = texte neutre et liste vide', async () => {
  clearLicenceCache();
  await withMockTransport(
    router({
      [CONTRACTS_PATH]: { status: 500, body: { message: 'secret interne' } },
      [PROJECTS_PATH]: { status: 500, body: { message: 'Unipile secret interne' } },
    }),
    async () => {
      const { status, body } = await call(await handleListRecruiterProjects(ACC, {}));
      strictEqual(status, 502);
      strictEqual(body.success, false);
      deepStrictEqual(body.projects, []);
      ok(!/unipile|secret/i.test(JSON.stringify(body)), JSON.stringify(body));
    },
  );
});

Deno.test('liste : compte déconnecté dit tel quel, sans appel de liste', async () => {
  clearLicenceCache();
  await withMockTransport(
    router({ [CONTRACTS_PATH]: { status: 401, body: { type: 'errors/disconnected_account', title: 'Account disconnected' } } }),
    async (mock) => {
      const { body } = await call(await handleListRecruiterProjects(ACC, {}));
      strictEqual(body.success, false);
      ok(!/unipile/i.test(JSON.stringify(body)));
      ok(mock.calls.every((c) => !c.path.endsWith('/recruiter/projects')));
    },
  );
});

Deno.test('projet : normalisation, éléments illisibles écartés', () => {
  strictEqual(toProjectOption(null), null);
  strictEqual(toProjectOption({ id: '1' }), null);
  strictEqual(toProjectOption({ name: 'x' }), null);
  deepStrictEqual(toProjectOption({ id: 7, name: ' Projet ', archived: true }), {
    id: '7', name: 'Projet', archived: true, shared: false, owner_name: null, created_at: null, last_modified_at: null,
  });
  strictEqual(offsetOfCursor(undefined), 0);
  strictEqual(offsetOfCursor('offset:30'), 30);
  strictEqual(offsetOfCursor('x'), null);
  strictEqual(clampLimit(500), 100);
  strictEqual(clampLimit(0), 1);
  strictEqual(clampLimit('12'), 50);
  strictEqual(recruiterProjectsProblem({ recruiter: true, sales_navigator: false, active: 'recruiter', selectedKnown: true }), null);
  strictEqual(recruiterProjectsProblem({ recruiter: true, sales_navigator: false, active: 'recruiter', selectedKnown: false }), null);
});

// ---------------------------------------------------------------------------
// recruiter_project_id dans la recherche
// ---------------------------------------------------------------------------

Deno.test('search Recruiter : recruiter_project_id devient le filtre project de la recherche de personnes', async () => {
  clearLicenceCache();
  await withMockTransport(
    router({
      [CONTRACTS_PATH]: RECRUITER,
      [`POST /${ACC}/linkedin/recruiter/search/people`]: { body: { data: [], next_cursor: null } },
    }),
    async (mock) => {
      const { status, body } = await call(await handleSearch(ACC, { api: 'recruiter', keywords: 'CTO', recruiter_project_id: '1234567890' }));
      strictEqual(status, 200);
      ok(!('filters_dropped' in body));
      const sent = mock.calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
      deepStrictEqual(sent.project, { include: [{ id: '1234567890', title: '1234567890' }] });
      ok(!('recruiter_project_id' in sent), 'le champ de Konekt ne part jamais chez le prestataire');
      ok(!('hiring_project' in sent));
    },
  );
});

Deno.test('search : un hiring_project explicite l\'emporte, un nombre est accepté', () => {
  const explicit = compileSearchRequest({ api: 'recruiter', hiring_project: '55', recruiter_project_id: '77' });
  deepStrictEqual((explicit.compiled.body as Record<string, unknown>).project, { include: [{ id: '55', title: '55' }] });
  const numeric = compileSearchRequest({ api: 'recruiter', recruiter_project_id: 4242 });
  deepStrictEqual((numeric.compiled.body as Record<string, unknown>).project, { include: [{ id: '4242', title: '4242' }] });
  const none = compileSearchRequest({ api: 'recruiter', recruiter_project_id: '' });
  ok(!('project' in (none.compiled.body as Record<string, unknown>)));
});

Deno.test('search hors Recruiter : le projet est rendu dans filters_dropped, jamais envoyé', () => {
  for (const api of ['classic', 'sales_navigator'] as const) {
    const compiled = compileSearchRequest({ api, keywords: 'go', recruiter_project_id: '1234' });
    ok(!('project' in (compiled.compiled.body as Record<string, unknown>)));
    deepStrictEqual(
      compiled.dropped.filter((d) => d.filter === 'hiring_project').map((d) => d.label),
      ['Projet de recrutement'],
      api,
    );
  }
});

Deno.test('search : un identifiant de projet invalide est refusé avant tout appel', () => {
  for (const bad of ['abc', '12 34', '1; drop', '../x', '1'.repeat(30), {}, ['1']]) {
    let error: unknown;
    try {
      compileSearchRequest({ api: 'recruiter', recruiter_project_id: bad });
    } catch (e) {
      error = e;
    }
    ok(error instanceof UnipileInputError, String(bad));
    strictEqual((error as UnipileInputError).status, 400);
    strictEqual((error as UnipileInputError).code, 'RECRUITER_PROJECT_INVALID');
  }
});

// ---------------------------------------------------------------------------
// Revue S8 : projets clos, licence périmée, nom du projet dans le filtre
// ---------------------------------------------------------------------------

Deno.test('liste : les projets clos sont demandés (status ACTIVE et CLOSED) et rendus archivés, ordre stable', async () => {
  clearLicenceCache();
  await withMockTransport(
    router({
      [CONTRACTS_PATH]: RECRUITER,
      [PROJECTS_PATH]: { body: { data: [project('1', 'Actif'), project('2', 'Ancien', { archived: true })], total_count: 2 } },
    }),
    async (mock) => {
      const { body } = await call(await handleListRecruiterProjects(ACC, {}));
      deepStrictEqual((body.projects as Array<{ id: string; archived: boolean }>).map((p) => [p.id, p.archived]), [['1', false], ['2', true]]);
      const list = mock.calls.find((c) => c.path.endsWith('/recruiter/projects'))!;
      deepStrictEqual(list.query.getAll('status').sort(), ['ACTIVE', 'CLOSED']);
      strictEqual(list.query.get('sort_by'), 'ALPHABETICAL');
    },
  );
});

Deno.test('liste : un contrat changé depuis la dernière lecture ne garde pas le refus périmé', async () => {
  clearLicenceCache();
  let contractReads = 0;
  await withMockTransport(
    router({
      // 1re lecture : Sales Navigator actif (refus mis en cache) ; ensuite : Recruiter, choisi dans les réglages.
      [CONTRACTS_PATH]: () => ({ body: contracts(['recruiter', ++contractReads > 1], ['sales_navigator', contractReads === 1]) }),
      [PROJECTS_PATH]: { body: { data: [project('1', 'A')], total_count: 1 } },
    }),
    async () => {
      const refused = await call(await handleListRecruiterProjects(ACC, {}));
      strictEqual(refused.status, 400);
      strictEqual(refused.body.errorType, 'LICENCE_UNAVAILABLE');
      strictEqual(contractReads, 1);
      // Le refus vient du cache : il est revérifié une fois, la liste part.
      const allowed = await call(await handleListRecruiterProjects(ACC, {}));
      strictEqual(allowed.status, 200);
      strictEqual(contractReads, 2);
    },
  );
});

Deno.test('liste : un refus de licence confirmé par la relecture reste un refus, et une relecture en panne garde le premier refus', async () => {
  clearLicenceCache();
  let reads = 0;
  await withMockTransport(
    router({
      [CONTRACTS_PATH]: () => (++reads === 1 ? { body: contracts(['sales_navigator', true]) } : { status: 500, body: {} }),
    }),
    async () => {
      await call(await handleListRecruiterProjects(ACC, {}));
      const again = await call(await handleListRecruiterProjects(ACC, {}));
      strictEqual(again.status, 400);
      strictEqual(again.body.errorType, 'LICENCE_UNAVAILABLE');
    },
  );
});

Deno.test('search Recruiter : un contrat changé depuis la dernière lecture ne garde pas le refus périmé', async () => {
  clearLicenceCache();
  let contractReads = 0;
  await withMockTransport(
    router({
      [CONTRACTS_PATH]: () => ({ body: contracts(['recruiter', ++contractReads > 1], ['sales_navigator', contractReads === 1]) }),
      [`POST /${ACC}/linkedin/recruiter/search/people`]: { body: { data: [], next_cursor: null } },
    }),
    async () => {
      strictEqual((await call(await handleSearch(ACC, { api: 'recruiter', keywords: 'CTO' }))).status, 400);
      strictEqual((await call(await handleSearch(ACC, { api: 'recruiter', keywords: 'CTO' }))).status, 200);
    },
  );
});

Deno.test('search Recruiter : le filtre project porte le nom du projet lu dans la liste, pas son identifiant', async () => {
  clearLicenceCache();
  clearProjectTitleCache();
  await withMockTransport(
    router({
      [CONTRACTS_PATH]: RECRUITER,
      [PROJECTS_PATH]: { body: { data: [project('101', 'CTO Fintech'), project('102', 'Ancien', { archived: true })], total_count: 2 } },
      [`POST /${ACC}/linkedin/recruiter/search/people`]: { body: { data: [], next_cursor: null } },
    }),
    async (mock) => {
      await call(await handleSearch(ACC, { api: 'recruiter', keywords: 'CTO', recruiter_project_id: '101' }));
      await call(await handleSearch(ACC, { api: 'recruiter', keywords: 'CTO', recruiter_project_id: '102' }));
      const sent = mock.calls.filter((c) => c.method === 'POST').map((c) => (c.body as Record<string, unknown>).project);
      deepStrictEqual(sent, [
        { include: [{ id: '101', title: 'CTO Fintech' }] },
        { include: [{ id: '102', title: 'Ancien' }] },
      ]);
      strictEqual(mock.calls.filter((c) => c.path.endsWith('/recruiter/projects')).length, 1, 'liste lue une fois, puis gardée');
    },
  );
});

Deno.test('search Recruiter : projet absent de la liste ou liste illisible, la recherche part avec l\'identifiant comme nom', async () => {
  clearLicenceCache();
  clearProjectTitleCache();
  await withMockTransport(
    router({
      [CONTRACTS_PATH]: RECRUITER,
      [PROJECTS_PATH]: { body: { data: [project('1', 'Autre')], total_count: 1 } },
      [`POST /${ACC}/linkedin/recruiter/search/people`]: { body: { data: [], next_cursor: null } },
    }),
    async (mock) => {
      strictEqual((await call(await handleSearch(ACC, { api: 'recruiter', recruiter_project_id: '999' }))).status, 200);
      deepStrictEqual((mock.calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>).project, { include: [{ id: '999', title: '999' }] });
    },
  );
  clearProjectTitleCache();
  await withMockTransport(
    router({
      [CONTRACTS_PATH]: RECRUITER,
      [PROJECTS_PATH]: { status: 500, body: {} },
      [`POST /${ACC}/linkedin/recruiter/search/people`]: { body: { data: [], next_cursor: null } },
    }),
    async () => {
      strictEqual((await call(await handleSearch(ACC, { api: 'recruiter', recruiter_project_id: '999' }))).status, 200);
    },
  );
});

Deno.test('search sous la barrière de l\'agent continu : aucune lecture de projet de plus', async () => {
  clearLicenceCache();
  clearProjectTitleCache();
  await withMockTransport(
    router({
      [CONTRACTS_PATH]: RECRUITER,
      [`POST /${ACC}/linkedin/recruiter/search/people`]: { body: { data: [], next_cursor: null } },
    }),
    async (mock) => {
      await call(await handleSearch(ACC, { api: 'recruiter', recruiter_project_id: '101' }, { beforeProvider: async () => {} }));
      ok(mock.calls.every((c) => !c.path.endsWith('/recruiter/projects')));
    },
  );
});
