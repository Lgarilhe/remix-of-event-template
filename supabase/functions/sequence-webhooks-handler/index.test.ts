// Récepteur du suivi natif des e-mails : jeton de l'URL seul, événements v2 tracking.open et tracking.click,
// événements des autres récepteurs ignorés. La base est jouée au niveau HTTP (fetch remplacé).
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/sequence-webhooks-handler/index.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';

let handler: ((req: Request) => Promise<Response>) | null = null;
Object.defineProperty(Deno, 'serve', {
  value: (fn: (req: Request) => Promise<Response>) => { handler = fn; return {}; },
  configurable: true,
  writable: true,
});
Deno.env.set('SUPABASE_URL', 'https://project.supabase.co');
Deno.env.set('SB_SECRET_KEY', 'service-key');
await import('./index.ts');
const serve = (req: Request) => handler!(req);

const TOKEN = 'tok-seq-123';
const URL_OK = `https://project.supabase.co/functions/v1/sequence-webhooks-handler?v2_token=${TOKEN}`;
const URL_NO_TOKEN = 'https://project.supabase.co/functions/v1/sequence-webhooks-handler';

const envelope = (type: string, payload: Record<string, unknown> = {}) => ({
  id: 'evt_trk1', type, created_at: '2026-10-11T08:00:00Z', account_id: 'acc_1', account_name: 'Boîte', account_provider: 'google', application_id: 'app_x', payload,
});
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

async function withToken<T>(token: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = [Deno.env.get('UNIPILE_V2_WEBHOOK_TOKEN'), Deno.env.get('UNIPILE_WEBHOOK_SECRET'), Deno.env.get('SEQUENCE_WEBHOOK_SECRET')];
  Deno.env.delete('UNIPILE_WEBHOOK_SECRET');
  Deno.env.delete('SEQUENCE_WEBHOOK_SECRET');
  if (token) Deno.env.set('UNIPILE_V2_WEBHOOK_TOKEN', token);
  else Deno.env.delete('UNIPILE_V2_WEBHOOK_TOKEN');
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, original);
    if (saved[0]) Deno.env.set('UNIPILE_V2_WEBHOOK_TOKEN', saved[0]); else Deno.env.delete('UNIPILE_V2_WEBHOOK_TOKEN');
    if (saved[1]) Deno.env.set('UNIPILE_WEBHOOK_SECRET', saved[1]);
    if (saved[2]) Deno.env.set('SEQUENCE_WEBHOOK_SECRET', saved[2]);
  }
}

/** Répond aux requêtes PostgREST de la base ; enregistre chaque appel. */
async function withRest<T>(
  answer: (path: string, method: string, body: unknown) => unknown,
  fn: (calls: Array<{ path: string; method: string; body: unknown }>) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const text = await request.clone().text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    const url = new URL(request.url);
    const path = `${url.pathname}${url.search}`;
    calls.push({ path, method: request.method, body });
    const reply = answer(url.pathname, request.method, body);
    return new Response(reply === undefined ? 'null' : JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test('suivi : jeton de l\'URL seul ; en-tête secret historique, jeton faux ou absent : 401 ; rien configuré : 503', async () => {
  await withToken(TOKEN, async () => {
    await withRest(() => { throw new Error('la base ne devait pas être lue'); }, async (calls) => {
      for (const request of [
        post(URL_NO_TOKEN, envelope('tracking.open')),
        post(`${URL_NO_TOKEN}?v2_token=faux`, envelope('tracking.open')),
        post(URL_NO_TOKEN, envelope('tracking.open'), { 'x-webhook-secret': TOKEN }),
        post(URL_NO_TOKEN, envelope('tracking.open'), { 'x-webhook-secret': 'local-webhook-secret' }),
      ]) strictEqual((await serve(request)).status, 401);
      strictEqual(calls.length, 0);
    });
  });
  await withToken(undefined, async () => {
    strictEqual((await serve(post(URL_OK, envelope('tracking.open')))).status, 503);
  });
});

Deno.test('suivi : message.new, relation.new et email.new sont journalisés et ignorés (unipile-webhook les traite)', async () => {
  await withToken(TOKEN, async () => {
    await withRest(() => { throw new Error('la base ne devait pas être lue'); }, async (calls) => {
      for (const type of ['message.new', 'relation.new', 'email.new', 'account.add']) {
        strictEqual((await serve(post(URL_OK, envelope(type, { id: 'x' })))).status, 200, type);
      }
      // Corps de l'ancienne génération : acquitté, rien n'est traité.
      const legacy = await serve(post(URL_OK, { event: 'mail_opened', tracking_id: 'abc' }));
      strictEqual(legacy.status, 200);
      deepStrictEqual(await legacy.json(), { received: true, ignored: 'not_a_v2_envelope' });
      strictEqual((await serve(post(URL_OK, 'pas du json'))).status, 400);
      strictEqual(calls.length, 0);
    });
  });
});

Deno.test('tracking.open et tracking.click : append atomique du jalon, statut opened puis clicked', async () => {
  await withToken(TOKEN, async () => {
    const answer = (path: string) => {
      if (path.endsWith('/rpc/record_webhook_event')) return true;
      if (path.endsWith('/sequence_email_tracking')) return { execution_id: 'ex-1' };
      if (path.endsWith('/sequence_step_executions')) return { id: 'ex-1', status: 'sent', tracking_data: {} };
      return undefined;
    };
    for (const [type, field, status] of [['tracking.open', 'opened_at', 'opened'], ['tracking.click', 'clicked_at', 'clicked']] as const) {
      await withRest(answer, async (calls) => {
        const response = await serve(post(URL_OK, envelope(type, { tracking_id: 'trk-9' })));
        strictEqual(response.status, 200, type);
        const append = calls.find((c) => c.path.includes('/rpc/atomic_tracking_append'))!;
        ok(append, `${type} : append atomique`);
        const args = append.body as { p_execution_id: string; p_field: string; p_new_status: string };
        strictEqual(args.p_execution_id, 'ex-1');
        strictEqual(args.p_field, field);
        strictEqual(args.p_new_status, status);
        const dedup = calls.find((c) => c.path.includes('/rpc/record_webhook_event'))!;
        strictEqual((dedup.body as { p_event_key: string }).p_event_key, `unipile:v2:${type}:evt_trk1`);
      });
    }
  });
});

Deno.test('tracking : nouvelle livraison du même événement ignorée ; charge sans tracking_id : rien d\'écrit', async () => {
  await withToken(TOKEN, async () => {
    await withRest((path) => (path.endsWith('/rpc/record_webhook_event') ? false : undefined), async (calls) => {
      const response = await serve(post(URL_OK, envelope('tracking.open', { tracking_id: 'trk-9' })));
      deepStrictEqual(await response.json(), { received: true, deduplicated: true });
      ok(!calls.some((c) => c.path.includes('atomic_tracking_append')));
    });
    await withRest((path) => (path.endsWith('/rpc/record_webhook_event') ? true : undefined), async (calls) => {
      strictEqual((await serve(post(URL_OK, envelope('tracking.click', {})))).status, 200);
      ok(!calls.some((c) => c.path.includes('atomic_tracking_append')));
    });
  });
});
