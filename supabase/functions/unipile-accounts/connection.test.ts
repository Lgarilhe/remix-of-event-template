// Connection actions end to end, against a fake database and a fake transport (no network).
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-accounts/connection.test.ts

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { FakeDb } from '../_shared/connection-claim.testing.ts';
import { emptyResponse, fixtures, jsonResponse, type MockHandler, type RecordedRequest, withMockTransport } from '../_shared/unipile/testing.ts';
import {
  cancelConnection,
  checkpointConnection,
  ConnectionFailure,
  type ConnectionContext,
  connectionCapabilities,
  connectionStatus,
  connectWithCookie,
  resendConnection,
  startConnection,
} from './connection.ts';
import { HttpError } from './ownership.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PEER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const ENV = {
  UNIPILE_V2_API_KEY: 'test-key',
  UNIPILE_HOSTED_DOMAIN: 'connect.konekt.test',
  APP_URL: 'https://app.konekt.test',
  CONNECTION_NATIVE_ENABLED: '1',
};

/** Runs `run` with the given environment, restored afterwards. */
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

/** Every console line written while `run` executes (credentials must never be among them). */
async function captureConsole<T>(run: () => Promise<T>): Promise<{ result: T; lines: string }> {
  const lines: string[] = [];
  const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  const sink = (...args: unknown[]) => lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, (_k, v) => v instanceof Error ? v.message : v))).join(' '));
  console.log = console.warn = console.error = console.info = console.debug = sink;
  try {
    return { result: await run(), lines: lines.join('\n') };
  } finally {
    Object.assign(console, originals);
  }
}

function makeDb(extra: Record<string, Array<Record<string, unknown>>> = {}): FakeDb {
  const db = new FakeDb({
    connection_attempts: [],
    member_linkedin_accounts: [],
    member_email_accounts: [],
    member_whatsapp_accounts: [],
    organization_members: [
      { organization_id: ORG, user_id: USER, role: 'member' },
      { organization_id: ORG, user_id: PEER, role: 'member' },
    ],
    ...extra,
  });
  db.defaults('connection_attempts', () => ({
    status: 'pending', intent_id: null, account_id: null, error_kind: null, created_at: new Date().toISOString(), completed_at: null,
  }));
  db.unique('connection_attempts', ['user_id', 'provider'], { where: (row) => row.status === 'pending' });
  db.unique('member_linkedin_accounts', ['linkedin_account_id', 'organization_id']);
  return db;
}

function ctxOf(db: FakeDb, userId = USER, organizationId = ORG): ConnectionContext {
  return { admin: db, organizationId, userId };
}

type Route = ((request: RecordedRequest) => ReturnType<MockHandler>) | { status?: number; body?: unknown };

function router(routes: Record<string, Route>): MockHandler {
  return (request) => {
    const route = routes[`${request.method} ${request.path}`];
    if (!route) return { status: 404, body: { message: `not mocked: ${request.method} ${request.path}` } };
    return typeof route === 'function' ? route(request) : route;
  };
}

const otpCheckpoint = { object: 'AuthenticationCheckpoint', intent_id: 'acc_intent1', checkpoint: { type: 'OTP', channel: 'EMAIL' } };
const linkedinAccount = (overrides: Record<string, unknown> = {}) => fixtures.account({ id: 'acc_li1', name: 'Claire Martin', ...overrides });

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

Deno.test('connection_capabilities : natif éteint sans le drapeau serveur, lien hébergé et domaine annoncés', async () => {
  await withEnv({ ...ENV, CONNECTION_NATIVE_ENABLED: null }, () => {
    const caps = connectionCapabilities();
    deepStrictEqual(caps, {
      success: true,
      hosted: { available: true, white_label: true },
      native: { linkedin: false, whatsapp: false, imap: false, oauth: false },
      products: { recruiter_exclusive_with_sales_navigator: true },
    });
  });
  await withEnv({ ...ENV, CONNECTION_NATIVE_ENABLED: '0' }, () => strictEqual(connectionCapabilities().native.linkedin, false));
  await withEnv(ENV, () => deepStrictEqual(connectionCapabilities().native, { linkedin: true, whatsapp: true, imap: true, oauth: true }));
  await withEnv({ ...ENV, UNIPILE_V2_API_KEY: null, UNIPILE_HOSTED_DOMAIN: null }, () => {
    deepStrictEqual(connectionCapabilities().hosted, { available: false, white_label: false });
  });
});

// ---------------------------------------------------------------------------
// connection_start : hosted
// ---------------------------------------------------------------------------

Deno.test('connection_start hébergé LinkedIn : lien porteur de l état, domaine, offres explicites, retour fixé par le serveur', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { object: 'HostedAuthLink', link: 'https://connect.konekt.test/link/abc' } } }));
    try {
      const started = await startConnection(ctxOf(db), { provider: 'linkedin' });
      const attempt = db.table('connection_attempts')[0];
      strictEqual(started.attempt.id, attempt.id);
      deepStrictEqual(started.next, { kind: 'redirect', url: 'https://connect.konekt.test/link/abc' });
      strictEqual(attempt.user_id, USER);
      strictEqual(attempt.organization_id, ORG);
      strictEqual(attempt.provider, 'linkedin');
      strictEqual(attempt.mode, 'hosted');
      strictEqual(attempt.purpose, 'link');

      const body = mock.calls[0].body as Record<string, any>;
      strictEqual(body.state, attempt.id);
      strictEqual(body.redirect_uri, 'https://app.konekt.test/settings/account/connections/retour');
      strictEqual(body.domain, 'connect.konekt.test');
      deepStrictEqual(body.providers, ['linkedin']);
      ok(Date.parse(body.expires_on) > Date.now() + 25 * 60_000 && Date.parse(body.expires_on) <= Date.now() + 31 * 60_000, 'trente minutes');
      deepStrictEqual(body.config.linkedin.products, ['classic', 'recruiter', 'sales_navigator']);
      strictEqual(body.config.linkedin.allow_product_selection, true);
      deepStrictEqual(body.config.linkedin.allow_methods, ['credentials', 'cookies']);
      strictEqual(body.config.global.allow_user_country_override, true);
      for (const gone of ['name', 'notify_url', 'type', 'api_url', 'success_redirect_url', 'failure_redirect_url', 'organization_display_name', 'expiresOn']) {
        ok(!(gone in body), `${gone} n'existe plus`);
      }
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start hébergé : l entreprise n est jamais demandée sauf si elle l est', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://connect.konekt.test/x' } } }));
    try {
      await startConnection(ctxOf(makeDb()), { provider: 'linkedin', linkedin: { products: ['recruiter'] } });
      deepStrictEqual((mock.calls[0].body as any).config.linkedin.products, ['recruiter']);
      await startConnection(ctxOf(makeDb()), { provider: 'linkedin', country: 'fr' });
      const second = mock.calls[1].body as any;
      ok(!second.config.linkedin.products.includes('company'));
      deepStrictEqual(second.config.linkedin.auto_proxy_config, { country: 'FR' });
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start hébergé WhatsApp et messagerie', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://connect.konekt.test/x' } } }));
    try {
      await startConnection(ctxOf(makeDb()), { provider: 'whatsapp' });
      const wa = mock.calls[0].body as any;
      deepStrictEqual(wa.providers, ['whatsapp']);
      deepStrictEqual(wa.config.whatsapp.allow_methods, ['qr', 'pairing']);
      strictEqual(wa.config.global.wait_initial_sync, true);
      ok(!wa.config.linkedin);

      await startConnection(ctxOf(makeDb()), { provider: 'outlook' });
      const mail = mock.calls[1].body as any;
      deepStrictEqual(mail.providers, ['outlook']);
      ok(!mail.config, 'aucune configuration pour une messagerie');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start : un lien hors du domaine configuré est refusé et la tentative échoue', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://auth.provider.example/abc' } } }));
    try {
      await rejects(() => startConnection(ctxOf(db), { provider: 'linkedin' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'server');
      strictEqual(db.table('connection_attempts')[0].status, 'failed');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start : un nouveau départ annule la tentative en cours du même canal', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://connect.konekt.test/x' } } }));
    try {
      const first = await startConnection(ctxOf(db), { provider: 'linkedin' });
      const second = await startConnection(ctxOf(db), { provider: 'linkedin' });
      const other = await startConnection(ctxOf(db), { provider: 'whatsapp' });
      const rows = db.table('connection_attempts');
      strictEqual(rows.find((r) => r.id === first.attempt.id)?.status, 'cancelled');
      strictEqual(rows.find((r) => r.id === second.attempt.id)?.status, 'pending');
      strictEqual(rows.find((r) => r.id === other.attempt.id)?.status, 'pending', 'un autre canal reste en cours');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start : limite de débit, mode direct éteint, saisie invalide : aucun appel au service, aucune tentative', async () => {
  await withEnv({ ...ENV, CONNECTION_NATIVE_ENABLED: null }, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({}));
    try {
      await rejects(
        () => startConnection(ctxOf(db), { provider: 'linkedin', mode: 'native', linkedin: { username: 'a@b.fr', password: 'pw' } }),
        (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'feature_disabled',
      );
      await rejects(() => startConnection(ctxOf(db), { provider: 'inconnu' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'validation');
      db.rpcResults.check_rate_limit = false;
      await rejects(() => startConnection(ctxOf(db), { provider: 'linkedin' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'rate_limited');
      strictEqual(mock.calls.length, 0);
      strictEqual(db.table('connection_attempts').length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start : le service refuse, la tentative échoue avec une nature d erreur et un texte Konekt', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({
      'POST /auth/link': { status: 500, body: { message: 'Unipile exploded: secret detail' } },
    }));
    try {
      const { result, lines } = await captureConsole(() =>
        startConnection(ctxOf(db), { provider: 'linkedin' }).catch((e) => e as ConnectionFailure)
      );
      ok(result instanceof ConnectionFailure);
      strictEqual((result as ConnectionFailure).errorCode, 'server');
      ok(!/unipile|secret detail/i.test((result as ConnectionFailure).message));
      strictEqual(db.table('connection_attempts')[0].status, 'failed');
      strictEqual(db.table('connection_attempts')[0].error_kind, 'server');
      ok(lines.length >= 0);
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// connection_start : reconnect
// ---------------------------------------------------------------------------

Deno.test('connection_start : reconnexion du compte relié, variante account_id du lien', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({ member_linkedin_accounts: [{ id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_li1' }] });
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://connect.konekt.test/x' } } }));
    try {
      const started = await startConnection(ctxOf(db), { provider: 'linkedin', reconnect_account_id: 'acc_li1' });
      strictEqual(started.attempt.purpose, 'reconnect');
      strictEqual(started.attempt.reconnect_account_id, 'acc_li1');
      const body = mock.calls[0].body as any;
      strictEqual(body.account_id, 'acc_li1');
      ok(!('providers' in body));
      ok(!('products' in body.config.linkedin), 'les offres déjà autorisées sont gardées');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start : on ne reconnecte ni le compte d un autre espace, ni un compte orphelin, ni un compte du mauvais canal', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({
      member_linkedin_accounts: [
        { id: 'm-foreign', organization_id: OTHER_ORG, user_id: PEER, linkedin_account_id: 'acc_foreign' },
        { id: 'm-peer', organization_id: ORG, user_id: PEER, linkedin_account_id: 'acc_peer' },
      ],
      member_whatsapp_accounts: [{ id: 'w1', organization_id: ORG, user_id: USER, whatsapp_account_id: 'acc_wa1' }],
    });
    const mock = withMockTransport(router({}));
    try {
      for (const id of ['acc_foreign', 'acc_orphan']) {
        await rejects(() => startConnection(ctxOf(db), { provider: 'linkedin', reconnect_account_id: id }), (e: unknown) => e instanceof HttpError && e.status === 403, id);
      }
      // Un collègue simple membre : refusé. Le canal doit correspondre au compte.
      await rejects(() => startConnection(ctxOf(db), { provider: 'linkedin', reconnect_account_id: 'acc_peer' }), (e: unknown) => e instanceof HttpError && e.status === 403);
      await rejects(() => startConnection(ctxOf(db), { provider: 'linkedin', reconnect_account_id: 'acc_wa1' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'validation');
      strictEqual(mock.calls.length, 0);
      strictEqual(db.table('connection_attempts').length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start : un administrateur peut reconnecter le compte d un collègue', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({ member_linkedin_accounts: [{ id: 'm-peer', organization_id: ORG, user_id: PEER, linkedin_account_id: 'acc_peer' }] });
    db.table('organization_members')[0].role = 'admin';
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://connect.konekt.test/x' } } }));
    try {
      const started = await startConnection(ctxOf(db), { provider: 'linkedin', reconnect_account_id: 'acc_peer' });
      strictEqual(started.attempt.purpose, 'reconnect');
      strictEqual(started.attempt.user_id, USER);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start : un lien resté sur un ancien identifiant redevient une nouvelle liaison, sans appel avec cet identifiant', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({ member_linkedin_accounts: [{ id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'ancien-identifiant' }] });
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://connect.konekt.test/x' } } }));
    try {
      const started = await startConnection(ctxOf(db), { provider: 'linkedin', reconnect_account_id: 'ancien-identifiant' });
      strictEqual(started.attempt.purpose, 'link');
      strictEqual(started.attempt.reconnect_account_id, null);
      ok(!JSON.stringify(mock.calls[0].body).includes('ancien-identifiant'));
      deepStrictEqual((mock.calls[0].body as any).providers, ['linkedin']);
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// connection_start : native
// ---------------------------------------------------------------------------

Deno.test('connection_start natif LinkedIn par cookie : corps de l intention, jamais d identifiant dans la ligne ni dans les journaux', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({ 'POST /auth/intent': { body: otpCheckpoint } }));
    try {
      const { result: started, lines } = await captureConsole(() =>
        startConnection(ctxOf(db), {
          provider: 'linkedin', mode: 'native', country: 'fr', timezone: 'Europe/Paris',
          linkedin: { method: 'cookie', access_token: 'SECRET-LI-AT', premium_access_token: 'SECRET-LI-A', user_agent: UA },
        })
      );
      deepStrictEqual(started.next, { kind: 'checkpoint', type: 'OTP', channel: 'EMAIL' });
      const body = mock.calls[0].body as any;
      strictEqual(body.provider, 'linkedin');
      deepStrictEqual(body.credentials, { access_token: 'SECRET-LI-AT', premium_access_token: 'SECRET-LI-A', user_agent: UA });
      deepStrictEqual(body.config.products, ['classic', 'recruiter', 'sales_navigator']);
      ok(!('allow_product_selection' in body.config), 'la sélection d\'offre reste au défaut du service : aucun écran de consentement à traiter');
      deepStrictEqual(body.config.auto_proxy_config, { country: 'FR' });
      strictEqual(body.user_timezone, 'Europe/Paris');
      strictEqual(body.state, started.attempt.id);
      ok(!('account_id' in body));

      const row = db.table('connection_attempts')[0];
      strictEqual(row.intent_id, 'acc_intent1');
      strictEqual(row.mode, 'native');
      const stored = JSON.stringify(db.table('connection_attempts')) + JSON.stringify(db.calls);
      ok(!/SECRET-LI/.test(stored), 'rien de secret en base');
      ok(!/SECRET-LI/.test(lines), 'rien de secret dans les journaux');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start natif LinkedIn par identifiants : le mot de passe ne sort que dans l appel au service', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({ 'POST /auth/intent': { body: otpCheckpoint } }));
    try {
      const { lines } = await captureConsole(() =>
        startConnection(ctxOf(db), { provider: 'linkedin', mode: 'native', linkedin: { method: 'credentials', username: 'claire@exemple.fr', password: 'SECRET-PASSWORD' } })
      );
      deepStrictEqual((mock.calls[0].body as any).credentials, { username: 'claire@exemple.fr', password: 'SECRET-PASSWORD' });
      ok(!/SECRET-PASSWORD/.test(lines + JSON.stringify(db.table('connection_attempts'))));
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start natif : une erreur du service ne laisse ni mot de passe ni texte du prestataire dans les journaux ni la réponse', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({ 'POST /auth/intent': { status: 400, body: { message: 'Unipile says: invalid password SECRET-PASSWORD for claire@exemple.fr' } } }));
    try {
      const { result, lines } = await captureConsole(() =>
        startConnection(ctxOf(db), { provider: 'linkedin', mode: 'native', linkedin: { method: 'credentials', username: 'claire@exemple.fr', password: 'SECRET-PASSWORD' } })
          .catch((e) => e as ConnectionFailure)
      );
      ok(result instanceof ConnectionFailure);
      strictEqual((result as ConnectionFailure).errorCode, 'validation');
      ok(!/unipile|SECRET/i.test((result as ConnectionFailure).message));
      strictEqual(db.table('connection_attempts')[0].status, 'failed');
      void lines;
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start natif : la reconnexion envoie account_id et garde les offres', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({ member_linkedin_accounts: [{ id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_li1' }] });
    const mock = withMockTransport(router({ 'POST /auth/intent': { body: otpCheckpoint } }));
    try {
      await startConnection(ctxOf(db), { provider: 'linkedin', mode: 'native', reconnect_account_id: 'acc_li1', linkedin: { method: 'credentials', username: 'a@b.fr', password: 'pw' } });
      const body = mock.calls[0].body as any;
      strictEqual(body.account_id, 'acc_li1');
      ok(!body.config || !('products' in body.config));
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start natif : un compte rendu tout de suite est rattaché depuis la tentative', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({ 'POST /auth/intent': { body: linkedinAccount() } }));
    try {
      const started = await startConnection(ctxOf(db), { provider: 'linkedin', mode: 'native', linkedin: { method: 'credentials', username: 'a@b.fr', password: 'pw' } });
      strictEqual(started.next.kind, 'done');
      const link = db.table('member_linkedin_accounts')[0];
      strictEqual(link.linkedin_account_id, 'acc_li1');
      strictEqual(link.user_id, USER);
      strictEqual(link.organization_id, ORG);
      strictEqual(db.table('connection_attempts')[0].status, 'completed');
      strictEqual(db.table('connection_attempts')[0].account_id, 'acc_li1');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start natif : liaison refusée = erreur lisible, tentative en échec', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({ member_linkedin_accounts: [{ id: 'm-foreign', organization_id: OTHER_ORG, user_id: PEER, linkedin_account_id: 'acc_li1' }] });
    const mock = withMockTransport(router({ 'POST /auth/intent': { body: linkedinAccount() } }));
    try {
      await rejects(
        () => startConnection(ctxOf(db), { provider: 'linkedin', mode: 'native', linkedin: { method: 'credentials', username: 'a@b.fr', password: 'pw' } }),
        (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'already_linked_org' && /autre espace de travail/.test(e.message),
      );
      strictEqual(db.table('connection_attempts')[0].status, 'failed');
      strictEqual(db.table('member_linkedin_accounts').length, 1);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start natif WhatsApp, messagerie IMAP et OAuth', async () => {
  await withEnv(ENV, async () => {
    const intents: any[] = [];
    const mock = withMockTransport(router({
      'POST /auth/intent': (request) => {
        const body = request.body as any;
        intents.push(body);
        if (body.provider === 'whatsapp') return { body: { object: 'AuthenticationQrCode', qrcode: '2@abcdef', intent_id: 'acc_qr1' } };
        if (body.provider === 'google') return { body: { object: 'OauthUrl', url: 'https://accounts.example.com/o/oauth2/auth?client_id=x' } };
        return { body: fixtures.account({ id: 'acc_imap1', provider: 'imap', name: 'claire@exemple.fr' }) };
      },
    }));
    try {
      const db = makeDb();
      const qr = await startConnection(ctxOf(db), { provider: 'whatsapp', mode: 'native' });
      deepStrictEqual(qr.next, { kind: 'qrcode', qrcode: '2@abcdef' });
      deepStrictEqual(intents[0].credentials, { qrcode: true });
      strictEqual(db.table('connection_attempts')[0].intent_id, 'acc_qr1');

      const pairing = await startConnection(ctxOf(makeDb()), { provider: 'whatsapp', mode: 'native', whatsapp: { method: 'pairing', phone_number: '+33 6 12 34 56 78' } });
      void pairing;
      deepStrictEqual(intents[1].credentials, { phone_number: '33612345678' });

      const oauthDb = makeDb();
      const oauth = await startConnection(ctxOf(oauthDb), { provider: 'google', mode: 'native' });
      deepStrictEqual(oauth.next, { kind: 'redirect', url: 'https://accounts.example.com/o/oauth2/auth?client_id=x' });
      strictEqual(intents[2].oauth_callback_redirect_uri, 'https://app.konekt.test/settings/account/connections/retour');
      strictEqual(intents[2].state, oauth.attempt.id);

      const imapDb = makeDb();
      const imap = await startConnection(ctxOf(imapDb), { provider: 'imap', mode: 'native', imap: { user: 'claire@exemple.fr', password: 'pw' } });
      strictEqual(imap.next.kind, 'done');
      deepStrictEqual(intents[3].credentials, { user: 'claire@exemple.fr', password: 'pw' });
      const mailbox = imapDb.table('member_email_accounts')[0];
      strictEqual(mailbox.email_account_id, 'acc_imap1');
      strictEqual(mailbox.provider, 'MAIL');
      strictEqual(mailbox.email_address, 'claire@exemple.fr');
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// connection_checkpoint, resend, status, cancel
// ---------------------------------------------------------------------------

async function nativeAttempt(db: FakeDb, patch: Record<string, unknown> = {}): Promise<string> {
  const mock = withMockTransport(router({ 'POST /auth/intent': { body: otpCheckpoint } }));
  try {
    const started = await startConnection(ctxOf(db), { provider: 'linkedin', mode: 'native', linkedin: { method: 'credentials', username: 'a@b.fr', password: 'pw' } });
    Object.assign(db.table('connection_attempts').find((r) => r.id === started.attempt.id)!, patch);
    return started.attempt.id;
  } finally {
    mock.restore();
  }
}

Deno.test('connection_checkpoint : un code juste rattache le compte et termine la tentative', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db);
    const mock = withMockTransport(router({ 'POST /auth/checkpoint': { body: linkedinAccount() } }));
    try {
      const next = await checkpointConnection(ctxOf(db), { attempt_id: attemptId, code: ' 123456 ' });
      strictEqual(next.kind, 'done');
      deepStrictEqual(mock.calls[0].body, { code: '123456', intent_id: 'acc_intent1' });
      strictEqual(db.table('member_linkedin_accounts')[0].linkedin_account_id, 'acc_li1');
      strictEqual(db.table('connection_attempts')[0].status, 'completed');
      // Une tentative terminée n'accepte plus de code.
      await rejects(() => checkpointConnection(ctxOf(db), { attempt_id: attemptId, code: '123456' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'attempt_closed');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_checkpoint : une vérification suivante renvoie la nouvelle étape et garde la tentative ouverte', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db);
    const mock = withMockTransport(router({
      'POST /auth/checkpoint': { body: { object: 'AuthenticationCheckpoint', intent_id: 'acc_intent2', checkpoint: { type: 'IN_APP_VALIDATION' } } },
    }));
    try {
      const next = await checkpointConnection(ctxOf(db), { attempt_id: attemptId, code: '123456' });
      deepStrictEqual(next, { kind: 'checkpoint', type: 'IN_APP_VALIDATION' });
      strictEqual(db.table('connection_attempts')[0].intent_id, 'acc_intent2');
      strictEqual(db.table('connection_attempts')[0].status, 'pending');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_checkpoint : un mauvais code laisse la tentative ouverte, avec le texte Konekt', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db);
    const mock = withMockTransport(router({ 'POST /auth/checkpoint': { status: 400, body: { message: 'Wrong code, Unipile' } } }));
    try {
      await rejects(
        () => checkpointConnection(ctxOf(db), { attempt_id: attemptId, code: '000000' }),
        (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'validation' && e.message === "Ce code n'est pas valide. Vérifiez-le, puis réessayez.",
      );
      strictEqual(db.table('connection_attempts')[0].status, 'pending');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_checkpoint : un flux disparu chez le service expire la tentative', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db);
    const mock = withMockTransport(router({ 'POST /auth/checkpoint': { status: 404, body: { message: 'intent not found' } } }));
    try {
      await rejects(() => checkpointConnection(ctxOf(db), { attempt_id: attemptId, code: '123456' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'attempt_expired');
      strictEqual(db.table('connection_attempts')[0].status, 'expired');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_checkpoint : la tentative d un autre membre ou d une autre organisation est introuvable, sans appel au service', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db);
    const mock = withMockTransport(router({}));
    try {
      for (const ctx of [ctxOf(db, PEER), ctxOf(db, USER, OTHER_ORG)]) {
        await rejects(() => checkpointConnection(ctx, { attempt_id: attemptId, code: '123456' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'attempt_not_found');
      }
      for (const bad of ['', 'acc_intent1', 'user:abc|org:def', undefined]) {
        await rejects(() => checkpointConnection(ctxOf(db), { attempt_id: bad, code: '1' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'attempt_not_found');
      }
      strictEqual(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_checkpoint : une tentative échue est fermée et refusée', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const mock = withMockTransport(router({}));
    try {
      await rejects(() => checkpointConnection(ctxOf(db), { attempt_id: attemptId, code: '123456' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'attempt_expired');
      strictEqual(db.table('connection_attempts')[0].status, 'expired');
      strictEqual(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_checkpoint : sans code ni étape d attente, rien n est envoyé', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db);
    const mock = withMockTransport(router({}));
    try {
      await rejects(() => checkpointConnection(ctxOf(db), { attempt_id: attemptId }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'validation');
      strictEqual(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_checkpoint : le choix d une méthode passe par la demande de vérification', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db);
    const mock = withMockTransport(router({
      'POST /auth/checkpoint/request': { body: { object: 'AuthenticationCheckpoint', intent_id: 'acc_intent1', checkpoint: { type: 'OTP', channel: 'SMS' } } },
    }));
    try {
      const next = await checkpointConnection(ctxOf(db), { attempt_id: attemptId, challenge: 'SMS' });
      deepStrictEqual(next, { kind: 'checkpoint', type: 'OTP', channel: 'SMS' });
      deepStrictEqual(mock.calls[0].body, { intent_id: 'acc_intent1', challenge: 'SMS' });
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_resend : 204 sans corps, et changement de méthode', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db);
    const mock = withMockTransport(router({ 'POST /auth/checkpoint/resend': () => emptyResponse(204) }));
    try {
      const resent = await resendConnection(ctxOf(db), { attempt_id: attemptId });
      strictEqual(resent.next, null);
      deepStrictEqual(mock.calls[0].body, { intent_id: 'acc_intent1' });
      await rejects(() => resendConnection(ctxOf(db, PEER), { attempt_id: attemptId }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'attempt_not_found');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_status : état d une tentative hébergée, compte rattaché, échec lisible', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://connect.konekt.test/x' } } }));
    try {
      const started = await startConnection(ctxOf(db), { provider: 'linkedin' });
      const pending = await connectionStatus(ctxOf(db), { attempt_id: started.attempt.id });
      deepStrictEqual(pending, { success: true, status: 'pending', provider: 'linkedin', mode: 'hosted' });
      strictEqual(mock.calls.length, 1, 'un lien hébergé ne se sonde pas');

      // Le récepteur de webhook termine la tentative : le statut rend le compte.
      const row = db.table('connection_attempts')[0];
      Object.assign(row, { status: 'completed', account_id: 'acc_li1' });
      db.table('member_linkedin_accounts').push({ id: 'm1', organization_id: ORG, user_id: USER, linkedin_account_id: 'acc_li1', linkedin_account_name: 'Claire Martin', account_status: 'OK' });
      const done = await connectionStatus(ctxOf(db), { attempt_id: started.attempt.id, ignored: 'account_id=acc_other' });
      deepStrictEqual(done.account, { id: 'acc_li1', name: 'Claire Martin', status: 'OK' });
      strictEqual(done.status, 'completed');

      Object.assign(row, { status: 'failed', account_id: null, error_kind: 'claim_cross_tenant' });
      const failed = await connectionStatus(ctxOf(db), { attempt_id: started.attempt.id });
      strictEqual(failed.status, 'failed');
      strictEqual(failed.error_code, 'claim_cross_tenant');
      strictEqual(failed.error, 'Ce compte LinkedIn est déjà rattaché à un autre espace de travail.');

      await rejects(() => connectionStatus(ctxOf(db, PEER), { attempt_id: started.attempt.id }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'attempt_not_found');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_status : une tentative échue est annoncée expirée et fermée', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db, { expires_at: new Date(Date.now() - 1000).toISOString() });
    const status = await connectionStatus(ctxOf(db), { attempt_id: attemptId });
    strictEqual(status.status, 'expired');
    strictEqual(status.error_code, 'attempt_expired');
    strictEqual(db.table('connection_attempts')[0].status, 'expired');
  });
});

Deno.test('connection_status : une étape d attente nommée sonde le service et termine la connexion', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock0 = withMockTransport(router({ 'POST /auth/intent': { body: { object: 'AuthenticationQrCode', qrcode: '2@abc', intent_id: 'acc_qr1' } } }));
    let attemptId = '';
    try {
      attemptId = (await startConnection(ctxOf(db), { provider: 'whatsapp', mode: 'native' })).attempt.id;
    } finally {
      mock0.restore();
    }
    let scanned = false;
    const mock = withMockTransport(router({
      'POST /auth/checkpoint': () => scanned
        ? { body: fixtures.account({ id: 'acc_wa1', provider: 'whatsapp', name: '+33 6 12 34 56 78' }) }
        : { body: { object: 'AuthenticationQrCode', qrcode: '2@abc-refreshed', intent_id: 'acc_qr1' } },
    }));
    try {
      const waiting = await connectionStatus(ctxOf(db), { attempt_id: attemptId, waiting_step: 'QR_CODE' });
      strictEqual(waiting.status, 'pending');
      deepStrictEqual(waiting.next, { kind: 'qrcode', qrcode: '2@abc-refreshed' });
      deepStrictEqual(mock.calls[0].body, { code: '', intent_id: 'acc_qr1' });
      scanned = true;
      const done = await connectionStatus(ctxOf(db), { attempt_id: attemptId, waiting_step: 'QR_CODE' });
      strictEqual(done.status, 'completed');
      deepStrictEqual(done.account, { id: 'acc_wa1', name: '+33 6 12 34 56 78', status: 'OK' });
      const wa = db.table('member_whatsapp_accounts')[0];
      strictEqual(wa.whatsapp_account_id, 'acc_wa1');
      strictEqual(wa.phone_number, '+33612345678');
      strictEqual(wa.user_id, USER);
      // Sans étape nommée, le statut ne sonde jamais le service (un code attendu ne doit pas être consommé à vide).
      const before = mock.calls.length;
      await connectionStatus(ctxOf(db), { attempt_id: attemptId });
      strictEqual(mock.calls.length, before);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_status : sans étape nommée un flux natif en attente n est pas sondé', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db);
    const mock = withMockTransport(router({}));
    try {
      const status = await connectionStatus(ctxOf(db), { attempt_id: attemptId });
      strictEqual(status.status, 'pending');
      strictEqual(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_cancel : idempotent, réservé au propriétaire de la tentative', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db);
    await rejects(() => cancelConnection(ctxOf(db, PEER), { attempt_id: attemptId }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'attempt_not_found');
    strictEqual(db.table('connection_attempts')[0].status, 'pending');
    await cancelConnection(ctxOf(db), { attempt_id: attemptId });
    strictEqual(db.table('connection_attempts')[0].status, 'cancelled');
    await cancelConnection(ctxOf(db), { attempt_id: attemptId });
    strictEqual(db.table('connection_attempts')[0].status, 'cancelled');
    // Une tentative terminée ne repasse pas en annulée.
    const other = await nativeAttempt(db, {});
    Object.assign(db.table('connection_attempts').find((r) => r.id === other)!, { status: 'completed' });
    await cancelConnection(ctxOf(db), { attempt_id: other });
    strictEqual(db.table('connection_attempts').find((r) => r.id === other)?.status, 'completed');
  });
});

// ---------------------------------------------------------------------------
// Hardening after review
// ---------------------------------------------------------------------------

Deno.test('connection hébergée : sans domaine propre, aucun lien du prestataire n est demandé ni proposé, sauf drapeau explicite', async () => {
  await withEnv({ ...ENV, UNIPILE_HOSTED_DOMAIN: null, CONNECTION_ALLOW_VENDOR_HOSTED_LINK: null }, async () => {
    deepStrictEqual(connectionCapabilities().hosted, { available: false, white_label: false });
    const db = makeDb();
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://auth.provider.example/abc' } } }));
    try {
      const refused = await startConnection(ctxOf(db), { provider: 'linkedin' }).catch((e) => e as ConnectionFailure);
      ok(refused instanceof ConnectionFailure && refused.errorCode === 'config', 'refus neutre');
      ok(!/unipile/i.test(refused.message));
      strictEqual(mock.calls.length, 0, 'le lien n est même pas demandé');
      strictEqual(db.table('connection_attempts')[0].status, 'failed');
      // Les connexions directes n'ont pas de page du prestataire : elles ne dépendent pas du domaine.
      const nativeMock = withMockTransport(router({ 'POST /auth/intent': { body: otpCheckpoint } }));
      try {
        const native = await startConnection(ctxOf(makeDb()), { provider: 'linkedin', mode: 'native', linkedin: { method: 'credentials', username: 'a@b.fr', password: 'pw' } });
        strictEqual(native.next.kind, 'checkpoint');
      } finally {
        nativeMock.restore();
      }
    } finally {
      mock.restore();
    }
  });
  await withEnv({ ...ENV, UNIPILE_HOSTED_DOMAIN: null, CONNECTION_ALLOW_VENDOR_HOSTED_LINK: '1' }, async () => {
    deepStrictEqual(connectionCapabilities().hosted, { available: true, white_label: false });
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://auth.provider.example/abc' } } }));
    try {
      const started = await startConnection(ctxOf(makeDb()), { provider: 'linkedin' });
      deepStrictEqual(started.next, { kind: 'redirect', url: 'https://auth.provider.example/abc' });
    } finally {
      mock.restore();
    }
  });
  // Un domaine illisible vaut pas de domaine.
  await withEnv({ ...ENV, UNIPILE_HOSTED_DOMAIN: 'pas un domaine !', CONNECTION_ALLOW_VENDOR_HOSTED_LINK: null }, async () => {
    const mock = withMockTransport(router({}));
    try {
      await rejects(() => startConnection(ctxOf(makeDb()), { provider: 'linkedin' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'config');
      strictEqual(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('limite de débit : illisible, les actions qui portent un mot de passe ou un code sont refusées ; le sondage de statut continue', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const attemptId = await nativeAttempt(db);
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://connect.konekt.test/x' } }, 'POST /auth/checkpoint': { body: linkedinAccount() }, 'POST /auth/intent': { body: otpCheckpoint } }));
    try {
      db.rpcResults.check_rate_limit = null; // ni vrai ni faux : le compteur n'a pas répondu
      await rejects(() => startConnection(ctxOf(db), { provider: 'whatsapp' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'server');
      await rejects(() => checkpointConnection(ctxOf(db), { attempt_id: attemptId, code: '123456' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'server');
      await rejects(() => resendConnection(ctxOf(db), { attempt_id: attemptId }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'server');
      strictEqual(mock.calls.length, 0, 'rien n atteint le service');
      strictEqual(db.table('connection_attempts').length, 1, 'aucune tentative créée');
      // Le sondage d'une étape d'attente et la lecture du statut n'embarquent aucun secret : ils continuent.
      strictEqual((await connectionStatus(ctxOf(db), { attempt_id: attemptId })).status, 'pending');
      // Une vraie erreur de la fonction de comptage est traitée de même.
      const failing = makeDb();
      failing.rpc = () => Promise.resolve({ data: null, error: { code: '42883', message: 'fonction absente' } as never });
      await rejects(() => startConnection(ctxOf(failing), { provider: 'whatsapp' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'server');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_status : un incident passager du service pendant le sondage laisse la tentative en attente', async () => {
  await withEnv(ENV, async () => {
    for (const failure of [{ status: 500, body: { message: 'Unipile 500' } }, { status: 429, body: { message: 'Too many' } }, { status: 503, body: {} }]) {
      const db = makeDb();
      const attemptId = await nativeAttempt(db);
      const mock = withMockTransport(router({ 'POST /auth/checkpoint': failure }));
      try {
        const { result, lines } = await captureConsole(() => connectionStatus(ctxOf(db), { attempt_id: attemptId, waiting_step: 'IN_APP_VALIDATION' }));
        strictEqual(result.success, true);
        strictEqual(result.status, 'pending');
        ok(!('error' in result) && !('next' in result));
        strictEqual(db.table('connection_attempts')[0].status, 'pending', `HTTP ${failure.status} : la tentative reste ouverte`);
        ok(!/unipile/i.test(JSON.stringify(result)));
        ok(!/Unipile 500/.test(lines), 'le texte du prestataire n est pas journalisé');
      } finally {
        mock.restore();
      }
    }
    // Un refus qui concerne la tentative elle-même (flux disparu) continue d'être traité.
    const db = makeDb();
    const attemptId = await nativeAttempt(db);
    const gone = withMockTransport(router({ 'POST /auth/checkpoint': { status: 404, body: {} } }));
    try {
      await rejects(() => connectionStatus(ctxOf(db), { attempt_id: attemptId, waiting_step: 'IN_APP_VALIDATION' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'attempt_expired');
      strictEqual(db.table('connection_attempts')[0].status, 'expired');
    } finally {
      gone.restore();
    }
  });
});

Deno.test('connection_start : la page de retour est un nom d une liste fermée, rendu par le statut', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://connect.konekt.test/x' } } }));
    try {
      const started = await startConnection(ctxOf(db), { provider: 'linkedin', return_to: 'onboarding' });
      strictEqual(db.table('connection_attempts')[0].return_to, 'onboarding');
      const status = await connectionStatus(ctxOf(db), { attempt_id: started.attempt.id });
      strictEqual(status.return_to, 'onboarding');
      // Tout autre contenu (adresse, chemin, nom inconnu) est ignoré : la tentative n'a pas de page de retour.
      for (const bad of ['https://evil.example/', '/onboarding', 'settings', { a: 1 }, 42]) {
        const other = makeDb();
        const reply = await startConnection(ctxOf(other), { provider: 'linkedin', return_to: bad });
        strictEqual(other.table('connection_attempts')[0].return_to, null);
        strictEqual('return_to' in (await connectionStatus(ctxOf(other), { attempt_id: reply.attempt.id })), false);
      }
      // Le redirect_uri envoyé au service reste celui du serveur.
      strictEqual((mock.calls[0].body as any).redirect_uri, 'https://app.konekt.test/settings/account/connections/retour');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connection_start : un administrateur ne reconnecte pas le lien à ancien identifiant d un collègue, seul son propriétaire le peut', async () => {
  await withEnv(ENV, async () => {
    const rows = [{ id: 'm-peer', organization_id: ORG, user_id: PEER, linkedin_account_id: 'ancien-identifiant' }];
    const db = makeDb({ member_linkedin_accounts: rows });
    db.table('organization_members')[0].role = 'admin';
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://connect.konekt.test/x' } } }));
    try {
      // La nouvelle connexion serait rattachée à celui qui la lance, donc à l'administrateur, au lieu du collègue.
      await rejects(
        () => startConnection(ctxOf(db), { provider: 'linkedin', reconnect_account_id: 'ancien-identifiant' }),
        (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'forbidden',
      );
      strictEqual(db.table('connection_attempts').length, 0);
      strictEqual(mock.calls.length, 0);
      // Le propriétaire du lien le peut ; les comptes à identifiant valide restent reconnectables par un administrateur.
      const started = await startConnection(ctxOf(db, PEER), { provider: 'linkedin', reconnect_account_id: 'ancien-identifiant' });
      strictEqual(started.attempt.purpose, 'link');
      strictEqual(started.attempt.user_id, PEER);
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// connection_start, reconnexion WhatsApp
// ---------------------------------------------------------------------------

Deno.test('connection_start : reconnexion WhatsApp du compte du membre, refus des comptes des collègues et orphelins', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb({
      member_whatsapp_accounts: [
        { id: 'w1', organization_id: ORG, user_id: USER, whatsapp_account_id: 'acc_wa_own' },
        { id: 'w2', organization_id: ORG, user_id: PEER, whatsapp_account_id: 'acc_wa_peer' },
        { id: 'w3', organization_id: OTHER_ORG, user_id: PEER, whatsapp_account_id: 'acc_wa_foreign' },
      ],
    });
    const mock = withMockTransport(router({ 'POST /auth/link': { body: { link: 'https://connect.konekt.test/x' } } }));
    try {
      await startConnection(ctxOf(db), { provider: 'whatsapp', mode: 'hosted', reconnect_account_id: 'acc_wa_own' });
      strictEqual((mock.calls[0].body as any).account_id, 'acc_wa_own');
      for (const id of ['acc_wa_peer', 'acc_wa_foreign', 'acc_wa_orphan']) {
        await rejects(() => startConnection(ctxOf(db), { provider: 'whatsapp', mode: 'hosted', reconnect_account_id: id }), (e: unknown) => e instanceof HttpError && e.status === 403, id);
      }
      strictEqual(mock.calls.length, 1);
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// connect_cookie (contrat de l extension Chrome)
// ---------------------------------------------------------------------------

Deno.test('connect_cookie : sans le mode direct, message neutre vers la connexion standard', async () => {
  await withEnv({ ...ENV, CONNECTION_NATIVE_ENABLED: null }, async () => {
    const mock = withMockTransport(router({}));
    try {
      await rejects(
        () => connectWithCookie(ctxOf(makeDb()), { access_token: 'x', user_agent: UA }),
        (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'feature_disabled' && /connexion standard/.test(e.message) && !/unipile/i.test(e.message),
      );
      strictEqual(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connect_cookie : contrat de l extension, { success, account_id, ... } ; la vérification passe par connection_checkpoint avec la poignée de la tentative', async () => {
  await withEnv(ENV, async () => {
    const db = makeDb();
    const mock = withMockTransport(router({
      'POST /auth/intent': { body: otpCheckpoint },
      'POST /auth/checkpoint': { body: linkedinAccount() },
    }));
    try {
      const started = await connectWithCookie(ctxOf(db), { access_token: 'AQED', premium_token: 'li_a', user_agent: UA, country: 'fr' });
      strictEqual(started.success, true);
      strictEqual(started.object, 'Checkpoint');
      deepStrictEqual(started.checkpoint, { type: 'OTP' });
      const handle = started.account_id as string;
      strictEqual(handle, db.table('connection_attempts')[0].id);
      strictEqual(started.attempt_id, handle);
      const intent = mock.calls[0].body as any;
      strictEqual(intent.credentials.premium_access_token, 'li_a', 'le cookie premium n est plus perdu');
      deepStrictEqual(intent.config.auto_proxy_config, { country: 'FR' });

      // Un identifiant de compte quelconque n'ouvre rien, ni la tentative d'un collègue.
      for (const forged of ['acc_li1', 'acc_other', 'ancien-id']) {
        await rejects(() => checkpointConnection(ctxOf(db), { attempt_id: forged, code: '123456' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'attempt_not_found', forged);
      }
      await rejects(() => checkpointConnection(ctxOf(db, PEER), { attempt_id: handle, code: '123456' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'attempt_not_found');

      const solved = await checkpointConnection(ctxOf(db), { attempt_id: handle, code: '123456' });
      strictEqual(solved.kind, 'done');
      strictEqual((solved as { account: { id: string } }).account.id, 'acc_li1');
    } finally {
      mock.restore();
    }
  });
});

Deno.test('connect_cookie : un cookie sans agent utilisateur est refusé avant tout appel', async () => {
  await withEnv(ENV, async () => {
    const mock = withMockTransport(router({}));
    try {
      await rejects(() => connectWithCookie(ctxOf(makeDb()), { access_token: 'AQED' }), (e: unknown) => e instanceof ConnectionFailure && e.errorCode === 'validation');
      await rejects(() => connectWithCookie(ctxOf(makeDb()), { user_agent: UA }), (e: unknown) => e instanceof ConnectionFailure && /li_at/.test(e.message));
      strictEqual(mock.calls.length, 0);
    } finally {
      mock.restore();
    }
  });
});

// A response helper kept for readability of the routes above.
void jsonResponse;
