// Récepteur d'événements : authentification, événements ignorés, dédoublonnage, suppression d'un compte,
// statuts. Le récepteur est joué en entier (handleRequest) sur une base factice qui enregistre chaque requête.
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-webhook/index.test.ts
//
// `--no-check` : le typage du module importe, par candidate-actions/incoming.ts, des fichiers voisins
// (resolve-org-credentials.ts, linkedin-quotas.ts) dont les erreurs de typage déjà présentes ne sont pas de ce lot.

import { deepStrictEqual, ok, strictEqual } from 'node:assert';

// Le module démarre un serveur à l'import : on le remplace avant de l'importer.
Object.defineProperty(Deno, 'serve', { value: () => ({}), configurable: true, writable: true });
const mod = await import('./index.ts');

const ACC = 'acc_01kyex2j0pexzt3v8prstne0ey';
const TOKEN = 'tok-receiver-123';
const URL_OK = `https://project.supabase.co/functions/v1/unipile-webhook?v2_token=${TOKEN}`;
const URL_NO_TOKEN = 'https://project.supabase.co/functions/v1/unipile-webhook';

type Call = {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc';
  payload?: unknown;
  filters: Array<[string, unknown[]]>;
  single?: boolean;
};
type Reply = { data?: unknown; error?: unknown } | undefined;

/** Base factice : chaque requête est enregistrée, la réponse vient de `respond`. Tout retourne vide par défaut. */
function makeDb(respond: (call: Call) => Reply = () => undefined) {
  const calls: Call[] = [];
  const builder = (call: Call) => {
    const proxy: unknown = new Proxy(() => {}, {
      get(_target, prop: string) {
        if (prop === 'then') {
          return (resolve: (value: unknown) => void) => {
            const reply = respond(call) ?? {};
            let data = reply.data ?? (call.single ? null : []);
            if (call.single && Array.isArray(data)) data = data[0] ?? null;
            resolve({ data, error: reply.error ?? null });
          };
        }
        return (...args: unknown[]) => {
          if (prop === 'insert' || prop === 'update' || prop === 'delete' || prop === 'upsert') {
            call.op = prop;
            call.payload = args[0];
          } else if (prop === 'maybeSingle' || prop === 'single') {
            call.single = true;
          } else if (prop !== 'select') {
            call.filters.push([prop, args]);
          }
          return proxy;
        };
      },
    });
    return proxy;
  };
  const db = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      return builder(call);
    },
    rpc(name: string, args: unknown) {
      const call: Call = { table: `rpc:${name}`, op: 'rpc', payload: args, filters: [] };
      calls.push(call);
      return builder(call);
    },
  };
  return { db, calls };
}

function envelope(type: string, payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    id: 'evt_01abc', type, created_at: '2026-10-11T08:00:00.000Z', account_id: ACC, account_name: 'Compte test',
    account_provider: 'linkedin', application_id: 'app_x', payload, ...extra,
  };
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const ENV_NAMES = ['UNIPILE_V2_WEBHOOK_TOKEN', 'UNIPILE_WEBHOOK_SECRET', 'SUPABASE_URL', 'SB_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

/** Joue `fn` avec un environnement donné et une base factice, puis rétablit tout. */
async function withEnv<T>(env: Record<string, string | undefined>, respond: ((call: Call) => Reply) | null, fn: (ctx: ReturnType<typeof makeDb>) => Promise<T>): Promise<T> {
  const saved = ENV_NAMES.map((name) => [name, Deno.env.get(name)] as const);
  const savedFactory = mod.testing.createDb;
  for (const name of ENV_NAMES) Deno.env.delete(name);
  for (const [name, value] of Object.entries({ SUPABASE_URL: 'https://project.supabase.co', SB_SECRET_KEY: 'service', ...env })) {
    if (value !== undefined) Deno.env.set(name, value);
  }
  const ctx = makeDb(respond ?? undefined);
  mod.testing.createDb = (() => ctx.db) as unknown as typeof mod.testing.createDb;
  const log = console.log, warn = console.warn, error = console.error;
  console.log = console.warn = console.error = () => {};
  try {
    return await fn(ctx);
  } finally {
    console.log = log; console.warn = warn; console.error = error;
    mod.testing.createDb = savedFactory;
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

const noDb = () => { throw new Error('la base ne devait pas être lue'); };

// ---------------------------------------------------------------------------
// Authentification
// ---------------------------------------------------------------------------

Deno.test('authentification : seul le jeton ?v2_token= ouvre ; en-tête historique, signature d\'appel de retour, jeton faux ou absent : 401', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, noDb, async ({ calls }) => {
    const body = envelope('message.new', { id: 'M1' });
    const refused: Request[] = [
      post(URL_NO_TOKEN, body),
      post(`${URL_NO_TOKEN}?v2_token=`, body),
      post(`${URL_NO_TOKEN}?v2_token=pas-le-bon`, body),
      post(`${URL_NO_TOKEN}?v2_token=${TOKEN}x`, body),
      // Un point de terminaison de l'ancienne génération : en-tête secret, pas de jeton.
      post(URL_NO_TOKEN, body, { 'unipile-auth': TOKEN }),
      post(URL_NO_TOKEN, body, { 'unipile-auth': 'local-webhook-secret' }),
      // Signature d'un appel de retour d'authentification de l'ancienne génération.
      post(`${URL_NO_TOKEN}?hosted_sig=${'a'.repeat(64)}`, { status: 'CREATION_SUCCESS', account_id: 'x', name: 'user:1|org:2' }),
    ];
    for (const request of refused) {
      const response = await mod.handleRequest(request);
      strictEqual(response.status, 401, request.url);
    }
    strictEqual(calls.length, 0, 'aucune lecture ni écriture avant l\'authentification');
  });
});

Deno.test('authentification : seul le jeton dédié est configuré (secret historique absent) : jamais 500', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_WEBHOOK_SECRET: undefined }, noDb, async () => {
    // Bon jeton, corps illisible : la livraison est authentifiée, c'est le corps qui est refusé (400).
    strictEqual((await mod.handleRequest(post(URL_OK, 'pas du json'))).status, 400);
    strictEqual((await mod.handleRequest(post(URL_NO_TOKEN, envelope('message.new')))).status, 401);
  });
});

Deno.test('authentification : jeton dérivé du secret historique seul', async () => {
  const { deriveWebhookToken } = await import('../_shared/unipile/index.ts');
  const derived = await deriveWebhookToken('legacy-secret');
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: undefined, UNIPILE_WEBHOOK_SECRET: 'legacy-secret' }, noDb, async () => {
    strictEqual((await mod.handleRequest(post(`${URL_NO_TOKEN}?v2_token=${derived}`, 'x'))).status, 400);
    // Le secret lui-même n'est pas un jeton.
    strictEqual((await mod.handleRequest(post(`${URL_NO_TOKEN}?v2_token=legacy-secret`, envelope('message.new')))).status, 401);
  });
});

Deno.test('authentification : aucun jeton configuré : 503, jamais 200 ni 500', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: undefined, UNIPILE_WEBHOOK_SECRET: undefined }, noDb, async ({ calls }) => {
    const response = await mod.handleRequest(post(URL_OK, envelope('message.new')));
    strictEqual(response.status, 503);
    strictEqual(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Corps et événements ignorés
// ---------------------------------------------------------------------------

Deno.test('corps qui n\'est pas une enveloppe v2 (ancienne génération) : acquitté, rien n\'est lu ni écrit', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, noDb, async ({ calls }) => {
    for (const body of [
      { event: 'message_received', account_id: 'abc123', chat_id: 'c', sender: { attendee_id: 'a' } },
      { AccountStatus: { account_id: 'abc', message: 'OK' } },
      { status: 'CREATION_SUCCESS', account_id: 'abc', name: 'user:1|org:2' },
    ]) {
      const response = await mod.handleRequest(post(URL_OK, body));
      strictEqual(response.status, 200);
      deepStrictEqual(await response.json(), { ok: true, ignored: 'not_a_v2_envelope' });
    }
    strictEqual(calls.length, 0);
  });
});

Deno.test('compte sans identifiant v2 : acquitté sans action', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, noDb, async ({ calls }) => {
    const response = await mod.handleRequest(post(URL_OK, envelope('message.new', { id: 'M' }, { account_id: 'ancien-identifiant-v1' })));
    strictEqual(response.status, 200);
    deepStrictEqual(await response.json(), { ok: true, ignored: 'invalid_account_id' });
    strictEqual(calls.length, 0);
  });
});

Deno.test('type d\'événement non traité : journalisé dans webhook_event_log (type brut) et acquitté 200 sans action', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => (call.table === 'rpc:record_webhook_event' ? { data: true } : undefined), async ({ calls }) => {
    for (const type of ['message.update', 'chat.update', 'calendar.event.new', 'tracking.open']) {
      calls.length = 0;
      const response = await mod.handleRequest(post(URL_OK, envelope(type, { id: 'x' })));
      strictEqual(response.status, 200, type);
      strictEqual(calls.length, 1, `${type} : une seule requête, la ligne de journal`);
      strictEqual(calls[0].table, 'rpc:record_webhook_event');
      deepStrictEqual(calls[0].payload, {
        p_event_key: `unipile:v2:${type}:evt_01abc`, p_provider: 'unipile', p_event_type: type, p_account_id: ACC,
      });
    }
  });
});

Deno.test('message.receipt.read, message.reaction.new et account.initial_sync.* : reconnus, journalisés, sans action', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => (call.table === 'rpc:record_webhook_event' ? { data: true } : undefined), async ({ calls }) => {
    for (const [type, payload] of [
      ['message.receipt.read', { id: 'M1', chat_id: 'C1' }],
      ['message.reaction.new', { message_id: 'M1', chat_id: 'C1', reaction: 'like' }],
      ['account.initial_sync.completed', {}],
      ['account.initial_sync.failed', {}],
    ] as const) {
      calls.length = 0;
      const response = await mod.handleRequest(post(URL_OK, envelope(type, payload)));
      strictEqual(response.status, 200, type);
      strictEqual(calls.length, 1, type);
      strictEqual((calls[0].payload as { p_event_type: string }).p_event_type, type);
    }
  });
});

Deno.test('dédoublonnage : même événement deux fois, le second est ignoré ; clé = type brut + evt_', async () => {
  let isNew = true;
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
    if (call.table === 'rpc:record_webhook_event') {
      const first = isNew;
      isNew = false;
      return { data: first };
    }
    return undefined;
  }, async ({ calls }) => {
    const request = () => post(URL_OK, envelope('message.update', { id: 'm' }, { id: 'evt_dup' }));
    strictEqual((await mod.handleRequest(request())).status, 200);
    const second = await mod.handleRequest(request());
    deepStrictEqual(await second.json(), { ok: true, deduplicated: true });
    strictEqual(calls.filter((c) => c.table === 'rpc:record_webhook_event').length, 2);
    ok(calls.every((c) => c.table === 'rpc:record_webhook_event' || c.table === 'webhook_event_log'));
  });
});

Deno.test('dédoublonnage : degraded, partial et running du même evt_ restent distincts (clé sur le type brut)', async () => {
  const keys: string[] = [];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
    if (call.table === 'rpc:record_webhook_event') keys.push((call.payload as { p_event_key: string }).p_event_key);
    return call.table === 'rpc:record_webhook_event' ? { data: true } : undefined;
  }, async () => {
    for (const type of ['account.status.running', 'account.status.degraded', 'account.status.partial']) {
      await mod.handleRequest(post(URL_OK, envelope(type, {}, { id: 'evt_same' })));
    }
  });
  strictEqual(new Set(keys).size, 3);
  deepStrictEqual(keys, [
    'unipile:v2:account.status.running:evt_same',
    'unipile:v2:account.status.degraded:evt_same',
    'unipile:v2:account.status.partial:evt_same',
  ]);
});

// ---------------------------------------------------------------------------
// Statuts de compte
// ---------------------------------------------------------------------------

const isNewEvent = (call: Call) => (call.table === 'rpc:record_webhook_event' ? { data: true } : undefined);
const writes = (calls: Call[], table: string, op: Call['op']) => calls.filter((c) => c.table === table && c.op === op);

Deno.test('account.status.degraded et partial : statut écrit sur le compte LinkedIn, aucune notification, aucune reprise', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, isNewEvent, async ({ calls }) => {
    for (const [type, status] of [['account.status.degraded', 'DEGRADED'], ['account.status.partial', 'PARTIAL']] as const) {
      calls.length = 0;
      strictEqual((await mod.handleRequest(post(URL_OK, envelope(type, { object: 'Account' })))).status, 200);
      const update = writes(calls, 'member_linkedin_accounts', 'update');
      strictEqual(update.length, 1, type);
      strictEqual((update[0].payload as { account_status: string }).account_status, status);
      deepStrictEqual(update[0].filters.find(([name]) => name === 'eq'), ['eq', ['linkedin_account_id', ACC]]);
      strictEqual(writes(calls, 'notifications', 'insert').length, 0, `${type} : pas de notification`);
      strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0, `${type} : pas de reprise`);
    }
  });
});

Deno.test('account.status.running sur un compte verrouillé : LOCKED ; sinon OK et reprise des inscriptions', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, isNewEvent, async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, envelope('account.status.running', { object: 'Account', is_locked: true })));
    strictEqual((writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { account_status: string }).account_status, 'LOCKED');
    strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0);

    calls.length = 0;
    await mod.handleRequest(post(URL_OK, envelope('account.status.running', { object: 'Account', is_locked: false })));
    const update = writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { account_status: string; failure_reason: null };
    strictEqual(update.account_status, 'OK');
    strictEqual(update.failure_reason, null);
    ok(calls.some((c) => c.table === 'sequence_enrollments'), 'les inscriptions en pause pour compte déconnecté sont relues');
  });
});

Deno.test('account.status.running d\'un compte e-mail ou WhatsApp : la bonne table, pas de reprise LinkedIn', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, isNewEvent, async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, envelope('account.status.degraded', {}, { account_provider: 'google' })));
    strictEqual(writes(calls, 'member_email_accounts', 'update').length, 1);
    strictEqual(writes(calls, 'member_linkedin_accounts', 'update').length, 0);
    calls.length = 0;
    await mod.handleRequest(post(URL_OK, envelope('account.status.partial', {}, { account_provider: 'whatsapp' })));
    strictEqual(writes(calls, 'member_whatsapp_accounts', 'update').length, 1);
    strictEqual(writes(calls, 'member_linkedin_accounts', 'update').length, 0);
  });
});

Deno.test('account.status.disconnected : CREDENTIALS, notification seulement au passage d\'un compte en état de marche', async () => {
  for (const [previous, notified] of [['OK', 1], ['DEGRADED', 1], ['CREDENTIALS', 0], ['ERROR', 0]] as const) {
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
      if (call.table === 'rpc:record_webhook_event') return { data: true };
      if (call.table === 'member_linkedin_accounts' && call.op === 'select') {
        return { data: [{ user_id: 'u1', organization_id: 'o1', linkedin_account_name: 'Marie', account_status: previous }] };
      }
      return undefined;
    }, async ({ calls }) => {
      await mod.handleRequest(post(URL_OK, envelope('account.status.disconnected', {})));
      const update = writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { account_status: string };
      strictEqual(update.account_status, 'CREDENTIALS', previous);
      const notifications = writes(calls, 'notifications', 'insert');
      strictEqual(notifications.length, notified, `${previous} -> ${notified} notification(s)`);
      if (notified) strictEqual((notifications[0].payload as Array<{ type: string }>)[0].type, 'linkedin_disconnected');
      strictEqual((writes(calls, 'member_whatsapp_accounts', 'update')[0].payload as { account_status: string }).account_status, 'DISCONNECTED');
    });
  }
});

Deno.test('account.status.disconnected : le texte du prestataire n\'est jamais écrit dans failure_reason (code neutre seulement)', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, isNewEvent, async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, envelope('account.status.disconnected', { reason: 'Unipile session expired for LinkedIn', message: 'raw provider text' })));
    const update = writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { failure_reason: string };
    strictEqual(update.failure_reason, 'disconnected');
  });
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, isNewEvent, async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, envelope('account.status.errored', { error: 'Unipile raw failure' })));
    strictEqual((writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { failure_reason: string }).failure_reason, 'error');
  });
});

Deno.test('account.status.errored : ERROR', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, isNewEvent, async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, envelope('account.status.errored', {})));
    strictEqual((writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { account_status: string }).account_status, 'ERROR');
    strictEqual((writes(calls, 'member_email_accounts', 'update')[0].payload as { account_status: string }).account_status, 'ERROR');
  });
});

// ---------------------------------------------------------------------------
// account.remove
// ---------------------------------------------------------------------------

const LINKED_ROWS = (call: Call): Reply => {
  if (call.table === 'rpc:record_webhook_event') return { data: true };
  if (call.table === 'member_linkedin_accounts' && call.op === 'select') {
    return { data: [{ id: 'link-1', user_id: 'u1', organization_id: 'o1', linkedin_account_name: 'Marie' }] };
  }
  return undefined;
};

Deno.test('account.remove : envois arrêtés PUIS liaison retirée, ni statut CREDENTIALS ni notification de déconnexion récupérable', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, LINKED_ROWS, async ({ calls }) => {
    const response = await mod.handleRequest(post(URL_OK, envelope('account.remove', { object: 'Account' })));
    strictEqual(response.status, 200);
    const stopAt = calls.findIndex((c) => c.table === 'sequence_enrollments' && c.op === 'update');
    const inmailAt = calls.findIndex((c) => c.table === 'inmail_queue' && c.op === 'update');
    const unlinkAt = calls.findIndex((c) => c.table === 'member_linkedin_accounts' && c.op === 'delete');
    ok(stopAt >= 0 && inmailAt >= 0, 'les envois du compte sont arrêtés (pause des inscriptions, InMails annulés)');
    ok(unlinkAt > stopAt && unlinkAt > inmailAt, 'la liaison n\'est retirée qu\'après l\'arrêt des envois');
    deepStrictEqual(calls[unlinkAt].filters.filter(([name]) => name === 'eq'), [['eq', ['id', 'link-1']], ['eq', ['organization_id', 'o1']]]);
    // Rien ne met le compte en CREDENTIALS : ce n'est pas une déconnexion récupérable.
    ok(!calls.some((c) => c.op === 'update' && JSON.stringify(c.payload ?? {}).includes('CREDENTIALS')));
    // Liaisons e-mail retirées, WhatsApp gardé en DELETED.
    strictEqual(writes(calls, 'member_email_accounts', 'delete').length, 1);
    const whatsapp = writes(calls, 'member_whatsapp_accounts', 'update');
    strictEqual((whatsapp[0].payload as { account_status: string }).account_status, 'DELETED');
    // Le membre est prévenu que le compte est supprimé.
    const notification = (writes(calls, 'notifications', 'insert')[0].payload as Array<{ body: string; user_id: string }>)[0];
    strictEqual(notification.user_id, 'u1');
    ok(notification.body.includes('supprimé'));
    ok(!/unipile/i.test(notification.body));
  });
});

Deno.test('account.remove : arrêt des envois en échec : 500, liaison conservée, ligne de dédoublonnage purgée pour le rejeu', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
    if (call.table === 'sequence_enrollments' && call.op === 'update') return { error: { code: 'XX000', message: 'base indisponible' } };
    return LINKED_ROWS(call);
  }, async ({ calls }) => {
    const response = await mod.handleRequest(post(URL_OK, envelope('account.remove', {}, { id: 'evt_rm' })));
    strictEqual(response.status, 500);
    strictEqual(writes(calls, 'member_linkedin_accounts', 'delete').length, 0, 'la liaison reste tant que l\'arrêt n\'a pas réussi');
    const purge = writes(calls, 'webhook_event_log', 'delete');
    strictEqual(purge.length, 1);
    deepStrictEqual(purge[0].filters, [['eq', ['event_key', 'unipile:v2:account.remove:evt_rm']]]);
  });
});

Deno.test('account.remove : une panne APRÈS le retrait d\'une liaison ne fait pas perdre la notification de son membre', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
    // Le retrait des liaisons e-mail échoue : 500 et rejeu, où la liaison LinkedIn déjà retirée ne sera plus relue.
    if (call.table === 'member_email_accounts' && call.op === 'delete') return { error: { code: 'XX000', message: 'base indisponible' } };
    return LINKED_ROWS(call);
  }, async ({ calls }) => {
    const response = await mod.handleRequest(post(URL_OK, envelope('account.remove', {}, { id: 'evt_rm2' })));
    strictEqual(response.status, 500);
    strictEqual(writes(calls, 'member_linkedin_accounts', 'delete').length, 1, 'la liaison est déjà retirée');
    const notifications = writes(calls, 'notifications', 'insert');
    strictEqual(notifications.length, 1, 'son membre est déjà prévenu');
    strictEqual((notifications[0].payload as Array<{ user_id: string }>)[0].user_id, 'u1');
  });
});

Deno.test('account.remove : compte sans liaison LinkedIn : rien à arrêter, WhatsApp et e-mail traités, 200', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, isNewEvent, async ({ calls }) => {
    strictEqual((await mod.handleRequest(post(URL_OK, envelope('account.remove', {}, { account_provider: 'whatsapp' })))).status, 200);
    strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0);
    strictEqual(writes(calls, 'member_whatsapp_accounts', 'update').length, 1);
    strictEqual(writes(calls, 'notifications', 'insert').length, 0);
  });
});

// ---------------------------------------------------------------------------
// account.add / account.reconnect
// ---------------------------------------------------------------------------

Deno.test('account.add : state inconnu ou absent : aucun rattachement ; liaison LinkedIn déjà en place repasse OK, reprise des inscriptions', async () => {
  for (const state of [undefined, 'pas-un-uuid', '8d0a6a62-1b53-4f4e-9a52-2f0a8f6b1111']) {
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, isNewEvent, async ({ calls }) => {
      const response = await mod.handleRequest(post(URL_OK, envelope('account.add', state ? { state } : {})));
      strictEqual(response.status, 200, String(state));
      strictEqual(writes(calls, 'member_linkedin_accounts', 'upsert').length, 0, 'rien n\'est rattaché sans tentative connue');
      strictEqual(writes(calls, 'member_email_accounts', 'insert').length, 0);
      strictEqual((writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { account_status: string }).account_status, 'OK');
      ok(calls.some((c) => c.table === 'sequence_enrollments'));
    });
  }
});

Deno.test('account.add : tentative échue : rien n\'est rattaché, le membre de la tentative est prévenu', async () => {
  const attempt = {
    id: '8d0a6a62-1b53-4f4e-9a52-2f0a8f6b2222', organization_id: 'org-1', user_id: 'user-1', provider: 'linkedin', purpose: 'link',
    reconnect_account_id: null, mode: 'hosted', status: 'pending', intent_id: null, account_id: null, error_kind: null,
    created_at: '2026-10-11T07:00:00Z', completed_at: null, expires_at: '2026-10-11T07:30:00Z',
  };
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
    if (call.table === 'rpc:record_webhook_event') return { data: true };
    if (call.table === 'connection_attempts' && call.op === 'select') return { data: attempt };
    return undefined;
  }, async ({ calls }) => {
    const response = await mod.handleRequest(post(URL_OK, envelope('account.add', { state: attempt.id })));
    strictEqual(response.status, 200);
    strictEqual(writes(calls, 'member_linkedin_accounts', 'upsert').length, 0);
    const notice = writes(calls, 'notifications', 'insert')[0].payload as { user_id: string; organization_id: string; title: string; body: string };
    strictEqual(notice.user_id, 'user-1');
    strictEqual(notice.organization_id, 'org-1');
    ok(notice.title.includes('non rattaché'));
    ok(!/unipile/i.test(notice.body));
    // La liaison n'a pas changé : aucune inscription n'est reprise.
    strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0, 'pas de reprise après un rattachement refusé');
    strictEqual(writes(calls, 'member_linkedin_accounts', 'update').length, 0);
  });
});

Deno.test('account.add : compte déjà rattaché à une autre organisation (échec du rattachement) : membre prévenu, aucune reprise des inscriptions', async () => {
  const attempt = {
    id: '8d0a6a62-1b53-4f4e-9a52-2f0a8f6b5555', organization_id: 'org-B', user_id: 'user-B', provider: 'linkedin', purpose: 'link',
    reconnect_account_id: null, mode: 'hosted', status: 'pending', intent_id: null, account_id: null, error_kind: null,
    created_at: new Date().toISOString(), completed_at: null, expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
  };
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
    if (call.table === 'rpc:record_webhook_event') return { data: true };
    if (call.table === 'connection_attempts' && call.op === 'select') return { data: attempt };
    if (call.table === 'connection_attempts' && call.op === 'update') return { data: [{ id: attempt.id }] };
    // Le compte appartient déjà à l'organisation A.
    if (call.table === 'member_linkedin_accounts' && call.op === 'select') return { data: [{ organization_id: 'org-A', user_id: 'user-A' }] };
    return undefined;
  }, async ({ calls }) => {
    strictEqual((await mod.handleRequest(post(URL_OK, envelope('account.add', { state: attempt.id })))).status, 200);
    strictEqual(writes(calls, 'member_linkedin_accounts', 'upsert').length, 0);
    const notice = writes(calls, 'notifications', 'insert')[0].payload as { user_id: string; title: string };
    strictEqual(notice.user_id, 'user-B');
    ok(notice.title.includes('non rattaché'));
    strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0, 'les inscriptions du compte de l\'autre organisation ne sont pas reprises');
  });
});

Deno.test('account.reconnect sans tentative : l\'état rapporté est écrit tel quel (LOCKED, ERROR), jamais forcé à OK, et seul OK reprend les inscriptions', async () => {
  for (const [payload, expected, resumes] of [
    [{ status: 'running', is_locked: true }, 'LOCKED', false],
    [{ status: 'errored' }, 'ERROR', false],
    [{ status: 'degraded' }, 'DEGRADED', false],
    [{ status: 'running', is_locked: false }, 'OK', true],
    [{}, 'OK', true],
  ] as const) {
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, isNewEvent, async ({ calls }) => {
      strictEqual((await mod.handleRequest(post(URL_OK, envelope('account.reconnect', payload)))).status, 200);
      const update = writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { account_status: string; failure_reason?: null };
      strictEqual(update.account_status, expected, JSON.stringify(payload));
      strictEqual('failure_reason' in update, expected === 'OK', 'la raison d\'échec n\'est effacée qu\'au retour à OK');
      strictEqual(calls.some((c) => c.table === 'sequence_enrollments'), resumes, JSON.stringify(payload));
    });
  }
});

Deno.test('account.add : fournisseur absent de la charge et illisible chez le prestataire : 500 pour le rejeu, aucune notification de refus', async () => {
  const attempt = {
    id: '8d0a6a62-1b53-4f4e-9a52-2f0a8f6b6666', organization_id: 'org-1', user_id: 'user-1', provider: 'linkedin', purpose: 'link',
    reconnect_account_id: null, mode: 'hosted', status: 'pending', intent_id: null, account_id: null, error_kind: null,
    created_at: new Date().toISOString(), completed_at: null, expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
  };
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, (call) => {
    if (call.table === 'rpc:record_webhook_event') return { data: true };
    if (call.table === 'connection_attempts' && call.op === 'select') return { data: attempt };
    return undefined;
  }, async ({ calls }) => {
    await withFetch(() => 404, async () => {
      const response = await mod.handleRequest(post(URL_OK, envelope('account.add', { state: attempt.id }, { account_provider: undefined })));
      strictEqual(response.status, 500);
      strictEqual(writes(calls, 'notifications', 'insert').length, 0, 'un refus faux et définitif n\'est pas notifié');
      strictEqual(writes(calls, 'member_linkedin_accounts', 'upsert').length, 0);
      strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 1, 'ligne de dédoublonnage purgée pour le rejeu');
    });
  });
});

Deno.test('account.add : tentative valide : rattachée au membre et à l\'organisation de la TENTATIVE, jamais à ceux de la charge', async () => {
  const attempt = {
    id: '8d0a6a62-1b53-4f4e-9a52-2f0a8f6b3333', organization_id: 'org-1', user_id: 'user-1', provider: 'linkedin', purpose: 'link',
    reconnect_account_id: null, mode: 'hosted', status: 'pending', intent_id: null, account_id: null, error_kind: null,
    created_at: new Date().toISOString(), completed_at: null, expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
  };
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
    if (call.table === 'rpc:record_webhook_event') return { data: true };
    if (call.table === 'connection_attempts' && call.op === 'select') return { data: attempt };
    if (call.table === 'connection_attempts' && call.op === 'update') return { data: [{ id: attempt.id }] };
    return undefined;
  }, async ({ calls }) => {
    // La charge tente de désigner un autre membre et une autre organisation : ignoré.
    const response = await mod.handleRequest(post(URL_OK, envelope('account.add', {
      state: attempt.id, user_id: 'intrus', organization_id: 'autre-org', name: 'user:intrus|org:autre-org|providers:LINKEDIN',
    })));
    strictEqual(response.status, 200);
    const upsert = writes(calls, 'member_linkedin_accounts', 'upsert')[0].payload as Record<string, unknown>;
    strictEqual(upsert.user_id, 'user-1');
    strictEqual(upsert.organization_id, 'org-1');
    strictEqual(upsert.linkedin_account_id, ACC);
    const closed = writes(calls, 'connection_attempts', 'update')[0].payload as Record<string, unknown>;
    strictEqual(closed.status, 'completed');
    strictEqual(closed.account_id, ACC);
    ok(calls.some((c) => c.table === 'sequence_enrollments'), 'reprise des inscriptions après le rattachement');
  });
});

Deno.test('account.add : lecture de la tentative en erreur : 500 (rejeu), rien n\'est écrit', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
    if (call.table === 'rpc:record_webhook_event') return { data: true };
    if (call.table === 'connection_attempts') return { error: { code: 'XX000', message: 'indisponible' } };
    return undefined;
  }, async ({ calls }) => {
    const response = await mod.handleRequest(post(URL_OK, envelope('account.add', { state: '8d0a6a62-1b53-4f4e-9a52-2f0a8f6b4444' })));
    strictEqual(response.status, 500);
    strictEqual(writes(calls, 'member_linkedin_accounts', 'upsert').length, 0);
    strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 1);
  });
});

// ---------------------------------------------------------------------------
// message.new : aucun appel de l'ancienne génération, lecture du prestataire par le client partagé
// ---------------------------------------------------------------------------

const CHAT = 'CLASSIC_2-CHAT';
const SENDER = 'ACoAADKm2akB';
const message = (extra: Record<string, unknown> = {}) => ({
  id: 'CLASSIC_2-MSG', object: 'Message', chat_id: CHAT, sender_id: SENDER, text: '<scrubbed>', timestamp: '2026-10-11T08:00:00.000Z',
  is_sender: false, sender: { id: SENDER, object: 'User', display_name: 'Marie Dupont' }, ...extra,
});

/** Remplace fetch : enregistre les adresses appelées, répond selon `answer`. */
async function withFetch<T>(answer: (url: string) => unknown, fn: (urls: string[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input: Request | URL | string) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const body = answer(url);
    const status = typeof body === 'number' ? body : 200;
    return Promise.resolve(new Response(typeof body === 'number' ? '{}' : JSON.stringify(body ?? {}), {
      status, headers: { 'content-type': 'application/json' },
    }));
  }) as typeof fetch;
  try {
    return await fn(urls);
  } finally {
    globalThis.fetch = original;
  }
}

const profileAnswer = (url: string) => (/\/users\//.test(url) ? { object: 'UserProfile', id: 'ACoAAalt', public_identifier: 'marie-dupont', display_name: 'Marie Dupont', specifics: null } : {});

const MEMBER = { user_id: 'u1', organization_id: 'o1' };
const ENROLLMENT = {
  id: 'enr-1', sequence_id: 'seq-1', profile_id: SENDER, provider_id: null, resolved_profile_id: null, account_id: ACC,
  status: 'active', organization_id: 'o1', profile_name: 'Marie Dupont', profile_url: 'https://www.linkedin.com/in/marie-dupont',
  created_by: 'u1', connection_status: 'connected',
};

function replyBase(call: Call): Reply {
  if (call.table === 'rpc:record_webhook_event') return { data: true };
  if (call.table === 'member_linkedin_accounts' && call.op === 'select') return { data: [MEMBER] };
  if (call.table === 'sequence_enrollments' && call.op === 'select') return { data: [ENROLLMENT] };
  if (call.table === 'sequence_enrollments' && call.op === 'update') return { data: [{ id: 'enr-1' }] };
  if (call.table === 'rpc:record_candidate_inbound') return { data: { changed: false, result: 'unchanged', project_id: 'proj-1' } };
  if (call.table === 'rpc:record_own_message') return { data: { result: 'echo' } };
  return undefined;
}

Deno.test('message.new d\'un candidat : inscription close « répondu », étape et notification ; lectures par le client v2 uniquement', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, replyBase, async ({ calls }) => {
    await withFetch(profileAnswer, async (urls) => {
      const response = await mod.handleRequest(post(URL_OK, envelope('message.new', message())));
      strictEqual(response.status, 200);
      const update = writes(calls, 'sequence_enrollments', 'update')[0].payload as { status: string };
      strictEqual(update.status, 'replied');
      const inbound = calls.find((c) => c.table === 'rpc:record_candidate_inbound')!;
      strictEqual((inbound.payload as { p_account_id: string }).p_account_id, ACC);
      strictEqual((inbound.payload as { p_chat_id: string }).p_chat_id, CHAT);
      const notification = writes(calls, 'notifications', 'insert')[0].payload as { type: string; link: string; title: string; metadata: { event_key: string } };
      strictEqual(notification.type, 'new_message');
      strictEqual(notification.link, `/inbox?chatId=${CHAT}`);
      strictEqual(notification.title, 'Nouveau message de Marie Dupont');
      strictEqual(notification.metadata.event_key, 'unipile:v2:message.new:evt_01abc');
      // Seule lecture du prestataire : le profil de l'expéditeur, sur l'hôte v2, avec le compte dans le chemin.
      const provider = urls.filter((u) => u.startsWith('https://api.unipile.com/'));
      ok(provider.length >= 1 && provider.every((u) => u.startsWith(`https://api.unipile.com/v2/${ACC}/users/`)), provider.join(','));
      ok(urls.every((u) => !u.includes('/api/v1')), 'aucun appel de l\'ancienne génération');
    });
  });
});

Deno.test('message.new : alias résolu par le profil (id différent) et slug public rattachent l\'inscription', async () => {
  const bySlug = { ...ENROLLMENT, profile_id: 'AEMother', profile_url: 'https://www.linkedin.com/in/marie-dupont' };
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, (call) => {
    // Premier passage par identifiant : rien ; seul le repli par slug rend l'inscription.
    if (call.table === 'sequence_enrollments' && call.op === 'select') {
      const usesSlug = call.filters.some(([name, args]) => name === 'ilike' && String(args[1]).includes('/in/marie-dupont'));
      return { data: usesSlug ? [bySlug] : [] };
    }
    return replyBase(call);
  }, async ({ calls }) => {
    await withFetch(profileAnswer, async () => {
      strictEqual((await mod.handleRequest(post(URL_OK, envelope('message.new', message())))).status, 200);
      strictEqual((writes(calls, 'sequence_enrollments', 'update')[0].payload as { status: string }).status, 'replied');
    });
  });
});

Deno.test('message.new de nous (is_sender) : message propre enregistré, aucune clôture ni lecture du profil', async () => {
  // Premier appel : candidat inconnu, la conversation est alors lue ; second appel : enregistré.
  let ownCalls = 0;
  const reply = (call: Call): Reply => (call.table === 'rpc:record_own_message'
    ? { data: { result: ++ownCalls === 1 ? 'no_candidate' : 'recorded' } }
    : replyBase(call));
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, reply, async ({ calls }) => {
    await withFetch((url) => (/\/chats\//.test(url)
      ? { object: 'Chat', id: CHAT, type: '1to1', is_1to1: true, user_id: SENDER, user: { id: SENDER, object: 'User', display_name: 'Marie Dupont', public_identifier: 'marie-dupont' } }
      : {}), async (urls) => {
      strictEqual((await mod.handleRequest(post(URL_OK, envelope('message.new', message({ is_sender: true }))))).status, 200);
      const own = calls.filter((c) => c.table === 'rpc:record_own_message');
      strictEqual(own.length, 2);
      // Le second appel porte le candidat lu dans la conversation (Chat.user).
      deepStrictEqual((own[1].payload as { p_candidate: { ids: string[]; slug?: string } }).p_candidate.ids, [SENDER]);
      strictEqual((own[1].payload as { p_candidate: { slug?: string } }).p_candidate.slug, 'marie-dupont');
      strictEqual(writes(calls, 'sequence_enrollments', 'update').length, 0);
      strictEqual(writes(calls, 'notifications', 'insert').length, 0);
      // L'autre participant est lu dans la conversation à deux : GET /v2/{compte}/chats/{chat}.
      ok(urls.some((u) => u === `https://api.unipile.com/v2/${ACC}/chats/${CHAT}`), urls.join(','));
      ok(urls.every((u) => !u.includes('/attendees') && !u.includes('/api/v1')));
    });
  });
});

Deno.test('message.new de nous : une lecture des membres en échec ne fait pas répondre 500 (chemin non bloquant)', async () => {
  // La première lecture des membres est celle de la capture des actions candidat (hors de ce lot) ; les
  // suivantes sont celles du récepteur, qui ne doivent pas faire échouer un écho de nos envois.
  let memberReads = 0;
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, (call) => {
    if (call.table === 'member_linkedin_accounts' && call.op === 'select' && ++memberReads > 1) {
      return { error: { code: 'XX000', message: 'base indisponible' } };
    }
    return replyBase(call);
  }, async ({ calls }) => {
    await withFetch(profileAnswer, async () => {
      const response = await mod.handleRequest(post(URL_OK, envelope('message.new', message({ is_sender: true }))));
      strictEqual(response.status, 200, 'un écho de nos envois n\'est pas rejoué');
      strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 0);
      strictEqual(writes(calls, 'sequence_enrollments', 'update').length, 0);
    });
  });
});

Deno.test('message.new sans is_sender sur un compte relié à aucune organisation : acquitté 200, ni relecture ni rejeu', async () => {
  const noFlag = message();
  delete (noFlag as Record<string, unknown>).is_sender;
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, (call) => {
    if (call.table === 'member_linkedin_accounts') return { data: [] };
    return replyBase(call);
  }, async ({ calls }) => {
    await withFetch(profileAnswer, async (urls) => {
      strictEqual((await mod.handleRequest(post(URL_OK, envelope('message.new', noFlag)))).status, 200);
      strictEqual(urls.filter((u) => u.startsWith('https://api.unipile.com/')).length, 0, urls.join(','));
      strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 0, 'pas de purge, donc pas de rejeu');
      strictEqual(writes(calls, 'sequence_enrollments', 'update').length, 0);
    });
  });
});

Deno.test('message.new : ligne système, masquée, supprimée ou invitation reçue : jamais une réponse', async () => {
  for (const extra of [
    { is_event: true, event_type: 9 },
    { is_hidden: true },
    { is_deleted: true },
    { specifics: { type: 'INVITATION' } },
    { specifics: { type: 'INMAIL_DECLINE' } },
    { specifics: { type: 'INMAIL_ACCEPT' } },
  ]) {
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, replyBase, async ({ calls }) => {
      await withFetch(profileAnswer, async (urls) => {
        strictEqual((await mod.handleRequest(post(URL_OK, envelope('message.new', message(extra))))).status, 200, JSON.stringify(extra));
        strictEqual(writes(calls, 'sequence_enrollments', 'update').length, 0, JSON.stringify(extra));
        ok(!calls.some((c) => c.table === 'rpc:record_candidate_inbound'), JSON.stringify(extra));
        strictEqual(writes(calls, 'notifications', 'insert').length, 0, JSON.stringify(extra));
        strictEqual(urls.filter((u) => u.startsWith('https://api.unipile.com/')).length, 0);
      });
    });
  }
});

Deno.test('message.new d\'un type de réponse d\'InMail : reste une réponse', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, replyBase, async ({ calls }) => {
    await withFetch(profileAnswer, async () => {
      await mod.handleRequest(post(URL_OK, envelope('message.new', message({ specifics: { type: 'INMAIL_REPLY', subject: 'Re' } }))));
      strictEqual((writes(calls, 'sequence_enrollments', 'update')[0].payload as { status: string }).status, 'replied');
    });
  });
});

Deno.test('message.new d\'un compte non relié à Konekt : aucune lecture du prestataire', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, (call) => {
    if (call.table === 'member_linkedin_accounts') return { data: [] };
    if (call.table === 'sequence_enrollments' && call.op === 'select') return { data: [] };
    return replyBase(call);
  }, async () => {
    await withFetch(profileAnswer, async (urls) => {
      strictEqual((await mod.handleRequest(post(URL_OK, envelope('message.new', message())))).status, 200);
      strictEqual(urls.filter((u) => u.startsWith('https://api.unipile.com/')).length, 0, urls.join(','));
    });
  });
});

Deno.test('message.new sans is_sender : le message est relu (GET /v2/{compte}/chats/{chat}/messages/{id}) ; illisible : 500 pour le rejeu', async () => {
  const noFlag = message();
  delete (noFlag as Record<string, unknown>).is_sender;
  // Relu : c\'est un message de nous.
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, replyBase, async ({ calls }) => {
    await withFetch((url) => (url.endsWith(`/messages/CLASSIC_2-MSG`) ? message({ is_sender: true }) : {}), async (urls) => {
      strictEqual((await mod.handleRequest(post(URL_OK, envelope('message.new', noFlag)))).status, 200);
      ok(urls.includes(`https://api.unipile.com/v2/${ACC}/chats/${CHAT}/messages/CLASSIC_2-MSG`), urls.join(','));
      strictEqual(writes(calls, 'sequence_enrollments', 'update').length, 0);
    });
  });
  // Illisible : jamais de clôture à l\'aveugle, 500 et ligne de dédoublonnage purgée.
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, replyBase, async ({ calls }) => {
    await withFetch((url) => (url.includes('/messages/') ? 503 : {}), async () => {
      strictEqual((await mod.handleRequest(post(URL_OK, envelope('message.new', noFlag)))).status, 500);
      strictEqual(writes(calls, 'sequence_enrollments', 'update').length, 0);
      strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 1);
    });
  });
});

Deno.test('message.new d\'un compte WhatsApp ou d\'un autre fournisseur : jamais par le parcours LinkedIn', async () => {
  for (const provider of ['whatsapp', 'telegram', 'instagram']) {
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, replyBase, async ({ calls }) => {
      await withFetch(profileAnswer, async () => {
        strictEqual((await mod.handleRequest(post(URL_OK, envelope('message.new', message(), { account_provider: provider })))).status, 200, provider);
        strictEqual(writes(calls, 'sequence_enrollments', 'update').length, 0, provider);
        ok(!calls.some((c) => c.table === 'rpc:record_candidate_inbound'), provider);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// relation.new
// ---------------------------------------------------------------------------

Deno.test('relation.new : acceptation rattachée par l\'identifiant, sinon par le slug du profil ; sans personne lisible, rien', async () => {
  const waiting = { ...ENROLLMENT, connection_status: 'pending' };
  // Par identifiant.
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
    if (call.table === 'sequence_enrollments' && call.op === 'select') return { data: [waiting] };
    if (call.table === 'sequence_enrollments' && call.op === 'update') return { data: [{ id: 'enr-1' }] };
    return replyBase(call);
  }, async ({ calls }) => {
    const body = envelope('relation.new', { object: 'UserRelation', id: 'rel_1', user: { id: SENDER, object: 'User', display_name: 'Marie', public_identifier: 'marie-dupont' } });
    strictEqual((await mod.handleRequest(post(URL_OK, body))).status, 200);
    const update = writes(calls, 'sequence_enrollments', 'update')[0].payload as { connection_status: string; network_distance: string };
    strictEqual(update.connection_status, 'connected');
    strictEqual(update.network_distance, 'FIRST_DEGREE');
    ok(calls.some((c) => c.table === 'rpc:increment_sequence_analytics'));
  });
  // Par le slug : l\'identifiant de la v2 ne correspond à rien.
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
    if (call.table === 'sequence_enrollments' && call.op === 'select') {
      return { data: call.filters.some(([name]) => name === 'ilike') ? [waiting] : [] };
    }
    if (call.table === 'sequence_enrollments' && call.op === 'update') return { data: [{ id: 'enr-1' }] };
    return replyBase(call);
  }, async ({ calls }) => {
    const body = envelope('relation.new', { object: 'UserRelation', id: 'rel_2', user: { id: 'ACoAAother', object: 'User', public_identifier: 'Marie-Dupont' } });
    strictEqual((await mod.handleRequest(post(URL_OK, body))).status, 200);
    strictEqual(writes(calls, 'sequence_enrollments', 'update').length, 1);
  });
  // Relation sans `user` : l\'id de la relation n\'est pas celui d\'une personne.
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, replyBase, async ({ calls }) => {
    strictEqual((await mod.handleRequest(post(URL_OK, envelope('relation.new', { object: 'UserRelation', id: 'rel_3' })))).status, 200);
    strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0);
  });
});

// ---------------------------------------------------------------------------
// email.new
// ---------------------------------------------------------------------------

Deno.test('email.new : réponse du candidat rattachée par son adresse ; courrier de la boîte elle-même ignoré', async () => {
  const mailEnrollment = {
    id: 'enr-m', sequence_id: 'seq-m', profile_id: 'ACoM', provider_id: null, resolved_profile_id: null, account_id: ACC,
    email_used: 'candidat@exemple.fr', organization_id: 'o1', created_by: 'u1', profile_name: 'Marie', profile_headline: null,
    profile_url: null, job_id: null, status: 'active',
  };
  const reply = (call: Call): Reply => {
    if (call.table === 'rpc:record_webhook_event') return { data: true };
    if (call.table === 'member_email_accounts' && call.op === 'select') return { data: [{ organization_id: 'o1', email_address: 'recruteur@konekt.fr' }] };
    if (call.table === 'sequence_enrollments' && call.op === 'select') return { data: [mailEnrollment] };
    if (call.table === 'sequence_enrollments' && call.op === 'update') return { data: [{ id: 'enr-m' }] };
    if (call.table === 'rpc:record_candidate_inbound') return { data: { changed: false, result: 'unchanged', project_id: null } };
    return undefined;
  };
  const mail = (from: string, extra: Record<string, unknown> = {}) => envelope('email.new', {
    id: 'em_1', message_id: '<m1@x>', thread_id: 'th_1', subject: 'Re: Poste', from: [{ email: from, display_name: 'Marie' }],
    to: [{ email: 'recruteur@konekt.fr' }], headers: [{ name: 'In-Reply-To', value: '<orig@konekt.fr>' }], ...extra,
  }, { account_provider: 'google' });
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, reply, async ({ calls }) => {
    strictEqual((await mod.handleRequest(post(URL_OK, mail('candidat@exemple.fr')))).status, 200);
    strictEqual((writes(calls, 'sequence_enrollments', 'update')[0].payload as { status: string }).status, 'replied');
    // La réponse est cherchée par le message d'origine (In-Reply-To lu des en-têtes v2).
    const tracked = calls.find((c) => c.table === 'sequence_email_tracking');
    ok(tracked, 'rattachement par in_reply_to');
    ok(JSON.stringify(tracked!.filters).includes('<orig@konekt.fr>'));
  });
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, reply, async ({ calls }) => {
    strictEqual((await mod.handleRequest(post(URL_OK, mail('Recruteur@Konekt.fr')))).status, 200);
    strictEqual(writes(calls, 'sequence_enrollments', 'update').length, 0, 'un courrier envoyé depuis la boîte n\'est jamais une réponse');
  });
});

Deno.test('email.new : rapport de non-remise (mailer-daemon) : adresse supprimée, inscription en « bounced »', async () => {
  const enrollment = {
    id: 'enr-b', sequence_id: 'seq-b', profile_id: 'ACoB', provider_id: null, resolved_profile_id: null, account_id: ACC,
    email_used: 'mort@exemple.fr', organization_id: 'o1', created_by: 'u1', profile_name: 'Paul', profile_headline: null,
    profile_url: null, job_id: null, status: 'active',
  };
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
    if (call.table === 'rpc:record_webhook_event') return { data: true };
    if (call.table === 'member_email_accounts' && call.op === 'select') return { data: [{ organization_id: 'o1', email_address: 'recruteur@konekt.fr' }] };
    if (call.table === 'sequence_enrollments' && call.op === 'select') return { data: [enrollment] };
    if (call.table === 'sequence_enrollments' && call.op === 'update') return { data: [{ id: 'enr-b' }] };
    return undefined;
  }, async ({ calls }) => {
    const ndr = envelope('email.new', {
      id: 'em_ndr', message_id: '<ndr@x>', subject: 'Delivery Status Notification (Failure)', body_plain: 'Delivery to mort@exemple.fr failed',
      from: [{ email: 'mailer-daemon@googlemail.com' }], to: [{ email: 'recruteur@konekt.fr' }], headers: [],
    }, { account_provider: 'google' });
    strictEqual((await mod.handleRequest(post(URL_OK, ndr))).status, 200);
    strictEqual((writes(calls, 'sequence_enrollments', 'update')[0].payload as { status: string }).status, 'bounced');
    const suppressed = writes(calls, 'suppressed_emails', 'upsert')[0].payload as { email: string; reason: string };
    deepStrictEqual(suppressed, { email: 'mort@exemple.fr', reason: 'bounce' });
  });
});

const MAIL_ENROLLMENT = {
  id: 'enr-m', sequence_id: 'seq-m', profile_id: 'ACoM', provider_id: null, resolved_profile_id: null, account_id: ACC,
  email_used: 'candidat@exemple.fr', organization_id: 'o1', created_by: 'u1', profile_name: 'Marie', profile_headline: null,
  profile_url: null, job_id: null, status: 'active',
};
const replyMail = (from: string) => envelope('email.new', {
  id: 'em_2', message_id: '<m2@x>', thread_id: 'th_2', subject: 'Re: Poste', from: [{ email: from, display_name: 'X' }],
  to: [{ email: 'candidat@exemple.fr' }], headers: [{ name: 'In-Reply-To', value: '<orig@konekt.fr>' }],
}, { account_provider: 'google' });

Deno.test('email.new sur une boîte reliée à aucune organisation : rien n\'est lu ni clos, même avec un In-Reply-To d\'un message suivi', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, (call) => {
    if (call.table === 'rpc:record_webhook_event') return { data: true };
    if (call.table === 'member_email_accounts') return { data: [] };
    // Si la lecture avait lieu, le message d'origine d'une autre organisation serait retrouvé et son inscription close.
    if (call.table === 'sequence_email_tracking') return { data: [{ execution_id: 'ex-1' }] };
    if (call.table === 'sequence_step_executions' && call.op === 'select') return { data: [{ enrollment_id: 'enr-m' }] };
    if (call.table === 'sequence_enrollments' && call.op === 'select') return { data: [MAIL_ENROLLMENT] };
    if (call.table === 'sequence_enrollments' && call.op === 'update') return { data: [{ id: 'enr-m' }] };
    return undefined;
  }, async ({ calls }) => {
    strictEqual((await mod.handleRequest(post(URL_OK, replyMail('candidat@exemple.fr')))).status, 200);
    strictEqual(calls.filter((c) => c.table === 'sequence_email_tracking').length, 0);
    strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0);
    strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 0);
  });
});

Deno.test('email.new : liaison sans adresse lisible (nom d\'affichage) : l\'adresse du compte relue chez le prestataire écarte le courrier envoyé', async () => {
  const reply = (call: Call): Reply => {
    if (call.table === 'rpc:record_webhook_event') return { data: true };
    if (call.table === 'member_email_accounts' && call.op === 'select') return { data: [{ organization_id: 'o1', email_address: 'Marie Recruteuse' }] };
    if (call.table === 'sequence_email_tracking') return { data: [{ execution_id: 'ex-1' }] };
    if (call.table === 'sequence_step_executions' && call.op === 'select') return { data: [{ enrollment_id: 'enr-m' }] };
    if (call.table === 'sequence_enrollments' && call.op === 'select') return { data: [MAIL_ENROLLMENT] };
    if (call.table === 'sequence_enrollments' && call.op === 'update') return { data: [{ id: 'enr-m' }] };
    if (call.table === 'rpc:record_candidate_inbound') return { data: { changed: false, result: 'unchanged', project_id: null } };
    return undefined;
  };
  const account = { object: 'Account', id: ACC, name: 'recruteur@konekt.fr', provider: 'google', status: 'running', is_locked: false };
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' }, reply, async ({ calls }) => {
    await withFetch((url) => (/\/accounts\/acc_/.test(url) ? account : {}), async () => {
      strictEqual((await mod.handleRequest(post(URL_OK, replyMail('Recruteur@Konekt.fr')))).status, 200);
      strictEqual(writes(calls, 'sequence_enrollments', 'update').length, 0, 'un courrier envoyé depuis la boîte n\'est jamais une réponse');
    });
  });
});
