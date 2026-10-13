// Transport unique du client partagé : en-têtes, corps, 204, délai d'attente,
// nouvelles tentatives bornées (appels idempotents seulement) et résultat
// « incertain » pour tout envoi non idempotent.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/http.test.ts

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { UNIPILE_BASE_URL } from './config.ts';
import { isUnipileError, UnipileError } from './errors.ts';
import {
  buildUrl,
  DEFAULT_RETRY_POLICY,
  isIdempotentRequest,
  parseRetryAfter,
  setTransportDefaults,
  unipileFetch,
  unipileJson,
  unipileVoid,
  type HttpMethod,
  type TransportFailure,
  type UnipileRequest,
} from './http.ts';
import {
  emptyResponse,
  hang,
  jsonResponse,
  networkError,
  textResponse,
  withMockTransport,
  type MockHandler,
  type MockTransport,
} from './testing.ts';

/** Plays a script of replies, one per call, then repeats the last one. */
function script(...replies: Array<ReturnType<MockHandler>>): MockHandler {
  let i = 0;
  return () => replies[Math.min(i++, replies.length - 1)];
}

async function failure(request: UnipileRequest, handler: MockHandler): Promise<{ result: TransportFailure; mock: MockTransport }> {
  const mock = withMockTransport(handler);
  try {
    const result = await unipileFetch(request);
    ok(result.outcome !== 'ok', `échec attendu, reçu ${JSON.stringify(result)}`);
    return { result: result as TransportFailure, mock };
  } finally {
    mock.restore();
  }
}

// ---------------------------------------------------------------------------
// Requête : URL, en-têtes, corps
// ---------------------------------------------------------------------------

Deno.test('buildUrl : racine constante, requête sérialisée, null et undefined ignorés, tableaux répétés', () => {
  strictEqual(buildUrl(UNIPILE_BASE_URL, '/accounts'), 'https://api.unipile.com/v2/accounts');
  strictEqual(
    buildUrl(UNIPILE_BASE_URL, '/accounts', { limit: '20', offset: 0, a: null, b: undefined, ok: true, ids: ['x', 'y'] }),
    'https://api.unipile.com/v2/accounts?limit=20&offset=0&ok=true&ids=x&ids=y',
  );
});

Deno.test('buildUrl : un chemin qui sortirait de la racine est refusé', () => {
  for (const path of ['accounts', '/a/../b', '/a//b', '/a?x=1', '/a#b', '/a b', 'https://evil.example/v2', '/./a', '']) {
    let thrown: unknown;
    try {
      buildUrl(UNIPILE_BASE_URL, path);
    } catch (e) {
      thrown = e;
    }
    ok(isUnipileError(thrown) && thrown.kind === 'validation', `chemin refusé : "${path}"`);
  }
});

Deno.test('unipileFetch : en-tête X-API-KEY, Accept, JSON, méthode et chemin', async () => {
  const mock = withMockTransport(() => jsonResponse({ ok: true }));
  try {
    const result = await unipileFetch({ method: 'POST', path: '/acc_1/chats', body: { a: 1 }, query: { q: 'x y' } });
    strictEqual(result.outcome, 'ok');
    const call = mock.calls[0];
    strictEqual(call.method, 'POST');
    strictEqual(call.path, '/acc_1/chats');
    strictEqual(call.query.get('q'), 'x y');
    strictEqual(call.headers['x-api-key'], 'test-key');
    strictEqual(call.headers['accept'], 'application/json');
    strictEqual(call.headers['content-type'], 'application/json');
    deepStrictEqual(call.body, { a: 1 });
    ok(call.url.startsWith(UNIPILE_BASE_URL));
  } finally {
    mock.restore();
  }
});

Deno.test('unipileFetch : une en-tête appelante ne peut pas écraser X-API-KEY', async () => {
  const mock = withMockTransport(() => jsonResponse({}));
  try {
    await unipileFetch({ path: '/x', headers: { 'X-API-KEY': 'evil', 'X-Extra': '1' } });
    strictEqual(mock.calls[0].headers['x-api-key'], 'test-key');
    strictEqual(mock.calls[0].headers['x-extra'], '1');
  } finally {
    mock.restore();
  }
});

Deno.test('unipileFetch : une en-tête x-api-key en minuscules est retirée, jamais fusionnée avec la clé', async () => {
  const mock = withMockTransport(() => jsonResponse({}));
  try {
    await unipileFetch({ path: '/x', headers: { 'x-api-key': 'evil', 'X-Api-Key': 'evil2' } });
    strictEqual(mock.calls[0].headers['x-api-key'], 'test-key');
  } finally {
    mock.restore();
  }
});

Deno.test('unipileFetch : ne suit jamais une redirection, une 3xx est un échec', async () => {
  let init: RequestInit | undefined;
  const config = { apiKey: 'k', baseUrl: 'https://api.test/v2' } as never;
  const result = await unipileFetch({ path: '/x' }, {
    config,
    fetchImpl: (_url, i) => {
      init = i;
      return Promise.resolve(new Response(null, { status: 307, headers: { location: 'https://evil.test/' } }));
    },
  });
  strictEqual(init?.redirect, 'manual');
  strictEqual(result.outcome, 'error');
});

Deno.test('unipileFetch : corps multipart sans Content-Type posé à la main', async () => {
  const mock = withMockTransport(() => jsonResponse({ ok: 1 }));
  try {
    const form = new FormData();
    form.append('text', 'bonjour');
    const result = await unipileFetch({ method: 'POST', path: '/acc_1/chats', form, idempotent: false });
    strictEqual(result.outcome, 'ok');
    ok(mock.calls[0].body instanceof FormData);
    ok(!('content-type' in mock.calls[0].headers) || mock.calls[0].headers['content-type'].startsWith('multipart/form-data'));
  } finally {
    mock.restore();
  }
});

Deno.test('unipileFetch : requête mal formée (GET avec corps, corps et form) refusée sans appel réseau', async () => {
  const mock = withMockTransport(() => jsonResponse({}));
  try {
    await rejects(() => unipileFetch({ path: '/x', body: { a: 1 } }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
    await rejects(
      () => unipileFetch({ method: 'POST', path: '/x', body: {}, form: new FormData() }),
      (e: unknown) => isUnipileError(e) && e.kind === 'validation',
    );
    strictEqual(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

Deno.test('unipileFetch : sans clé configurée, UnipileConfigError (pas de repli, pas de résultat vide)', async () => {
  setTransportDefaults(null);
  const previous = Deno.env.get('UNIPILE_V2_API_KEY');
  Deno.env.delete('UNIPILE_V2_API_KEY');
  try {
    await rejects(
      () => unipileFetch({ path: '/accounts' }, { fetchImpl: () => Promise.reject(new Error('ne doit pas être appelé')) }),
      (e: unknown) => isUnipileError(e) && e.kind === 'config',
    );
  } finally {
    if (previous !== undefined) Deno.env.set('UNIPILE_V2_API_KEY', previous);
  }
});

// ---------------------------------------------------------------------------
// Réponses : 200, 204, corps vide, JSON illisible
// ---------------------------------------------------------------------------

Deno.test('204 et corps vide : data null, issue ok', async () => {
  for (const reply of [emptyResponse(204), textResponse('', 200), textResponse('  \n', 200)]) {
    const mock = withMockTransport(() => reply.clone());
    try {
      const result = await unipileFetch({ method: 'DELETE', path: '/acc_1/chats/c1' });
      strictEqual(result.outcome, 'ok');
      if (result.outcome === 'ok') strictEqual(result.data, null);
      await unipileVoid({ method: 'DELETE', path: '/acc_1/chats/c1' });
    } finally {
      mock.restore();
    }
  }
});

Deno.test('unipileJson : rend le JSON ; un corps vide là où du JSON est attendu lève', async () => {
  await withMockTransport(() => jsonResponse({ id: 'acc_1' }), async () => {
    deepStrictEqual(await unipileJson<{ id: string }>({ path: '/accounts/acc_1' }), { id: 'acc_1' });
  });
  await withMockTransport(() => emptyResponse(204), async () => {
    await rejects(() => unipileJson({ path: '/accounts/acc_1' }), (e: unknown) => isUnipileError(e) && e.kind === 'server');
  });
});

Deno.test('unipileJson et unipileVoid : toute issue non ok lève une UnipileError classée', async () => {
  await withMockTransport(() => jsonResponse({ message: 'nope' }, 404), async () => {
    await rejects(() => unipileJson({ path: '/x' }), (e: unknown) => isUnipileError(e) && e.kind === 'not_found' && e.status === 404);
    await rejects(() => unipileVoid({ path: '/x' }), (e: unknown) => isUnipileError(e) && e.kind === 'not_found');
  });
});

Deno.test('2xx au JSON illisible : erreur serveur sur une lecture, incertain sur un envoi', async () => {
  const read = await failure({ path: '/x' }, () => textResponse('<html>oops</html>', 200));
  strictEqual(read.result.outcome, 'error');
  strictEqual(read.result.error.kind, 'server');
  const send = await failure({ method: 'POST', path: '/x', body: {} }, () => textResponse('<html>oops</html>', 200));
  strictEqual(send.result.outcome, 'uncertain');
  strictEqual(send.result.error.kind, 'uncertain');
  strictEqual(send.mock.calls.length, 1, 'jamais rejoué');
});

Deno.test('erreur HTTP : corps JSON ou texte classé, débogage conservé, message neutre', async () => {
  const json = await failure({ path: '/x' }, () => jsonResponse({ message: 'Unipile: account disconnected' }, 403, { 'x-request-id': 'r-1' }));
  strictEqual(json.result.error.kind, 'account_disconnected');
  strictEqual(json.result.error.status, 403);
  deepStrictEqual(json.result.error.debug.body, { message: 'Unipile: account disconnected' });
  strictEqual(json.result.error.debug.requestId, 'r-1');
  ok(!/unipile/i.test(json.result.error.message));
  const text = await failure({ path: '/x' }, () => textResponse('Bad Request raw text', 400));
  strictEqual(text.result.error.kind, 'validation');
  strictEqual(text.result.error.debug.body, 'Bad Request raw text');
});

// ---------------------------------------------------------------------------
// Nouvelles tentatives : appels idempotents
// ---------------------------------------------------------------------------

Deno.test('isIdempotentRequest : GET, DELETE, PUT, PATCH oui ; POST seulement s’il est déclaré', () => {
  for (const m of ['GET', 'DELETE', 'PUT', 'PATCH'] as HttpMethod[]) strictEqual(isIdempotentRequest(m), true, m);
  strictEqual(isIdempotentRequest('POST'), false);
  strictEqual(isIdempotentRequest('POST', false), false);
  strictEqual(isIdempotentRequest('POST', true), true);
});

Deno.test('parseRetryAfter : secondes, date HTTP, absent ou illisible', () => {
  strictEqual(parseRetryAfter('2'), 2000);
  strictEqual(parseRetryAfter('0.5'), 500);
  strictEqual(parseRetryAfter(null), null);
  strictEqual(parseRetryAfter(''), null);
  strictEqual(parseRetryAfter('soon'), null);
  const now = Date.parse('2026-10-11T10:00:00Z');
  strictEqual(parseRetryAfter('Sun, 11 Oct 2026 10:00:03 GMT', now), 3000);
  strictEqual(parseRetryAfter('Sun, 11 Oct 2026 09:00:00 GMT', now), 0);
});

Deno.test('GET : 503 puis 200, une nouvelle tentative avec l’attente par défaut', async () => {
  const mock = withMockTransport(script(jsonResponse({}, 503), jsonResponse({ ok: 1 })));
  try {
    const result = await unipileFetch({ path: '/x' });
    strictEqual(result.outcome, 'ok');
    strictEqual(result.attempts, 2);
    strictEqual(mock.calls.length, 2);
    deepStrictEqual(mock.sleeps, [500]);
  } finally {
    mock.restore();
  }
});

Deno.test('GET : 502 / 503 / 504 réessayés deux fois au plus, puis erreur serveur', async () => {
  for (const status of [502, 503, 504]) {
    const { result, mock } = await failure({ path: '/x' }, () => jsonResponse({}, status));
    strictEqual(result.outcome, 'error', String(status));
    strictEqual(result.error.kind, 'server');
    strictEqual(result.attempts, 3);
    strictEqual(mock.calls.length, 3);
    deepStrictEqual(mock.sleeps, [500, 1500]);
  }
});

Deno.test('GET : 500 ne se réessaie pas (seuls 502, 503, 504 et 429 le sont)', async () => {
  const { result, mock } = await failure({ path: '/x' }, () => jsonResponse({}, 500));
  strictEqual(result.attempts, 1);
  strictEqual(mock.calls.length, 1);
  strictEqual(mock.sleeps.length, 0);
});

Deno.test('4xx ne se réessaie jamais', async () => {
  for (const status of [400, 401, 403, 404, 409, 422]) {
    const { result, mock } = await failure({ path: '/x' }, () => jsonResponse({}, status));
    strictEqual(result.attempts, 1, String(status));
    strictEqual(mock.calls.length, 1);
  }
});

Deno.test('429 : Retry-After respecté jusqu’à 5 s', async () => {
  const a = withMockTransport(script(jsonResponse({}, 429, { 'retry-after': '2' }), jsonResponse({ ok: 1 })));
  try {
    strictEqual((await unipileFetch({ path: '/x' })).outcome, 'ok');
    deepStrictEqual(a.sleeps, [2000]);
  } finally {
    a.restore();
  }
  const b = withMockTransport(script(jsonResponse({}, 429, { 'retry-after': '4.9' }), jsonResponse({ ok: 1 })));
  try {
    await unipileFetch({ path: '/x' });
    deepStrictEqual(b.sleeps, [4900]);
  } finally {
    b.restore();
  }
});

Deno.test('429 ou 503 avec un Retry-After au-delà du plafond : aucune nouvelle tentative, l’attente demandée est rendue', async () => {
  // Raccourcir 30 s en 5 s ferait marteler la clé partagée : on s’arrête et on rend l’attente.
  for (const status of [429, 503]) {
    const c = withMockTransport(script(jsonResponse({}, status, { 'retry-after': '60' }), jsonResponse({ ok: 1 })));
    try {
      const result = await unipileFetch({ path: '/x' });
      strictEqual(result.outcome, 'error', String(status));
      strictEqual(result.attempts, 1, String(status));
      deepStrictEqual(c.sleeps, [], String(status));
      if (result.outcome === 'error') strictEqual(result.error.retryAfterMs, 60000);
    } finally {
      c.restore();
    }
  }
});

Deno.test('503 avec un Retry-After court : l’attente du serveur est respectée', async () => {
  const c = withMockTransport(script(jsonResponse({}, 503, { 'retry-after': '3' }), jsonResponse({ ok: 1 })));
  try {
    strictEqual((await unipileFetch({ path: '/x' })).outcome, 'ok');
    deepStrictEqual(c.sleeps, [3000]);
  } finally {
    c.restore();
  }
});

Deno.test('429 sans Retry-After : 1 s puis 3 s ; épuisé, erreur rate_limited avec retryAfterMs', async () => {
  const { result, mock } = await failure({ path: '/x' }, () => jsonResponse({ message: 'Too many requests' }, 429));
  strictEqual(result.outcome, 'error');
  strictEqual(result.error.kind, 'rate_limited');
  strictEqual(result.attempts, 3);
  deepStrictEqual(mock.sleeps, [1000, 3000]);
  const withHeader = await failure({ path: '/x' }, () => jsonResponse({}, 429, { 'retry-after': '7' }));
  strictEqual(withHeader.result.error.retryAfterMs, 7000);
});

Deno.test('429 qui est une limite du réseau (invitations) : pas de nouvelle tentative', async () => {
  const { result, mock } = await failure({ path: '/x' }, () => jsonResponse({ message: 'Weekly invitation limit reached' }, 429));
  strictEqual(result.error.kind, 'provider_limit');
  strictEqual(result.attempts, 1);
  strictEqual(mock.sleeps.length, 0);
});

Deno.test('budget de 10 s : une attente qui le dépasserait n’est pas lancée', async () => {
  // Retry-After 5 s deux fois = 10 s : la deuxième attente (5 s + 5 s écoulées) dépasse la limite stricte seulement au-delà.
  const mock = withMockTransport(() => jsonResponse({}, 429, { 'retry-after': '5' }));
  try {
    const result = await unipileFetch({ path: '/x' });
    strictEqual(result.outcome, 'error');
    // 1re attente 5000 (0 + 5000 <= 10000), 2e attente 5000 (5000 + 5000 <= 10000) : 3 tentatives.
    deepStrictEqual(mock.sleeps, [5000, 5000]);
  } finally {
    mock.restore();
  }
  const tight = withMockTransport(() => jsonResponse({}, 503));
  try {
    const result = await unipileFetch({ path: '/x', retry: { budgetMs: 700 } });
    // 500 passe (0 + 500 <= 700), 1500 ne passe pas (500 + 1500 > 700).
    strictEqual(result.attempts, 2);
    deepStrictEqual(tight.sleeps, [500]);
  } finally {
    tight.restore();
  }
});

Deno.test('retry: false et maxRetries 0 coupent les nouvelles tentatives', async () => {
  const a = await failure({ path: '/x', retry: false }, () => jsonResponse({}, 503));
  strictEqual(a.result.attempts, 1);
  const b = await failure({ path: '/x', retry: { maxRetries: 1 } }, () => jsonResponse({}, 503));
  strictEqual(b.result.attempts, 2);
});

Deno.test('erreur réseau sur un GET : réessayée, puis erreur network', async () => {
  const mock = withMockTransport(script(networkError(), jsonResponse({ ok: 1 })));
  try {
    const result = await unipileFetch({ path: '/x' });
    strictEqual(result.outcome, 'ok');
    strictEqual(result.attempts, 2);
  } finally {
    mock.restore();
  }
  const { result } = await failure({ path: '/x' }, () => networkError());
  strictEqual(result.outcome, 'error');
  strictEqual(result.error.kind, 'network');
  strictEqual(result.error.code, 'network_error');
  strictEqual(result.attempts, 3);
});

Deno.test('délai dépassé sur un GET : annulé, réessayé, puis erreur network (code timeout)', async () => {
  const { result, mock } = await failure({ path: '/x', timeoutMs: 15 }, (req) => hang(req));
  strictEqual(result.outcome, 'error');
  strictEqual(result.error.kind, 'network');
  strictEqual(result.error.code, 'timeout');
  strictEqual(mock.calls.length, 3);
  ok(mock.calls.every((c) => c.signal.aborted), 'chaque tentative est annulée');
});

Deno.test('délai dépassé même si le faux transport ignore le signal', async () => {
  const mock = withMockTransport(() => new Promise<never>(() => {}));
  try {
    const result = await unipileFetch({ path: '/x', timeoutMs: 15, retry: false });
    strictEqual(result.outcome, 'error');
    if (result.outcome === 'error') strictEqual(result.error.code, 'timeout');
  } finally {
    mock.restore();
  }
});

Deno.test('DELETE, PATCH, PUT et POST déclaré idempotent sont réessayés comme un GET', async () => {
  const cases: UnipileRequest[] = [
    { method: 'DELETE', path: '/x' },
    { method: 'PATCH', path: '/x', body: {} },
    { method: 'PUT', path: '/x', body: {} },
    { method: 'POST', path: '/x', body: {}, idempotent: true },
  ];
  for (const request of cases) {
    const mock = withMockTransport(script(jsonResponse({}, 503), jsonResponse({ ok: 1 })));
    try {
      const result = await unipileFetch(request);
      strictEqual(result.outcome, 'ok', `${request.method} idempotent=${request.idempotent}`);
      strictEqual(mock.calls.length, 2);
    } finally {
      mock.restore();
    }
  }
});

// ---------------------------------------------------------------------------
// Envois non idempotents : jamais rejoués, issue « incertaine » jamais « réussie »
// ---------------------------------------------------------------------------

const SEND: UnipileRequest = { method: 'POST', path: '/acc_1/chats/c1/messages', body: { text: 'Bonjour' } };

Deno.test('envoi : 5xx (500, 502, 503, 504) et 408 donnent incertain, un seul appel, aucune attente', async () => {
  for (const status of [408, 500, 502, 503, 504]) {
    const { result, mock } = await failure(SEND, () => jsonResponse({ message: 'upstream' }, status));
    strictEqual(result.outcome, 'uncertain', String(status));
    strictEqual(result.error.kind, 'uncertain');
    strictEqual(result.error.status, status);
    strictEqual(result.attempts, 1);
    strictEqual(mock.calls.length, 1);
    strictEqual(mock.sleeps.length, 0);
  }
});

Deno.test('envoi : délai dépassé ou erreur réseau donnent incertain, jamais rejoués', async () => {
  const timeout = await failure({ ...SEND, timeoutMs: 15 }, (req) => hang(req));
  strictEqual(timeout.result.outcome, 'uncertain');
  strictEqual(timeout.result.error.kind, 'uncertain');
  strictEqual(timeout.result.error.code, 'timeout');
  strictEqual(timeout.mock.calls.length, 1);
  const net = await failure(SEND, () => networkError());
  strictEqual(net.result.outcome, 'uncertain');
  strictEqual(net.mock.calls.length, 1);
});

Deno.test('envoi : 429 et 4xx sont des refus nets (rien n’est parti), jamais rejoués', async () => {
  const limited = await failure(SEND, () => jsonResponse({ message: 'Too many requests' }, 429, { 'retry-after': '1' }));
  strictEqual(limited.result.outcome, 'error');
  strictEqual(limited.result.error.kind, 'rate_limited');
  strictEqual(limited.mock.calls.length, 1);
  for (const status of [400, 403, 404, 422]) {
    const { result, mock } = await failure(SEND, () => jsonResponse({}, status));
    strictEqual(result.outcome, 'error', String(status));
    strictEqual(mock.calls.length, 1);
  }
  const quota = await failure(SEND, () => jsonResponse({ message: 'Weekly invitation limit reached' }, 429));
  strictEqual(quota.result.error.kind, 'provider_limit');
});

Deno.test('envoi : succès 200 et 201 rendus tels quels', async () => {
  for (const status of [200, 201]) {
    const mock = withMockTransport(() => jsonResponse({ object: 'MessageSent', message_id: ['m1', 'm2'] }, status));
    try {
      const result = await unipileFetch(SEND);
      strictEqual(result.outcome, 'ok');
      if (result.outcome === 'ok') {
        strictEqual(result.status, status);
        deepStrictEqual(result.data, { object: 'MessageSent', message_id: ['m1', 'm2'] });
      }
    } finally {
      mock.restore();
    }
  }
});

Deno.test('unipileJson sur un envoi incertain : lève une erreur de type uncertain', async () => {
  await withMockTransport(() => jsonResponse({}, 503), async () => {
    await rejects(() => unipileJson(SEND), (e: unknown) => e instanceof UnipileError && e.kind === 'uncertain');
  });
});

Deno.test('politique par défaut : 2 nouvelles tentatives, budget 10 s, plafond Retry-After 5 s', () => {
  strictEqual(DEFAULT_RETRY_POLICY.maxRetries, 2);
  strictEqual(DEFAULT_RETRY_POLICY.budgetMs, 10_000);
  strictEqual(DEFAULT_RETRY_POLICY.maxRetryAfterMs, 5_000);
});

Deno.test('withMockTransport restitue l’état : après restore, les valeurs par défaut sont retirées', async () => {
  const mock = withMockTransport(() => jsonResponse({}));
  mock.restore();
  const previous = Deno.env.get('UNIPILE_V2_API_KEY');
  Deno.env.delete('UNIPILE_V2_API_KEY');
  try {
    await rejects(() => unipileFetch({ path: '/x' }), (e: unknown) => isUnipileError(e) && e.kind === 'config');
  } finally {
    if (previous !== undefined) Deno.env.set('UNIPILE_V2_API_KEY', previous);
  }
});
