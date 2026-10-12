// The unipile-accounts actions through the request handler, against a fake database and a
// fake transport (no network, no real key).
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-accounts/handler.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { FakeDb } from '../_shared/connection-claim.testing.ts';
import { emptyResponse, fixtures, type MockHandler, type RecordedRequest, withMockTransport } from '../_shared/unipile/testing.ts';
import { handleRequest } from './handler.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PEER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STRANGER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MAPPING = '91111111-1111-4111-8111-111111111111';

type Route = ((request: RecordedRequest) => ReturnType<MockHandler>) | { status?: number; body?: unknown };

function router(routes: Record<string, Route>): MockHandler {
  return (request) => {
    const route = routes[`${request.method} ${request.path}`];
    if (!route) return { status: 404, body: { message: `not mocked: ${request.method} ${request.path}` } };
    return typeof route === 'function' ? route(request) : route;
  };
}

async function withEnv<T>(env: Record<string, string | null>, run: () => Promise<T> | T): Promise<T> {
  const before: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    before[key] = Deno.env.get(key);
    if (value === null) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

const ENV = { UNIPILE_V2_API_KEY: 'test-key', UNIPILE_HOSTED_DOMAIN: 'connect.konekt.test', APP_URL: 'https://app.konekt.test', CONNECTION_NATIVE_ENABLED: '1' };

/** The caller (USER) is a platform administrator: the only role that may list or claim an unlinked account. */
const ENV_PLATFORM = { ...ENV, KONEKT_PLATFORM_ADMIN_USER_IDS: USER };

function makeDb(extra: Record<string, Array<Record<string, unknown>>> = {}, role = 'admin'): FakeDb {
  const db = new FakeDb({
    organization_members: [
      { id: 'mem-user', organization_id: ORG, user_id: USER, role },
      { id: 'mem-peer', organization_id: ORG, user_id: PEER, role: 'member' },
      { id: 'mem-stranger', organization_id: OTHER_ORG, user_id: STRANGER, role: 'owner' },
    ],
    member_linkedin_accounts: [],
    member_email_accounts: [],
    member_whatsapp_accounts: [],
    connection_attempts: [],
    ...extra,
  });
  db.defaults('connection_attempts', () => ({ status: 'pending', intent_id: null, account_id: null, error_kind: null, created_at: new Date().toISOString(), completed_at: null }));
  db.unique('connection_attempts', ['user_id', 'provider'], { where: (row) => row.status === 'pending' });
  return db;
}

interface Reply {
  status: number;
  data: Record<string, any>;
  raw: string;
}

async function call(db: FakeDb, body: Record<string, unknown>, options: { userId?: string; org?: string | null } = {}): Promise<Reply> {
  const userId = options.userId ?? USER;
  const response = await handleRequest(
    new Request('https://supabase.fixture/functions/v1/unipile-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(options.org === null ? {} : { organization_id: options.org ?? ORG }), ...body }),
    }),
    { authenticate: () => Promise.resolve({ userId, method: 'jwt' }), createAdmin: () => db },
  );
  const raw = await response.text();
  return { status: response.status, data: raw ? JSON.parse(raw) : {}, raw };
}

/** No answer of the function may carry the provider name or a provider body. */
function assertNoVendor(reply: Reply, label = ''): void {
  ok(!/unipile/i.test(reply.raw), `${label} : nom du prestataire dans la réponse : ${reply.raw}`);
}

const wa = (id: string, overrides: Record<string, unknown> = {}) =>
  fixtures.account({ id, provider: 'whatsapp', name: '+33 6 12 34 56 78', ...overrides });

function whatsappDb(): FakeDb {
  return makeDb({
    member_whatsapp_accounts: [
      { id: 'w-own', organization_id: ORG, user_id: USER, whatsapp_account_id: 'acc_wa_own', name: 'Mon numéro', phone_number: '+33612345678', account_status: 'OK' },
      { id: 'w-peer', organization_id: ORG, user_id: PEER, whatsapp_account_id: 'acc_wa_peer', name: 'Collègue', phone_number: null, account_status: 'OK' },
      { id: 'w-foreign', organization_id: OTHER_ORG, user_id: STRANGER, whatsapp_account_id: 'acc_wa_foreign', name: 'Autre', phone_number: null, account_status: 'OK' },
    ],
    member_email_accounts: [
      { id: MAPPING, organization_id: ORG, user_id: USER, email_account_id: 'acc_mail_own', email_address: 'moi@exemple.fr', provider: 'GOOGLE_OAUTH' },
      { id: '92222222-2222-4222-8222-222222222222', organization_id: ORG, user_id: PEER, email_account_id: 'acc_mail_peer', email_address: 'collegue@exemple.fr', provider: 'OUTLOOK' },
      { id: '93333333-3333-4333-8333-333333333333', organization_id: OTHER_ORG, user_id: USER, email_account_id: 'acc_mail_foreign', email_address: 'x@exemple.fr', provider: 'MAIL' },
    ],
  });
}

// ---------------------------------------------------------------------------
// Gate: authentication, organisation, configuration, vocabulary of errors
// ---------------------------------------------------------------------------

Deno.test('l authentification refusée rend la réponse de refus telle quelle', async () => {
  const refusal = new Response('{"error":"Unauthorized"}', { status: 401 });
  const response = await handleRequest(new Request('https://x.test', { method: 'POST', body: '{}' }), {
    authenticate: () => Promise.reject(refusal),
    createAdmin: () => makeDb(),
  });
  strictEqual(response.status, 401);
});

Deno.test('un membre d une autre organisation est refusé avant toute action', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({}));
    try {
      const reply = await call(makeDb(), { action: 'list' }, { userId: STRANGER });
      strictEqual(reply.status, 403);
      strictEqual(mock.calls.length, 0);
      strictEqual((await call(makeDb(), { action: 'list' }, { org: null })).status, 400, 'aucune organisation active');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('action inconnue ou absente, corps illisible', async () => {
  await withEnv(ENV, async () => {
    strictEqual((await call(makeDb(), { action: 'nope' })).status, 400);
    strictEqual((await call(makeDb(), {})).status, 400);
    const response = await handleRequest(new Request('https://x.test', { method: 'POST', body: 'pas du json' }), {
      authenticate: () => Promise.resolve({ userId: USER, method: 'jwt' }),
      createAdmin: () => makeDb(),
    });
    strictEqual(response.status, 400);
  });
});

Deno.test('service non configuré : message neutre, sauf les actions qui n écrivent qu en base', async () => {
  await withEnv({ ...ENV, UNIPILE_V2_API_KEY: null }, async () => {
    const mock = withMockTransport(router({}));
    try {
      const db = whatsappDb();
      const list = await call(db, { action: 'list_whatsapp' });
      strictEqual(list.status, 200);
      strictEqual(list.data.success, false);
      ok(/WhatsApp/.test(list.data.error));
      strictEqual(list.data.error_code, 'config');
      const linkedin = await call(db, { action: 'list' });
      strictEqual(linkedin.data.success, false);
      strictEqual(linkedin.data.error_code, 'config');
      assertNoVendor(linkedin);
      strictEqual((await call(db, { action: 'connection_start', provider: 'whatsapp' })).data.success, false);

      // Hors fournisseur : lire les capacités, annuler, dissocier une boîte.
      const caps = await call(db, { action: 'connection_capabilities' });
      deepStrictEqual(caps.data.hosted, { available: false, white_label: true });
      const unlink = await call(db, { action: 'unlink_email_account', mapping_id: MAPPING, expected_account_id: 'acc_mail_own' });
      strictEqual(unlink.status, 200);
      strictEqual(unlink.data.success, true);
      strictEqual(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('une erreur imprévue ne remonte ni son texte ni le nom du prestataire', async () => {
  await withEnv(ENV, async () => {
    const db = whatsappDb();
    db.failOn('member_whatsapp_accounts', 'select');
    const reply = await call(db, { action: 'list_whatsapp' });
    strictEqual(reply.status, 500);
    assertNoVendor(reply);
    const boom = await handleRequest(new Request('https://x.test', { method: 'POST', body: JSON.stringify({ action: 'list', organization_id: ORG }) }), {
      authenticate: () => Promise.resolve({ userId: USER, method: 'jwt' }),
      createAdmin: () => ({ from() { throw new Error('Unipile secret internal detail'); } }),
    });
    const text = await boom.text();
    strictEqual(boom.status, 500);
    ok(!/unipile|secret|detail/i.test(text), text);
    deepStrictEqual(JSON.parse(text), { success: false, error: 'Erreur interne. Réessayez dans un instant.', error_code: 'server' });
  });
});

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

Deno.test('list_whatsapp : lit seulement les identifiants du membre, vocabulaire Konekt, aucun champ privé', async () => {
  await withEnv(ENV, async () => {
    const db = whatsappDb();
    const mock = withMockTransport(router({
      'GET /accounts/acc_wa_own': { body: { ...wa('acc_wa_own'), proxy: { password: 'private-proxy-pass' }, metadata: { custom_data: { token: 'private-token' } } } },
    }));
    try {
      const reply = await call(db, { action: 'list_whatsapp' });
      strictEqual(reply.status, 200);
      deepStrictEqual(mock.calls.map((c) => `${c.method} ${c.path}`), ['GET /accounts/acc_wa_own']);
      deepStrictEqual(reply.data.accounts, [{ id: 'acc_wa_own', name: '+33 6 12 34 56 78', identifier: '+33612345678', status: 'OK', type: 'WHATSAPP' }]);
      ok(!/private-proxy-pass|private-token|test-key|fixture-service/.test(reply.raw));
      strictEqual(db.table('member_whatsapp_accounts')[0].account_status, 'OK');
      strictEqual(db.table('member_whatsapp_accounts')[0].phone_number, '+33612345678');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('list_whatsapp : un compte supprimé chez le service est marqué, un refus du service est une erreur', async () => {
  await withEnv(ENV, async () => {
    const db = whatsappDb();
    let mock = withMockTransport(router({ 'GET /accounts/acc_wa_own': { status: 404, body: { message: 'gone' } } }));
    try {
      const reply = await call(db, { action: 'list_whatsapp' });
      strictEqual(reply.data.accounts[0].status, 'DELETED');
      strictEqual(db.table('member_whatsapp_accounts')[0].account_status, 'DELETED');
    } finally {
      mock.restore();
    }
    const db2 = whatsappDb();
    mock = withMockTransport(router({ 'GET /accounts/acc_wa_own': { status: 503, body: { message: 'Unipile down' } } }));
    try {
      const reply = await call(db2, { action: 'list_whatsapp' });
      strictEqual(reply.status, 502);
      strictEqual(reply.data.success, false);
      strictEqual(reply.data.accounts, undefined);
      assertNoVendor(reply);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('list_whatsapp : un compte dont l identifiant est ancien ou retiré n appelle pas le service', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({
      member_whatsapp_accounts: [
        { id: 'w1', organization_id: ORG, user_id: USER, whatsapp_account_id: 'ancien-id', name: 'Ancien', phone_number: null, account_status: 'OK' },
        { id: 'w2', organization_id: ORG, user_id: USER, whatsapp_account_id: 'acc_gone', name: 'Retiré', phone_number: null, account_status: 'DELETED' },
      ],
    });
    const mock = withMockTransport(router({}));
    try {
      const reply = await call(db, { action: 'list_whatsapp' });
      strictEqual(mock.calls.length, 0);
      deepStrictEqual(reply.data.accounts.map((a: any) => a.status).sort(), ['CREDENTIALS', 'DELETED']);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('même un administrateur ne déconnecte ni ne lit le WhatsApp d un collègue ou d une autre organisation', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({}));
    try {
      for (const action of ['disconnect_whatsapp', 'disconnect', 'get_account_details']) {
        const reply = await call(whatsappDb(), { action, account_id: 'acc_wa_peer' });
        strictEqual(reply.status, 403, action);
      }
      strictEqual((await call(whatsappDb(), { action: 'disconnect_whatsapp', account_id: 'acc_wa_foreign' })).status, 403);
      strictEqual(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('disconnect_whatsapp : supprime chez le service et garde la pierre tombale de propriété', async () => {
  await withEnv(ENV, async () => {
    for (const missing of [false, true]) {
      const db = whatsappDb();
      const mock = withMockTransport(router({
        'DELETE /accounts/acc_wa_own': () => missing ? { status: 404, body: { message: 'gone' } } : { body: { success: true } },
      }));
      try {
        const reply = await call(db, { action: 'disconnect_whatsapp', account_id: 'acc_wa_own' });
        strictEqual(reply.data.success, true, `missing=${missing}`);
        strictEqual(mock.calls[0].method, 'DELETE');
        strictEqual(db.table('member_whatsapp_accounts').find((r) => r.id === 'w-own')?.account_status, 'DELETED');
        strictEqual(db.table('member_whatsapp_accounts').length, 3);
      } finally {
        mock.restore();
      }
    }
    // Un refus du service garde la liaison et ne montre aucun texte du prestataire.
    const db = whatsappDb();
    const mock = withMockTransport(router({ 'DELETE /accounts/acc_wa_own': { status: 500, body: { message: 'Unipile kaput' } } }));
    try {
      const reply = await call(db, { action: 'disconnect_whatsapp', account_id: 'acc_wa_own' });
      strictEqual(reply.status, 502);
      assertNoVendor(reply);
      strictEqual(db.table('member_whatsapp_accounts').find((r) => r.id === 'w-own')?.account_status, 'OK');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('disconnect_whatsapp et disconnect : un 200 { success: false } du service n est pas une suppression', async () => {
  await withEnv(ENV, async () => {
    const db = whatsappDb();
    const mock = withMockTransport(router({ 'DELETE /accounts/acc_wa_own': { body: { success: false } } }));
    try {
      const reply = await call(db, { action: 'disconnect_whatsapp', account_id: 'acc_wa_own' });
      strictEqual(reply.status, 502);
      strictEqual(reply.data.success, false);
      assertNoVendor(reply);
      strictEqual(db.table('member_whatsapp_accounts').find((r) => r.id === 'w-own')?.account_status, 'OK', 'aucune pierre tombale sur un compte encore vivant');
    } finally {
      mock.restore();
    }
    const owned = ownedDb();
    const mock2 = withMockTransport(router({ 'DELETE /accounts/acc_own': { body: { success: false } } }));
    try {
      const reply = await call(owned, { action: 'disconnect', account_id: 'acc_own' });
      strictEqual(reply.status, 200);
      strictEqual(reply.data.success, false);
      strictEqual(reply.data.error_code, 'server');
      assertNoVendor(reply);
    } finally {
      mock2.restore();
    }
    const mock3 = withMockTransport(router({ 'DELETE /accounts/acc_own': { body: { success: true } } }));
    try {
      deepStrictEqual((await call(ownedDb(), { action: 'disconnect', account_id: 'acc_own' })).data, { success: true });
    } finally {
      mock3.restore();
    }
  });
});

Deno.test('list_whatsapp : un nom qui n est pas un numéro n efface ni le numéro ni le nom déjà enregistrés', async () => {
  await withEnv(ENV, async () => {
    const db = whatsappDb();
    const mock = withMockTransport(router({ 'GET /accounts/acc_wa_own': { body: wa('acc_wa_own', { name: 'Recruteur', status: 'disconnected' }) } }));
    try {
      const reply = await call(db, { action: 'list_whatsapp' });
      strictEqual(reply.data.accounts[0].status, 'CREDENTIALS');
      const row = db.table('member_whatsapp_accounts').find((r) => r.id === 'w-own')!;
      strictEqual(row.phone_number, '+33612345678', 'le numéro enregistré est gardé');
      strictEqual(row.account_status, 'CREDENTIALS');
      strictEqual(row.name, 'Recruteur', 'un nom lisible est mis à jour');
    } finally {
      mock.restore();
    }
    const db2 = whatsappDb();
    const mock2 = withMockTransport(router({ 'GET /accounts/acc_wa_own': { body: wa('acc_wa_own', { name: 'user:u1|org:o1|providers:WHATSAPP|expires:1' }) } }));
    try {
      await call(db2, { action: 'list_whatsapp' });
      const row = db2.table('member_whatsapp_accounts').find((r) => r.id === 'w-own')!;
      strictEqual(row.phone_number, '+33612345678');
      strictEqual(row.name, 'Mon numéro', 'un nom illisible ne remplace pas le nom enregistré');
    } finally {
      mock2.restore();
    }
  });
});

Deno.test('disconnect_whatsapp : un ancien identifiant n appelle pas le service, la liaison est retirée', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({ member_whatsapp_accounts: [{ id: 'w1', organization_id: ORG, user_id: USER, whatsapp_account_id: 'ancien-id', account_status: 'OK' }] });
    const mock = withMockTransport(router({}));
    try {
      const reply = await call(db, { action: 'disconnect_whatsapp', account_id: 'ancien-id' });
      strictEqual(reply.data.success, true);
      strictEqual(mock.calls.length, 0);
      strictEqual(db.table('member_whatsapp_accounts')[0].account_status, 'DELETED');
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// E-mail
// ---------------------------------------------------------------------------

Deno.test('unlink_email_account : liaison exacte du membre, sans service, jamais celle d un collègue ni obsolète', async () => {
  await withEnv({ ...ENV, UNIPILE_V2_API_KEY: null }, async () => {
    const db = whatsappDb();
    const ok1 = await call(db, { action: 'unlink_email_account', mapping_id: MAPPING, expected_account_id: 'acc_mail_own' });
    strictEqual(ok1.data.success, true);
    deepStrictEqual(db.table('member_email_accounts').map((r) => r.email_account_id), ['acc_mail_peer', 'acc_mail_foreign']);
    for (const [mappingId, expected, status] of [
      ['92222222-2222-4222-8222-222222222222', 'acc_mail_peer', 403],
      ['93333333-3333-4333-8333-333333333333', 'acc_mail_foreign', 403],
      [MAPPING, 'repointed', 409],
      [MAPPING, '', 400],
    ] as const) {
      const fresh = whatsappDb();
      const reply = await call(fresh, { action: 'unlink_email_account', mapping_id: mappingId, expected_account_id: expected });
      strictEqual(reply.status, status, `${mappingId} ${expected}`);
      strictEqual(fresh.table('member_email_accounts').length, 3);
    }
  });
});

Deno.test('list_email : une lecture par boîte du membre, type et état au format attendu, pas de liste vide sur refus', async () => {
  await withEnv(ENV, async () => {
    const db = whatsappDb();
    const mock = withMockTransport(router({
      'GET /accounts/acc_mail_own': { body: fixtures.account({ id: 'acc_mail_own', provider: 'google', name: 'Moi@Exemple.fr', status: 'running' }) },
    }));
    try {
      const reply = await call(db, { action: 'list_email' });
      deepStrictEqual(mock.calls.map((c) => c.path), ['/accounts/acc_mail_own']);
      deepStrictEqual(reply.data.accounts, [{ id: 'acc_mail_own', name: 'Moi@Exemple.fr', identifier: 'moi@exemple.fr', type: 'GOOGLE_OAUTH', status: 'OK' }]);
    } finally {
      mock.restore();
    }
    const failing = withMockTransport(router({ 'GET /accounts/acc_mail_own': { status: 500, body: {} } }));
    try {
      const reply = await call(whatsappDb(), { action: 'list_email' });
      strictEqual(reply.status, 502);
      strictEqual(reply.data.accounts, undefined);
    } finally {
      failing.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// LinkedIn list
// ---------------------------------------------------------------------------

const li = (id: string, overrides: Record<string, unknown> = {}) => fixtures.account({ id, provider: 'linkedin', name: `Compte ${id}`, ...overrides });

Deno.test('list : un appel par compte relié, états Konekt, licences par contrats, photo mise en cache', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({
      member_linkedin_accounts: [
        { id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_ok', linkedin_account_name: 'Claire' },
        { id: 'm2', organization_id: ORG, user_id: PEER, linkedin_account_id: 'acc_dis', linkedin_account_name: 'Pierre' },
        { id: 'm3', organization_id: ORG, user_id: STRANGER, linkedin_account_id: 'ancien-id', linkedin_account_name: 'user:abc|org:def' },
        { id: 'm4', organization_id: OTHER_ORG, user_id: STRANGER, linkedin_account_id: 'acc_foreign', linkedin_account_name: 'Autre' },
      ],
    });
    const mock = withMockTransport(router({
      'GET /accounts/acc_ok': { body: li('acc_ok', { name: 'Claire Martin' }) },
      'GET /accounts/acc_dis': { body: li('acc_dis', { status: 'disconnected' }) },
      'GET /acc_ok/linkedin/contracts': { body: { object: 'AvailableContracts', contracts: [{ object: 'Contract', id: 'c1', name: 'Contrat', product: 'recruiter', selected: true }] } },
      'GET /acc_ok/users/me': { body: { id: 'ACoAAxyz', display_name: 'Claire', public_picture_url: 'https://media.example/c.jpg' } },
    }));
    try {
      const reply = await call(db, { action: 'list' });
      strictEqual(reply.status, 200);
      const byId = Object.fromEntries(reply.data.accounts.map((a: any) => [a.id, a]));
      deepStrictEqual(Object.keys(byId).sort(), ['acc_dis', 'acc_ok', 'ancien-id']);
      strictEqual(byId.acc_ok.status, 'OK');
      strictEqual(byId.acc_ok.profile_picture_url, 'https://media.example/c.jpg');
      deepStrictEqual(byId.acc_ok.subscriptions, { classic: true, recruiter: true, sales_navigator: false });
      strictEqual(byId.acc_ok.mapped, true);
      strictEqual(byId.acc_dis.status, 'CREDENTIALS');
      strictEqual(byId.acc_dis.profile_picture_url, null, 'un compte à reconnecter ne lit pas son profil');
      strictEqual(byId['ancien-id'].status, 'CREDENTIALS');
      strictEqual(byId['ancien-id'].name, 'Compte LinkedIn');
      ok(!mock.calls.some((c) => c.path.includes('ancien-id') || c.path.includes('acc_foreign')), 'ni ancien identifiant ni compte d une autre organisation');
      ok(!mock.calls.some((c) => c.path === '/accounts/'), 'aucune liste globale hors mode revendication');

      // Deuxième lecture : contrats et photo viennent du cache, seuls les comptes sont relus.
      const before = mock.calls.length;
      await call(db, { action: 'list' });
      const second = mock.calls.slice(before).map((c) => c.path).sort();
      deepStrictEqual(second, ['/accounts/acc_dis', '/accounts/acc_ok']);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('list : un refus du service est une erreur explicite, jamais une liste vide', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({ member_linkedin_accounts: [{ id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_fail', linkedin_account_name: 'X' }] });
    const mock = withMockTransport(router({ 'GET /accounts/acc_fail': { status: 503, body: { message: 'Unipile 503' } } }));
    try {
      const reply = await call(db, { action: 'list' });
      strictEqual(reply.status, 502);
      strictEqual(reply.data.success, false);
      strictEqual(reply.data.accounts, undefined);
      assertNoVendor(reply);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('list include_org_accounts : réservé à la plateforme, orphelins jamais montrés à un membre ou à un administrateur d organisation', async () => {
  const members = () => makeDb({
    member_linkedin_accounts: [
      { id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_own', linkedin_account_name: 'Claire' },
      { id: 'm4', organization_id: OTHER_ORG, user_id: STRANGER, linkedin_account_id: 'acc_foreign', linkedin_account_name: 'Autre' },
    ],
  });
  const routes = {
    'GET /accounts/acc_own': { body: li('acc_own', { name: 'Claire' }) },
    'GET /acc_own/linkedin/contracts': { body: { contracts: [] } },
    'GET /acc_own/users/me': { body: { id: 'ACoAAown' } },
    'GET /accounts/': {
      body: { object: 'Accounts', has_more: false, data: [li('acc_own', { name: 'Claire' }), li('acc_foreign', { name: 'Autre' }), li('acc_orphan', { name: 'Nouveau', status: 'running' })] },
    },
  };
  // Un administrateur d'organisation (USER l'est) ne voit aucun orphelin : ce peut être la connexion en cours d'une autre organisation.
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router(routes));
    try {
      const reply = await call(members(), { action: 'list', include_org_accounts: true });
      deepStrictEqual(reply.data.accounts.map((a: any) => a.id), ['acc_own']);
      ok(!mock.calls.some((c) => c.path === '/accounts/'), 'aucune liste globale des comptes du prestataire');
    } finally {
      mock.restore();
    }
  });
  // Un autre identifiant dans le secret : toujours rien.
  await withEnv({ ...ENV, KONEKT_PLATFORM_ADMIN_USER_IDS: PEER }, async () => {
    const mock = withMockTransport(router(routes));
    try {
      const reply = await call(members(), { action: 'list', include_org_accounts: true });
      deepStrictEqual(reply.data.accounts.map((a: any) => a.id), ['acc_own']);
    } finally {
      mock.restore();
    }
  });
  // La plateforme voit les orphelins, jamais ceux d'une autre organisation, sans photo ni contrats.
  await withEnv(ENV_PLATFORM, async () => {
    const mock = withMockTransport(router(routes));
    try {
      const reply = await call(members(), { action: 'list', include_org_accounts: true });
      const ids = reply.data.accounts.map((a: any) => a.id).sort();
      deepStrictEqual(ids, ['acc_orphan', 'acc_own']);
      const orphan = reply.data.accounts.find((a: any) => a.id === 'acc_orphan');
      strictEqual(orphan.mapped, false);
      strictEqual(orphan.profile_picture_url, null);
      ok(!mock.calls.some((c) => c.path.startsWith('/acc_orphan') || c.path.startsWith('/acc_foreign')), 'rien n est lu de la session d un compte qui n est pas le sien');
      strictEqual(mock.calls.find((c) => c.path === '/accounts/')?.query.get('provider'), 'linkedin');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('list include_org_accounts : les comptes d autres organisations sont lus par pages, aucun ne passe pour un orphelin au-delà de 1000 lignes', async () => {
  await withEnv(ENV_PLATFORM, async () => {
    const foreign = Array.from({ length: 1200 }, (_, i) => ({
      id: `mf${i}`, organization_id: OTHER_ORG, user_id: STRANGER, linkedin_account_id: i === 1100 ? 'acc_late_foreign' : `acc_f${i}`,
    }));
    const db = makeDb({ member_linkedin_accounts: foreign });
    const mock = withMockTransport(router({
      'GET /accounts/': { body: { object: 'Accounts', has_more: false, data: [li('acc_late_foreign', { name: 'Tardif' }), li('acc_orphan', { name: 'Nouveau' })] } },
    }));
    try {
      const reply = await call(db, { action: 'list', include_org_accounts: true });
      deepStrictEqual(reply.data.accounts.map((a: any) => a.id), ['acc_orphan']);
    } finally {
      mock.restore();
    }
    // Une lecture illisible des comptes étrangers refuse la liste : jamais un ensemble vide qui ferait tout passer pour orphelin.
    const broken = makeDb({ member_linkedin_accounts: foreign.slice(0, 2) });
    broken.failOn('member_linkedin_accounts', 'select'); // la lecture des comptes de l'organisation (journalisée)
    broken.failOn('member_linkedin_accounts', 'select'); // celle des comptes étrangers
    const mock2 = withMockTransport(router({ 'GET /accounts/': { body: { object: 'Accounts', has_more: false, data: [li('acc_orphan', { name: 'Nouveau' })] } } }));
    try {
      const reply = await call(broken, { action: 'list', include_org_accounts: true });
      strictEqual(reply.data.success, false);
      strictEqual(reply.data.accounts, undefined);
      ok(!mock2.calls.some((c) => c.path === '/accounts/'), 'aucune liste globale lue sans l ensemble des comptes étrangers');
    } finally {
      mock2.restore();
    }
  });
});

Deno.test('list : un lien mort n est jamais repointé vers un homonyme, même seul de son nom', async () => {
  await withEnv(ENV_PLATFORM, async () => {
    const rows = () => [{ id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_dead', linkedin_account_name: 'Claire Martin' }];
    const db = makeDb({ member_linkedin_accounts: rows() });
    // Un compte de même nom existe chez le prestataire sans être relié : c'est la connexion en cours d'une autre
    // organisation, ou un ancien membre. Aucun rapprochement par le nom.
    const mock = withMockTransport(router({
      'GET /accounts/acc_dead': { status: 404, body: { message: 'not found' } },
      'GET /accounts/': { body: { object: 'Accounts', has_more: false, data: [li('acc_new', { name: 'claire  martin' })] } },
    }));
    try {
      const reply = await call(db, { action: 'list' });
      strictEqual(db.table('member_linkedin_accounts')[0].linkedin_account_id, 'acc_dead', 'la ligne n est pas modifiée');
      deepStrictEqual(reply.data.accounts, []);
      ok(!mock.calls.some((c) => c.path === '/accounts/'), 'aucune liste globale lue pour réconcilier');
      // Même en mode dépannage de la plateforme, la ligne reste telle quelle.
      const withClaim = await call(db, { action: 'list', include_org_accounts: true });
      strictEqual(db.table('member_linkedin_accounts')[0].linkedin_account_id, 'acc_dead');
      deepStrictEqual(withClaim.data.accounts.map((a: any) => [a.id, a.mapped]), [['acc_new', false]]);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('list : un compte que le service ne renseigne pas n empêche pas les autres, et le dernier état connu est gardé', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({
      member_linkedin_accounts: [
        { id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_ok', linkedin_account_name: 'Claire', account_status: 'OK' },
        { id: 'm2', organization_id: ORG, user_id: PEER, linkedin_account_id: 'acc_slow', linkedin_account_name: 'Pierre', account_status: 'DEGRADED' },
      ],
    });
    const mock = withMockTransport(router({
      'GET /accounts/acc_ok': { body: li('acc_ok', { name: 'Claire' }) },
      'GET /accounts/acc_slow': { status: 429, body: { message: 'Too many requests' } },
      'GET /acc_ok/linkedin/contracts': { body: { contracts: [] } },
      'GET /acc_ok/users/me': { body: { id: 'ACoAAok' } },
    }));
    try {
      const reply = await call(db, { action: 'list' });
      strictEqual(reply.status, 200);
      const byId = Object.fromEntries(reply.data.accounts.map((a: any) => [a.id, a]));
      deepStrictEqual(Object.keys(byId).sort(), ['acc_ok', 'acc_slow']);
      strictEqual(byId.acc_slow.status, 'DEGRADED');
      strictEqual(byId.acc_slow.reconnectable, false);
      strictEqual(byId.acc_ok.status, 'OK');
      assertNoVendor(reply);
      strictEqual(db.table('member_linkedin_accounts')[1].account_status, 'DEGRADED', 'la liaison n est pas modifiée');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('list : limitée par membre et par minute, sans appel au service quand elle est refusée', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({ member_linkedin_accounts: [{ id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_ok' }] });
    db.rpcResults.check_rate_limit = false;
    const mock = withMockTransport(router({ 'GET /accounts/acc_ok': { body: li('acc_ok') } }));
    try {
      const reply = await call(db, { action: 'list' });
      strictEqual(reply.data.success, false);
      strictEqual(reply.data.error_code, 'rate_limited');
      strictEqual(mock.calls.length, 0);
      deepStrictEqual(db.rpcCalls[0].args.p_action, 'unipile_accounts_list');
    } finally {
      mock.restore();
    }
    // Un compteur illisible ne bloque pas la liste (ce n'est pas une action qui porte un secret).
    const open = makeDb({ member_linkedin_accounts: [{ id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_ok' }] });
    open.rpcResults.check_rate_limit = null;
    const mock2 = withMockTransport(router({
      'GET /accounts/acc_ok': { body: li('acc_ok') },
      'GET /acc_ok/linkedin/contracts': { body: { contracts: [] } },
      'GET /acc_ok/users/me': { body: { id: 'x' } },
    }));
    try {
      strictEqual((await call(open, { action: 'list' })).data.success, true);
    } finally {
      mock2.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// claim, unlink, stop
// ---------------------------------------------------------------------------

Deno.test('claim_linkedin_account : refus d un compte étranger, d un collègue, d un orphelin (même récent, même pour un administrateur d organisation)', async () => {
  await withEnv(ENV, async () => {
    const base = (role = 'member') => makeDb({
      member_linkedin_accounts: [
        { id: 'm-foreign', organization_id: OTHER_ORG, user_id: STRANGER, linkedin_account_id: 'acc_foreign' },
        { id: 'm-peer', organization_id: ORG, user_id: PEER, linkedin_account_id: 'acc_peer' },
      ],
    }, role);
    const mock = withMockTransport(router({
      'GET /accounts/acc_new': { body: li('acc_new', { name: 'Claire', status: 'partial', created_at: new Date().toISOString() }) },
      'GET /accounts/acc_old': { body: li('acc_old', { created_at: '2020-01-01T00:00:00.000Z' }) },
      'GET /accounts/acc_wa': { body: wa('acc_wa') },
    }));
    try {
      strictEqual((await call(base(), { action: 'claim_linkedin_account', account_id: 'acc_foreign' })).status, 403);
      strictEqual((await call(base(), { action: 'claim_linkedin_account', account_id: 'acc_peer' })).status, 409);
      strictEqual((await call(base(), { action: 'claim_linkedin_account', account_id: 'acc_wa' })).status, 403, 'un orphelin ne se revendique pas, quel que soit son type');
      strictEqual((await call(base(), { action: 'claim_linkedin_account', account_id: 'acc_missing' })).status, 403, 'et on ne devine pas par la réponse si un compte existe');
      strictEqual(mock.calls.length, 0, 'aucun compte inconnu n est lu chez le prestataire');
      strictEqual((await call(base(), { action: 'claim_linkedin_account', account_id: 'ancien-identifiant' })).status, 409, 'un identifiant ancien demande une reconnexion');
      strictEqual(mock.calls.length, 0, 'aucun compte inconnu n est lu chez le prestataire');
      // Un orphelin créé à l'instant peut être la connexion en cours d'une autre organisation : refusé à un membre comme à un administrateur.
      for (const role of ['member', 'admin', 'owner']) {
        const db = base(role);
        const recent = await call(db, { action: 'claim_linkedin_account', account_id: 'acc_new' });
        strictEqual(recent.status, 403, `${role} : orphelin récent`);
        strictEqual((await call(db, { action: 'claim_linkedin_account', account_id: 'acc_old' })).status, 403, `${role} : orphelin ancien`);
        ok(!db.table('member_linkedin_accounts').some((r) => r.linkedin_account_id === 'acc_new' || r.linkedin_account_id === 'acc_old'), `${role} : aucun lien posé`);
        assertNoVendor(recent);
      }
    } finally {
      mock.restore();
    }
  });
  // La plateforme peut relier un orphelin (dépannage) ; lien posé avec le statut Konekt.
  await withEnv(ENV_PLATFORM, async () => {
    const mock = withMockTransport(router({
      'GET /accounts/acc_new': { body: li('acc_new', { name: 'Claire', status: 'partial', created_at: '2020-01-01T00:00:00.000Z' }) },
      'GET /accounts/acc_missing': { status: 404, body: {} },
      'GET /accounts/acc_wa': { body: wa('acc_wa') },
    }));
    try {
      const db = makeDb({}, 'member');
      strictEqual((await call(db, { action: 'claim_linkedin_account', account_id: 'acc_missing' })).status, 404);
      strictEqual((await call(db, { action: 'claim_linkedin_account', account_id: 'acc_wa' })).status, 400);
      const claimed = await call(db, { action: 'claim_linkedin_account', account_id: 'acc_new' });
      strictEqual(claimed.status, 200);
      strictEqual(claimed.data.mapping.linkedin_account_id, 'acc_new');
      const row = db.table('member_linkedin_accounts').find((r) => r.linkedin_account_id === 'acc_new')!;
      strictEqual(row.account_status, 'PARTIAL');
      strictEqual(row.linkedin_account_name, 'Claire');
      strictEqual(row.user_id, USER);
      strictEqual(row.linked_by, USER);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('claim_linkedin_account : le droit de la plateforme ne vient que du secret (identifiant exact dans la liste) et ne contourne ni l espace étranger, ni le collègue, ni l appartenance', async () => {
  const routes = {
    'GET /accounts/acc_orphan': { body: li('acc_orphan', { name: 'Claire' }) },
    'GET /accounts/acc_foreign': { body: li('acc_foreign', { name: 'Autre' }) },
    'GET /accounts/acc_peer': { body: li('acc_peer', { name: 'Pierre' }) },
  };
  const base = () => makeDb({
    member_linkedin_accounts: [
      { id: 'm-foreign', organization_id: OTHER_ORG, user_id: STRANGER, linkedin_account_id: 'acc_foreign' },
      { id: 'm-peer', organization_id: ORG, user_id: PEER, linkedin_account_id: 'acc_peer' },
    ],
  }, 'owner');
  const hasOrphanLink = (db: FakeDb) => db.table('member_linkedin_accounts').some((r) => r.linkedin_account_id === 'acc_orphan');

  // Le secret nomme un autre identifiant (ou un préfixe de celui de l'appelant), ou n'existe pas : même un propriétaire est refusé, le prestataire n'est pas consulté.
  for (const secret of [PEER, USER.slice(0, 8), '', null]) {
    await withEnv({ ...ENV, KONEKT_PLATFORM_ADMIN_USER_IDS: secret }, async () => {
      const mock = withMockTransport(router(routes));
      try {
        const db = base();
        const refused = await call(db, { action: 'claim_linkedin_account', account_id: 'acc_orphan' });
        strictEqual(refused.status, 403, `secret ${JSON.stringify(secret)} : orphelin refusé`);
        ok(!hasOrphanLink(db), `secret ${JSON.stringify(secret)} : aucun lien posé`);
        strictEqual(mock.calls.length, 0, `secret ${JSON.stringify(secret)} : prestataire non consulté`);
        assertNoVendor(refused);
      } finally {
        mock.restore();
      }
    });
  }

  // Le secret est une liste séparée par des virgules, espaces tolérés : l'appelant y figure, il relie l'orphelin et, pour un membre, le sien.
  await withEnv({ ...ENV, KONEKT_PLATFORM_ADMIN_USER_IDS: ` ${PEER} , ${USER} ` }, async () => {
    const mock = withMockTransport(router(routes));
    try {
      const db = base();
      const claimed = await call(db, { action: 'claim_linkedin_account', account_id: 'acc_orphan' });
      strictEqual(claimed.status, 200, JSON.stringify(claimed.data));
      const row = db.table('member_linkedin_accounts').find((r) => r.linkedin_account_id === 'acc_orphan')!;
      strictEqual(row.user_id, USER);
      strictEqual(row.linked_by, USER);
      ok(mock.calls.some((c) => c.path === '/accounts/acc_orphan'), 'le compte est lu chez le prestataire pour son nom et son statut');

      // Pour un membre de l'organisation : lien posé pour lui, attribué à la plateforme.
      const forPeer = base();
      forPeer.table('member_linkedin_accounts').splice(1, 1);
      const linked = await call(forPeer, { action: 'claim_linkedin_account', account_id: 'acc_orphan', user_id: PEER });
      strictEqual(linked.status, 200, JSON.stringify(linked.data));
      const peerRow = forPeer.table('member_linkedin_accounts').find((r) => r.linkedin_account_id === 'acc_orphan')!;
      strictEqual(peerRow.user_id, PEER);
      strictEqual(peerRow.linked_by, USER);

      // Le droit de la plateforme ne couvre que les comptes sans liaison : espace étranger 403, collègue 409, hors organisation 404.
      strictEqual((await call(base(), { action: 'claim_linkedin_account', account_id: 'acc_foreign' })).status, 403);
      strictEqual((await call(base(), { action: 'claim_linkedin_account', account_id: 'acc_peer' })).status, 409);
      const notMember = base();
      strictEqual((await call(notMember, { action: 'claim_linkedin_account', account_id: 'acc_orphan', user_id: STRANGER })).status, 404);
      ok(!hasOrphanLink(notMember), 'aucun lien pour quelqu un hors de l organisation');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('claim_linkedin_account : l ancien compte cesse d envoyer avant le changement ; la plateforme relie un membre', async () => {
  await withEnv(ENV_PLATFORM, async () => {
    const db = makeDb({
      member_linkedin_accounts: [{ id: 'm-old', organization_id: ORG, user_id: PEER, linkedin_account_id: 'acc_old', linked_at: '2026-01-01T00:00:00.000Z' }],
    });
    const mock = withMockTransport(router({ 'GET /accounts/acc_new': { body: li('acc_new', { name: 'Pierre' }) } }));
    try {
      const reply = await call(db, { action: 'claim_linkedin_account', account_id: 'acc_new', user_id: PEER });
      strictEqual(reply.status, 200);
      const row = db.table('member_linkedin_accounts').find((r) => r.user_id === PEER)!;
      strictEqual(row.linkedin_account_id, 'acc_new');
      ok(db.calls.some((c) => c.table === 'sequence_enrollments'), 'arrêt des envois de l ancien compte');
      ok(db.calls.findIndex((c) => c.table === 'sequence_enrollments') < db.calls.findIndex((c) => c.table === 'member_linkedin_accounts' && c.op === 'upsert'));
      // Un membre simple ne relie pas un collègue.
      const member = makeDb({}, 'member');
      strictEqual((await call(member, { action: 'claim_linkedin_account', account_id: 'acc_new', user_id: PEER })).status, 403);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('unlink_linkedin_account et stop_member_linkedin : sans service, envois arrêtés avant de retirer la liaison', async () => {
  await withEnv({ ...ENV, UNIPILE_V2_API_KEY: null }, async () => {
    const db = makeDb({ member_linkedin_accounts: [{ id: MAPPING, organization_id: ORG, user_id: PEER, linkedin_account_id: 'acc_peer' }] });
    const stale = await call(db, { action: 'unlink_linkedin_account', mapping_id: MAPPING, expected_account_id: 'acc_autre' });
    strictEqual(stale.status, 409);
    const done = await call(db, { action: 'unlink_linkedin_account', mapping_id: MAPPING, expected_account_id: 'acc_peer' });
    strictEqual(done.status, 200);
    deepStrictEqual(Object.keys(done.data).sort(), ['cancelled_inmails', 'paused_enrollments', 'relabeled_enrollments', 'removed', 'success']);
    strictEqual(db.table('member_linkedin_accounts').length, 0);

    const db2 = makeDb({ member_linkedin_accounts: [{ id: MAPPING, organization_id: ORG, user_id: PEER, linkedin_account_id: 'acc_peer' }] });
    const stop = await call(db2, { action: 'stop_member_linkedin', member_user_id: PEER });
    strictEqual(stop.data.removed_links, 1);
    strictEqual(db2.table('member_linkedin_accounts').length, 0);
    const denied = await call(makeDb({}, 'member'), { action: 'stop_member_linkedin', member_user_id: PEER });
    strictEqual(denied.status, 403);
  });
});

Deno.test('stop_member_linkedin : les connexions en cours du membre sont annulées avant son retrait', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({
      member_linkedin_accounts: [{ id: MAPPING, organization_id: ORG, user_id: PEER, linkedin_account_id: 'acc_peer' }],
      connection_attempts: [
        { id: 'a1111111-1111-4111-8111-111111111111', organization_id: ORG, user_id: PEER, provider: 'linkedin', purpose: 'link', mode: 'hosted', status: 'pending', expires_at: new Date(Date.now() + 600_000).toISOString(), intent_id: 'acc_intent' },
        { id: 'a2222222-2222-4222-8222-222222222222', organization_id: ORG, user_id: USER, provider: 'linkedin', purpose: 'link', mode: 'hosted', status: 'pending', expires_at: new Date(Date.now() + 600_000).toISOString() },
        { id: 'a3333333-3333-4333-8333-333333333333', organization_id: OTHER_ORG, user_id: PEER, provider: 'whatsapp', purpose: 'link', mode: 'hosted', status: 'pending', expires_at: new Date(Date.now() + 600_000).toISOString() },
      ],
    });
    const stop = await call(db, { action: 'stop_member_linkedin', member_user_id: PEER });
    strictEqual(stop.data.success, true);
    const byId = Object.fromEntries(db.table('connection_attempts').map((r) => [r.id.slice(0, 2), r]));
    strictEqual(byId.a1.status, 'cancelled');
    strictEqual(byId.a1.intent_id, null);
    strictEqual(byId.a2.status, 'pending', 'la connexion d un autre membre n est pas touchée');
    strictEqual(byId.a3.status, 'pending', 'ni celle d une autre organisation');

    // Annulation impossible : le membre n'est pas retiré.
    const db2 = makeDb({ member_linkedin_accounts: [{ id: MAPPING, organization_id: ORG, user_id: PEER, linkedin_account_id: 'acc_peer' }] });
    db2.failOn('connection_attempts', 'update');
    const failed = await call(db2, { action: 'stop_member_linkedin', member_user_id: PEER });
    strictEqual(failed.status, 500);
    strictEqual(db2.table('member_linkedin_accounts').length, 1);
  });
});

// ---------------------------------------------------------------------------
// inmail_balance, contracts, proxy, details
// ---------------------------------------------------------------------------

function ownedDb(): FakeDb {
  return makeDb({
    member_linkedin_accounts: [
      { id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_own', linkedin_account_name: 'Claire' },
      { id: 'm-peer', organization_id: ORG, user_id: PEER, linkedin_account_id: 'acc_peer', linkedin_account_name: 'Pierre' },
      { id: 'm-foreign', organization_id: OTHER_ORG, user_id: STRANGER, linkedin_account_id: 'acc_foreign', linkedin_account_name: 'X' },
      { id: 'm-detail', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_detail', linkedin_account_name: 'Détail' },
    ],
  });
}

Deno.test('inmail_balance : la clé classic devient premium, une licence absente reste null', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({ 'GET /acc_own/linkedin/inmail-credits': { body: { object: 'InmailCredits', credits: { classic: 5, recruiter: 40 } } } }));
    try {
      const reply = await call(ownedDb(), { action: 'inmail_balance', account_id: 'acc_own' });
      deepStrictEqual(reply.data, { success: true, balance: { premium: 5, recruiter: 40, sales_navigator: null } });
      strictEqual((await call(ownedDb(), { action: 'inmail_balance', account_id: 'acc_foreign' })).status, 403);
      strictEqual((await call(ownedDb(), { action: 'inmail_balance' })).status, 400);
    } finally {
      mock.restore();
    }
    const failing = withMockTransport(router({ 'GET /acc_own/linkedin/inmail-credits': { status: 500, body: { message: 'Unipile boom' } } }));
    try {
      const reply = await call(ownedDb(), { action: 'inmail_balance', account_id: 'acc_own' });
      strictEqual(reply.status, 200);
      strictEqual(reply.data.success, false);
      strictEqual(reply.data.error_code, 'server');
      strictEqual(typeof reply.data.status, 'number');
      assertNoVendor(reply);
    } finally {
      failing.restore();
    }
  });
});

Deno.test('inmail_balance : un identifiant ancien demande une reconnexion, sans appel', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({ member_linkedin_accounts: [{ id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'ancien-id' }] });
    const mock = withMockTransport(router({}));
    try {
      const reply = await call(db, { action: 'inmail_balance', account_id: 'ancien-id' });
      strictEqual(reply.status, 200);
      strictEqual(reply.data.success, false);
      strictEqual(reply.data.error_code, 'account_disconnected');
      strictEqual(reply.data.status, 409);
      ok(/reconnecter/.test(reply.data.error));
      strictEqual(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('contrats : liste (ancien nom compris) et choix réservé au propriétaire du compte ou à un administrateur', async () => {
  await withEnv(ENV, async () => {
    const contracts = { object: 'AvailableContracts', contracts: [
      { object: 'Contract', id: 'c1', name: 'Contrat A', product: 'recruiter', selected: true },
      { object: 'Contract', id: 'c2', name: 'Contrat B', product: 'recruiter', selected: false, description: 'Seconde équipe' },
    ] };
    const mock = withMockTransport(router({
      'GET /acc_own/linkedin/contracts': { body: contracts },
      'POST /acc_own/linkedin/contracts/c2/select': { body: { object: 'ContractSelected', contract: { id: 'c2', name: 'Contrat B', product: 'recruiter', selected: true } } },
    }));
    try {
      for (const action of ['list_contracts', 'list_recruiter_contracts']) {
        const reply = await call(ownedDb(), { action, account_id: 'acc_own' });
        strictEqual(reply.data.contracts.length, 2, action);
        strictEqual(reply.data.contracts[0].selected, true);
        deepStrictEqual(reply.data.recruiter_info, { has_recruiter: true, has_sales_navigator: false });
      }
      const selected = await call(ownedDb(), { action: 'select_contract', account_id: 'acc_own', contract_id: 'c2' });
      deepStrictEqual(selected.data, { success: true, contract: { id: 'c2', product: 'recruiter', selected: true } });
      // Un collègue simple membre ne choisit pas le contrat d'un autre.
      const member = ownedDb();
      member.table('organization_members')[0].role = 'member';
      strictEqual((await call(member, { action: 'select_contract', account_id: 'acc_peer', contract_id: 'c2' })).status, 403);
      strictEqual((await call(ownedDb(), { action: 'select_contract', account_id: 'acc_own' })).status, 400);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('update_proxy : pays et proxy personnalisé vers les champs du service, le mode IP n existe plus', async () => {
  await withEnv(ENV, async () => {
    const db = ownedDb();
    const mock = withMockTransport(router({
      'GET /accounts/acc_own': { body: li('acc_own', { proxy: { country: 'FR', auto_proxy: true } }) },
      'PATCH /accounts/acc_own': { body: li('acc_own', { proxy: { country: 'FR', auto_proxy: true } }) },
      'PATCH /accounts/acc_peer': { body: li('acc_peer') },
      'GET /accounts/acc_peer': { body: li('acc_peer') },
    }));
    const patches = () => mock.calls.filter((c) => c.method === 'PATCH');
    try {
      const country = await call(db, { action: 'update_proxy', account_id: 'acc_own', proxy_mode: 'country', proxy_country: 'fr' });
      deepStrictEqual(country.data, { success: true, account_id: 'acc_own', proxy_mode: 'country', rows_updated: 1 });
      deepStrictEqual(patches().map((c) => c.body), [{ auto_proxy_country: 'FR' }], 'proxy automatique : un seul appel, sans effacer de proxy');
      const row = db.table('member_linkedin_accounts')[0];
      strictEqual(row.proxy_mode, 'country');
      strictEqual(row.proxy_country, 'FR');
      strictEqual(row.proxy_is_active, true);
      strictEqual(row.proxy_last_error, null);

      const custom = await call(db, {
        action: 'update_proxy', account_id: 'acc_own', proxy_mode: 'custom', proxy_protocol: 'socks5', proxy_host: ' p.example ', proxy_port: '1080', proxy_username: 'u', proxy_password: 'SECRET-PROXY',
      });
      strictEqual(custom.data.success, true);
      deepStrictEqual(patches()[1].body, { proxy: { protocol: 'socks5', host: 'p.example', port: 1080, username: 'u', password: 'SECRET-PROXY' } });
      ok(!custom.raw.includes('SECRET-PROXY'));
      strictEqual(row.proxy_mode, 'custom');
      strictEqual(row.proxy_host, 'p.example', 'la base garde la valeur normalisée envoyée au service');

      const before = mock.calls.length;
      const ip = await call(db, { action: 'update_proxy', account_id: 'acc_own', proxy_mode: 'ip', proxy_ip: '1.2.3.4' });
      strictEqual(ip.status, 400);
      ok(/IP/.test(ip.data.error));
      strictEqual((await call(db, { action: 'update_proxy', account_id: 'acc_own', proxy_mode: 'country', proxy_country: 'FRA' })).status, 400);
      strictEqual((await call(db, { action: 'update_proxy', account_id: 'acc_own', proxy_mode: 'custom', proxy_host: 'h', proxy_port: '1', proxy_protocol: 'ftp' })).status, 400);
      // Hôte, identifiants : du texte de la bonne forme, rien d'autre.
      for (const host of [{ not: 'a string' }, 'http://x.test', 'a b', 'x.test/chemin', 'a'.repeat(254), ['p.example']]) {
        const bad = await call(db, { action: 'update_proxy', account_id: 'acc_own', proxy_mode: 'custom', proxy_host: host, proxy_port: '1080', proxy_protocol: 'http' });
        strictEqual(bad.status, 400, `hôte ${JSON.stringify(host).slice(0, 30)}`);
        strictEqual(row.proxy_host, 'p.example');
      }
      strictEqual((await call(db, { action: 'update_proxy', account_id: 'acc_own', proxy_mode: 'custom', proxy_host: 'p.example', proxy_port: '1080', proxy_protocol: 'http', proxy_password: { x: 1 } })).status, 400);
      strictEqual(mock.calls.length, before, 'aucune requête invalide n atteint le service');
      strictEqual((await call(db, { action: 'update_proxy', account_id: 'acc_foreign', proxy_mode: 'country', proxy_country: 'FR' })).status, 403);
      strictEqual((await call(db, { action: 'update_proxy', account_id: 'acc_peer', proxy_mode: 'country', proxy_country: 'FR' })).status, 200, 'un administrateur règle le proxy d un collègue');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('update_proxy : un pays retire d abord un proxy personnalisé, dans un appel à part', async () => {
  await withEnv(ENV, async () => {
    const db = ownedDb();
    const mock = withMockTransport(router({
      'GET /accounts/acc_own': { body: li('acc_own', { proxy: { country: null, auto_proxy: false, host: 'p.example', port: 1080, protocol: 'socks5' } }) },
      'PATCH /accounts/acc_own': { body: li('acc_own') },
    }));
    try {
      const reply = await call(db, { action: 'update_proxy', account_id: 'acc_own', proxy_mode: 'country', proxy_country: 'de' });
      strictEqual(reply.data.success, true);
      deepStrictEqual(mock.calls.filter((c) => c.method === 'PATCH').map((c) => c.body), [{ proxy: null }, { auto_proxy_country: 'DE' }]);
      strictEqual(db.table('member_linkedin_accounts')[0].proxy_mode, 'country');
      strictEqual(db.table('member_linkedin_accounts')[0].proxy_host, null);
    } finally {
      mock.restore();
    }
    // Le proxy ne peut pas être retiré : le pays n'est pas posé et la base ne dit pas le contraire.
    const failing = ownedDb();
    const mock2 = withMockTransport(router({
      'GET /accounts/acc_own': { body: li('acc_own', { proxy: { country: null, auto_proxy: false, host: 'p.example', port: 1080 } }) },
      'PATCH /accounts/acc_own': { status: 400, body: { message: 'Unipile refused' } },
    }));
    try {
      const reply = await call(failing, { action: 'update_proxy', account_id: 'acc_own', proxy_mode: 'country', proxy_country: 'DE' });
      strictEqual(reply.data.success, false);
      strictEqual(mock2.calls.filter((c) => c.method === 'PATCH').length, 1, 'le pays n est pas envoyé après un effacement refusé');
      strictEqual(failing.table('member_linkedin_accounts')[0].proxy_mode, undefined);
      strictEqual(failing.table('member_linkedin_accounts')[0].proxy_is_active, false);
      assertNoVendor(reply);
    } finally {
      mock2.restore();
    }
  });
});

Deno.test('update_proxy : refus du service = état en échec, texte Konekt, code numérique pour l écran', async () => {
  await withEnv(ENV, async () => {
    const db = ownedDb();
    const mock = withMockTransport(router({
      'GET /accounts/acc_own': { body: li('acc_own') },
      'PATCH /accounts/acc_own': { status: 400, body: { message: 'Unipile: country unavailable' } },
    }));
    try {
      const reply = await call(db, { action: 'update_proxy', account_id: 'acc_own', proxy_mode: 'country', proxy_country: 'FR' });
      strictEqual(reply.status, 200);
      strictEqual(reply.data.success, false);
      strictEqual(reply.data.status, 400);
      assertNoVendor(reply);
      const row = db.table('member_linkedin_accounts')[0];
      strictEqual(row.proxy_is_active, false);
      ok(!/unipile/i.test(String(row.proxy_last_error)));
    } finally {
      mock.restore();
    }
  });
});

Deno.test('update_proxy : sans liaison locale, un message sans identifiant interne', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({
      member_email_accounts: [{ id: MAPPING, organization_id: ORG, user_id: USER, email_account_id: 'acc_mail_own' }],
    });
    const mock = withMockTransport(router({
      'GET /accounts/acc_mail_own': { body: fixtures.account({ id: 'acc_mail_own', provider: 'google' }) },
      'PATCH /accounts/acc_mail_own': { body: fixtures.account({ id: 'acc_mail_own', provider: 'google' }) },
    }));
    try {
      const reply = await call(db, { action: 'update_proxy', account_id: 'acc_mail_own', proxy_mode: 'country', proxy_country: 'FR' });
      strictEqual(reply.data.success, false);
      ok(!reply.raw.includes('acc_mail_own') && !reply.raw.includes(ORG), reply.raw);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('get_account_details : jamais les identifiants du proxy, état Konekt, licences par contrats', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({
      'GET /accounts/acc_detail': { body: li('acc_detail', { proxy: { country: 'FR', auto_proxy: false, host: 'h', port: 1, username: 'u', protocol: 'https' } }) },
      'GET /acc_detail/linkedin/contracts': { body: { contracts: [{ id: 'c1', name: 'A', product: 'sales_navigator', selected: true }] } },
    }));
    try {
      const reply = await call(ownedDb(), { action: 'get_account_details', account_id: 'acc_detail' });
      strictEqual(reply.data.account.type, 'LINKEDIN');
      strictEqual(reply.data.account.status, 'OK');
      deepStrictEqual(reply.data.account.proxy, { country: 'FR', auto_proxy: false, host: 'h', port: 1, protocol: 'https' });
      deepStrictEqual(reply.data.account.premium_features, ['sales_navigator']);
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Messages and invitations
// ---------------------------------------------------------------------------

Deno.test('add_reaction, delete_message, delete_chat : compte et conversation voyagent ensemble, 204 sans corps', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({
      'POST /acc_own/chats/chat1/messages/msg1/reactions': { body: { object: 'MessageReactionAdded' } },
      'DELETE /acc_own/chats/chat1/messages/msg1': () => emptyResponse(204),
      'DELETE /acc_own/chats/chat1': () => emptyResponse(204),
    }));
    try {
      const reaction = await call(ownedDb(), { action: 'add_reaction', account_id: 'acc_own', chat_id: 'chat1', message_id: 'msg1', reaction: '👍' });
      deepStrictEqual(reaction.data, { success: true });
      deepStrictEqual(mock.calls[0].body, { reaction: '👍' });
      deepStrictEqual((await call(ownedDb(), { action: 'delete_message', account_id: 'acc_own', chat_id: 'chat1', message_id: 'msg1' })).data, { success: true });
      deepStrictEqual((await call(ownedDb(), { action: 'delete_chat', account_id: 'acc_own', chat_id: 'chat1' })).data, { success: true });
      // Sans compte dans la requête : celui de l'appelant. Le compte d'un autre espace est refusé.
      deepStrictEqual((await call(ownedDb(), { action: 'delete_chat', chat_id: 'chat1' })).data, { success: true });
      strictEqual((await call(ownedDb(), { action: 'delete_chat', account_id: 'acc_foreign', chat_id: 'chat1' })).status, 403);
      strictEqual((await call(ownedDb(), { action: 'delete_message', account_id: 'acc_own', message_id: 'msg1' })).status, 400, 'la conversation est obligatoire');
      strictEqual((await call(makeDb(), { action: 'delete_chat', chat_id: 'chat1' })).status, 400, 'aucun compte relié');
    } finally {
      mock.restore();
    }
    const failing = withMockTransport(router({ 'DELETE /acc_own/chats/chat1': { status: 403, body: { message: 'Unipile: not supported' } } }));
    try {
      const reply = await call(ownedDb(), { action: 'delete_chat', account_id: 'acc_own', chat_id: 'chat1' });
      strictEqual(reply.data.success, false);
      assertNoVendor(reply);
    } finally {
      failing.restore();
    }
  });
});

Deno.test('add_reaction, delete_message, delete_chat : jamais depuis le compte d un collègue, même pour un administrateur', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({
      'POST /acc_peer/chats/chat1/messages/msg1/reactions': { body: {} },
      'DELETE /acc_peer/chats/chat1/messages/msg1': () => emptyResponse(204),
      'DELETE /acc_peer/chats/chat1': () => emptyResponse(204),
    }));
    try {
      // USER est administrateur de l'organisation ; acc_peer est relié à PEER.
      for (const body of [
        { action: 'add_reaction', account_id: 'acc_peer', chat_id: 'chat1', message_id: 'msg1', reaction: '👍' },
        { action: 'delete_message', account_id: 'acc_peer', chat_id: 'chat1', message_id: 'msg1' },
        { action: 'delete_chat', account_id: 'acc_peer', chat_id: 'chat1' },
      ]) {
        const reply = await call(ownedDb(), body);
        strictEqual(reply.status, 403, body.action);
        strictEqual(reply.data.success, false);
      }
      // Ni une boîte e-mail de l'organisation, ni le WhatsApp du membre : seulement son compte LinkedIn.
      strictEqual((await call(whatsappDb(), { action: 'delete_chat', account_id: 'acc_mail_own', chat_id: 'chat1' })).status, 403);
      strictEqual((await call(whatsappDb(), { action: 'delete_chat', account_id: 'acc_wa_own', chat_id: 'chat1' })).status, 403);
      strictEqual(mock.calls.length, 0, 'aucun appel au service');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('invitations reçues : liste au format habituel, accepter ou refuser sans secret partagé', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({
      'GET /acc_own/users/me/relation-requests': () => ({
        body: {
          data: [{ object: 'RelationRequest', type: 'received', id: 'rr1', created_at: '2026-10-01T10:00:00.000Z', message: 'Bonjour', user: { id: 'ACoAAabc', display_name: 'Paul Durand', public_identifier: 'paul-durand', description: 'Dev', public_picture_url: 'https://media.example/p.jpg' } }],
          next_cursor: 'cur2',
        },
      }),
      'POST /acc_own/users/me/relation-requests/rr1/accept': { body: { object: 'RelationRequestConfirmed' } },
      'POST /acc_own/users/me/relation-requests/rr2/cancel': { body: { object: 'RelationRequestCanceled' } },
    }));
    try {
      const list = await call(ownedDb(), { action: 'list_invitations_received', account_id: 'acc_own', limit: 500 });
      strictEqual(mock.calls[0].query.get('type'), 'received');
      strictEqual(mock.calls[0].query.get('limit'), '100');
      deepStrictEqual(list.data.invitations[0], {
        id: 'rr1', inviter_name: 'Paul Durand', inviter_id: 'ACoAAabc', inviter_public_identifier: 'paul-durand', inviter_description: 'Dev',
        inviter_picture_url: 'https://media.example/p.jpg', invitation_text: 'Bonjour', date: '2026-10-01T10:00:00.000Z',
        parsed_datetime: '2026-10-01T10:00:00.000Z', shared_secret: '', provider: 'LINKEDIN',
      });
      strictEqual(list.data.cursor, 'cur2');

      const accepted = await call(ownedDb(), { action: 'handle_invitation_received', account_id: 'acc_own', invitation_id: 'rr1', invitation_action: 'accept' });
      deepStrictEqual(accepted.data, { success: true, status: 'ACCEPTED' });
      const declined = await call(ownedDb(), { action: 'handle_invitation_received', account_id: 'acc_own', invitation_id: 'rr2', action_: 1, invitation_action: 'decline' });
      deepStrictEqual(declined.data, { success: true, status: 'DECLINED' });
      strictEqual((await call(ownedDb(), { action: 'handle_invitation_received', account_id: 'acc_own', invitation_id: 'rr1', invitation_action: 'maybe' })).status, 400);
      strictEqual((await call(ownedDb(), { action: 'handle_invitation_received', account_id: 'acc_foreign', invitation_id: 'rr1', invitation_action: 'accept' })).status, 403);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('bulk_handle_invitations : un résultat par invitation, arrêt au premier plafond atteint', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({
      'POST /acc_own/users/me/relation-requests/a/accept': { body: { object: 'RelationRequestConfirmed' } },
      'POST /acc_own/users/me/relation-requests/b/cancel': { status: 500, body: { message: 'Unipile 500' } },
      'POST /acc_own/users/me/relation-requests/c/accept': { status: 429, body: { message: 'Too many requests' } },
    }));
    const realTimeout = globalThis.setTimeout;
    // @ts-ignore: no 1.5 s pause in a test
    globalThis.setTimeout = (fn: () => void) => realTimeout(fn, 0);
    try {
      const reply = await call(ownedDb(), {
        action: 'bulk_handle_invitations', account_id: 'acc_own',
        invitations: [
          { invitation_id: 'a', action: 'accept' },
          { invitation_id: 'b', action: 'decline' },
          { invitation_id: 'c', action: 'accept' },
          { invitation_id: 'd', action: 'accept' },
        ],
      });
      deepStrictEqual(reply.data.results.map((r: any) => [r.invitation_id, r.status]), [['a', 'ACCEPTED'], ['b', 'ERROR'], ['c', 'RATE_LIMITED']]);
      assertNoVendor(reply);
    } finally {
      globalThis.setTimeout = realTimeout;
      mock.restore();
    }
  });
});

Deno.test('bulk_handle_invitations : au plus 30 invitations par appel, refus avant tout appel au service', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({}));
    try {
      const many = Array.from({ length: 31 }, (_, i) => ({ invitation_id: `i${i}`, action: 'accept' }));
      const reply = await call(ownedDb(), { action: 'bulk_handle_invitations', account_id: 'acc_own', invitations: many });
      strictEqual(reply.status, 400);
      ok(/30/.test(reply.data.error));
      strictEqual(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('get_attendee_picture : adresse de la photo de la conversation, jamais d octets', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({
      'GET /acc_own/chats/chat1': { body: { id: 'chat1', type: '1to1', user: { id: 'ACoAAabc', public_picture_url: 'https://media.example/p.jpg' } } },
      'GET /acc_own/chats/chat2': { body: { id: 'chat2', type: '1to1' } },
    }));
    try {
      deepStrictEqual((await call(ownedDb(), { action: 'get_attendee_picture', account_id: 'acc_own', chat_id: 'chat1' })).data, { success: true, picture_url: 'https://media.example/p.jpg' });
      strictEqual((await call(ownedDb(), { action: 'get_attendee_picture', account_id: 'acc_own', chat_id: 'chat2' })).data.success, false);
      strictEqual((await call(ownedDb(), { action: 'get_attendee_picture', attendee_id: 'old' })).data.success, false);
      // Ce qui n'avait aucun contrôle d'appartenance en a un : le compte d'un autre espace est refusé.
      strictEqual((await call(ownedDb(), { action: 'get_attendee_picture', account_id: 'acc_foreign', chat_id: 'chat1' })).status, 403);
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Connection actions through the handler
// ---------------------------------------------------------------------------

Deno.test('connection_* par le gestionnaire : départ, statut, annulation, et refus lisibles', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://connect.konekt.test/x' } } }));
    try {
      const caps = await call(db, { action: 'connection_capabilities' });
      strictEqual(caps.data.success, true);
      const started = await call(db, { action: 'connection_start', provider: 'linkedin' });
      strictEqual(started.status, 200);
      strictEqual(started.data.success, true);
      strictEqual(started.data.mode, 'hosted');
      deepStrictEqual(started.data.next, { kind: 'redirect', url: 'https://connect.konekt.test/x' });
      const status = await call(db, { action: 'connection_status', attempt_id: started.data.attempt_id });
      deepStrictEqual(status.data, { success: true, status: 'pending', provider: 'linkedin', mode: 'hosted' });
      strictEqual((await call(db, { action: 'connection_status', attempt_id: started.data.attempt_id }, { userId: PEER })).data.error_code, 'attempt_not_found');
      deepStrictEqual((await call(db, { action: 'connection_cancel', attempt_id: started.data.attempt_id })).data, { success: true });
      const closed = await call(db, { action: 'connection_checkpoint', attempt_id: started.data.attempt_id, code: '1' });
      strictEqual(closed.data.success, false);
      strictEqual(closed.data.error_code, 'attempt_closed');
      assertNoVendor(closed);
      const invalid = await call(db, { action: 'connection_start', provider: 'inconnu' });
      strictEqual(invalid.status, 200);
      strictEqual(invalid.data.error_code, 'validation');
      const nativeOff = await withEnv({ CONNECTION_NATIVE_ENABLED: null }, () => call(db, { action: 'connection_start', provider: 'whatsapp', mode: 'native' }));
      strictEqual(nativeOff.data.error_code, 'feature_disabled');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('les anciens noms hosted_auth_link, connect_credentials et solve_checkpoint ne sont plus servis : réponse neutre, aucun appel au service', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({}));
    try {
      const db = makeDb();
      for (const action of ['hosted_auth_link', 'connect_credentials', 'solve_checkpoint']) {
        const reply = await call(db, { action, providers: ['LINKEDIN'], username: 'a@b.fr', password: 'pw', account_id: 'acc_new', code: '123456' });
        strictEqual(reply.status, 400, action);
        deepStrictEqual(reply.data, { success: false, error: 'Action non reconnue' }, action);
        assertNoVendor(reply);
      }
      strictEqual(mock.calls.length, 0);
      strictEqual(db.table('connection_attempts').length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connect_cookie par le gestionnaire (contrat de l extension), vérification par connection_checkpoint', async () => {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  await withEnv({ ...ENV, CONNECTION_NATIVE_ENABLED: null }, async () => {
    const reply = await call(makeDb(), { action: 'connect_cookie', access_token: 'AQED', user_agent: UA });
    strictEqual(reply.data.success, false);
    strictEqual(reply.data.error_code, 'feature_disabled');
    assertNoVendor(reply);
  });
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({
      'POST /auth/intent': { body: { object: 'AuthenticationCheckpoint', intent_id: 'acc_i1', checkpoint: { type: '2FA', platform: 'APP' } } },
      'POST /auth/checkpoint': { body: li('acc_new', { name: 'Claire' }) },
    }));
    try {
      const started = await call(db, { action: 'connect_cookie', access_token: 'AQED', user_agent: UA });
      strictEqual(started.data.success, true);
      strictEqual(started.data.object, 'Checkpoint');
      deepStrictEqual(started.data.checkpoint, { type: '2FA' });
      const bad = await call(db, { action: 'connect_cookie', user_agent: UA });
      strictEqual(bad.status, 400);
      const forged = await call(db, { action: 'connection_checkpoint', attempt_id: 'acc_new', code: '123456' });
      strictEqual(forged.data.error_code, 'attempt_not_found');
      const solved = await call(db, { action: 'connection_checkpoint', attempt_id: started.data.account_id, code: '123456' });
      strictEqual(solved.data.success, true);
      strictEqual(db.table('member_linkedin_accounts')[0].linkedin_account_id, 'acc_new');
    } finally {
      mock.restore();
    }
  });
});
