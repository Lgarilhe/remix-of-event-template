// Comptes et connexion : liste, lecture, mise à jour, suppression, lien hébergé,
// intention de connexion native et points de contrôle. Chaque méthode est jouée
// contre un transport factice qui vérifie l'URL, la méthode, la requête et le corps.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/accounts.test.ts

import { deepStrictEqual, ok, rejects, strictEqual, throws } from 'node:assert';
import {
  buildAuthIntentBody,
  buildHostedLinkBody,
  createAuthIntent,
  createHostedLink,
  DEFAULT_LINKEDIN_PRODUCTS,
  deleteAccount,
  getAccount,
  listAccounts,
  listAllAccounts,
  parseAuthStep,
  requestCheckpoint,
  resendCheckpoint,
  submitCheckpoint,
  updateAccount,
} from './accounts.ts';
import { isUnipileError } from './errors.ts';
import { OutdatedAccountIdError } from './ids.ts';
import { emptyResponse, fixtures, jsonResponse, withMockTransport } from './testing.ts';

const ACC = 'acc_01abc';
const DOMAIN_ENV = (name: string) => (name === 'UNIPILE_HOSTED_DOMAIN' ? 'connect.konekt.fr' : undefined);
const NO_ENV = () => undefined;
const EXPIRES = new Date('2026-10-12T10:00:00.000Z');

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

Deno.test('listAccounts : GET /accounts/ avec filtres, offset et limit en chaînes', async () => {
  await withMockTransport(() => jsonResponse(fixtures.hasMorePage([fixtures.account()], true)), async (mock) => {
    const page = await listAccounts({
      provider: 'linkedin', status: 'degraded', search: 'marie', accountScopeId: 'none', offset: 40, limit: 20,
    });
    strictEqual(page.items.length, 1);
    strictEqual(page.hasMore, true);
    const call = mock.calls[0];
    strictEqual(call.method, 'GET');
    strictEqual(call.path, '/accounts/');
    deepStrictEqual(Object.fromEntries(call.query), {
      account_scope_id: 'none', status: 'degraded', provider: 'linkedin', search: 'marie', offset: '40', limit: '20',
    });
  });
});

Deno.test('listAccounts : sans filtre, aucune requête', async () => {
  await withMockTransport(() => jsonResponse(fixtures.hasMorePage([])), async (mock) => {
    const page = await listAccounts();
    strictEqual(page.items.length, 0);
    strictEqual(mock.calls[0].url, 'https://api.unipile.com/v2/accounts/');
  });
});

Deno.test('listAllAccounts : suit has_more avec un offset en chaîne', async () => {
  const pages = [
    fixtures.hasMorePage([fixtures.account({ id: 'acc_a' }), fixtures.account({ id: 'acc_b' })], true),
    fixtures.hasMorePage([fixtures.account({ id: 'acc_c' })], false),
  ];
  let i = 0;
  await withMockTransport(() => jsonResponse(pages[i++]), async (mock) => {
    const result = await listAllAccounts({ provider: 'google', limit: 2 });
    deepStrictEqual(result.items.map((a) => a.id), ['acc_a', 'acc_b', 'acc_c']);
    strictEqual(result.truncated, false);
    strictEqual(mock.calls.length, 2);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { provider: 'google', offset: '0', limit: '2' });
    deepStrictEqual(Object.fromEntries(mock.calls[1].query), { provider: 'google', offset: '2', limit: '2' });
  });
});

Deno.test('getAccount : GET /accounts/{id} ; un ancien identifiant est refusé avant tout appel', async () => {
  await withMockTransport(() => jsonResponse(fixtures.account({ id: ACC })), async (mock) => {
    const account = await getAccount(ACC);
    strictEqual(account.id, ACC);
    strictEqual(mock.calls[0].method, 'GET');
    strictEqual(mock.calls[0].path, `/accounts/${ACC}`);
    await rejects(() => getAccount('MmHgq-v1-id'), OutdatedAccountIdError);
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('getAccount : une réponse illisible est une erreur serveur', async () => {
  await withMockTransport(() => jsonResponse({ hello: 'world' }), async () => {
    await rejects(() => getAccount(ACC), (e: unknown) => isUnipileError(e) && e.kind === 'server');
  });
});

Deno.test('updateAccount : PATCH avec les seuls champs fournis', async () => {
  await withMockTransport(() => jsonResponse(fixtures.account({ id: ACC })), async (mock) => {
    await updateAccount(ACC, {
      metadata: { konekt_org: 'org-1' },
      proxy: null,
      autoProxyCountry: 'FR',
      allowCountryFallback: false,
      accountScopeId: 'scope_x',
    });
    strictEqual(mock.calls[0].method, 'PATCH');
    strictEqual(mock.calls[0].path, `/accounts/${ACC}`);
    deepStrictEqual(mock.calls[0].body, {
      account_scope_id: 'scope_x',
      metadata: { konekt_org: 'org-1' },
      auto_proxy_country: 'FR',
      allow_country_fallback: false,
      proxy: null,
    });
    await updateAccount(ACC, { metadata: {} });
    deepStrictEqual(mock.calls[1].body, { metadata: {} });
  });
});

Deno.test('updateAccount : corps vide ou valeur de métadonnée non textuelle refusés', async () => {
  await withMockTransport(() => jsonResponse(fixtures.account()), async (mock) => {
    await rejects(() => updateAccount(ACC, {}), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
    await rejects(
      () => updateAccount(ACC, { metadata: { n: 3 as unknown as string } }),
      (e: unknown) => isUnipileError(e) && e.kind === 'validation',
    );
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('deleteAccount : un not_found après une nouvelle tentative veut dire que le premier essai a supprimé le compte', async () => {
  let n = 0;
  await withMockTransport(() => (n++ === 0 ? new Response('boom', { status: 503 }) : jsonResponse({ error: 'not found' }, 404)), async (mock) => {
    strictEqual(await deleteAccount(ACC), true);
    strictEqual(mock.calls.length, 2);
  });
  // Premier et seul essai en 404 : le compte n'existait pas, l'erreur reste.
  await withMockTransport(() => jsonResponse({ error: 'not found' }, 404), async (mock) => {
    await rejects(() => deleteAccount(ACC), (e: unknown) => isUnipileError(e) && e.kind === 'not_found');
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('deleteAccount : DELETE /accounts/{id} rend le drapeau success', async () => {
  await withMockTransport((req) => jsonResponse({ success: req.path === `/accounts/${ACC}` }), async (mock) => {
    strictEqual(await deleteAccount(ACC), true);
    strictEqual(mock.calls[0].method, 'DELETE');
  });
  await withMockTransport(() => jsonResponse({ success: false }), async () => {
    strictEqual(await deleteAccount(ACC), false);
  });
});

// ---------------------------------------------------------------------------
// Lien hébergé
// ---------------------------------------------------------------------------

Deno.test('createHostedLink : nouveau compte LinkedIn, domaine de la configuration, produits explicites sans company', async () => {
  await withMockTransport(() => jsonResponse({ object: 'HostedAuthLink', link: 'https://connect.konekt.fr/x' }), async (mock) => {
    const result = await createHostedLink({
      redirectUri: 'https://app.test/retour',
      expiresOn: EXPIRES,
      providers: ['linkedin'],
      state: 'attempt-1',
      env: DOMAIN_ENV,
    });
    deepStrictEqual(result, { link: 'https://connect.konekt.fr/x' });
    const call = mock.calls[0];
    strictEqual(call.method, 'POST');
    strictEqual(call.path, '/auth/link');
    deepStrictEqual(call.body, {
      expires_on: '2026-10-12T10:00:00.000Z',
      redirect_uri: 'https://app.test/retour',
      providers: ['linkedin'],
      state: 'attempt-1',
      domain: 'connect.konekt.fr',
      config: { linkedin: { products: ['classic', 'recruiter', 'sales_navigator'] } },
    });
    ok(!JSON.stringify(call.body).includes('company'));
  });
});

Deno.test('createHostedLink : company seulement si demandé, options LinkedIn transmises', async () => {
  await withMockTransport(() => jsonResponse({ object: 'HostedAuthLink', link: 'https://l' }), async (mock) => {
    await createHostedLink({
      redirectUri: 'https://app.test/r',
      expiresOn: '2026-10-12T10:00:00.000Z',
      providers: 'linkedin',
      linkedin: { products: ['classic', 'company', 'classic'], allowProductSelection: false, allowMethods: ['credentials'] },
      env: NO_ENV,
    });
    deepStrictEqual(mock.calls[0].body, {
      expires_on: '2026-10-12T10:00:00.000Z',
      redirect_uri: 'https://app.test/r',
      providers: 'linkedin',
      config: { linkedin: { products: ['classic', 'company'], allow_product_selection: false, allow_methods: ['credentials'] } },
    });
  });
});

Deno.test('createHostedLink : pas de domaine quand il n\'est pas configuré ; jokers = LinkedIn inclus', async () => {
  await withMockTransport(() => jsonResponse({ object: 'HostedAuthLink', link: 'https://l' }), async (mock) => {
    await createHostedLink({ redirectUri: 'https://app.test/r', expiresOn: EXPIRES, providers: '*:MESSAGING', env: NO_ENV });
    const body = mock.calls[0].body as Record<string, unknown>;
    ok(!('domain' in body));
    deepStrictEqual(body.config, { linkedin: { products: [...DEFAULT_LINKEDIN_PRODUCTS] } });
  });
});

Deno.test('createHostedLink : un fournisseur sans LinkedIn n\'envoie pas de config', () => {
  const body = buildHostedLinkBody({ redirectUri: 'https://app.test/r', expiresOn: EXPIRES, providers: ['google', 'outlook'], env: NO_ENV });
  deepStrictEqual(body, {
    expires_on: '2026-10-12T10:00:00.000Z',
    redirect_uri: 'https://app.test/r',
    providers: ['google', 'outlook'],
  });
});

Deno.test('createHostedLink : reconnexion par account_id, sans providers, produits gardés sauf demande', () => {
  const keep = buildHostedLinkBody({ redirectUri: 'https://app.test/r', expiresOn: EXPIRES, accountId: ACC, state: 's', env: NO_ENV });
  deepStrictEqual(keep, { expires_on: '2026-10-12T10:00:00.000Z', redirect_uri: 'https://app.test/r', account_id: ACC, state: 's' });
  const narrow = buildHostedLinkBody({
    redirectUri: 'https://app.test/r', expiresOn: EXPIRES, accountId: ACC, linkedin: { products: ['classic'] }, env: NO_ENV,
  });
  deepStrictEqual(narrow.config, { linkedin: { products: ['classic'] } });
});

Deno.test('createHostedLink : entrées invalides refusées avant tout appel', async () => {
  const base = { redirectUri: 'https://app.test/r', expiresOn: EXPIRES, env: NO_ENV };
  throws(() => buildHostedLinkBody({ ...base }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
  throws(() => buildHostedLinkBody({ ...base, providers: 'linkedin', accountId: ACC }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
  throws(() => buildHostedLinkBody({ ...base, providers: [] }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
  throws(() => buildHostedLinkBody({ ...base, providers: 'linkedin', redirectUri: 'javascript:alert(1)' }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
  throws(() => buildHostedLinkBody({ ...base, providers: 'linkedin', redirectUri: 'pas une url' }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
  throws(() => buildHostedLinkBody({ ...base, providers: 'linkedin', expiresOn: 'demain' }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
  throws(() => buildHostedLinkBody({ ...base, providers: 'linkedin', linkedin: { products: [] } }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
  throws(
    () => buildHostedLinkBody({ ...base, providers: 'linkedin', linkedin: { products: ['bogus' as 'classic'] } }),
    (e: unknown) => isUnipileError(e) && e.kind === 'validation',
  );
  throws(() => buildHostedLinkBody({ ...base, accountId: 'v1-id' }), OutdatedAccountIdError);
  await withMockTransport(() => jsonResponse({ object: 'HostedAuthLink' }), async () => {
    await rejects(
      () => createHostedLink({ ...base, providers: 'linkedin' }),
      (e: unknown) => isUnipileError(e) && e.kind === 'server',
    );
  });
});

Deno.test('createHostedLink : un nom de domaine mal formé dans la configuration est une erreur de configuration', () => {
  throws(
    () => buildHostedLinkBody({
      redirectUri: 'https://app.test/r', expiresOn: EXPIRES, providers: 'linkedin',
      env: (n) => (n === 'UNIPILE_HOSTED_DOMAIN' ? 'pas un domaine' : undefined),
    }),
    (e: unknown) => isUnipileError(e) && e.kind === 'config',
  );
});

Deno.test('createHostedLink : le lien est rejoué sur incident réseau (doublon sans effet)', async () => {
  let n = 0;
  await withMockTransport(() => (n++ === 0 ? new Response('boom', { status: 503 }) : jsonResponse({ object: 'HostedAuthLink', link: 'https://l' })), async (mock) => {
    const r = await createHostedLink({ redirectUri: 'https://app.test/r', expiresOn: EXPIRES, providers: 'linkedin', env: NO_ENV });
    strictEqual(r.link, 'https://l');
    strictEqual(mock.calls.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Intention de connexion
// ---------------------------------------------------------------------------

Deno.test('buildAuthIntentBody : LinkedIn identifiants, produits explicites, jamais company par défaut', () => {
  deepStrictEqual(
    buildAuthIntentBody({
      provider: 'linkedin',
      credentials: { username: 'a@b.fr', password: 'pw', userAgent: 'UA' },
      userTimezone: 'Europe/Paris',
      state: 'att-1',
      accountScopeId: 'scope_1',
    }),
    {
      provider: 'linkedin',
      credentials: { username: 'a@b.fr', password: 'pw', user_agent: 'UA' },
      user_timezone: 'Europe/Paris',
      config: { products: ['classic', 'recruiter', 'sales_navigator'] },
      account_scope_id: 'scope_1',
      state: 'att-1',
    },
  );
});

Deno.test('buildAuthIntentBody : LinkedIn cookies exigent le user agent, reconnexion par account_id', () => {
  deepStrictEqual(
    buildAuthIntentBody({
      provider: 'linkedin',
      credentials: { accessToken: 'li_at', premiumAccessToken: 'li_a', userAgent: 'UA' },
      products: ['classic'],
      allowProductSelection: true,
      accountId: ACC,
    }),
    {
      provider: 'linkedin',
      credentials: { access_token: 'li_at', premium_access_token: 'li_a', user_agent: 'UA' },
      config: { products: ['classic'], allow_product_selection: true },
      account_id: ACC,
    },
  );
  throws(
    () => buildAuthIntentBody({ provider: 'linkedin', credentials: { accessToken: 'li_at', userAgent: '' } }),
    (e: unknown) => isUnipileError(e) && e.kind === 'validation',
  );
  throws(
    () => buildAuthIntentBody({ provider: 'linkedin', credentials: { username: 'a', password: '' } }),
    (e: unknown) => isUnipileError(e) && e.kind === 'validation',
  );
});

Deno.test('buildAuthIntentBody : IMAP (simple et complet), WhatsApp (QR et jumelage), mock, OAuth', () => {
  deepStrictEqual(buildAuthIntentBody({ provider: 'imap', credentials: { user: 'u@x.fr', password: 'p' } }), {
    provider: 'imap', credentials: { user: 'u@x.fr', password: 'p' },
  });
  deepStrictEqual(
    buildAuthIntentBody({
      provider: 'imap',
      initialSyncEnable: true,
      credentials: {
        imap: { user: 'u', password: 'p', host: 'imap.x.fr', port: 993, encryption: 'ssl' },
        smtp: { user: 'u', password: 'p', host: 'smtp.x.fr', port: 465 },
      },
    }),
    {
      provider: 'imap',
      credentials: {
        imap: { user: 'u', password: 'p', host: 'imap.x.fr', port: 993, encryption: 'ssl' },
        smtp: { user: 'u', password: 'p', host: 'smtp.x.fr', port: 465 },
      },
      config: { initial_sync_enable: true },
    },
  );
  deepStrictEqual(buildAuthIntentBody({ provider: 'whatsapp', credentials: { qrcode: true } }), {
    provider: 'whatsapp', credentials: { qrcode: true },
  });
  deepStrictEqual(buildAuthIntentBody({ provider: 'whatsapp', credentials: { phoneNumber: '33612345678' } }), {
    provider: 'whatsapp', credentials: { phone_number: '33612345678' },
  });
  throws(
    () => buildAuthIntentBody({ provider: 'whatsapp', credentials: { phoneNumber: '+33 6 12' } }),
    (e: unknown) => isUnipileError(e) && e.kind === 'validation',
  );
  deepStrictEqual(buildAuthIntentBody({ provider: 'mock' }), { provider: 'mock', credentials: {} });
  deepStrictEqual(
    buildAuthIntentBody({
      provider: 'outlook', oauthCallbackRedirectUri: 'https://app.test/cb', loginHint: 'a@b.fr', oauthScope: ['Mail.Read'], state: 's',
    }),
    {
      provider: 'outlook',
      oauth_callback_redirect_uri: 'https://app.test/cb',
      login_hint: 'a@b.fr',
      config: { oauth_scope: ['Mail.Read'] },
      state: 's',
    },
  );
});

Deno.test('createAuthIntent : POST /auth/intent, les quatre réponses sont distinguées par object', async () => {
  const answers: unknown[] = [
    { object: 'AuthenticationCheckpoint', intent_id: 'acc_i1', checkpoint: { type: 'OTP', channel: 'SMS' } },
    { object: 'AuthenticationQrCode', intent_id: 'acc_i2', qrcode: 'data:image/png;base64,AAA' },
    { object: 'OauthUrl', url: 'https://login.example/oauth' },
    fixtures.account({ id: 'acc_new' }),
  ];
  let i = 0;
  await withMockTransport(() => jsonResponse(answers[i++]), async (mock) => {
    const input = { provider: 'linkedin' as const, credentials: { username: 'a', password: 'b' } };
    const a = await createAuthIntent(input);
    deepStrictEqual(a, { kind: 'checkpoint', intentId: 'acc_i1', checkpoint: { type: 'OTP', channel: 'SMS' } });
    const b = await createAuthIntent({ provider: 'whatsapp', credentials: { qrcode: true } });
    deepStrictEqual(b, { kind: 'qrcode', intentId: 'acc_i2', qrcode: 'data:image/png;base64,AAA' });
    const c = await createAuthIntent({ provider: 'google', oauthCallbackRedirectUri: 'https://app.test/cb' });
    deepStrictEqual(c, { kind: 'oauth_url', url: 'https://login.example/oauth' });
    const d = await createAuthIntent({ provider: 'mock' });
    strictEqual(d.kind, 'account');
    strictEqual(mock.calls.length, 4);
    for (const call of mock.calls) {
      strictEqual(call.method, 'POST');
      strictEqual(call.path, '/auth/intent');
    }
  });
});

Deno.test('parseAuthStep : une forme inconnue ou incomplète est une erreur, jamais un succès', () => {
  for (const bad of [null, 'x', {}, { object: 'Mystery' }, { object: 'AuthenticationQrCode', intent_id: 'acc_1' }, { object: 'OauthUrl' }]) {
    throws(() => parseAuthStep(bad), (e: unknown) => isUnipileError(e) && e.kind === 'server');
  }
});

Deno.test('createAuthIntent : une tentative d\'identifiants n\'est pas rejouée après un incident serveur', async () => {
  await withMockTransport(() => new Response('boom', { status: 503 }), async (mock) => {
    await rejects(
      () => createAuthIntent({ provider: 'linkedin', credentials: { username: 'a', password: 'b' } }),
      (e: unknown) => isUnipileError(e) && e.kind === 'uncertain',
    );
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('buildAuthIntentBody : une reconnexion sans produits explicites ne touche pas aux produits déjà autorisés', () => {
  const keep = buildAuthIntentBody({
    provider: 'linkedin', credentials: { username: 'a', password: 'p' }, accountId: ACC,
  });
  deepStrictEqual(keep, { provider: 'linkedin', credentials: { username: 'a', password: 'p' }, account_id: ACC });
  ok(!('config' in keep));
  deepStrictEqual(
    buildAuthIntentBody({ provider: 'linkedin', credentials: { username: 'a', password: 'p' }, accountId: ACC, allowProductSelection: true }).config,
    { allow_product_selection: true },
  );
  // Produits donnés : envoyés. Première connexion : liste par défaut.
  deepStrictEqual(
    buildAuthIntentBody({ provider: 'linkedin', credentials: { username: 'a', password: 'p' }, accountId: ACC, products: ['classic'] }).config,
    { products: ['classic'] },
  );
  deepStrictEqual(
    buildAuthIntentBody({ provider: 'linkedin', credentials: { username: 'a', password: 'p' } }).config,
    { products: [...DEFAULT_LINKEDIN_PRODUCTS] },
  );
});

// ---------------------------------------------------------------------------
// Points de contrôle
// ---------------------------------------------------------------------------

Deno.test('submitCheckpoint : une étape d’attente (notification, QR, chargement) se suit sans code', async () => {
  await withMockTransport(() => jsonResponse({ object: 'AuthenticationCheckpoint', intent_id: 'acc_i1', checkpoint: { type: 'LOADING' } }), async (mock) => {
    for (const checkpointType of ['IN_APP_VALIDATION', 'LOADING', 'QR_CODE']) {
      const step = await submitCheckpoint({ intentId: 'acc_i1', checkpointType });
      strictEqual(step.kind, 'checkpoint');
    }
    deepStrictEqual(mock.calls[0].body, { code: '', intent_id: 'acc_i1' });
    strictEqual(mock.calls.length, 3);
    // Un type qui attend un code l’exige toujours.
    for (const checkpointType of ['OTP', '2FA', undefined]) {
      await rejects(
        () => submitCheckpoint({ intentId: 'acc_i1', checkpointType }),
        (e: unknown) => isUnipileError(e) && e.kind === 'validation',
        String(checkpointType),
      );
    }
    strictEqual(mock.calls.length, 3);
  });
});

Deno.test('submitCheckpoint : POST /auth/checkpoint {code, intent_id}', async () => {
  await withMockTransport(() => jsonResponse(fixtures.account({ id: 'acc_ok' })), async (mock) => {
    const step = await submitCheckpoint({ intentId: 'acc_i1', code: '123456' });
    strictEqual(step.kind, 'account');
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, '/auth/checkpoint');
    deepStrictEqual(mock.calls[0].body, { code: '123456', intent_id: 'acc_i1' });
    await rejects(() => submitCheckpoint({ intentId: 'acc_i1', code: ' ' }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
  });
});

Deno.test('requestCheckpoint : POST /auth/checkpoint/request, challenge facultatif', async () => {
  await withMockTransport(
    () => jsonResponse({ object: 'AuthenticationCheckpoint', intent_id: 'acc_i1', checkpoint: { type: 'OTP', channel: 'EMAIL' } }),
    async (mock) => {
      const step = await requestCheckpoint({ intentId: 'acc_i1', challenge: 'EMAIL' });
      strictEqual(step.kind, 'checkpoint');
      strictEqual(mock.calls[0].path, '/auth/checkpoint/request');
      deepStrictEqual(mock.calls[0].body, { intent_id: 'acc_i1', challenge: 'EMAIL' });
      await requestCheckpoint({ intentId: 'acc_i1' });
      deepStrictEqual(mock.calls[1].body, { intent_id: 'acc_i1' });
    },
  );
});

Deno.test('resendCheckpoint : POST /auth/checkpoint/resend répond 204 sans corps', async () => {
  await withMockTransport(() => emptyResponse(204), async (mock) => {
    strictEqual(await resendCheckpoint({ intentId: 'acc_i1' }), undefined);
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, '/auth/checkpoint/resend');
    deepStrictEqual(mock.calls[0].body, { intent_id: 'acc_i1' });
  });
});
