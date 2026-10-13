// Gestionnaires de unipile-search sur l'API v2 : chemins, requêtes, corps, formes de réponse conservées,
// erreurs sans le nom du prestataire, envois au plus une fois. Le prestataire est un transport factice
// (aucun réseau) ; la base est une doublure qui enregistre les appels de fonction SQL.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-search/handlers.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { jsonResponse, withMockTransport, type MockReply, type RecordedRequest } from '../_shared/unipile/testing.ts';
import { handleGetChats, handleGetMessages, handleMarkAsRead, handleSyncChatHistory, nextPageCursor, readPageCursor } from './chats.ts';
import { clearLicenceCache, inboxKindOf, licencesFromContracts, pickInbox, searchLicenceProblem } from './licence.ts';
import { handleEndorseSkill, handleGetProfile, handleGetUserPosts, toLegacyPost } from './profile.ts';
import { UnipileInputError } from './responses.ts';
import { handleGetParameters, handleSearch, prepareSearch } from './search.ts';
import { handleSendMessage, planSend, SEND_ERASED_MESSAGE, SEND_GDPR_UNVERIFIED_MESSAGE, type SendContext } from './send.ts';

const ACC = 'acc_test1';
const originalConsole = { log: console.log, warn: console.warn, error: console.error };
console.log = console.warn = console.error = () => {};
addEventListener('unload', () => Object.assign(console, originalConsole));

type Handler = MockReply | ((request: RecordedRequest) => MockReply | Promise<MockReply>);
/** Table `METHODE /chemin` (sans /v2) vers une réponse ; une route absente répond 404. */
function router(routes: Record<string, Handler | Handler[]>, timeline: string[] = []) {
  const counters = new Map<string, number>();
  return async (request: RecordedRequest): Promise<MockReply> => {
    const key = `${request.method} ${request.path}`;
    timeline.push(key);
    const entry = routes[key];
    if (entry === undefined) return { status: 404, body: { error: 'route inconnue', route: key } };
    const handler = Array.isArray(entry) ? entry[Math.min(counters.get(key) ?? 0, entry.length - 1)] : entry;
    counters.set(key, (counters.get(key) ?? 0) + 1);
    return typeof handler === 'function' ? await handler(request) : handler;
  };
}

const contracts = (...list: Array<[string, boolean]>) => ({
  object: 'AvailableContracts',
  contracts: list.map(([product, selected], i) => ({ object: 'Contract', id: `c${i}`, name: product, product, selected })),
});
const RECRUITER = contracts(['recruiter', true]);
const SALES = contracts(['sales_navigator', true]);

async function call<T>(response: Response): Promise<{ status: number; body: Record<string, unknown> & T }> {
  return { status: response.status, body: await response.json() };
}

type Row = Record<string, unknown>;

/**
 * Doublure de la base. `erased` : le registre de l'organisation désigne tout candidat (true) ou ces identifiants
 * seulement ; `pipeline` : lignes du pipeline qui rattachent une adresse de profil à un identifiant ; `unreadableRegister` :
 * la lecture du registre d'effacement échoue.
 */
function fakeAdmin(
  options: { erased?: boolean | string[]; unreadableRegister?: boolean; pipeline?: Row[]; displayName?: string | null; link?: Row | null } = {},
  timeline: string[] = [],
) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];
  const from = (table: string) => {
    const inFilters: Record<string, unknown[]> = {};
    const likeFilters: Record<string, string> = {};
    const rows = (): unknown[] => {
      if (table === 'candidate_photos' && options.erased === true) return [{ candidate_id: 'x' }];
      if (table === 'candidate_photos' && Array.isArray(options.erased)) {
        const asked = inFilters.candidate_id ?? [];
        return asked.some((id) => (options.erased as string[]).includes(String(id))) ? [{ candidate_id: 'x' }] : [];
      }
      if (table === 'job_candidate_status') {
        return (options.pipeline ?? []).filter((row) => {
          if (inFilters.candidate_id) return inFilters.candidate_id.includes(row.candidate_id);
          if (likeFilters.linkedin_profile_url) return String(row.linkedin_profile_url ?? '').toLowerCase().includes(likeFilters.linkedin_profile_url);
          return false;
        });
      }
      if (table === 'mission_conversations' && options.link) return [options.link];
      return [];
    };
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select: () => q, or: () => q, order: () => q, limit: () => q,
      eq: (column: string, value: unknown) => { eqCalls.push({ table, column, value }); return q; },
      in: (column: string, values: unknown[]) => { inFilters[column] = values; return q; },
      ilike: (column: string, pattern: string) => { likeFilters[column] = pattern.replace(/\\([%_\\])/g, '$1').replace(/^%|%$/g, '').toLowerCase(); return q; },
      maybeSingle: () => Promise.resolve({ data: table === 'profiles' && options.displayName !== undefined ? { display_name: options.displayName } : null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(
        table === 'candidate_photos' && options.unreadableRegister
          ? { data: null, error: { message: 'lecture impossible' } }
          : { data: rows(), error: null },
      ).then(resolve, reject),
    };
    return q;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    timeline.push(`rpc ${name}${args.p_pending ? ' pending' : ''}`);
    return Promise.resolve({ data: { project_id: 'p1', via: 'explicit', rows: [] }, error: null });
  };
  return { from, rpc, rpcCalls, eqCalls };
}

function sendContext(admin: ReturnType<typeof fakeAdmin>, overrides: Partial<SendContext> = {}): SendContext {
  return { organizationId: 'org-1', userId: 'user-1', isInternal: false, accountOwnerId: 'user-1', admin: () => admin, ...overrides };
}

const reset = () => clearLicenceCache();

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

Deno.test('search Recruiter : chemin, requête, corps, forme de réponse et filtres non appliqués', async () => {
  reset();
  const timeline: string[] = [];
  await withMockTransport(
    router({
      [`GET /${ACC}/linkedin/contracts`]: { body: RECRUITER },
      [`POST /${ACC}/linkedin/recruiter/search/people`]: {
        body: {
          data: [
            { object: 'PeopleSearchResult', id: 'ACoAAfoo', display_name: 'Ada Lovelace', public_identifier: 'ada', headline: 'CTO', network_distance: 'FIRST_DEGREE', product: 'recruiter' },
          ],
          total_count: 120,
          next_cursor: 'cur2',
        },
      },
    }, timeline),
    async (mock) => {
      const { status, body } = await call(await handleSearch(ACC, {
        api: 'recruiter', category: 'people', keywords: 'Engineer', limit: 25, location: [{ id: '1', priority: 'MUST_HAVE' }], location_within_area: 35,
      }));
      strictEqual(status, 200);
      strictEqual(body.success, true);
      strictEqual(body.cursor, 'cur2');
      strictEqual(body.total, 120);
      const result = (body.results as Array<Record<string, unknown>>)[0];
      strictEqual(result.provider_id, 'ACoAAfoo');
      strictEqual(result.name, 'Ada Lovelace');
      strictEqual(result.network_distance, 'DISTANCE_1');
      deepStrictEqual(body.filters_dropped, [{ filter: 'location_within_area', label: 'Rayon autour du lieu', reason: 'unsupported' }]);
      ok(!('config' in body));
      const search = mock.calls.find((c) => c.method === 'POST')!;
      strictEqual(search.query.get('limit'), '25');
      strictEqual(search.query.get('cursor'), null);
      const sent = search.body as Record<string, unknown>;
      strictEqual(sent.keywords, 'Engineer');
      for (const key of ['api', 'category', 'limit', 'cursor']) ok(!(key in sent), key);
    },
  );
  deepStrictEqual(timeline, [`GET /${ACC}/linkedin/contracts`, `POST /${ACC}/linkedin/recruiter/search/people`]);
});

Deno.test('search Classic : pas de page à choisir, curseur transmis, aucune lecture de contrat', async () => {
  reset();
  await withMockTransport(
    router({ [`POST /${ACC}/linkedin/search/people`]: { body: { data: [], next_cursor: null } } }),
    async (mock) => {
      const { body } = await call(await handleSearch(ACC, { api: 'classic', keywords: 'Go', limit: 25, cursor: 'abc', company: ['100'] }));
      strictEqual(body.success, true);
      strictEqual(body.cursor, null);
      strictEqual(mock.calls.length, 1);
      strictEqual(mock.calls[0].query.get('cursor'), 'abc');
      strictEqual(mock.calls[0].query.get('limit'), null);
      deepStrictEqual((mock.calls[0].body as Record<string, unknown>).current_company, ['100']);
    },
  );
});

Deno.test('search Sales Navigator : le curseur est un décalage, de page en page', async () => {
  reset();
  const page = (n: number) => ({ data: Array.from({ length: n }, (_, i) => ({ object: 'PeopleSearchResult', id: `ACoAA${i}`, display_name: `P${i}` })), total_count: 40 });
  await withMockTransport(
    router({
      [`GET /${ACC}/linkedin/contracts`]: { body: SALES },
      [`POST /${ACC}/linkedin/sales-navigator/search/people`]: [{ body: page(25) }, { body: page(15) }],
    }),
    async (mock) => {
      const first = (await call(await handleSearch(ACC, { api: 'sales_navigator', keywords: 'Go', limit: 25 }))).body;
      strictEqual(first.cursor, 'offset:25');
      const second = (await call(await handleSearch(ACC, { api: 'sales_navigator', keywords: 'Go', limit: 25, cursor: first.cursor }))).body;
      strictEqual(second.cursor, null);
      const posts = mock.calls.filter((c) => c.method === 'POST');
      strictEqual(posts[0].query.get('offset'), '0');
      strictEqual(posts[1].query.get('offset'), '25');
    },
  );
});

Deno.test('search : une licence absente ou inactive est refusée avant la recherche, en français', async () => {
  reset();
  await withMockTransport(router({ [`GET /${ACC}/linkedin/contracts`]: { body: contracts(['recruiter', false], ['sales_navigator', true]) } }), async (mock) => {
    const { status, body } = await call(await handleSearch(ACC, { api: 'recruiter', keywords: 'Go' }));
    strictEqual(status, 400);
    strictEqual(body.errorType, 'LICENCE_UNAVAILABLE');
    ok(/contrat LinkedIn actif sur ce compte est Sales Navigator/.test(body.error as string));
    ok(!mock.calls.some((c) => c.method === 'POST'));
  });
  reset();
  await withMockTransport(router({ [`GET /${ACC}/linkedin/contracts`]: { body: contracts() } }), async () => {
    const { status, body } = await call(await handleSearch(ACC, { api: 'sales_navigator', keywords: 'Go' }));
    strictEqual(status, 400);
    ok(/n’a pas de licence Sales Navigator/.test(body.error as string));
    ok(!/unipile/i.test(JSON.stringify(body)));
  });
});

Deno.test('search : la lecture des contrats impossible pour une raison passagère n\'empêche pas la recherche', async () => {
  reset();
  await withMockTransport(
    router({
      [`GET /${ACC}/linkedin/contracts`]: { status: 503, body: { error: 'indisponible' } },
      [`POST /${ACC}/linkedin/recruiter/search/people`]: { body: { data: [] } },
    }),
    async () => {
      const { status, body } = await call(await handleSearch(ACC, { api: 'recruiter', keywords: 'Go' }));
      strictEqual(status, 200);
      strictEqual(body.success, true);
    },
  );
});

Deno.test('search : le compte déconnecté est dit tel quel, sans le texte du prestataire', async () => {
  reset();
  await withMockTransport(
    router({
      [`GET /${ACC}/linkedin/contracts`]: { body: RECRUITER },
      [`POST /${ACC}/linkedin/recruiter/search/people`]: { status: 401, body: { type: 'errors/disconnected_account', detail: 'Unipile account disconnected, reconnect it' } },
    }),
    async () => {
      const { status, body } = await call(await handleSearch(ACC, { api: 'recruiter', keywords: 'Go' }));
      strictEqual(status, 502);
      strictEqual(body.errorType, 'ACCOUNT_DISCONNECTED');
      ok(!/unipile/i.test(JSON.stringify(body)));
    },
  );
});

Deno.test('search : limite atteinte, requête trop grosse et refus ordinaire ont chacun leur réponse, jamais le texte brut', async () => {
  for (const [reply, status, errorType] of [
    [{ status: 429, body: { detail: 'Too many requests for Unipile' } }, 429, 'RATE_LIMIT'],
    [{ status: 400, body: { type: 'errors/content_too_large', detail: 'Unipile: Too large' } }, 400, 'CONTENT_TOO_LARGE'],
    [{ status: 400, body: { detail: 'Unipile says: unable to process request' } }, 400, 'INVALID_REQUEST'],
    [{ status: 502, text: '<html>Unipile gateway</html>' }, 502, 'PROVIDER_ERROR'],
  ] as Array<[MockReply, number, string]>) {
    reset();
    const failures: Array<Record<string, unknown>> = [];
    await withMockTransport(router({ [`POST /${ACC}/linkedin/search/people`]: reply }), async (mock) => {
      const response = await call(await handleSearch(ACC, { api: 'classic', keywords: 'Go' }, { recordFailure: (row) => { failures.push({ ...row }); return Promise.resolve(); } }));
      strictEqual(response.status, status);
      strictEqual(response.body.errorType, errorType);
      ok(!/unipile|html/i.test(JSON.stringify(response.body)), JSON.stringify(response.body));
      ok(mock.calls.length >= 1);
    });
    strictEqual(failures.length, 1, 'boîte noire écrite une fois');
    deepStrictEqual(failures[0].search_body, { keywords: 'Go' });
    strictEqual(failures[0].account_id, ACC);
  }
});

Deno.test('search : une panne passagère est reprise hors barrière, jamais sous la barrière de l\'agent continu', async () => {
  reset();
  await withMockTransport(
    router({ [`POST /${ACC}/linkedin/search/people`]: [{ status: 503, body: {} }, { body: { data: [] } }] }),
    async (mock) => {
      const { body } = await call(await handleSearch(ACC, { api: 'classic', keywords: 'Go' }));
      strictEqual(body.success, true);
      strictEqual(mock.calls.length, 2);
    },
  );
  reset();
  let fenced = 0;
  await withMockTransport(
    router({ [`POST /${ACC}/linkedin/search/people`]: [{ status: 503, body: {} }, { body: { data: [] } }] }),
    async (mock) => {
      const { status } = await call(await handleSearch(ACC, { api: 'classic', keywords: 'Go' }, { beforeProvider: () => { fenced++; return Promise.resolve(); } }));
      strictEqual(status, 502);
      strictEqual(mock.calls.length, 1, 'une seule consultation sous barrière');
      strictEqual(fenced, 1);
    },
  );
});

Deno.test('search : la barrière interrompt avant tout appel, la licence n\'ouvre pas de consultation de plus', async () => {
  reset();
  await withMockTransport(router({}), async (mock) => {
    let error: unknown;
    try {
      await handleSearch(ACC, { api: 'recruiter', keywords: 'Go' }, { beforeProvider: () => Promise.reject(new UnipileInputError('stop', 409, 'AGENT_LEASE_CHANGED')) });
    } catch (e) {
      error = e;
    }
    ok(error instanceof UnipileInputError && error.code === 'AGENT_LEASE_CHANGED');
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('search : les erreurs d\'entrée sont levées avant tout appel', async () => {
  reset();
  await withMockTransport(router({}), async (mock) => {
    for (const params of [{ api: 'classic', keywords: 'a'.repeat(201) }, { api: 'recruiter', keywords: 'Go AND' }, { api: 'database' }]) {
      let thrown: unknown;
      try {
        await handleSearch(ACC, params);
      } catch (e) {
        thrown = e;
      }
      ok(thrown instanceof UnipileInputError);
    }
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('search sous la barrière : un filtre que la licence ne sait pas appliquer arrête l\'agent avant toute consultation', async () => {
  reset();
  let fenced = 0;
  const beforeProvider = () => { fenced++; return Promise.resolve(); };
  await withMockTransport(router({ [`POST /${ACC}/linkedin/recruiter/search/people`]: { body: { data: [] } } }), async (mock) => {
    let thrown: unknown;
    try {
      await handleSearch(ACC, { api: 'recruiter', keywords: 'Go', location: [{ id: '1', priority: 'MUST_HAVE' }], location_within_area: 25 }, { beforeProvider });
    } catch (e) {
      thrown = e;
    }
    ok(thrown instanceof UnipileInputError);
    strictEqual(thrown.code, 'FILTERS_UNSUPPORTED');
    strictEqual(thrown.status, 422);
    ok(thrown.message.includes('Rayon autour du lieu'));
    ok(!/unipile/i.test(thrown.message));
    strictEqual(mock.calls.length, 0, 'aucune consultation');
    strictEqual(fenced, 0, 'la barrière n\'est pas ouverte pour une recherche refusée');
  });
  // Sans barrière (recherche manuelle), le filtre est seulement signalé et la recherche part.
  reset();
  await withMockTransport(router({ [`GET /${ACC}/linkedin/contracts`]: { body: RECRUITER }, [`POST /${ACC}/linkedin/recruiter/search/people`]: { body: { data: [] } } }), async () => {
    const manual = await call(await handleSearch(ACC, { api: 'recruiter', keywords: 'Go', location: [{ id: '1', priority: 'MUST_HAVE' }], location_within_area: 25 }));
    strictEqual(manual.status, 200);
    deepStrictEqual(manual.body.filters_dropped, [{ filter: 'location_within_area', label: 'Rayon autour du lieu', reason: 'unsupported' }]);
  });
  reset();
  await withMockTransport(router({ [`POST /${ACC}/linkedin/search/people`]: { body: { data: [] } } }), async (mock) => {
    const { body } = await call(await handleSearch(ACC, { api: 'classic', keywords: 'Go' }, { beforeProvider }));
    strictEqual(body.success, true, 'sans filtre non appliqué, la recherche continue part');
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('prepareSearch : les refus de la requête et de la licence se jugent avant tout envoi', async () => {
  reset();
  await withMockTransport(router({ [`GET /${ACC}/linkedin/contracts`]: { body: contracts() } }), async (mock) => {
    const refused = await prepareSearch(ACC, { api: 'recruiter', keywords: 'Go' });
    ok('response' in refused);
    strictEqual(refused.response.status, 400);
    strictEqual((await refused.response.json()).errorType, 'LICENCE_UNAVAILABLE');
    ok(!mock.calls.some((c) => c.method === 'POST'));
    let thrown: unknown;
    try {
      await prepareSearch(ACC, { api: 'classic', keywords: 'a'.repeat(201) });
    } catch (e) {
      thrown = e;
    }
    ok(thrown instanceof UnipileInputError && thrown.code === 'KEYWORDS_TOO_LONG');
    const ready = await prepareSearch(ACC, { api: 'classic', keywords: 'Go' });
    ok('prepared' in ready);
  });
});

Deno.test('licences : sélection, absence, boîtes et type de boîte', () => {
  deepStrictEqual(licencesFromContracts([]), { recruiter: false, sales_navigator: false, active: 'classic', selectedKnown: false });
  deepStrictEqual(licencesFromContracts([{ product: 'recruiter', selected: false }, { product: 'sales_navigator', selected: true }]), {
    recruiter: true, sales_navigator: true, active: 'sales_navigator', selectedKnown: true,
  });
  strictEqual(licencesFromContracts([{ product: 'recruiter' }, { product: 'sales_navigator' }]).active, 'recruiter');
  // Sans contrat désigné, seule l'absence d'une licence bloque : le choix par défaut n'est pas une preuve.
  strictEqual(searchLicenceProblem('sales_navigator', licencesFromContracts([{ product: 'recruiter' }, { product: 'sales_navigator' }])), null);
  strictEqual(searchLicenceProblem('classic', licencesFromContracts([])), null);
  ok(searchLicenceProblem('recruiter', licencesFromContracts([{ product: 'sales_navigator', selected: true }])));
  strictEqual(inboxKindOf({ id: 'inbox_recruiter_1' }), 'recruiter');
  strictEqual(inboxKindOf({ id: 'i1', description: 'LinkedIn Sales Navigator' }), 'sales_navigator');
  strictEqual(inboxKindOf({ id: 'i2', description: 'Classic' }), 'classic');
  strictEqual(inboxKindOf({ id: 'i3', description: 'LinkedIn' }), undefined);
  const one = [{ id: 'only', disabled: false }];
  strictEqual(pickInbox(one, 'recruiter')?.id, 'only');
  const two = [{ id: 'a', description: 'Recruiter', disabled: false }, { id: 'b', description: 'x', disabled: false }];
  strictEqual(pickInbox(two, 'recruiter')?.id, 'a');
  strictEqual(pickInbox(two, 'classic'), undefined);
});

// ---------------------------------------------------------------------------
// Paramètres des filtres
// ---------------------------------------------------------------------------

Deno.test('get_parameters : le type et le service de l\'interface deviennent ceux de la licence, name devient title', async () => {
  reset();
  const items = { data: [{ object: 'SearchParameter', id: '1', name: 'Paris' }, { id: '2' }], total_count: 2 };
  await withMockTransport(
    router({
      [`GET /${ACC}/linkedin/contracts`]: { body: RECRUITER },
      [`GET /${ACC}/linkedin/search/parameters`]: { body: items },
      [`POST /${ACC}/linkedin/recruiter/search/parameters`]: { body: items },
      [`GET /${ACC}/linkedin/sales-navigator/search/parameters`]: { body: items },
    }),
    async (mock) => {
      // La lecture du contrat (mise en cache) n'est pas un appel de paramètres.
      const parameterCalls = () => mock.calls.filter((c) => !c.path.endsWith('/contracts'));
      const classic = (await call(await handleGetParameters(ACC, { type: 'CONNECTIONS', keywords: 'ada', service: 'CLASSIC' }))).body;
      deepStrictEqual(classic, { success: true, items: [{ id: '1', title: 'Paris' }] });
      strictEqual(parameterCalls()[0].query.get('type'), 'RELATION');
      strictEqual(parameterCalls()[0].query.get('keywords'), 'ada');
      strictEqual(parameterCalls()[0].query.get('limit'), '100');

      await handleGetParameters(ACC, { type: 'DEPARTMENT', keywords: 'eng', service: 'RECRUITER', limit: 3 });
      deepStrictEqual(parameterCalls()[1].body, { source: 'SEARCH', type: 'JOB_FUNCTION', keywords: 'eng' });
      strictEqual(parameterCalls()[1].query.get('limit'), '3');

      await handleGetParameters(ACC, { type: 'location', keywords: 'par' });
      strictEqual(parameterCalls()[2].path, `/${ACC}/linkedin/recruiter/search/parameters`);
      deepStrictEqual(parameterCalls()[2].body, { source: 'SEARCH', type: 'LOCATION', keywords: 'par' });
    },
  );
  reset();
  await withMockTransport(
    router({
      [`GET /${ACC}/linkedin/contracts`]: { body: SALES },
      [`GET /${ACC}/linkedin/sales-navigator/search/parameters`]: { body: items },
    }),
    async (mock) => {
      await handleGetParameters(ACC, { type: 'GROUPS', keywords: 'dev', service: 'sales_navigator' });
      const last = mock.calls[mock.calls.length - 1];
      strictEqual(last.path, `/${ACC}/linkedin/sales-navigator/search/parameters`);
      strictEqual(last.query.get('type'), 'GROUP');
    },
  );
});

Deno.test('get_parameters : le service demandé par l\'écran n\'est qu\'une indication, le contrat du compte décide', async () => {
  reset();
  const items = { data: [{ id: '1', name: 'Paris' }], total_count: 1 };
  // Compte Classic sans contrat : plusieurs écrans demandent RECRUITER quelle que soit la source.
  await withMockTransport(
    router({
      [`GET /${ACC}/linkedin/contracts`]: { body: contracts() },
      [`GET /${ACC}/linkedin/search/parameters`]: { body: items },
      [`POST /${ACC}/linkedin/recruiter/search/parameters`]: { status: 403, body: { detail: 'pas de licence' } },
    }),
    async (mock) => {
      const { status, body } = await call(await handleGetParameters(ACC, { type: 'LOCATION', keywords: 'par', service: 'RECRUITER' }));
      strictEqual(status, 200);
      deepStrictEqual(body, { success: true, items: [{ id: '1', title: 'Paris' }] });
      ok(!mock.calls.some((c) => c.path.includes('/recruiter/')), 'aucun appel à l\'endpoint Recruiter');
      strictEqual(mock.calls[mock.calls.length - 1].path, `/${ACC}/linkedin/search/parameters`);
    },
  );
  // Compte Sales Navigator : RECRUITER est ramené à son contrat.
  reset();
  await withMockTransport(
    router({
      [`GET /${ACC}/linkedin/contracts`]: { body: SALES },
      [`GET /${ACC}/linkedin/sales-navigator/search/parameters`]: { body: items },
    }),
    async (mock) => {
      const { body } = await call(await handleGetParameters(ACC, { type: 'LOCATION', keywords: 'par', service: 'RECRUITER' }));
      deepStrictEqual(body, { success: true, items: [{ id: '1', title: 'Paris' }] });
      ok(!mock.calls.some((c) => c.path.includes('/recruiter/')));
    },
  );
  // Compte Recruiter dont le contrat actif est Sales Navigator : la demande Recruiter suit le contrat actif.
  reset();
  await withMockTransport(
    router({
      [`GET /${ACC}/linkedin/contracts`]: { body: contracts(['recruiter', false], ['sales_navigator', true]) },
      [`GET /${ACC}/linkedin/sales-navigator/search/parameters`]: { body: items },
    }),
    async (mock) => {
      await handleGetParameters(ACC, { type: 'LOCATION', keywords: 'par', service: 'RECRUITER' });
      ok(!mock.calls.some((c) => c.path.includes('/recruiter/')));
    },
  );
  // Contrat illisible pour une raison passagère : la licence demandée est essayée.
  reset();
  await withMockTransport(
    router({
      [`GET /${ACC}/linkedin/contracts`]: { status: 503, body: {} },
      [`POST /${ACC}/linkedin/recruiter/search/parameters`]: { body: items },
    }),
    async (mock) => {
      const { body } = await call(await handleGetParameters(ACC, { type: 'LOCATION', keywords: 'par', service: 'RECRUITER' }));
      strictEqual(body.success, true);
      ok(mock.calls.some((c) => c.path === `/${ACC}/linkedin/recruiter/search/parameters`));
    },
  );
});

Deno.test('get_parameters : type sans équivalent ou mots-clés Classic absents : liste vide sans appel de paramètres', async () => {
  reset();
  await withMockTransport(router({ [`GET /${ACC}/linkedin/contracts`]: { body: RECRUITER } }), async (mock) => {
    deepStrictEqual((await call(await handleGetParameters(ACC, { type: 'TAGS', keywords: 'x', service: 'RECRUITER' }))).body, { success: true, items: [] });
    deepStrictEqual((await call(await handleGetParameters(ACC, { type: 'LOCATION', service: 'CLASSIC' }))).body, { success: true, items: [] });
    strictEqual((await call(await handleGetParameters(ACC, {}))).status, 400);
    ok(mock.calls.every((c) => c.path.endsWith('/contracts')), 'seule la lecture du contrat part');
  });
});

Deno.test('get_parameters : une erreur garde la liste vide et le texte neutre', async () => {
  reset();
  await withMockTransport(router({ [`GET /${ACC}/linkedin/search/parameters`]: { status: 403, body: { detail: 'Unipile feature not subscribed' } } }), async () => {
    const { status, body } = await call(await handleGetParameters(ACC, { type: 'SCHOOL', keywords: 'hec', service: 'CLASSIC' }));
    strictEqual(status, 502);
    strictEqual(body.success, false);
    deepStrictEqual(body.items, []);
    ok(!/unipile/i.test(JSON.stringify(body)));
  });
});

// ---------------------------------------------------------------------------
// Profils
// ---------------------------------------------------------------------------

Deno.test('get_profile : toutes les sections, lecture silencieuse, forme LinkedInProfile', async () => {
  reset();
  await withMockTransport(
    router({
      [`GET /${ACC}/users/ada-lovelace`]: {
        body: {
          object: 'UserProfile', id: 'ACoAAada', public_identifier: 'ada-lovelace', display_name: 'Ada Lovelace', description: 'CTO chez X',
          specifics: {
            network_distance: 'FIRST_DEGREE', is_open_to_work: true,
            experience: [{ job_title: 'CTO', company: { name: 'X' }, started_on: '03/15/2019' }],
          },
        },
      },
    }),
    async (mock) => {
      const { status, body } = await call(await handleGetProfile(ACC, { profile_url: 'https://www.linkedin.com/in/ada-lovelace/' }));
      strictEqual(status, 200);
      const profile = body.profile as Record<string, unknown>;
      strictEqual(profile.provider_id, 'ACoAAada');
      strictEqual(profile.headline, 'CTO chez X');
      strictEqual(profile.network_distance, 'DISTANCE_1');
      const experience = (profile.work_experience as Array<Record<string, unknown>>)[0];
      strictEqual(experience.role, 'CTO');
      deepStrictEqual(experience.start, { year: 2019, month: 3 });
      strictEqual(mock.calls.length, 1);
      deepStrictEqual(mock.calls[0].query.getAll('with_sections'), ['linkedin_*']);
      ok(!mock.calls.some((c) => c.path.includes('visit-profile')));
    },
  );
});

Deno.test('get_profile : identifiant du prestataire accepté, entrée invalide refusée, profil absent en français', async () => {
  reset();
  await withMockTransport(router({ [`GET /${ACC}/users/ACoAAada`]: { body: { id: 'ACoAAada' } } }), async (mock) => {
    strictEqual((await call(await handleGetProfile(ACC, { profile_id: 'ACoAAada' }))).status, 200);
    strictEqual((await call(await handleGetProfile(ACC, {}))).status, 400);
    strictEqual((await call(await handleGetProfile(ACC, { profile_id: 'a b/c' }))).status, 400);
    strictEqual(mock.calls.length, 1);
  });
  await withMockTransport(router({}), async () => {
    const { status, body } = await call(await handleGetProfile(ACC, { profile_id: 'inconnu' }));
    strictEqual(status, 404);
    strictEqual(body.errorType, 'PROFILE_NOT_FOUND');
    strictEqual(body.error, 'Ce profil est introuvable sur LinkedIn. Vérifiez le lien du candidat.');
  });
});

Deno.test('get_profile : include_details (messagerie) ne change rien, les sections sont toujours demandées et les rubriques limitées sont rendues', async () => {
  reset();
  // main (#343) a ajouté include_details pour que l'ancienne API rende les cinq rubriques sans notifier la personne ;
  // l'API v2 les demande d'office (with_sections), en lecture silencieuse, et rend les rubriques que le réseau a limitées.
  await withMockTransport(
    router({
      [`GET /${ACC}/users/ACoAAada`]: {
        body: {
          object: 'UserProfile', id: 'ACoAAada', display_name: 'Ada Lovelace',
          specifics: { experience: [{ job_title: 'CTO', company: { name: 'X' }, started_on: '03/15/2019' }], throttled_sections: ['skills', 'languages'] },
        },
      },
    }),
    async (mock) => {
      for (const include_details of [undefined, true, false, 'true']) {
        const params: Record<string, unknown> = { profile_id: 'ACoAAada' };
        if (include_details !== undefined) params.include_details = include_details;
        const { status, body } = await call(await handleGetProfile(ACC, params));
        strictEqual(status, 200);
        const profile = body.profile as Record<string, unknown>;
        deepStrictEqual(profile.throttled_sections, ['skills', 'languages']);
        strictEqual((profile.work_experience as Array<Record<string, unknown>>)[0].role, 'CTO');
      }
      strictEqual(mock.calls.length, 4, 'une lecture par appel, aucune reprise automatique');
      for (const c of mock.calls) deepStrictEqual(c.query.getAll('with_sections'), ['linkedin_*']);
      ok(!mock.calls.some((c) => c.path.includes('visit-profile')));
    },
  );
});

Deno.test('get_profile : compte introuvable, route introuvable et accès refusé ne passent pas pour un profil absent', async () => {
  reset();
  const refused = async (reply: { status: number; body: unknown }) => {
    let result = { status: 0, body: {} as Record<string, unknown> };
    await withMockTransport(router({ [`GET /${ACC}/users/ACoAAada`]: reply }), async () => {
      result = await call(await handleGetProfile(ACC, { profile_id: 'ACoAAada' }));
    });
    return result;
  };
  const account = await refused({ status: 404, body: { object: 'Error', status: 404, type: 'api/resource_not_found', title: 'Account not found', detail: 'Account with given id acc_x not found' } });
  strictEqual(account.status, 403);
  strictEqual(account.body.errorType, 'LINKEDIN_CONNECTION_REQUIRED');
  const route = await refused({ status: 404, body: { object: 'Error', status: 404, type: 'api/resource_not_found', title: 'Route Not Found' } });
  strictEqual(route.status, 502);
  strictEqual(route.body.errorType, 'NOT_FOUND');
  const denied = await refused({ status: 403, body: { object: 'Error', status: 403, type: 'api/forbidden', title: 'Forbidden' } });
  strictEqual(denied.status, 403);
  strictEqual(denied.body.errorType, 'ACCOUNT_ACCESS');
});

Deno.test('get_profile : la barrière passe avant l\'appel', async () => {
  reset();
  const order: string[] = [];
  await withMockTransport(router({ [`GET /${ACC}/users/ada`]: () => { order.push('GET'); return { body: { id: 'ACoAAada' } }; } }), async () => {
    await handleGetProfile(ACC, { profile_id: 'ada' }, () => { order.push('fence'); return Promise.resolve(); });
  });
  deepStrictEqual(order, ['fence', 'GET']);
});

Deno.test('get_profile sous la barrière : une seule requête, ni reprise du transport ni second identifiant', async () => {
  reset();
  let fenced = 0;
  const beforeProvider = () => { fenced++; return Promise.resolve(); };
  // Panne passagère : hors barrière le transport reprend, sous barrière la consultation reste unique.
  await withMockTransport(router({ [`GET /${ACC}/users/ACoAAadaLovelace1`]: [{ status: 503, body: {} }, { body: { id: 'ACoAAadaLovelace1' } }] }), async (mock) => {
    const { status } = await call(await handleGetProfile(ACC, { profile_id: 'ACoAAadaLovelace1' }, beforeProvider));
    strictEqual(status, 502);
    strictEqual(mock.calls.length, 1);
    strictEqual(fenced, 1);
  });
  // Profil introuvable : le second format d'identifiant n'est pas essayé sous barrière.
  await withMockTransport(router({}), async (mock) => {
    const { status } = await call(await handleGetProfile(ACC, { profile_id: 'ACoAAadaLovelace1', profile_url: 'https://www.linkedin.com/in/ada-lovelace/' }, beforeProvider));
    strictEqual(status, 404);
    strictEqual(mock.calls.length, 1);
  });
  // Sans barrière le comportement d'avant demeure : reprise passagère.
  await withMockTransport(router({ [`GET /${ACC}/users/ACoAAadaLovelace1`]: [{ status: 503, body: {} }, { body: { id: 'ACoAAadaLovelace1' } }] }), async (mock) => {
    strictEqual((await call(await handleGetProfile(ACC, { profile_id: 'ACoAAadaLovelace1' }))).status, 200);
    strictEqual(mock.calls.length, 2);
  });
});

Deno.test('get_profile : identifiant ET adresse de profil sont gardés, la seconde forme prend le relais', async () => {
  reset();
  const timeline: string[] = [];
  await withMockTransport(
    router({
      [`GET /${ACC}/users/ada-lovelace`]: { status: 404, body: {} },
      [`GET /${ACC}/users/ACoAAadaLovelace1`]: { body: { id: 'ACoAAadaLovelace1', display_name: 'Ada Lovelace' } },
    }, timeline),
    async () => {
      const { status, body } = await call(await handleGetProfile(ACC, { profile_id: 'ACoAAadaLovelace1', profile_url: 'https://www.linkedin.com/in/ada-lovelace/' }));
      strictEqual(status, 200);
      strictEqual((body.profile as Record<string, unknown>).provider_id, 'ACoAAadaLovelace1');
    },
  );
  deepStrictEqual(timeline, [`GET /${ACC}/users/ada-lovelace`, `GET /${ACC}/users/ACoAAadaLovelace1`]);
  // Identifiant seul refusé et adresse valide : l'adresse sert.
  reset();
  await withMockTransport(router({ [`GET /${ACC}/users/ada-lovelace`]: { body: { id: 'ACoAAadaLovelace1' } } }), async () => {
    strictEqual((await call(await handleGetProfile(ACC, { profile_id: 'a b/c', profile_url: 'https://www.linkedin.com/in/ada-lovelace/' }))).status, 200);
  });
});

Deno.test('get_user_posts : publications avec les noms que lit l\'enrichissement', async () => {
  reset();
  const post = { id: 'p1', text: 'Bonjour', created_at: '2026-10-01T10:00:00Z', reactions_counter: [{ reaction: 'LIKE', count: 3 }, { reaction: 'PRAISE', count: 2 }], comments_counter: 4 };
  await withMockTransport(router({ [`GET /${ACC}/users/ada/posts`]: { body: { data: [post] } } }), async (mock) => {
    const { body } = await call(await handleGetUserPosts(ACC, { identifier: 'ada', limit: 500 }));
    const item = (body.items as Array<Record<string, unknown>>)[0];
    strictEqual(item.date, '2026-10-01T10:00:00Z');
    strictEqual(item.reaction_counter, 5);
    strictEqual(item.comment_counter, 4);
    strictEqual(mock.calls[0].query.get('limit'), '50');
    strictEqual((await call(await handleGetUserPosts(ACC, {}))).status, 400);
  });
  strictEqual(toLegacyPost(null).reaction_counter, null);
});

Deno.test('endorse_skill : identifiant de compétence en texte, pas de reprise', async () => {
  reset();
  await withMockTransport(router({ [`POST /${ACC}/linkedin/member/ACoAAada/endorse-skill`]: { body: { object: 'SkillEndorsed' } } }), async (mock) => {
    const { body } = await call(await handleEndorseSkill(ACC, { profile_id: 'ACoAAada', skill_endorsement_id: 42 }));
    deepStrictEqual(body, { object: 'SkillEndorsed', success: true });
    deepStrictEqual(mock.calls[0].body, { skill_id: '42' });
    strictEqual((await call(await handleEndorseSkill(ACC, { profile_id: 'x' }))).status, 400);
  });
  await withMockTransport(router({ [`POST /${ACC}/linkedin/member/m1/endorse-skill`]: { status: 503, body: {} } }), async (mock) => {
    const { status, body } = await call(await handleEndorseSkill(ACC, { profile_id: 'm1', skill_endorsement_id: 1 }));
    strictEqual(status, 502);
    strictEqual(body.errorType, 'UNCERTAIN');
    strictEqual(mock.calls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

const chat = (id: string, stamp: string, extra: Record<string, unknown> = {}) => ({
  object: 'Chat', id, type: '1to1', is_1to1: true, user_id: `ACoAA${id}`, last_message_timestamp: stamp, unread_count: 0,
  user: { id: `ACoAA${id}`, display_name: `Nom ${id}`, public_identifier: `nom-${id}` }, ...extra,
});

Deno.test('get_chats : toutes les boîtes du compte, fusionnées, dédoublonnées, triées, avec un curseur par boîte', async () => {
  reset();
  await withMockTransport(
    router({
      [`GET /${ACC}/inboxes`]: { body: { data: [{ object: 'Inbox', id: 'inbox_rec', description: 'Recruiter', disabled: false }, { object: 'Inbox', id: 'inbox_cls', description: 'Classic', disabled: false }, { object: 'Inbox', id: 'inbox_off', disabled: true }] } },
      [`GET /${ACC}/inboxes/inbox_rec/chats`]: { body: { data: [chat('a', '2026-10-01T10:00:00Z'), chat('b', '2026-10-03T10:00:00Z')], next_cursor: 'rec2' } },
      [`GET /${ACC}/inboxes/inbox_cls/chats`]: { body: { data: [chat('b', '2026-10-03T10:00:00Z'), chat('c', '2026-10-02T10:00:00Z')] } },
    }),
    async (mock) => {
      const { status, body } = await call(await handleGetChats(ACC, { limit: 50 }));
      strictEqual(status, 200);
      deepStrictEqual((body.chats as Array<{ id: string }>).map((c) => c.id), ['b', 'c', 'a']);
      deepStrictEqual(body.cursors, { inbox_rec: 'rec2', inbox_cls: null });
      strictEqual(body.cursor, '__has_more__');
      const first = (body.chats as Array<Record<string, unknown>>)[0];
      strictEqual(first.account_id, ACC);
      deepStrictEqual(first.folder, ['INBOX_LINKEDIN_RECRUITER']);
      strictEqual((first.attendees as Array<Record<string, unknown>>)[0].id, 'ACoAAb');
      strictEqual(first.attendee_provider_id, 'ACoAAb');
      ok(!mock.calls.some((c) => c.path.includes('chat_attendees')), 'plus d\'appel par chat');

      // Page suivante : la boîte épuisée n'est pas relue.
      mock.calls.length = 0;
      const next = (await call(await handleGetChats(ACC, { limit: 50, cursors: body.cursors }))).body;
      strictEqual(mock.calls.filter((c) => c.path.endsWith('/chats')).length, 1);
      strictEqual(mock.calls.find((c) => c.path.endsWith('/chats'))!.query.get('cursor'), 'rec2');
      ok(next.success === true);
    },
  );
});

Deno.test('get_chats : une boîte en échec ne masque pas les autres, toutes en échec = indisponible', async () => {
  reset();
  const inboxes = { body: { data: [{ object: 'Inbox', id: 'i1', disabled: false }, { object: 'Inbox', id: 'i2', disabled: false }] } };
  await withMockTransport(
    router({
      [`GET /${ACC}/inboxes`]: inboxes,
      [`GET /${ACC}/inboxes/i1/chats`]: { status: 403, body: { detail: 'Unipile: not subscribed' } },
      [`GET /${ACC}/inboxes/i2/chats`]: { body: { data: [] } },
    }),
    async () => {
      const { status, body } = await call(await handleGetChats(ACC, {}));
      strictEqual(status, 200);
      strictEqual(body.success, true);
    },
  );
  reset();
  await withMockTransport(
    router({ [`GET /${ACC}/inboxes`]: inboxes, [`GET /${ACC}/inboxes/i1/chats`]: { status: 500, body: {} }, [`GET /${ACC}/inboxes/i2/chats`]: { status: 500, body: {} } }),
    async () => {
      const { status, body } = await call(await handleGetChats(ACC, {}));
      strictEqual(status, 502);
      strictEqual(body.success, false);
      strictEqual(body.error, 'Les conversations LinkedIn sont temporairement indisponibles.');
    },
  );
});

Deno.test('get_chats : des boîtes déjà parcourues ne provoquent aucun appel de liste, ni fausse panne', async () => {
  reset();
  await withMockTransport(
    router({ [`GET /${ACC}/inboxes`]: { body: { data: [{ object: 'Inbox', id: 'i1', disabled: false }] } } }),
    async (mock) => {
      const { body } = await call(await handleGetChats(ACC, { cursors: { i1: null } }));
      strictEqual(body.success, true);
      deepStrictEqual(body.chats, []);
      strictEqual(body.cursor, null);
      ok(!mock.calls.some((c) => c.path.endsWith('/chats')));
    },
  );
});

Deno.test('get_chats : un compte sans boîtes se lit globalement, et un décalage se suit par offset', async () => {
  reset();
  await withMockTransport(
    router({
      [`GET /${ACC}/inboxes`]: { status: 404, body: {} },
      [`GET /${ACC}/chats`]: [{ body: { data: [chat('a', '2026-10-01T10:00:00Z')], has_more: true } }, { body: { data: [chat('b', '2026-10-02T10:00:00Z')] } }],
    }),
    async (mock) => {
      const first = (await call(await handleGetChats(ACC, {}))).body;
      deepStrictEqual(first.cursors, { ALL: 'offset:1' });
      await handleGetChats(ACC, { cursors: first.cursors });
      const reads = mock.calls.filter((c) => c.path === `/${ACC}/chats`);
      strictEqual(reads[1].query.get('offset'), '1');
      strictEqual(reads[1].query.get('cursor'), null);
    },
  );
});

Deno.test('get_chats raw : identité de l\'interlocuteur sans appel de plus, avec le nombre de non lus', async () => {
  reset();
  await withMockTransport(
    router({
      [`GET /${ACC}/inboxes`]: { body: { data: [{ object: 'Inbox', id: 'i1', disabled: false }] } },
      [`GET /${ACC}/inboxes/i1/chats`]: { body: { data: [chat('a', '2026-10-01T10:00:00Z', { unread_count: 2 })] } },
    }),
    async (mock) => {
      const { body } = await call(await handleGetChats(ACC, { raw: true, limit: 40 }));
      deepStrictEqual((body.chats as unknown[])[0], {
        id: 'a', attendee_provider_id: 'ACoAAa', name: null, timestamp: '2026-10-01T10:00:00Z', folder: [], unread_count: 2,
        attendees: [{ name: 'Nom a', provider_id: 'ACoAAa', id: 'ACoAAa', is_self: 0 }],
      });
      strictEqual(mock.calls.length, 2);
    },
  );
});

Deno.test('get_chats d\'un candidat : aucune conversation est une absence normale, une vraie panne reste une erreur', async () => {
  reset();
  const lookup = `GET /${ACC}/users/ACoAAcand/chat`;
  await withMockTransport(router({ [lookup]: { body: { object: 'ChatLookup', data: [] } } }), async () => {
    deepStrictEqual((await call(await handleGetChats(ACC, { attendee_provider_id: 'ACoAAcand' }))).body, { success: true, chats: [], cursor: null });
  });
  for (const status of [401, 403, 404, 429, 500, 503]) {
    await withMockTransport(router({ [lookup]: { status, body: { detail: 'Attendee not found' } } }), async () => {
      const response = await call(await handleGetChats(ACC, { attendee_provider_id: 'ACoAAcand' }));
      strictEqual(response.status, 200, `statut ${status}`);
      strictEqual(response.body.success, false, `statut ${status}`);
      deepStrictEqual(response.body.chats, []);
    });
  }
});

Deno.test('get_chats d\'un candidat : les conversations trouvées sont lues une à une, la page suivante est la fin', async () => {
  reset();
  await withMockTransport(
    router({
      [`GET /${ACC}/users/ACoAAcand/chat`]: { body: { data: [{ chat_id: 'c1', inbox_id: 'i1' }, { chat_id: 'c2' }] } },
      [`GET /${ACC}/chats/c1`]: { body: chat('c1', '2026-10-01T10:00:00Z') },
      [`GET /${ACC}/chats/c2`]: { status: 404, body: {} },
    }),
    async (mock) => {
      const { body } = await call(await handleGetChats(ACC, { attendee_provider_id: 'ACoAAcand' }));
      strictEqual((body.chats as unknown[]).length, 1);
      strictEqual(body.cursor, null);
      const before = mock.calls.length;
      deepStrictEqual((await call(await handleGetChats(ACC, { attendee_provider_id: 'ACoAAcand', cursor: 'next' }))).body, { success: true, chats: [], cursor: null });
      strictEqual(mock.calls.length, before);
    },
  );
  await withMockTransport(
    router({ [`GET /${ACC}/users/ACoAAcand/chat`]: { body: { data: [{ chat_id: 'c1' }] } }, [`GET /${ACC}/chats/c1`]: { status: 500, body: {} } }),
    async () => {
      const response = await call(await handleGetChats(ACC, { attendee_provider_id: 'ACoAAcand' }));
      strictEqual(response.body.success, false);
    },
  );
});

Deno.test('curseurs de liste : curseur du prestataire, décalage, fin de liste', () => {
  deepStrictEqual(readPageCursor('abc'), { cursor: 'abc' });
  deepStrictEqual(readPageCursor('offset:40'), { offset: 40 });
  deepStrictEqual(readPageCursor(undefined), {});
  deepStrictEqual(readPageCursor(null), {});
  const page = (extra: Record<string, unknown>, n = 3) => ({ items: Array(n).fill({}), nextCursor: null, totalCount: null, hasMore: null, ...extra });
  strictEqual(nextPageCursor(page({ nextCursor: 'n' }), 0), 'n');
  strictEqual(nextPageCursor(page({ hasMore: true }), 10), 'offset:13');
  strictEqual(nextPageCursor(page({ totalCount: 20 }), 10), 'offset:13');
  strictEqual(nextPageCursor(page({ totalCount: 13 }), 10), null);
  strictEqual(nextPageCursor(page({}), 0), null, 'une page pleine n\'est pas une preuve');
  strictEqual(nextPageCursor(page({ hasMore: true }, 0), 0), null);
});

Deno.test('get_messages : forme de message conservée, curseur de page, identifiant de conversation contrôlé', async () => {
  reset();
  const message = { object: 'Message', id: 'm1', chat_id: 'c1', sender_id: 'ACoAAa', text: 'Bonjour', timestamp: '2026-10-01T10:00:00Z', is_sender: false, is_seen: true, specifics: { type: 'INMAIL', subject: 'Objet' } };
  await withMockTransport(router({ [`GET /${ACC}/chats/c1/messages`]: { body: { data: [message], next_cursor: 'm2' } } }), async (mock) => {
    const { body } = await call(await handleGetMessages(ACC, { chat_id: 'c1', limit: 500, cursor: 'm1c' }));
    const item = (body.messages as Array<Record<string, unknown>>)[0];
    strictEqual(item.text, 'Bonjour');
    strictEqual(item.subject, 'Objet');
    strictEqual(item.message_type, 'INMAIL');
    strictEqual(item.seen, 1);
    strictEqual(item.account_id, ACC);
    strictEqual(body.cursor, 'm2');
    strictEqual(mock.calls[0].query.get('limit'), '100');
    strictEqual(mock.calls[0].query.get('cursor'), 'm1c');
    strictEqual((await call(await handleGetMessages(ACC, {}))).status, 400);
    let thrown: unknown;
    try {
      await handleGetMessages(ACC, { chat_id: '../accounts' });
    } catch (e) {
      thrown = e;
    }
    ok(thrown instanceof UnipileInputError);
    strictEqual(mock.calls.length, 1);
  });
  await withMockTransport(router({ [`GET /${ACC}/chats/c9/messages`]: { status: 500, body: { detail: 'Unipile boom' } } }), async () => {
    const { status, body } = await call(await handleGetMessages(ACC, { chat_id: 'c9' }));
    strictEqual(status, 502);
    deepStrictEqual(body.messages, []);
    ok(!/unipile/i.test(JSON.stringify(body)));
  });
});

Deno.test('mark_as_read : la conversation est marquée lue, sans compte dans le corps', async () => {
  reset();
  await withMockTransport(router({ [`PATCH /${ACC}/chats/c1`]: { body: chat('c1', '2026-10-01T10:00:00Z') } }), async (mock) => {
    deepStrictEqual((await call(await handleMarkAsRead(ACC, { chat_id: 'c1' }))).body, { success: true });
    deepStrictEqual(mock.calls[0].body, { read_status: true });
  });
});

Deno.test('sync_chat_history : plus de resynchronisation, la conversation est seulement vérifiée', async () => {
  reset();
  await withMockTransport(router({ [`GET /${ACC}/chats/c1`]: { body: chat('c1', '2026-10-01T10:00:00Z') }, [`GET /${ACC}/chats/gone`]: { status: 404, body: {} } }), async () => {
    deepStrictEqual((await call(await handleSyncChatHistory(ACC, { chat_id: 'c1' }))).body, { success: true, status: 'SYNC_DONE', chat_id: 'c1' });
    deepStrictEqual((await call(await handleSyncChatHistory(ACC, { chat_id: 'gone' }))).body, { success: true, status: 'CHAT_DELETED', chat_id: 'gone' });
  });
});

// ---------------------------------------------------------------------------
// Envois
// ---------------------------------------------------------------------------

const STARTED = { object: 'ChatStarted', chat_id: 'chat_new', message_id: 'msg_1' };

Deno.test('send_message dans une conversation : marqueur avant l\'envoi, enregistrement après, identifiant du message', async () => {
  reset();
  const timeline: string[] = [];
  const admin = fakeAdmin({ link: { candidate_id: 'ACoAAcand', candidate_ids: [], candidate_slug: 'cand' } }, timeline);
  await withMockTransport(
    router({ [`POST /${ACC}/chats/c1/messages/send`]: { body: { object: 'MessageSent', message_id: ['m1', 'm2'] } } }, timeline),
    async (mock) => {
      const { status, body } = await call(await handleSendMessage(ACC, { chat_id: 'c1', text: '  Bonjour  ' }, sendContext(admin, {}), ));
      strictEqual(status, 200);
      strictEqual(body.success, true);
      deepStrictEqual(body.message, { object: 'MessageSent', message_id: 'm1', message_ids: ['m1', 'm2'], chat_id: 'c1' });
      deepStrictEqual(mock.calls[0].body, { text: 'Bonjour' });
    },
  );
  deepStrictEqual(timeline, ['rpc record_candidate_outbound pending', `POST /${ACC}/chats/c1/messages/send`, 'rpc record_candidate_outbound']);
  const record = admin.rpcCalls[1].args;
  strictEqual(record.p_message_id, 'm1');
  strictEqual(record.p_chat_id, 'c1');
  strictEqual(record.p_account_id, ACC);
  strictEqual(record.p_pending, false);
});

Deno.test('send_message nouvelle conversation : users_ids en texte, id de conversation pris dans la réponse', async () => {
  reset();
  const admin = fakeAdmin();
  await withMockTransport(
    router({ [`GET /${ACC}/inboxes`]: { status: 404, body: {} }, [`POST /${ACC}/chats/send`]: { body: STARTED } }),
    async (mock) => {
      const { body } = await call(await handleSendMessage(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour', project_id: 'project:11111111-1111-4111-8111-111111111111' }, sendContext(admin)));
      deepStrictEqual(body.message, { object: 'ChatStarted', message_id: 'msg_1', message_ids: ['msg_1'], chat_id: 'chat_new' });
      const post = mock.calls.find((c) => c.method === 'POST')!;
      deepStrictEqual(post.body, { text: 'Bonjour', users_ids: 'ACoAAcand' });
    },
  );
  strictEqual(admin.rpcCalls[0].args.p_pending, true);
  strictEqual(admin.rpcCalls[1].args.p_chat_id, 'chat_new');
  strictEqual(admin.rpcCalls[1].args.p_project_id, '11111111-1111-4111-8111-111111111111');
  strictEqual(admin.rpcCalls[1].args.p_send_kind, 'message');
});

Deno.test('send_message : une boîte unique est utilisée, et refusée elle cède la place à la route sans boîte', async () => {
  reset();
  const timeline: string[] = [];
  await withMockTransport(
    router({
      [`GET /${ACC}/inboxes`]: { body: { data: [{ object: 'Inbox', id: 'inb1', disabled: false }] } },
      [`POST /${ACC}/inboxes/inb1/chats/send`]: { status: 400, body: { detail: 'bad route' } },
      [`POST /${ACC}/chats/send`]: { body: STARTED },
    }, timeline),
    async () => {
      const { body } = await call(await handleSendMessage(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour' }, sendContext(fakeAdmin())));
      strictEqual(body.success, true);
    },
  );
  deepStrictEqual(timeline.filter((k) => k.startsWith('POST')), [`POST /${ACC}/inboxes/inb1/chats/send`, `POST /${ACC}/chats/send`]);
});

Deno.test('send_message InMail Recruiter : objet et signature du profil, route par la boîte Recruiter', async () => {
  reset();
  const admin = fakeAdmin({ displayName: 'Claire Dubois' });
  await withMockTransport(
    router({
      [`GET /${ACC}/linkedin/contracts`]: { body: RECRUITER },
      [`GET /${ACC}/inboxes`]: { body: { data: [{ object: 'Inbox', id: 'i_cls', description: 'Classic', disabled: false }, { object: 'Inbox', id: 'i_rec', description: 'Recruiter', disabled: false }] } },
      [`POST /${ACC}/inboxes/i_rec/chats/send`]: { body: STARTED },
    }),
    async (mock) => {
      const { body } = await call(await handleSendMessage(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour', is_inmail: true, subject: 'Un rôle' }, sendContext(admin)));
      strictEqual(body.success, true);
      const post = mock.calls.find((c) => c.method === 'POST')!;
      deepStrictEqual(post.body, {
        text: 'Bonjour', users_ids: 'ACoAAcand',
        specifics: { linkedin: { recruiter: { subject: 'Un rôle', signature: 'Claire Dubois' } } },
      });
    },
  );
  strictEqual(admin.rpcCalls[0].args.p_send_kind, 'inmail');
});

Deno.test('send_message InMail : Sales Navigator avec objet, Classic sans objet, objet obligatoire sinon, rien avant la vérification', async () => {
  reset();
  await withMockTransport(
    router({
      [`GET /${ACC}/linkedin/contracts`]: { body: SALES },
      [`GET /${ACC}/inboxes`]: { status: 404, body: {} },
      [`POST /${ACC}/chats/send`]: { body: STARTED },
    }),
    async (mock) => {
      await handleSendMessage(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour', is_inmail: true, subject: 'Objet' }, sendContext(fakeAdmin()));
      deepStrictEqual((mock.calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>).specifics, { linkedin: { sales_navigator: { subject: 'Objet' } } });
      mock.calls.length = 0;
      const admin = fakeAdmin();
      const refused = await call(await handleSendMessage(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour', is_inmail: true }, sendContext(admin)));
      strictEqual(refused.status, 400);
      strictEqual(refused.body.error, 'Renseignez l’objet de l’InMail.');
      ok(!mock.calls.some((c) => c.method === 'POST'));
      strictEqual(admin.rpcCalls.length, 0, 'aucun marqueur pour un envoi qui ne part pas');
    },
  );
  reset();
  await withMockTransport(
    router({ [`GET /${ACC}/linkedin/contracts`]: { body: contracts() }, [`GET /${ACC}/inboxes`]: { status: 404, body: {} }, [`POST /${ACC}/chats/send`]: { body: STARTED } }),
    async (mock) => {
      await handleSendMessage(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour', is_inmail: true, subject: 'ignoré' }, sendContext(fakeAdmin()));
      deepStrictEqual((mock.calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>).specifics, { linkedin: { classic: { inmail: true } } });
    },
  );
});

Deno.test('send_message InMail Recruiter sans nom de profil : refus clair, aucun envoi', async () => {
  reset();
  await withMockTransport(router({ [`GET /${ACC}/linkedin/contracts`]: { body: RECRUITER } }), async (mock) => {
    const { status, body } = await call(await handleSendMessage(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour', is_inmail: true, subject: 'Objet' }, sendContext(fakeAdmin({ displayName: null }))));
    strictEqual(status, 400);
    ok(/signe l’InMail/.test(body.error as string));
    ok(!mock.calls.some((c) => c.method === 'POST'));
  });
});

Deno.test('send_message incertain : jamais enregistré comme envoyé, jamais repris, texte neutre', async () => {
  reset();
  const admin = fakeAdmin();
  for (const reply of [{ status: 503, body: { detail: 'Unipile down' } }, { status: 200, text: '<html>' }] as MockReply[]) {
    admin.rpcCalls.length = 0;
    await withMockTransport(router({ [`POST /${ACC}/chats/c1/messages/send`]: reply }), async (mock) => {
      const { status, body } = await call(await handleSendMessage(ACC, { chat_id: 'c1', text: 'Bonjour', recipient_id: 'ACoAAcand' }, sendContext(admin)));
      strictEqual(status, 502);
      strictEqual(body.errorType, 'UNCERTAIN');
      ok(!/unipile|html/i.test(JSON.stringify(body)));
      // La conversation sans lien est lue une fois (interlocuteur du destinataire à contrôler), l'envoi une seule.
      strictEqual(mock.calls.filter((c) => c.method === 'POST').length, 1, 'aucune reprise');
    });
    deepStrictEqual(admin.rpcCalls.map((c) => c.args.p_pending), [true], 'le marqueur seul, pas de « Contacté »');
  }
});

Deno.test('send_message refusé (limite, compte, destinataire) : réponse en français, aucun enregistrement', async () => {
  reset();
  for (const [reply, status, errorType] of [
    [{ status: 429, body: { detail: 'weekly invitation limit' } }, 429, 'RATE_LIMIT'],
    [{ status: 401, body: { detail: 'account disconnected, reconnect' } }, 502, 'ACCOUNT_DISCONNECTED'],
    [{ status: 422, body: { detail: 'invalid user' } }, 400, 'INVALID_REQUEST'],
  ] as Array<[MockReply, number, string]>) {
    const admin = fakeAdmin();
    await withMockTransport(router({ [`POST /${ACC}/chats/c1/messages/send`]: reply }), async () => {
      const response = await call(await handleSendMessage(ACC, { chat_id: 'c1', text: 'Bonjour', recipient_id: 'ACoAAcand' }, sendContext(admin)));
      strictEqual(response.status, status);
      strictEqual(response.body.errorType, errorType);
      ok(!/unipile/i.test(JSON.stringify(response.body)));
    });
    deepStrictEqual(admin.rpcCalls.map((c) => c.args.p_pending), [true]);
  }
});

/** Refus d'un envoi (UnipileInputError du contrôle du destinataire) : statut, code et texte, ou échec du test si rien n'est refusé. */
async function refusedSend(run: () => Promise<unknown>): Promise<{ status: number; code: string | undefined; message: string }> {
  try {
    await run();
  } catch (e) {
    if (e instanceof UnipileInputError) return { status: e.status, code: e.code, message: e.message };
    throw e;
  }
  throw new Error('envoi non refusé');
}

const SENT = { object: 'MessageSent', message_id: 'm1' };

Deno.test('send_message : un candidat effacé (nouvelle conversation) est refusé 403 avant tout appel, marqueur et lecture de licence', async () => {
  reset();
  const timeline: string[] = [];
  const admin = fakeAdmin({ erased: true }, timeline);
  await withMockTransport(router({ [`POST /${ACC}/chats/send`]: { body: STARTED } }, timeline), async (mock) => {
    const refused = await refusedSend(() => handleSendMessage(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour' }, sendContext(admin)));
    deepStrictEqual(refused, { status: 403, code: 'CANDIDATE_ERASED', message: SEND_ERASED_MESSAGE });
    // Même refus par le plan, qui précède le plafond LinkedIn dans le point d'entrée.
    const planned = await refusedSend(() => planSend(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour' }, sendContext(admin)));
    strictEqual(planned.code, 'CANDIDATE_ERASED');
    // InMail : le candidat est jugé avant la lecture du contrat (aucun appel au prestataire).
    const inmail = await refusedSend(() => handleSendMessage(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour', is_inmail: true, subject: 'Objet' }, sendContext(admin)));
    strictEqual(inmail.code, 'CANDIDATE_ERASED');
    strictEqual(mock.calls.length, 0, 'aucun appel au prestataire');
  });
  strictEqual(admin.rpcCalls.length, 0, 'aucun marqueur');
  ok(!/unipile|linkedin/i.test(SEND_ERASED_MESSAGE));
});

Deno.test('send_message : le candidat de la conversation prime sur recipient_id, lien de la mission puis interlocuteur lu chez le prestataire', async () => {
  reset();
  // Lien de la mission : le candidat effacé est celui du lien, recipient_id désigne un autre candidat.
  const linked = fakeAdmin({ erased: ['ACoAAerased'], link: { candidate_id: 'ACoAAerased', candidate_ids: [], candidate_slug: 'erased' } });
  await withMockTransport(router({ [`POST /${ACC}/chats/c1/messages/send`]: { body: SENT } }), async (mock) => {
    const refused = await refusedSend(() => handleSendMessage(ACC, { chat_id: 'c1', recipient_id: 'ACoAAfine', text: 'Bonjour' }, sendContext(linked)));
    deepStrictEqual([refused.status, refused.code], [403, 'CANDIDATE_ERASED']);
    strictEqual(mock.calls.length, 0, 'ni lecture de la conversation (lien connu) ni envoi');
  });
  strictEqual(linked.rpcCalls.length, 0);

  // Sans lien : l'interlocuteur lu sous le compte de la requête (identifiant ACoAAc1).
  const readChat = { [`GET /${ACC}/chats/c1`]: { body: chat('c1', '2026-10-01T10:00:00Z') }, [`POST /${ACC}/chats/c1/messages/send`]: { body: SENT } };
  const read = fakeAdmin({ erased: ['ACoAAc1'] });
  await withMockTransport(router(readChat), async (mock) => {
    const refused = await refusedSend(() => handleSendMessage(ACC, { chat_id: 'c1', recipient_id: 'ACoAAfine', text: 'Bonjour' }, sendContext(read)));
    deepStrictEqual([refused.status, refused.code], [403, 'CANDIDATE_ERASED']);
    deepStrictEqual(mock.calls.map((c) => c.method), ['GET'], 'une lecture, aucun envoi');
  });
  strictEqual(read.rpcCalls.length, 0);

  // Le recipient_id effacé ne compte pas dans une conversation : le message part vers l'interlocuteur, enregistré pour lui.
  const fine = fakeAdmin({ erased: ['ACoAAerased'] });
  await withMockTransport(router(readChat), async () => {
    strictEqual((await call(await handleSendMessage(ACC, { chat_id: 'c1', recipient_id: 'ACoAAerased', text: 'Bonjour' }, sendContext(fine)))).body.success, true);
  });
  deepStrictEqual((fine.rpcCalls[0].args.p_candidate as { ids: string[] }).ids, ['ACoAAc1']);
});

Deno.test('send_message : le candidat est cherché sous le chat_id que l\'envoi utilise, y compris un identifiant qui contient un %', async () => {
  reset();
  // Aucun décodage entre le contrôle et l'envoi : « %63hat » est un identifiant de conversation, pas « chat ».
  const admin = fakeAdmin({ link: { candidate_id: 'ACoAAcand', candidate_ids: [], candidate_slug: 'cand' } });
  await withMockTransport(router({ [`POST /${ACC}/chats/%2563hat1/messages/send`]: { body: SENT } }), async (mock) => {
    strictEqual((await call(await handleSendMessage(ACC, { chat_id: ' %63hat1 ', text: 'Bonjour' }, sendContext(admin)))).body.success, true);
    const post = mock.calls.find((c) => c.method === 'POST')!;
    strictEqual(decodeURIComponent(post.path).endsWith('/chats/%63hat1/messages/send'), true, post.path);
  });
  const lookups = admin.eqCalls.filter((c) => c.table === 'mission_conversations' && c.column === 'chat_id');
  deepStrictEqual(lookups.map((c) => c.value), ['%63hat1'], 'le lien est lu sous l\'identifiant que l\'envoi utilise');
  strictEqual(admin.rpcCalls[0].args.p_chat_id, '%63hat1');
});

Deno.test('send_message : un registre d\'effacement illisible refuse l\'envoi 503, jamais un passage silencieux', async () => {
  reset();
  for (const params of [{ recipient_id: 'ACoAAcand' }, { chat_id: 'c1', recipient_id: 'ACoAAcand' }]) {
    const admin = fakeAdmin({ unreadableRegister: true });
    await withMockTransport(router({ [`POST /${ACC}/chats/c1/messages/send`]: { body: SENT }, [`POST /${ACC}/chats/send`]: { body: STARTED } }), async (mock) => {
      const refused = await refusedSend(() => handleSendMessage(ACC, { ...params, text: 'Bonjour' }, sendContext(admin)));
      deepStrictEqual(refused, { status: 503, code: 'GDPR_UNVERIFIED', message: SEND_GDPR_UNVERIFIED_MESSAGE });
      ok(!mock.calls.some((c) => c.method === 'POST'), 'aucun envoi');
    });
    strictEqual(admin.rpcCalls.length, 0, 'aucun marqueur');
  }
});

Deno.test('send_message : un recipient_id donné par nom court ou adresse de profil est contrôlé par ce profil', async () => {
  reset();
  const pipeline = [{ candidate_id: 'ACoAAerased', linkedin_profile_url: 'https://www.linkedin.com/in/ada-erased' }];
  for (const recipient_id of ['ada-erased', 'https://www.linkedin.com/in/ada-erased/']) {
    const admin = fakeAdmin({ erased: ['ACoAAerased'], pipeline });
    await withMockTransport(router({}), async (mock) => {
      const refused = await refusedSend(() => handleSendMessage(ACC, { recipient_id, text: 'Bonjour' }, sendContext(admin)));
      strictEqual(refused.code, 'CANDIDATE_ERASED', recipient_id);
      strictEqual(mock.calls.length, 0);
    });
    strictEqual(admin.rpcCalls.length, 0);
  }
  // Un profil qui n'est pas au registre reste joignable.
  const other = fakeAdmin({ erased: ['ACoAAerased'], pipeline });
  await withMockTransport(router({ [`GET /${ACC}/inboxes`]: { status: 404, body: {} }, [`POST /${ACC}/chats/send`]: { body: STARTED } }), async () => {
    strictEqual((await call(await handleSendMessage(ACC, { recipient_id: 'grace-fine', text: 'Bonjour' }, sendContext(other)))).body.success, true);
  });
});

Deno.test('send_message : un nom public effacé ne passe pas avec l\'adresse d\'un autre profil dans recipient_profile_url', async () => {
  reset();
  const pipeline = [{ candidate_id: 'ACoAAerased', linkedin_profile_url: 'https://www.linkedin.com/in/ada-erased' }];
  // L'envoi suit le nom public de recipient_id (userRef) : l'adresse d'un profil non effacé ne doit pas masquer ce candidat.
  for (const recipient_id of ['ada-erased', 'https://www.linkedin.com/in/ada-erased']) {
    const admin = fakeAdmin({ erased: ['ACoAAerased'], pipeline });
    await withMockTransport(router({ [`POST /${ACC}/chats/send`]: { body: STARTED } }), async (mock) => {
      const refused = await refusedSend(() => handleSendMessage(ACC, { recipient_id, recipient_profile_url: 'https://www.linkedin.com/in/grace-fine', text: 'Bonjour' }, sendContext(admin)));
      strictEqual(refused.code, 'CANDIDATE_ERASED', recipient_id);
      ok(!mock.calls.some((c) => c.method === 'POST'), 'aucun envoi');
    });
    strictEqual(admin.rpcCalls.length, 0, 'aucun marqueur');
  }
});

Deno.test('send_message : un interlocuteur connu par son seul nom public ou son adresse est jugé par cette identité', async () => {
  reset();
  const pipeline = [{ candidate_id: 'ACoAAerased', linkedin_profile_url: 'https://www.linkedin.com/in/ada-erased' }];
  const bare = (user: Record<string, unknown>) => ({
    [`GET /${ACC}/chats/c1`]: { body: { object: 'Chat', id: 'c1', type: '1to1', is_1to1: true, last_message_timestamp: '2026-10-01T10:00:00Z', user } },
    [`POST /${ACC}/chats/c1/messages/send`]: { body: SENT },
  });
  // Pas de user_id : le nom public ou l'adresse désigne un candidat effacé, l'envoi est refusé.
  for (const user of [{ public_identifier: 'ada-erased' }, { profile_url: 'https://www.linkedin.com/in/ada-erased' }]) {
    const admin = fakeAdmin({ erased: ['ACoAAerased'], pipeline });
    await withMockTransport(router(bare(user)), async (mock) => {
      const refused = await refusedSend(() => handleSendMessage(ACC, { chat_id: 'c1', text: 'Bonjour' }, sendContext(admin)));
      strictEqual(refused.code, 'CANDIDATE_ERASED', JSON.stringify(user));
      ok(!mock.calls.some((c) => c.method === 'POST'), 'aucun envoi');
    });
    strictEqual(admin.rpcCalls.length, 0);
  }
  // Lien de mission avec le seul nom public : même jugement, sans lire la conversation.
  const linked = fakeAdmin({ erased: ['ACoAAerased'], pipeline, link: { candidate_id: null, candidate_ids: [], candidate_slug: 'ada-erased' } });
  await withMockTransport(router(bare({ public_identifier: 'grace-fine' })), async (mock) => {
    const refused = await refusedSend(() => handleSendMessage(ACC, { chat_id: 'c1', text: 'Bonjour' }, sendContext(linked)));
    strictEqual(refused.code, 'CANDIDATE_ERASED');
    strictEqual(mock.calls.length, 0);
  });
  // Un profil connu de même façon qui n'est pas au registre part, sans enregistrement faute d'identifiant.
  const fine = fakeAdmin({ erased: ['ACoAAerased'], pipeline });
  await withMockTransport(router(bare({ public_identifier: 'grace-fine' })), async () => {
    strictEqual((await call(await handleSendMessage(ACC, { chat_id: 'c1', text: 'Bonjour' }, sendContext(fine)))).body.success, true);
  });
  strictEqual(fine.rpcCalls.length, 0, 'rien à enregistrer sans identifiant');
});

Deno.test('send_message : une lecture de conversation en panne passagère refuse l\'envoi 503 (échec fermé), un refus du prestataire laisse l\'envoi rendre sa propre erreur', async () => {
  reset();
  // Réseau, 5xx et limite : l'interlocuteur est inconnu, son effacement ne peut pas être vérifié, rien ne part ni ne s'écrit.
  for (const status of [503, 502, 429]) {
    const admin = fakeAdmin();
    await withMockTransport(router({ [`GET /${ACC}/chats/c1`]: { status, body: {} }, [`POST /${ACC}/chats/c1/messages/send`]: { body: SENT } }), async (mock) => {
      const refused = await refusedSend(() => handleSendMessage(ACC, { chat_id: 'c1', text: 'Bonjour' }, sendContext(admin)));
      deepStrictEqual(refused, { status: 503, code: 'GDPR_UNVERIFIED', message: SEND_GDPR_UNVERIFIED_MESSAGE }, String(status));
      ok(!mock.calls.some((c) => c.method === 'POST'), `aucun envoi (${status})`);
    });
    strictEqual(admin.rpcCalls.length, 0, `aucun marqueur (${status})`);
  }
  // Conversation introuvable chez le prestataire : pas une panne passagère, l'envoi suit son cours et rend sa propre erreur.
  const gone = fakeAdmin();
  await withMockTransport(router({ [`GET /${ACC}/chats/c1`]: { status: 404, body: {} } }), async (mock) => {
    const { status } = await call(await handleSendMessage(ACC, { chat_id: 'c1', text: 'Bonjour' }, sendContext(gone)));
    ok(status >= 400, String(status));
    ok(mock.calls.some((c) => c.method === 'POST'), 'l\'envoi a été tenté et refusé par le prestataire');
  });
});

Deno.test('send_message : un candidat non effacé part et s\'enregistre comme avant', async () => {
  reset();
  const timeline: string[] = [];
  const admin = fakeAdmin({ erased: ['ACoAAsomeoneelse'] }, timeline);
  await withMockTransport(
    router({ [`GET /${ACC}/inboxes`]: { status: 404, body: {} }, [`POST /${ACC}/chats/send`]: { body: STARTED } }, timeline),
    async () => {
      const { status, body } = await call(await handleSendMessage(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour' }, sendContext(admin)));
      strictEqual(status, 200);
      strictEqual(body.success, true);
    },
  );
  deepStrictEqual(timeline.filter((k) => k.startsWith('rpc') || k.startsWith('POST')), ['rpc record_candidate_outbound pending', `POST /${ACC}/chats/send`, 'rpc record_candidate_outbound']);
});

Deno.test('send_message dans une conversation sans lien : le candidat est l\'interlocuteur lu sous le compte de la requête', async () => {
  reset();
  const admin = fakeAdmin();
  await withMockTransport(
    router({
      [`GET /${ACC}/chats/c1`]: { body: chat('c1', '2026-10-01T10:00:00Z') },
      [`POST /${ACC}/chats/c1/messages/send`]: { body: { object: 'MessageSent', message_id: 'm1' } },
    }),
    async () => {
      await handleSendMessage(ACC, { chat_id: 'c1', text: 'Bonjour' }, sendContext(admin));
    },
  );
  const candidate = admin.rpcCalls[0].args.p_candidate as { ids: string[]; slug?: string };
  deepStrictEqual(candidate.ids, ['ACoAAc1']);
  strictEqual(candidate.slug, 'nom-c1');
});

Deno.test('send_message : un groupe n\'a pas de candidat, l\'envoi part sans enregistrement', async () => {
  reset();
  const admin = fakeAdmin();
  await withMockTransport(
    router({
      [`GET /${ACC}/chats/g1`]: { body: { id: 'g1', type: 'group', is_group: true } },
      [`POST /${ACC}/chats/g1/messages/send`]: { body: { object: 'MessageSent', message_id: 'm1' } },
    }),
    async () => {
      strictEqual((await call(await handleSendMessage(ACC, { chat_id: 'g1', text: 'Bonjour' }, sendContext(admin)))).body.success, true);
    },
  );
  strictEqual(admin.rpcCalls.length, 0);
});

Deno.test('send_message : entrées invalides refusées avant tout appel', async () => {
  reset();
  await withMockTransport(router({}), async (mock) => {
    const ctx = sendContext(fakeAdmin());
    strictEqual((await call(await handleSendMessage(ACC, { text: 'x' }, ctx))).status, 400);
    strictEqual((await call(await handleSendMessage(ACC, { chat_id: 'c1', text: '   ' }, ctx))).status, 400);
    strictEqual((await call(await handleSendMessage(ACC, { recipient_id: 'a b/c', text: 'x' }, ctx))).status, 400);
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('send_message : une conversation mal formée est refusée sans marqueur ni appel', async () => {
  reset();
  await withMockTransport(router({}), async (mock) => {
    const admin = fakeAdmin();
    for (const chat_id of ['bad/id', 'a b', 'x?y']) {
      const { status } = await call(await handleSendMessage(ACC, { chat_id, recipient_id: 'ACoAAcand', text: 'hi' }, sendContext(admin)));
      strictEqual(status, 400);
    }
    strictEqual(admin.rpcCalls.length, 0, 'aucun marqueur pour une demande qui n\'atteint jamais le prestataire');
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('planSend : objet, signature et conversation se jugent sans rien écrire ni envoyer', async () => {
  reset();
  await withMockTransport(router({ [`GET /${ACC}/linkedin/contracts`]: { body: RECRUITER } }), async (mock) => {
    const admin = fakeAdmin({ displayName: null });
    const ctx = { organizationId: 'org-1', userId: 'user-1', accountOwnerId: 'user-1', admin: () => admin };
    const noSubject = await planSend(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour', is_inmail: true }, ctx);
    ok(!noSubject.ok);
    strictEqual(noSubject.response.status, 400);
    const noName = await planSend(ACC, { recipient_id: 'ACoAAcand', text: 'Bonjour', is_inmail: true, subject: 'Objet' }, ctx);
    ok(!noName.ok);
    ok(!(await planSend(ACC, { chat_id: 'bad/id', text: 'x' }, ctx)).ok);
    const good = await planSend(ACC, { recipient_id: 'ACoAAcand', text: ' Bonjour ', is_inmail: true, subject: 'Objet', signature: 'Ada' }, ctx);
    ok(good.ok);
    strictEqual(good.plan.body, 'Bonjour');
    strictEqual(good.plan.kind, 'recruiter');
    strictEqual(admin.rpcCalls.length, 0);
    ok(!mock.calls.some((c) => c.method === 'POST'));
  });
});

Deno.test('send_message interne : source et auteur lus du corps, auteur d\'un appel utilisateur imposé', async () => {
  reset();
  const author = '22222222-2222-4222-8222-222222222222';
  const internal = fakeAdmin();
  await withMockTransport(router({ [`POST /${ACC}/chats/c1/messages/send`]: { body: { object: 'MessageSent', message_id: 'm1' } } }), async () => {
    await handleSendMessage(ACC, { chat_id: 'c1', text: 'x', recipient_id: 'ACoAAcand', source: 'assistant', created_by: author }, sendContext(internal, { isInternal: true, userId: '' }));
  });
  strictEqual(internal.rpcCalls[0].args.p_source, 'assistant');
  strictEqual(internal.rpcCalls[0].args.p_created_by, author);
  const user = fakeAdmin();
  await withMockTransport(router({ [`POST /${ACC}/chats/c1/messages/send`]: { body: { object: 'MessageSent', message_id: 'm1' } } }), async () => {
    await handleSendMessage(ACC, { chat_id: 'c1', text: 'x', recipient_id: 'ACoAAcand', source: 'assistant', created_by: author }, sendContext(user));
  });
  strictEqual(user.rpcCalls[0].args.p_source, 'manual');
  strictEqual(user.rpcCalls[0].args.p_created_by, 'user-1');
});

// Les réponses du prestataire sont des objets : un helper de test les range.
void jsonResponse;
