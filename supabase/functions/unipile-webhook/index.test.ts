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
  /** `.select()` chaîné après une écriture : la requête rend les lignes qu'elle a écrites. */
  returning?: boolean;
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
          } else if (prop === 'select') {
            if (call.op !== 'select') call.returning = true;
          } else {
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

const ENV_NAMES = ['UNIPILE_V2_WEBHOOK_TOKEN', 'UNIPILE_WEBHOOK_SECRET', 'UNIPILE_V2_API_KEY', 'SUPABASE_URL', 'SB_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

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

Deno.test('account.status.degraded et partial : une seule écriture sur la liaison LinkedIn, conditionnelle au statut lu, aucune reprise des inscriptions', async () => {
  for (const [type, status] of [['account.status.degraded', 'DEGRADED'], ['account.status.partial', 'PARTIAL']] as const) {
    const rows = [marie('OK')];
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
      strictEqual((await mod.handleRequest(post(URL_OK, fresh(type)))).status, 200, type);
      const update = writes(calls, 'member_linkedin_accounts', 'update');
      // Une écriture, jamais deux : une seconde écriture sans condition recouvrirait un événement plus récent.
      strictEqual(update.length, 1, `${type} : une seule écriture sur la liaison`);
      strictEqual((update[0].payload as { account_status: string }).account_status, status);
      deepStrictEqual(
        update[0].filters.map(([name, args]) => [name, ...args]),
        [['eq', 'id', 'link-u1'], ['eq', 'linkedin_account_id', ACC], ['eq', 'account_status', 'OK']],
        `${type} : conditionnelle au statut lu`,
      );
      ok(update[0].returning, `${type} : l'écriture rend ses lignes (.select())`);
      strictEqual(rows[0].account_status, status);
      strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0, `${type} : pas de reprise`);
    });
  }
});

Deno.test('account.status.running sur un compte verrouillé : LOCKED ; sinon OK (raison d\'échec effacée) et reprise des inscriptions', async () => {
  const locking = [marie('OK')];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(locking), async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, fresh('account.status.running', { object: 'Account', is_locked: true })));
    strictEqual(locking[0].account_status, 'LOCKED');
    strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0);
  });
  const rows = [marie('CREDENTIALS')];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, fresh('account.status.running', { object: 'Account', is_locked: false })));
    const update = writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { account_status: string; failure_reason: null };
    strictEqual(update.account_status, 'OK');
    strictEqual(update.failure_reason, null);
    strictEqual(rows[0].account_status, 'OK');
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
  for (const [previous, notified] of [['OK', 1], ['DEGRADED', 1], ['PARTIAL', 1], ['LOCKED', 1], [null, 1], ['CREDENTIALS', 0], ['ERROR', 0]] as const) {
    const rows = [marie(previous)];
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
      await mod.handleRequest(post(URL_OK, fresh('account.status.disconnected')));
      const update = writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { account_status: string };
      strictEqual(update.account_status, 'CREDENTIALS', String(previous));
      strictEqual(rows[0].account_status, 'CREDENTIALS', String(previous));
      const notifications = writes(calls, 'notifications', 'insert');
      strictEqual(notifications.length, notified, `${previous} -> ${notified} notification(s)`);
      if (notified) strictEqual((notifications[0].payload as Array<{ type: string }>)[0].type, 'linkedin_disconnected');
      strictEqual((writes(calls, 'member_whatsapp_accounts', 'update')[0].payload as { account_status: string }).account_status, 'DISCONNECTED');
    });
  }
});

Deno.test('account.status.disconnected : le texte du prestataire n\'est jamais écrit dans failure_reason (code neutre seulement)', async () => {
  const rows = [marie('OK')];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, fresh('account.status.disconnected', { object: 'Account', reason: 'Unipile session expired for LinkedIn', message: 'raw provider text' })));
    const update = writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { failure_reason: string };
    strictEqual(update.failure_reason, 'disconnected');
  });
  const other = [marie('OK')];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(other), async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, fresh('account.status.errored', { object: 'Account', error: 'Unipile raw failure' })));
    strictEqual((writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { failure_reason: string }).failure_reason, 'error');
  });
});

Deno.test('account.status.errored : ERROR', async () => {
  const rows = [marie('OK')];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, fresh('account.status.errored')));
    strictEqual((writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { account_status: string }).account_status, 'ERROR');
    strictEqual(rows[0].account_status, 'ERROR');
    strictEqual((writes(calls, 'member_email_accounts', 'update')[0].payload as { account_status: string }).account_status, 'ERROR');
  });
});

// ---------------------------------------------------------------------------
// Ce que le membre apprend quand son compte change d'état (constat F12)
// ---------------------------------------------------------------------------

/** Liaison LinkedIn de Marie dont le statut d'avant l'événement est `previous` (null : sans statut). */
const linkedWith = (previous: string | null) => (call: Call): Reply => {
  if (call.table === 'rpc:record_webhook_event') return { data: true };
  if (call.table === 'member_linkedin_accounts' && call.op === 'select') {
    return { data: [{ user_id: 'u1', organization_id: 'o1', linkedin_account_name: 'Marie', account_status: previous }] };
  }
  return undefined;
};
const noticesOf = (calls: Call[]) => writes(calls, 'notifications', 'insert').flatMap((c) => c.payload as Array<{
  user_id: string; organization_id: string; type: string; title: string; body: string; link: string; metadata: Record<string, unknown>;
}>);

// Base factice avec ÉTAT pour member_linkedin_accounts : l'écriture conditionnelle du récepteur
// (update + .or + .select) y est évaluée comme PostgREST le ferait, sur les lignes courantes, et ne rend que
// les lignes qu'elle a vraiment changées. Les autres tables restent enregistrées sans état.
interface LinkRow {
  id: string;
  user_id: string;
  organization_id: string;
  linkedin_account_name: string | null;
  linkedin_account_id: string;
  account_status: string | null;
  failure_reason?: string | null;
}
const marie = (status: string | null, extra: Partial<LinkRow> = {}): LinkRow => ({
  id: `link-${extra.user_id ?? 'u1'}`, user_id: 'u1', organization_id: 'o1', linkedin_account_name: 'Marie', linkedin_account_id: ACC, account_status: status, ...extra,
});
const cellOf = (row: LinkRow, column: string): unknown => (row as unknown as Record<string, unknown>)[column] ?? null;
const listOf = (text: string) => text.split(',').map((x) => x.trim());
/** Une condition d'un `or(...)` : seuls les opérateurs que le récepteur emploie, tout autre lève. */
function orTermMatches(row: LinkRow, term: string): boolean {
  let m = term.match(/^([a-z_]+)\.is\.null$/);
  if (m) return cellOf(row, m[1]) === null;
  m = term.match(/^([a-z_]+)\.eq\.(.+)$/);
  if (m) return cellOf(row, m[1]) === m[2];
  // SQL : NULL NOT IN (...) est inconnu, donc faux (d'où le `is.null` explicite du récepteur).
  m = term.match(/^([a-z_]+)\.not\.in\.\((.*)\)$/);
  if (m) return cellOf(row, m[1]) !== null && !listOf(m[2]).includes(String(cellOf(row, m[1])));
  throw new Error(`condition non gérée par la base factice : ${term}`);
}
/** Découpe un `or(...)` aux virgules hors parenthèses. */
function orTerms(expression: string): string[] {
  const terms: string[] = [];
  let depth = 0, current = '';
  for (const ch of expression) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { terms.push(current); current = ''; } else current += ch;
  }
  terms.push(current);
  return terms;
}
function rowMatches(row: LinkRow, filters: Call['filters']): boolean {
  return filters.every(([name, args]) => {
    if (name === 'eq') return cellOf(row, String(args[0])) === args[1];
    if (name === 'neq') return cellOf(row, String(args[0])) !== null && cellOf(row, String(args[0])) !== args[1];
    if (name === 'is') return cellOf(row, String(args[0])) === args[1];
    if (name === 'or') return orTerms(String(args[0])).some((term) => orTermMatches(row, term));
    throw new Error(`filtre non géré par la base factice : ${name}`);
  });
}
/**
 * Réponses d'une base qui garde `rows` : lecture, écriture conditionnelle (rend les lignes écrites seulement si la
 * requête chaîne `.select()`, comme PostgREST), dédoublonnage des événements par clé. Chaque écriture est atomique
 * (évaluée et appliquée d'un bloc, comme une instruction SQL). `beforeUpdate` et `afterUpdate` laissent un autre
 * événement s'intercaler juste avant ou juste après une écriture du récepteur.
 */
function linkedState(rows: LinkRow[], options: {
  failLinkedinUpdate?: boolean;
  /** Toute lecture de member_linkedin_accounts échoue (lecture d'avant un passage d'état, ou lecture des liaisons LOCKED). */
  failLinkedinSelect?: boolean;
  beforeUpdate?: (call: Call, rows: LinkRow[]) => void;
  afterUpdate?: (call: Call, rows: LinkRow[]) => void;
} = {}) {
  const seen = new Set<string>();
  return (call: Call): Reply => {
    if (call.table === 'rpc:record_webhook_event') {
      const key = String((call.payload as { p_event_key: string }).p_event_key);
      const isNew = !seen.has(key);
      seen.add(key);
      return { data: isNew };
    }
    // Le récepteur libère la clé d'un événement qu'il n'a pas pu traiter : le rejeu du prestataire est alors traité.
    if (call.table === 'webhook_event_log' && call.op === 'delete') {
      const key = call.filters.find(([name, args]) => name === 'eq' && args[0] === 'event_key')?.[1][1];
      if (typeof key === 'string') seen.delete(key);
      return undefined;
    }
    if (call.table !== 'member_linkedin_accounts') return undefined;
    if (call.op === 'select' && options.failLinkedinSelect) return { error: { code: 'XX000', message: 'base indisponible' } };
    if (call.op === 'select') return { data: rows.filter((row) => rowMatches(row, call.filters)).map((row) => ({ ...row })) };
    if (call.op === 'update') {
      if (options.failLinkedinUpdate) return { error: { code: 'XX000', message: 'base indisponible' } };
      options.beforeUpdate?.(call, rows);
      const hit = rows.filter((row) => rowMatches(row, call.filters));
      for (const row of hit) Object.assign(row, call.payload);
      const answer = { data: call.returning ? hit.map((row) => ({ ...row })) : null };
      options.afterUpdate?.(call, rows);
      return answer;
    }
    return undefined;
  };
}
let eventCounter = 0;
/** Enveloppe d'un événement distinct (evt_ propre), pour les livraisons qui ne sont pas des rejeux. */
const fresh = (type: string, payload: Record<string, unknown> = { object: 'Account' }, extra: Record<string, unknown> = {}) =>
  envelope(type, payload, { id: `evt_state${String(++eventCounter).padStart(6, '0')}`, ...extra });
const lockEvents: Array<[string, () => ReturnType<typeof envelope>]> = [
  ['account.locked', () => fresh('account.locked', { object: 'Account', is_locked: true })],
  ['account.status.running', () => fresh('account.status.running', { object: 'Account', is_locked: true })],
  ['account.status.degraded', () => fresh('account.status.degraded', { object: 'Account', is_locked: true })],
  ['account.status.partial', () => fresh('account.status.partial', { object: 'Account', is_locked: true })],
];

/** Ce que la notification de verrouillage doit dire (titre, corps, type, lien, metadata). */
function expectLockNotice(n: ReturnType<typeof noticesOf>[number]) {
  strictEqual(n.user_id, 'u1');
  strictEqual(n.organization_id, 'o1');
  strictEqual(n.type, 'linkedin_disconnected', 'même type que la déconnexion : hors « Pour vous », classée en action');
  strictEqual(n.link, '/settings?tab=account');
  strictEqual(n.title, 'Compte LinkedIn restreint');
  ok(n.body.includes('« Marie »'), n.body);
  ok(n.body.includes('restreint par LinkedIn'), n.body);
  ok(n.body.includes('en pause'), n.body);
  ok(/Patientez/.test(n.body) && /directement sur LinkedIn/.test(n.body), `ce qu'il faut faire : ${n.body}`);
  ok(/Se reconnecter n'y change rien/.test(n.body), n.body);
  ok(!/Reconnectez/.test(n.body), 'aucune invitation à reconnecter');
  ok(!/unipile/i.test(`${n.title} ${n.body}`), 'jamais le nom du prestataire');
  ok(!/—/.test(`${n.title} ${n.body}`), 'pas de tiret cadratin');
  strictEqual(n.metadata.account_status, 'LOCKED');
  strictEqual(n.metadata.linkedin_account_id, ACC);
}

Deno.test('verrouillage : account.locked et account.status.* avec is_locked donnent le même résultat depuis le même statut enregistré', async () => {
  // LOCKED remplace OK, DEGRADED, PARTIAL, l'absence de statut et un statut inconnu, et prévient une fois ;
  // il ne remplace jamais une panne à reconnecter (la liaison garde son statut et sa notification) ni LOCKED.
  const outcomes: Array<[string | null, string | null, number]> = [
    ['OK', 'LOCKED', 1], [null, 'LOCKED', 1], ['DEGRADED', 'LOCKED', 1], ['PARTIAL', 'LOCKED', 1],
    ['NOUVEAU_STATUT', 'LOCKED', 1], ['PAUSED', 'LOCKED', 1], ['', 'LOCKED', 1],
    ['LOCKED', 'LOCKED', 0],
    ['CREDENTIALS', 'CREDENTIALS', 0], ['ERROR', 'ERROR', 0],
    ['PERMISSIONS', 'PERMISSIONS', 0], ['DISCONNECTED', 'DISCONNECTED', 0], ['DELETED', 'DELETED', 0],
  ];
  for (const [type, makeEvent] of lockEvents) {
    for (const [previous, finalStatus, notified] of outcomes) {
      const rows = [marie(previous)];
      await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
        const label = `${type} depuis ${previous === null ? 'sans statut' : `« ${previous} »`}`;
        strictEqual((await mod.handleRequest(post(URL_OK, makeEvent()))).status, 200, label);
        strictEqual(rows[0].account_status, finalStatus, `${label} : statut final`);
        const notices = noticesOf(calls);
        strictEqual(notices.length, notified, `${label} : ${notified} notification(s)`);
        if (notified) expectLockNotice(notices[0]);
      });
    }
  }
});

Deno.test('verrouillage : écriture conditionnelle sur le statut d\'avant, rendue par .select() ; aucune lecture du statut avant l\'écriture', async () => {
  for (const [type, makeEvent] of lockEvents) {
    const rows = [marie('OK')];
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
      await mod.handleRequest(post(URL_OK, makeEvent()));
      const linkedinCalls = calls.filter((c) => c.table === 'member_linkedin_accounts');
      strictEqual(linkedinCalls.filter((c) => c.op === 'select').length, 0, `${type} : pas de lecture du statut d'avant`);
      const updates = linkedinCalls.filter((c) => c.op === 'update');
      strictEqual(updates.length, 1, type);
      ok(updates[0].returning, `${type} : l'écriture rend ses lignes (.select())`);
      const condition = String(updates[0].filters.find(([name]) => name === 'or')?.[1][0]);
      ok(/account_status\.is\.null/.test(condition) && /account_status\.not\.in\.\(/.test(condition), `${type} : ${condition}`);
      for (const protectedStatus of ['CREDENTIALS', 'ERROR', 'LOCKED']) ok(condition.includes(protectedStatus), `${type} : ${protectedStatus} gardé`);
      for (const replaced of ['OK', 'DEGRADED', 'PARTIAL']) ok(!new RegExp(`[(,]${replaced}[,)]`).test(condition), `${type} : ${replaced} remplacé`);
    });
  }
});

Deno.test('verrouillage : des livraisons simultanées d\'événements distincts ne préviennent qu\'une seule fois', async () => {
  for (const count of [2, 6, 12]) {
    const rows = [marie('OK')];
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
      // account.locked et account.status.running avec is_locked pour le même passage, chacun avec son evt_.
      const deliveries = Array.from({ length: count }, (_, i) =>
        mod.handleRequest(post(URL_OK, lockEvents[i % 2][1]())));
      const responses = await Promise.all(deliveries);
      deepStrictEqual(responses.map((r) => r.status), Array(count).fill(200));
      strictEqual(rows[0].account_status, 'LOCKED');
      strictEqual(noticesOf(calls).length, 1, `${count} livraisons simultanées : une notification`);
    });
  }
});

Deno.test('verrouillage : le même evt_ rejoué est ignoré, un compte déjà verrouillé n\'est pas annoncé de nouveau', async () => {
  const rows = [marie('OK')];
  await withEnv(WITH_KEY, linkedState(rows), async ({ calls }) => {
    const event = fresh('account.locked', { object: 'Account', is_locked: true });
    strictEqual((await mod.handleRequest(post(URL_OK, event))).status, 200);
    strictEqual(noticesOf(calls).length, 1);
    const writesBefore = calls.filter((c) => (c.table === 'member_linkedin_accounts' || c.table === 'notifications') && c.op !== 'select').length;
    const replay = await mod.handleRequest(post(URL_OK, event));
    deepStrictEqual(await replay.json(), { ok: true, deduplicated: true });
    strictEqual(calls.filter((c) => (c.table === 'member_linkedin_accounts' || c.table === 'notifications') && c.op !== 'select').length, writesBefore, 'le rejeu n\'écrit rien');
    // Autre événement, même état : la liaison est déjà LOCKED, personne n'est prévenu une seconde fois.
    await mod.handleRequest(post(URL_OK, fresh('account.locked', { object: 'Account', is_locked: true })));
    await mod.handleRequest(post(URL_OK, fresh('account.status.running', { object: 'Account', is_locked: true })));
    strictEqual(noticesOf(calls).length, 1);
    // Déverrouillage puis nouveau verrouillage : un nouveau passage, une nouvelle notification.
    await withFetch(providerSays('running'), () => mod.handleRequest(post(URL_OK, fresh('account.unlocked', { object: 'Account', is_locked: false }))));
    strictEqual(rows[0].account_status, 'OK');
    await mod.handleRequest(post(URL_OK, fresh('account.locked', { object: 'Account', is_locked: true })));
    strictEqual(noticesOf(calls).length, 2);
  });
});

Deno.test('verrouillage : écriture en échec, personne n\'est prévenu ; une liaison par membre, chacune prévenue', async () => {
  const rows = [marie('OK')];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows, { failLinkedinUpdate: true }), async ({ calls }) => {
    for (const [, makeEvent] of lockEvents.slice(0, 2)) {
      strictEqual((await mod.handleRequest(post(URL_OK, makeEvent()))).status, 200);
    }
    strictEqual(noticesOf(calls).length, 0, 'le compte n\'est pas passé LOCKED : personne n\'est prévenu');
    strictEqual(rows[0].account_status, 'OK');
  });
  const two = [marie('OK'), marie(null, { user_id: 'u2', organization_id: 'o2', linkedin_account_name: 'Paul' }), marie('CREDENTIALS', { user_id: 'u3', organization_id: 'o3' })];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(two), async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, fresh('account.locked', { object: 'Account', is_locked: true })));
    deepStrictEqual(noticesOf(calls).map((n) => n.user_id).sort(), ['u1', 'u2']);
    deepStrictEqual(two.map((r) => r.account_status), ['LOCKED', 'LOCKED', 'CREDENTIALS']);
  });
});

/** Compte tel que le prestataire le rapporte à la relecture (GET /accounts/{id}). */
const reportedAccount = (status: string, isLocked = false) => ({ object: 'Account', id: ACC, provider: 'linkedin', name: 'Compte test', status, is_locked: isLocked });
/** Le prestataire répond `status` (et le verrou) à la relecture du compte ; toute autre adresse : objet vide. */
const providerSays = (status: string, isLocked = false) => (url: string) => (/\/accounts\/acc_/.test(url) ? reportedAccount(status, isLocked) : {});
const WITH_KEY = { UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, UNIPILE_V2_API_KEY: 'key-test' };
const TITLES = {
  locked: 'Compte LinkedIn restreint', partial: 'Connexion LinkedIn partielle',
  disconnected: 'Compte LinkedIn déconnecté', error: 'Problème de connexion LinkedIn',
};
/** Avertissements du récepteur pendant `fn` (withEnv les rend muets : on les relit ici). */
async function warningsDuring<T>(fn: () => Promise<T>): Promise<{ result: T; warnings: string[] }> {
  const warnings: string[] = [];
  const saved = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), warnings };
  } finally {
    console.warn = saved;
  }
}

Deno.test('account.unlocked : l\'état est relu chez le prestataire et c\'est lui qui est écrit sur les liaisons LOCKED seulement ; PARTIAL, CREDENTIALS et ERROR préviennent une fois', async () => {
  // [statut enregistré, [statut du prestataire, verrou], statut final, notification attendue]
  const cases: Array<[string, [string, boolean], string, string | null]> = [
    ['LOCKED', ['running', false], 'OK', null],
    ['LOCKED', ['degraded', false], 'DEGRADED', null],
    ['LOCKED', ['partial', false], 'PARTIAL', TITLES.partial],
    ['LOCKED', ['disconnected', false], 'CREDENTIALS', TITLES.disconnected],
    ['LOCKED', ['errored', false], 'ERROR', TITLES.error],
    // Encore verrouillé chez le prestataire (événement en retard) : rien ne change.
    ['LOCKED', ['running', true], 'LOCKED', null],
    ['LOCKED', ['partial', true], 'LOCKED', null],
    // Une panne à reconnecter l'emporte sur le verrou, comme sur la liste des comptes.
    ['LOCKED', ['disconnected', true], 'CREDENTIALS', TITLES.disconnected],
    // Les autres statuts enregistrés ne sont jamais touchés.
    ['PARTIAL', ['running', false], 'PARTIAL', null],
    ['DEGRADED', ['partial', false], 'DEGRADED', null],
    ['CREDENTIALS', ['running', false], 'CREDENTIALS', null],
    ['ERROR', ['running', false], 'ERROR', null],
    ['OK', ['partial', false], 'OK', null],
  ];
  for (const [stored, [providerStatus, providerLocked], finalStatus, title] of cases) {
    const rows = [marie(stored)];
    await withEnv(WITH_KEY, linkedState(rows), async ({ calls }) => {
      await withFetch(providerSays(providerStatus, providerLocked), async (urls) => {
        const label = `${stored} + prestataire « ${providerStatus}${providerLocked ? ' + verrou' : ''} »`;
        strictEqual((await mod.handleRequest(post(URL_OK, fresh('account.unlocked', { object: 'Account', is_locked: false })))).status, 200, label);
        strictEqual(rows[0].account_status, finalStatus, `${label} : statut final`);
        deepStrictEqual(noticesOf(calls).map((n) => n.title), title ? [title] : [], `${label} : notifications`);
        // Le prestataire n'est lu que pour une liaison enregistrée LOCKED : aucune relecture pour les autres statuts.
        strictEqual(urls.length, stored === 'LOCKED' ? 1 : 0, `${label} : relecture seulement d'une liaison LOCKED`);
        if (stored === 'LOCKED') ok(/\/accounts\/acc_01kyex2j0pexzt3v8prstne0ey$/.test(urls[0]), urls[0]);
        strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0, 'le déverrouillage ne reprend aucune inscription');
        const update = writes(calls, 'member_linkedin_accounts', 'update')[0];
        ok(update === undefined || update.filters.some(([name, args]) => name === 'eq' && args[0] === 'account_status' && args[1] === 'LOCKED'), `${label} : limité à LOCKED`);
      });
    });
  }
});

Deno.test('account.unlocked : PARTIAL puis verrou puis déverrouillage reste PARTIAL quand le prestataire le dit, OK quand il dit running', async () => {
  for (const [providerStatus, finalStatus, titles] of [
    ['partial', 'PARTIAL', [TITLES.locked, TITLES.partial]],
    ['running', 'OK', [TITLES.locked]],
    ['degraded', 'DEGRADED', [TITLES.locked]],
  ] as const) {
    const rows = [marie('PARTIAL')];
    await withEnv(WITH_KEY, linkedState(rows), async ({ calls }) => {
      await withFetch(providerSays(providerStatus), async () => {
        await mod.handleRequest(post(URL_OK, fresh('account.locked', { object: 'Account', is_locked: true })));
        strictEqual(rows[0].account_status, 'LOCKED');
        await mod.handleRequest(post(URL_OK, fresh('account.unlocked', { object: 'Account', is_locked: false })));
        strictEqual(rows[0].account_status, finalStatus, `prestataire « ${providerStatus} »`);
        deepStrictEqual(noticesOf(calls).map((n) => n.title), titles, `prestataire « ${providerStatus} »`);
        // Un autre déverrouillage ne change plus rien et ne prévient pas de nouveau.
        await mod.handleRequest(post(URL_OK, fresh('account.unlocked', { object: 'Account', is_locked: false })));
        deepStrictEqual(noticesOf(calls).map((n) => n.title), titles);
      });
    });
  }
});

/** Corps de la réponse JSON d'un récepteur. */
const bodyOf = async (response: Response) => await response.json() as Record<string, unknown>;

Deno.test('account.unlocked : relecture impossible (clé absente, compte introuvable, erreur du prestataire, délai dépassé, compte sans statut) : la liaison reste LOCKED, 500 et clé libérée ; le rejeu relu applique l\'état du prestataire, un rejeu après succès est dédoublonné', async () => {
  // Chaque panne de relecture : [libellé, réponse du prestataire]. `null` : clé du prestataire absente (aucun appel).
  const failures: Array<[string, ((url: string) => unknown) | null]> = [
    ['clé absente', null],
    ['404', () => 404],
    ['500', () => 500],
    ['compte sans statut', () => ({ object: 'Account', id: ACC, provider: 'linkedin' })],
    ['statut vide', () => ({ object: 'Account', id: ACC, provider: 'linkedin', status: '  ' })],
  ];
  for (const [label, answer] of failures) {
    // Un compte PARTIAL verrouillé puis déverrouillé : tant que le prestataire n'a pas répondu, il ne devient pas OK.
    const rows = [marie('LOCKED')];
    await withEnv(answer === null ? { UNIPILE_V2_WEBHOOK_TOKEN: TOKEN } : WITH_KEY, linkedState(rows), async ({ calls }) => {
      const event = fresh('account.unlocked', { object: 'Account', is_locked: false });
      const first = await warningsDuring(async () => {
        if (answer === null) return await mod.handleRequest(post(URL_OK, event));
        return await withFetch(answer, () => mod.handleRequest(post(URL_OK, event)));
      });
      strictEqual(first.result.status, 500, `${label} : l'événement n'est pas acquitté`);
      strictEqual((await bodyOf(first.result)).success, false, label);
      ok(first.warnings.some((w) => /could not be re-read/.test(w)), `${label} : journalisé : ${first.warnings.join(' | ')}`);
      strictEqual(rows[0].account_status, 'LOCKED', `${label} : la liaison reste LOCKED, aucun envoi ne part sur un doute`);
      strictEqual(writes(calls, 'member_linkedin_accounts', 'update').length, 0, `${label} : rien n'est écrit`);
      strictEqual(writes(calls, 'member_email_accounts', 'update').length + writes(calls, 'member_whatsapp_accounts', 'update').length, 0, label);
      strictEqual(noticesOf(calls).length, 0, `${label} : aucune notification`);
      strictEqual(calls.some((c) => c.table === 'sequence_enrollments'), false, `${label} : aucune reprise des inscriptions`);
      strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 1, `${label} : clé de dédoublonnage libérée`);

      // Le même evt_ rejoué, le prestataire répondant cette fois : traité (pas « deduplicated ») et l'état du prestataire est écrit.
      if (answer === null) Deno.env.set('UNIPILE_V2_API_KEY', 'key-test');
      const redelivery = await withFetch(providerSays('partial'), (urls) => mod.handleRequest(post(URL_OK, event)).then((r) => ({ r, urls })));
      strictEqual(redelivery.r.status, 200, `${label} : le rejeu est traité`);
      strictEqual(redelivery.urls.length, 1, `${label} : une relecture`);
      strictEqual(rows[0].account_status, 'PARTIAL', `${label} : l'état du prestataire`);
      deepStrictEqual(noticesOf(calls).map((n) => n.title), [TITLES.partial], `${label} : le retour en PARTIAL prévient une fois`);

      // Un rejeu après le succès reste dédoublonné.
      deepStrictEqual(await bodyOf(await mod.handleRequest(post(URL_OK, event))), { ok: true, deduplicated: true }, label);
      strictEqual(noticesOf(calls).length, 1, label);
    });
  }
  // Délai dépassé : la relecture est abandonnée, même résultat.
  const slow = [marie('LOCKED')];
  const savedDeadline = mod.testing.rereadDeadlineMs;
  const savedFetch = globalThis.fetch;
  mod.testing.rereadDeadlineMs = 30;
  try {
    await withEnv(WITH_KEY, linkedState(slow), async ({ calls }) => {
      const event = fresh('account.unlocked', { object: 'Account', is_locked: false });
      globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
      const { result, warnings } = await warningsDuring(async () => mod.handleRequest(post(URL_OK, event)));
      strictEqual(result.status, 500);
      strictEqual(slow[0].account_status, 'LOCKED');
      ok(warnings.some((w) => /deadline/.test(w)), warnings.join('\n'));
      strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 1);
      globalThis.fetch = savedFetch;
      await withFetch(providerSays('running'), async () => {
        strictEqual((await mod.handleRequest(post(URL_OK, event))).status, 200);
      });
      strictEqual(slow[0].account_status, 'OK');
    });
  } finally {
    globalThis.fetch = savedFetch;
    mod.testing.rereadDeadlineMs = savedDeadline;
  }
  // Statut inconnu chez le prestataire (mot hors spécification) : lu, donc ERROR (un doute ne laisse rien partir), comme avant.
  const weird = [marie('LOCKED')];
  await withEnv(WITH_KEY, linkedState(weird), async ({ calls }) => {
    await withFetch(providerSays('quelque_chose_de_nouveau'), async () => {
      strictEqual((await mod.handleRequest(post(URL_OK, fresh('account.unlocked', { object: 'Account', is_locked: false })))).status, 200);
      strictEqual(weird[0].account_status, 'ERROR');
      deepStrictEqual(noticesOf(calls).map((n) => n.title), [TITLES.error]);
    });
  });
});

Deno.test('account.unlocked : la lecture des liaisons enregistrées en échec : 500 et clé libérée, rien n\'est écrit ni relu chez le prestataire ; le rejeu est traité', async () => {
  const rows = [marie('LOCKED')];
  const options = { failLinkedinSelect: true };
  await withEnv(WITH_KEY, linkedState(rows, options), async ({ calls }) => {
    await withFetch(providerSays('running'), async (urls) => {
      const event = fresh('account.unlocked', { object: 'Account', is_locked: false });
      strictEqual((await mod.handleRequest(post(URL_OK, event))).status, 500);
      strictEqual(urls.length, 0, 'sans lecture des liaisons, aucune relecture du prestataire');
      strictEqual(writes(calls, 'member_linkedin_accounts', 'update').length, 0);
      strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 1);
      options.failLinkedinSelect = false;
      strictEqual((await mod.handleRequest(post(URL_OK, event))).status, 200);
      strictEqual(rows[0].account_status, 'OK');
      strictEqual(urls.length, 1);
    });
  });
});

Deno.test('account.unlocked : le prestataire n\'est lu que pour une liaison enregistrée LOCKED (LinkedIn, e-mail ou WhatsApp), jamais pour OK, PARTIAL, CREDENTIALS, ERROR, DEGRADED ou sans statut', async () => {
  const unlock = () => post(URL_OK, fresh('account.unlocked', { object: 'Account', is_locked: false }));
  for (const stored of ['OK', 'PARTIAL', 'CREDENTIALS', 'ERROR', 'DEGRADED', null]) {
    const rows = [marie(stored)];
    await withEnv(WITH_KEY, linkedState(rows), async ({ calls }) => {
      await withFetch(providerSays('running'), async (urls) => {
        // Plusieurs livraisons distinctes (rafale) : toujours aucune lecture.
        const responses = await Promise.all([unlock(), unlock(), unlock()].map((request) => mod.handleRequest(request)));
        deepStrictEqual(responses.map((r) => r.status), [200, 200, 200], String(stored));
        strictEqual(urls.length, 0, `${stored} : aucune lecture du prestataire`);
        strictEqual(rows[0].account_status, stored, `${stored} : statut inchangé`);
        strictEqual(['member_linkedin_accounts', 'member_email_accounts', 'member_whatsapp_accounts'].flatMap((t) => writes(calls, t, 'update')).length, 0, `${stored} : aucune écriture`);
        strictEqual(noticesOf(calls).length, 0, String(stored));
      });
    });
  }
  // Une liaison LOCKED d'une boîte e-mail ou d'un compte WhatsApp suffit à relire (la table LinkedIn n'a aucune ligne).
  for (const table of ['member_email_accounts', 'member_whatsapp_accounts']) {
    await withEnv(WITH_KEY, (call) => {
      if (call.table === 'rpc:record_webhook_event') return { data: true };
      if (call.table === table && call.op === 'select') return { data: [{ account_status: 'LOCKED' }] };
      return undefined;
    }, async ({ calls }) => {
      await withFetch(providerSays('running'), async (urls) => {
        strictEqual((await mod.handleRequest(unlock())).status, 200, table);
        strictEqual(urls.length, 1, `${table} : une relecture`);
        const update = writes(calls, table, 'update')[0];
        strictEqual((update.payload as { account_status: string }).account_status, 'OK', table);
      });
    });
  }
});

Deno.test('account.unlocked : les boîtes e-mail et les comptes WhatsApp prennent le même état relu, sur les seules lignes LOCKED', async () => {
  for (const [providerStatus, expected] of [['running', 'OK'], ['partial', 'PARTIAL'], ['degraded', 'DEGRADED'], ['running_locked', 'LOCKED']] as const) {
    await withEnv(WITH_KEY, linkedState([marie('LOCKED')]), async ({ calls }) => {
      await withFetch(providerSays(providerStatus === 'running_locked' ? 'running' : providerStatus, providerStatus === 'running_locked'), async () => {
        await mod.handleRequest(post(URL_OK, fresh('account.unlocked', { object: 'Account', is_locked: false })));
        for (const [table, status] of [['member_email_accounts', 'account_status'], ['member_whatsapp_accounts', 'account_status']] as const) {
          const [update] = writes(calls, table, 'update');
          if (expected === 'LOCKED') {
            strictEqual(update, undefined, `${table} : encore verrouillé, rien n'est écrit`);
            continue;
          }
          strictEqual((update.payload as Record<string, unknown>)[status], expected, table);
          ok(update.filters.some(([name, args]) => name === 'eq' && args[0] === 'account_status' && args[1] === 'LOCKED'), `${table} : limité à LOCKED`);
        }
      });
    });
  }
});

Deno.test('account.status.* sans verrou sur une liaison LOCKED : l\'état est relu chez le prestataire ; les autres liaisons ne déclenchent aucune relecture', async () => {
  // [événement, statut du prestataire (verrou), statut final, notification attendue, reprise des inscriptions]
  const cases: Array<[string, [string, boolean], string, string | null, boolean]> = [
    ['account.status.running', ['running', false], 'OK', null, true],
    ['account.status.running', ['running', true], 'LOCKED', null, false],
    ['account.status.running', ['partial', false], 'PARTIAL', TITLES.partial, false],
    ['account.status.degraded', ['degraded', false], 'DEGRADED', null, false],
    ['account.status.degraded', ['partial', false], 'PARTIAL', TITLES.partial, false],
    ['account.status.partial', ['partial', false], 'PARTIAL', TITLES.partial, false],
    ['account.status.partial', ['partial', true], 'LOCKED', null, false],
    ['account.status.partial', ['running', false], 'OK', null, false],
    ['account.status.partial', ['disconnected', false], 'CREDENTIALS', TITLES.disconnected, false],
  ];
  for (const [type, [providerStatus, providerLocked], finalStatus, title, resumes] of cases) {
    const rows = [marie('LOCKED')];
    await withEnv(WITH_KEY, linkedState(rows), async ({ calls }) => {
      await withFetch(providerSays(providerStatus, providerLocked), async (urls) => {
        const label = `${type} sur LOCKED, prestataire « ${providerStatus}${providerLocked ? ' + verrou' : ''} »`;
        await mod.handleRequest(post(URL_OK, fresh(type)));
        strictEqual(rows[0].account_status, finalStatus, label);
        deepStrictEqual(noticesOf(calls).map((n) => n.title), title ? [title] : [], `${label} : notifications`);
        strictEqual(urls.length, 1, `${label} : une relecture`);
        strictEqual(calls.some((c) => c.table === 'sequence_enrollments'), resumes, `${label} : reprise`);
      });
    });
  }
  // Une panne à reconnecter l'emporte sur le verrou sans relecture ; une liaison qui n'est pas LOCKED non plus.
  for (const [type, stored, expected] of [
    ['account.status.disconnected', 'LOCKED', 'CREDENTIALS'], ['account.status.errored', 'LOCKED', 'ERROR'],
    ['account.status.running', 'OK', 'OK'], ['account.status.partial', 'OK', 'PARTIAL'], ['account.status.degraded', 'PARTIAL', 'DEGRADED'],
  ] as const) {
    const rows = [marie(stored)];
    await withEnv(WITH_KEY, linkedState(rows), async () => {
      await withFetch(providerSays('running'), async (urls) => {
        await mod.handleRequest(post(URL_OK, fresh(type)));
        strictEqual(rows[0].account_status, expected, `${type} sur ${stored}`);
        strictEqual(urls.length, 0, `${type} sur ${stored} : aucune relecture`);
      });
    });
  }
});

Deno.test('account.status.* avec is_locked explicite sur une liaison LOCKED : l\'événement fait foi, aucune relecture du prestataire, même s\'il dit encore verrouillé', async () => {
  // [événement, charge, statut final, notification attendue, reprise des inscriptions]
  const cases: Array<[string, Record<string, unknown>, string, string | null, boolean]> = [
    ['account.status.running', { is_locked: false }, 'OK', null, true],
    ['account.status.degraded', { is_locked: false }, 'DEGRADED', null, false],
    ['account.status.partial', { is_locked: false }, 'PARTIAL', TITLES.partial, false],
    // is_locked: true : la liaison est déjà LOCKED, rien ne change, personne n'est prévenu une seconde fois.
    ['account.status.running', { is_locked: true }, 'LOCKED', null, false],
    ['account.status.partial', { is_locked: true }, 'LOCKED', null, false],
  ];
  for (const [type, flag, finalStatus, title, resumes] of cases) {
    const rows = [marie('LOCKED')];
    await withEnv(WITH_KEY, linkedState(rows), async ({ calls }) => {
      // Le prestataire dit encore « verrouillé » (événement en avance sur la lecture) : l'événement l'emporte, pas la lecture.
      await withFetch(providerSays('running', true), async (urls) => {
        const label = `${type} ${JSON.stringify(flag)} sur LOCKED`;
        strictEqual((await mod.handleRequest(post(URL_OK, fresh(type, { object: 'Account', ...flag })))).status, 200, label);
        strictEqual(rows[0].account_status, finalStatus, `${label} : statut final`);
        deepStrictEqual(noticesOf(calls).map((n) => n.title), title ? [title] : [], `${label} : notifications`);
        strictEqual(urls.length, 0, `${label} : aucune relecture`);
        strictEqual(calls.some((c) => c.table === 'sequence_enrollments'), resumes, `${label} : reprise`);
      });
    });
  }
});

Deno.test('account.status.* sans is_locked sur une liaison LOCKED, relecture impossible : la liaison reste LOCKED, 500 et clé libérée ; le rejeu relu applique l\'état du prestataire', async () => {
  for (const type of ['account.status.running', 'account.status.degraded', 'account.status.partial']) {
    const rows = [marie('LOCKED')];
    await withEnv(WITH_KEY, linkedState(rows), async ({ calls }) => {
      const event = fresh(type);
      const failed = await withFetch(() => 500, () => warningsDuring(() => mod.handleRequest(post(URL_OK, event))));
      strictEqual(failed.result.status, 500, `${type} : non acquitté`);
      strictEqual(rows[0].account_status, 'LOCKED', `${type} : la liaison reste LOCKED, jamais l'état de l'événement sur un doute`);
      strictEqual(writes(calls, 'member_linkedin_accounts', 'update').length, 0, type);
      strictEqual(noticesOf(calls).length, 0, type);
      strictEqual(calls.some((c) => c.table === 'sequence_enrollments'), false, `${type} : aucune reprise des inscriptions`);
      strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 1, `${type} : clé libérée`);
      await withFetch(providerSays('running'), async (urls) => {
        strictEqual((await mod.handleRequest(post(URL_OK, event))).status, 200, `${type} : le rejeu est traité`);
        strictEqual(urls.length, 1, type);
      });
      strictEqual(rows[0].account_status, 'OK', `${type} : l'état du prestataire`);
      deepStrictEqual(await bodyOf(await mod.handleRequest(post(URL_OK, event))), { ok: true, deduplicated: true }, type);
    });
  }
});

Deno.test('verrouillage d\'une boîte e-mail ou d\'un compte WhatsApp : même règle (jamais une panne à reconnecter), sur les deux événements', async () => {
  const conditionOf = (call: Call) => String(call.filters.find(([name]) => name === 'or')?.[1][0]);
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, isNewEvent, async ({ calls }) => {
    // account.locked : les trois tables, la même condition.
    await mod.handleRequest(post(URL_OK, fresh('account.locked', { object: 'Account', is_locked: true })));
    const tables = ['member_linkedin_accounts', 'member_email_accounts', 'member_whatsapp_accounts'];
    const conditions = tables.map((table) => conditionOf(writes(calls, table, 'update')[0]));
    strictEqual(new Set(conditions).size, 1, 'une seule condition pour les trois tables');
    ok(conditions[0].includes('CREDENTIALS') && conditions[0].includes('ERROR'), conditions[0]);
  });
  for (const [provider, table] of [['google', 'member_email_accounts'], ['whatsapp', 'member_whatsapp_accounts']] as const) {
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, isNewEvent, async ({ calls }) => {
      await mod.handleRequest(post(URL_OK, fresh('account.status.running', { object: 'Account', is_locked: true }, { account_provider: provider })));
      const update = writes(calls, table, 'update')[0];
      strictEqual((update.payload as { account_status: string }).account_status, 'LOCKED');
      const condition = conditionOf(update);
      ok(condition.includes('CREDENTIALS') && condition.includes('ERROR'), `${table} : ${condition}`);
      // Un statut sans verrou reste écrit sans condition.
      calls.length = 0;
      await mod.handleRequest(post(URL_OK, fresh('account.status.running', { object: 'Account', is_locked: false }, { account_provider: provider })));
      ok(!writes(calls, table, 'update')[0].filters.some(([name]) => name === 'or'), `${table} : OK sans condition`);
    });
  }
});

/** Ce que la notification de connexion partielle doit dire : la phrase de la carte de connexion, mot pour mot. */
const PARTIAL_SENTENCE = 'Une partie de la connexion LinkedIn demande une nouvelle authentification. Reconnectez le compte pour reprendre les envois.';
function expectPartialNotice(n: ReturnType<typeof noticesOf>[number]) {
  strictEqual(n.user_id, 'u1');
  strictEqual(n.organization_id, 'o1');
  strictEqual(n.type, 'linkedin_disconnected', 'même type que la déconnexion : hors « Pour vous », classée en action');
  strictEqual(n.link, '/settings?tab=account');
  strictEqual(n.title, 'Connexion LinkedIn partielle');
  strictEqual(n.body, PARTIAL_SENTENCE, 'la phrase de la carte, sans autre texte');
  ok(!/unipile/i.test(`${n.title} ${n.body}`), 'jamais le nom du prestataire');
  ok(!/—/.test(`${n.title} ${n.body}`), 'pas de tiret cadratin');
  deepStrictEqual(n.metadata, { linkedin_account_id: ACC, account_status: 'PARTIAL' });
}

Deno.test('account.status.partial : PARTIAL écrit et une notification au passage d\'un compte qui n\'était ni en panne à reconnecter ni déjà PARTIAL', async () => {
  const outcomes: Array<[string | null, number]> = [
    ['OK', 1], [null, 1], ['DEGRADED', 1], ['LOCKED', 1], ['NOUVEAU_STATUT', 1],
    ['PARTIAL', 0], ['CREDENTIALS', 0], ['ERROR', 0], ['PERMISSIONS', 0], ['DISCONNECTED', 0], ['DELETED', 0],
  ];
  for (const [previous, notified] of outcomes) {
    const rows = [marie(previous)];
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
      const label = previous === null ? 'sans statut' : `« ${previous} »`;
      // `is_locked: false` dans l'événement fait foi pour le verrou : même depuis LOCKED, aucune relecture du prestataire.
      strictEqual((await mod.handleRequest(post(URL_OK, fresh('account.status.partial', { object: 'Account', is_locked: false })))).status, 200, label);
      strictEqual(rows[0].account_status, 'PARTIAL', `depuis ${label} : le statut de l'événement est écrit`);
      const notices = noticesOf(calls);
      strictEqual(notices.length, notified, `depuis ${label} : ${notified} notification(s)`);
      if (notified) expectPartialNotice(notices[0]);
      strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0, 'PARTIAL ne reprend ni ne met en pause aucune inscription');
    });
  }
});

Deno.test('account.status.partial : rejoué, répété ou simultané, une seule notification ; un nouveau passage en prévient une autre', async () => {
  const rows = [marie('OK')];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
    const event = fresh('account.status.partial');
    await mod.handleRequest(post(URL_OK, event));
    deepStrictEqual(await (await mod.handleRequest(post(URL_OK, event))).json(), { ok: true, deduplicated: true });
    await mod.handleRequest(post(URL_OK, fresh('account.status.partial')));
    strictEqual(noticesOf(calls).length, 1, 'rejeu et répétition : déjà annoncé');
    // Retour à OK puis nouveau passage en PARTIAL : une nouvelle notification.
    await mod.handleRequest(post(URL_OK, fresh('account.status.running', { object: 'Account', is_locked: false })));
    strictEqual(rows[0].account_status, 'OK');
    strictEqual(noticesOf(calls).length, 1, 'le retour à OK ne prévient pas');
    await mod.handleRequest(post(URL_OK, fresh('account.status.partial')));
    strictEqual(noticesOf(calls).length, 2);
  });
  for (const count of [2, 6, 12]) {
    const concurrent = [marie('OK')];
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(concurrent), async ({ calls }) => {
      const responses = await Promise.all(Array.from({ length: count }, () => mod.handleRequest(post(URL_OK, fresh('account.status.partial')))));
      deepStrictEqual(responses.map((r) => r.status), Array(count).fill(200));
      strictEqual(concurrent[0].account_status, 'PARTIAL');
      strictEqual(noticesOf(calls).length, 1, `${count} livraisons simultanées : une notification`);
    });
  }
});

Deno.test('account.status.partial : une lecture puis UNE écriture conditionnelle au statut lu, rendue par .select(), jamais une seconde écriture sans condition ; en échec, personne n\'est prévenu', async () => {
  const rows = [marie('OK')];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, fresh('account.status.partial')));
    const linkedinCalls = calls.filter((c) => c.table === 'member_linkedin_accounts');
    strictEqual(linkedinCalls.filter((c) => c.op === 'select').length, 1, 'le statut d\'avant est lu une fois');
    const updates = linkedinCalls.filter((c) => c.op === 'update');
    strictEqual(updates.length, 1, 'une seule écriture : une seconde, sans condition, recouvrirait un événement plus récent');
    ok(updates[0].returning, 'l\'écriture rend ses lignes (.select())');
    deepStrictEqual(
      updates[0].filters.map(([name, args]) => [name, ...args]),
      [['eq', 'id', 'link-u1'], ['eq', 'linkedin_account_id', ACC], ['eq', 'account_status', 'OK']],
      'conditionnelle au statut lu',
    );
  });
  // Sans statut enregistré : la condition est « IS NULL », jamais un égal à null.
  const unset = [marie(null)];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(unset), async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, fresh('account.status.partial')));
    const [update] = writes(calls, 'member_linkedin_accounts', 'update');
    ok(update.filters.some(([name, args]) => name === 'is' && args[0] === 'account_status' && args[1] === null));
    strictEqual(unset[0].account_status, 'PARTIAL');
  });
  // Écriture en échec : personne n'est prévenu, la liaison garde son statut, et l'événement n'est PAS acquitté (500,
  // clé de dédoublonnage libérée) : le prestataire le rejoue et le rejeu s'applique.
  const failing = [marie('OK')];
  const failingOptions = { failLinkedinUpdate: true };
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(failing, failingOptions), async ({ calls }) => {
    const event = fresh('account.status.partial');
    strictEqual((await mod.handleRequest(post(URL_OK, event))).status, 500);
    strictEqual(noticesOf(calls).length, 0);
    strictEqual(failing[0].account_status, 'OK');
    strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 1, 'clé de dédoublonnage libérée pour le rejeu');
    failingOptions.failLinkedinUpdate = false;
    strictEqual((await mod.handleRequest(post(URL_OK, event))).status, 200, 'le rejeu est traité, pas dédoublonné');
    strictEqual(failing[0].account_status, 'PARTIAL');
    strictEqual(noticesOf(calls).length, 1);
  });
});

Deno.test('account.status.partial : un running qui s\'applique juste après l\'écriture n\'est pas recouvert (plus de seconde écriture)', async () => {
  // Avant : écriture conditionnelle (OK -> PARTIAL, notifiée), puis écriture générale du même contenu. Un événement
  // plus récent qui s'appliquait entre les deux (partial puis running, 0 à 5 ms d'écart) était recouvert : l'état
  // final restait PARTIAL alors que le dernier événement appliqué était running.
  const rows = [marie('OK')];
  let runningLanded = false;
  const options = {
    afterUpdate: (_call: Call, state: LinkRow[]) => {
      if (runningLanded) return;
      runningLanded = true;
      state[0].account_status = 'OK'; // account.status.running appliqué à cet instant
    },
  };
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows, options), async ({ calls }) => {
    strictEqual((await mod.handleRequest(post(URL_OK, fresh('account.status.partial')))).status, 200);
    strictEqual(rows[0].account_status, 'OK', 'le dernier événement appliqué est running : son état reste');
    strictEqual(writes(calls, 'member_linkedin_accounts', 'update').length, 1, 'partial n\'écrit qu\'une fois');
    strictEqual(noticesOf(calls).length, 1, 'le passage en PARTIAL a été fait une fois : une notification');
  });
});

Deno.test('statut : un événement qui s\'applique entre la lecture et l\'écriture est lu de nouveau, jamais recouvert ni annoncé deux fois', async () => {
  // partial lit OK ; avant son écriture, disconnected passe la liaison à CREDENTIALS (et prévient). L'écriture de
  // partial ne trouve plus OK : elle relit CREDENTIALS et décide de nouveau (PARTIAL remplace une panne sans
  // nouvelle notification). Équivalent à disconnected PUIS partial.
  const rows = [marie('OK')];
  let landed = false;
  const options = {
    beforeUpdate: (_call: Call, state: LinkRow[]) => {
      if (landed) return;
      landed = true;
      state[0].account_status = 'CREDENTIALS';
    },
  };
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows, options), async ({ calls }) => {
    strictEqual((await mod.handleRequest(post(URL_OK, fresh('account.status.partial')))).status, 200);
    strictEqual(rows[0].account_status, 'PARTIAL');
    strictEqual(noticesOf(calls).length, 0, 'le passage a eu lieu depuis une panne déjà signalée : aucune notification');
    strictEqual(calls.filter((c) => c.table === 'member_linkedin_accounts' && c.op === 'select').length, 2, 'relu après le conflit');
  });
  // Un conflit permanent (une ligne qui change à chaque écriture) s'arrête au plafond d'essais : événement non
  // appliqué, donc NON acquitté (500, clé de dédoublonnage libérée), le prestataire le rejoue.
  const churn = [marie('OK')];
  let flip = 0;
  let churning = true;
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(churn, {
    beforeUpdate: (_call: Call, state: LinkRow[]) => { if (churning) state[0].account_status = `AUTRE_${++flip}`; },
  }), async ({ calls }) => {
    const event = fresh('account.status.partial');
    strictEqual((await mod.handleRequest(post(URL_OK, event))).status, 500);
    ok(flip >= 10 && flip <= 40, `essais bornés (${flip})`);
    strictEqual(noticesOf(calls).length, 0);
    strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 1, 'clé de dédoublonnage libérée pour le rejeu');
    // Le rejeu, une fois la ligne stable, est traité.
    churning = false;
    strictEqual((await mod.handleRequest(post(URL_OK, event))).status, 200);
    strictEqual(churn[0].account_status, 'PARTIAL');
    strictEqual(noticesOf(calls).length, 1);
  });
});

Deno.test('statut : lecture des liaisons en échec avant un passage d\'état : 500 et clé libérée, rien n\'est écrit ni notifié ; le rejeu est traité', async () => {
  // [libellé, événement, statut final au rejeu, notification au rejeu]
  const cases: Array<[string, () => ReturnType<typeof envelope>, string, string | null]> = [
    ['account.status.partial', () => fresh('account.status.partial'), 'PARTIAL', TITLES.partial],
    ['account.status.degraded', () => fresh('account.status.degraded'), 'DEGRADED', null],
    ['account.status.running', () => fresh('account.status.running', { object: 'Account', is_locked: false }), 'OK', null],
    ['account.status.disconnected', () => fresh('account.status.disconnected'), 'CREDENTIALS', TITLES.disconnected],
    ['account.status.errored', () => fresh('account.status.errored'), 'ERROR', TITLES.error],
    ['account.reconnect sans tentative', () => fresh('account.reconnect', { status: 'partial' }), 'PARTIAL', TITLES.partial],
  ];
  for (const [label, makeEvent, finalStatus, title] of cases) {
    const rows = [marie('OK')];
    const options = { failLinkedinSelect: true };
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows, options), async ({ calls }) => {
      const event = makeEvent();
      const failed = await warningsDuring(() => mod.handleRequest(post(URL_OK, event)));
      strictEqual(failed.result.status, 500, `${label} : la lecture a échoué, l'événement n'est pas acquitté`);
      ok(failed.warnings.some((w) => /not applied/.test(w)), `${label} : journalisé : ${failed.warnings.join(' | ')}`);
      strictEqual(writes(calls, 'member_linkedin_accounts', 'update').length, 0, `${label} : rien n'est écrit`);
      strictEqual(noticesOf(calls).length, 0, `${label} : personne n'est prévenu`);
      strictEqual(calls.some((c) => c.table === 'sequence_enrollments'), false, `${label} : aucune reprise des inscriptions`);
      strictEqual(rows[0].account_status, 'OK', label);
      strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 1, `${label} : clé de dédoublonnage libérée`);
      // La base répond de nouveau : le même evt_ rejoué est traité (pas « deduplicated »).
      options.failLinkedinSelect = false;
      strictEqual((await mod.handleRequest(post(URL_OK, event))).status, 200, `${label} : le rejeu est traité`);
      strictEqual(rows[0].account_status, finalStatus, `${label} : statut au rejeu`);
      deepStrictEqual(noticesOf(calls).map((n) => n.title), title ? [title] : [], `${label} : notifications au rejeu`);
      deepStrictEqual(await bodyOf(await mod.handleRequest(post(URL_OK, event))), { ok: true, deduplicated: true }, `${label} : un rejeu après succès est dédoublonné`);
    });
  }
});

Deno.test('transitionLinkedInAccount : au plafond de 25 essais, ou sur une lecture ou une relecture en échec, rend une erreur (jamais « appliqué ») sans écrire ce qu\'elle ne peut pas écrire', async () => {
  const row = { id: 'l1', user_id: 'u1', organization_id: 'o1', linkedin_account_name: 'Marie', account_status: 'OK' };
  const target = () => ({ status: 'PARTIAL', patch: { account_status: 'PARTIAL' } });
  // Plafond : l'écriture conditionnelle ne trouve jamais la ligne telle qu'elle l'a lue.
  const capped = makeDb((call) => (call.op === 'select' ? { data: [row] } : call.op === 'update' ? { data: [] } : undefined));
  const cap = await mod.transitionLinkedInAccount(capped.db as never, ACC, target);
  ok(cap.error instanceof Error && /kept changing/.test(cap.error.message), String(cap.error));
  deepStrictEqual(cap.finalStatuses, [], 'aucun statut final : rien n\'a été appliqué');
  strictEqual(capped.calls.filter((c) => c.op === 'select').length, 25, 'vingt-cinq lectures');
  strictEqual(capped.calls.filter((c) => c.op === 'update').length, 25, 'vingt-cinq écritures conditionnelles');
  strictEqual(capped.calls.some((c) => c.table === 'notifications'), false, 'aucune notification');
  // Lecture en échec : aucune écriture.
  const readFails = makeDb((call) => (call.op === 'select' ? { error: { code: 'XX000', message: 'indisponible' } } : undefined));
  const read = await mod.transitionLinkedInAccount(readFails.db as never, ACC, target);
  deepStrictEqual((read.error as { code: string }).code, 'XX000');
  strictEqual(readFails.calls.filter((c) => c.op === 'update').length, 0);
  // Écriture en échec : l'erreur de la base est rendue.
  const writeFails = makeDb((call) => (call.op === 'select' ? { data: [row] } : call.op === 'update' ? { error: { code: 'XX000', message: 'indisponible' } } : undefined));
  strictEqual(((await mod.transitionLinkedInAccount(writeFails.db as never, ACC, target)).error as { code: string }).code, 'XX000');
  // Relecture du compte impossible (l'état à écrire ne peut pas être décidé) : l'erreur est rendue, rien n'est écrit.
  const noTarget = makeDb((call) => (call.op === 'select' ? { data: [row] } : undefined));
  const refused = await mod.transitionLinkedInAccount(noTarget.db as never, ACC, () => { throw new Error('relecture impossible'); });
  strictEqual((refused.error as Error).message, 'relecture impossible');
  strictEqual(noTarget.calls.filter((c) => c.op === 'update').length, 0);
  // Cas nominal : une lecture, une écriture, statut final rendu, pas d'erreur.
  const fine = makeDb((call) => (call.op === 'select' ? { data: [row] } : call.op === 'update' ? { data: [{ id: 'l1' }] } : undefined));
  const done = await mod.transitionLinkedInAccount(fine.db as never, ACC, target);
  strictEqual(done.error, null);
  deepStrictEqual(done.finalStatuses, ['PARTIAL']);
});

Deno.test('account.status.degraded : état de carte seulement, jamais de notification, depuis aucun statut', async () => {
  for (const previous of ['OK', null, 'PARTIAL', 'LOCKED', 'CREDENTIALS', 'ERROR', 'DEGRADED']) {
    const rows = [marie(previous)];
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
      strictEqual((await mod.handleRequest(post(URL_OK, fresh('account.status.degraded', { object: 'Account', is_locked: false })))).status, 200);
      strictEqual(rows[0].account_status, 'DEGRADED', String(previous));
      strictEqual(noticesOf(calls).length, 0, `${previous} : pas de notification`);
      strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0, `${previous} : pas de reprise`);
    });
  }
});

Deno.test('account.status.running (compte non verrouillé) : OK, aucune notification', async () => {
  const rows = [marie('LOCKED')];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, fresh('account.status.running', { object: 'Account', is_locked: false })));
    strictEqual(rows[0].account_status, 'OK');
    strictEqual(noticesOf(calls).length, 0);
  });
});

Deno.test('account.status.errored : la notification parle d\'un problème de connexion, pas d\'un compte « plus connecté » ; disconnected garde son texte', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState([marie('OK')]), async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, fresh('account.status.errored')));
    const [n] = noticesOf(calls);
    strictEqual(n.type, 'linkedin_disconnected');
    strictEqual(n.title, 'Problème de connexion LinkedIn');
    ok(n.body.includes('« Marie »') && n.body.includes('problème de connexion'), n.body);
    ok(!/n'est plus connecté/.test(n.body), `ne dit plus « plus connecté » : ${n.body}`);
    ok(/Reconnectez-le/.test(n.body), 'reconnecter reste le geste');
    ok(!/unipile/i.test(`${n.title} ${n.body}`));
    strictEqual(n.metadata.account_status, 'ERROR');
  });
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState([marie('OK')]), async ({ calls }) => {
    await mod.handleRequest(post(URL_OK, fresh('account.status.disconnected')));
    const [n] = noticesOf(calls);
    strictEqual(n.title, 'Compte LinkedIn déconnecté');
    ok(n.body.includes('n\'est plus connecté'), n.body);
  });
});

Deno.test('account.status.disconnected et errored : une panne remplace l\'autre sans nouvelle notification, un rejeu ou une répétition ne préviennent pas', async () => {
  const rows = [marie('OK')];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
    const first = fresh('account.status.errored');
    await mod.handleRequest(post(URL_OK, first));
    deepStrictEqual(await (await mod.handleRequest(post(URL_OK, first))).json(), { ok: true, deduplicated: true });
    await mod.handleRequest(post(URL_OK, fresh('account.status.errored')));
    strictEqual(rows[0].account_status, 'ERROR');
    await mod.handleRequest(post(URL_OK, fresh('account.status.disconnected')));
    strictEqual(rows[0].account_status, 'CREDENTIALS', 'la dernière panne rapportée est enregistrée');
    deepStrictEqual(noticesOf(calls).map((n) => n.title), ['Problème de connexion LinkedIn'], 'déjà signalé');
    // Retour à OK, puis nouvelle panne : un nouveau passage, une nouvelle notification.
    await mod.handleRequest(post(URL_OK, fresh('account.status.running', { object: 'Account', is_locked: false })));
    await mod.handleRequest(post(URL_OK, fresh('account.status.disconnected')));
    deepStrictEqual(noticesOf(calls).map((n) => n.title), ['Problème de connexion LinkedIn', 'Compte LinkedIn déconnecté']);
  });
});

// ---------------------------------------------------------------------------
// Passage d'état atomique : équivalence avec un ordre série des événements
// ---------------------------------------------------------------------------
// Des événements simultanés pour un même compte doivent laisser le statut ET les notifications d'un ordre série
// quelconque des mêmes événements : aucun événement perdu, recouvert ou annoncé deux fois. Le modèle ci-dessous est
// écrit à la lettre des règles (et non à partir du code) ; `provider` est l'état que le prestataire rapporte à la
// relecture (constant pendant un essai).

type Kind = 'lock' | 'unlock' | 'running' | 'degraded' | 'partial' | 'disconnected' | 'errored';
type Told = 'locked' | 'partial' | 'disconnected' | 'error';
const BROKEN = ['CREDENTIALS', 'ERROR', 'PERMISSIONS', 'DELETED', 'DISCONNECTED'];
const TITLE_OF: Record<Told, string> = {
  locked: 'Compte LinkedIn restreint', partial: 'Connexion LinkedIn partielle',
  disconnected: 'Compte LinkedIn déconnecté', error: 'Problème de connexion LinkedIn',
};

function modelApply(status: string, kind: Kind, provider: string): [string, Told | null] {
  const told = (to: string, from: string): Told | null => {
    if (to === 'PARTIAL') return BROKEN.includes(from) || from === 'PARTIAL' ? null : 'partial';
    if (to === 'CREDENTIALS') return BROKEN.includes(from) ? null : 'disconnected';
    if (to === 'ERROR') return BROKEN.includes(from) ? null : 'error';
    return null;
  };
  const afterLock = (): [string, Told | null] => (provider === 'LOCKED' ? [status, null] : [provider, told(provider, 'LOCKED')]);
  switch (kind) {
    case 'lock': return BROKEN.includes(status) || status === 'LOCKED' ? [status, null] : ['LOCKED', 'locked'];
    case 'unlock': return status === 'LOCKED' ? afterLock() : [status, null];
    // `running` porte `is_locked: false` (eventOfKind) : il fait foi pour le verrou, aucune relecture du prestataire.
    case 'running': return ['OK', null];
    case 'degraded': case 'partial': {
      if (status === 'LOCKED') return afterLock();
      const to = kind === 'degraded' ? 'DEGRADED' : 'PARTIAL';
      return [to, told(to, status)];
    }
    case 'disconnected': return ['CREDENTIALS', told('CREDENTIALS', status)];
    case 'errored': return ['ERROR', told('ERROR', status)];
  }
}

/** Tous les couples (statut final, notifications triées) que donne un ordre série quelconque de `kinds`. */
function serialOutcomes(initial: string, kinds: Kind[], provider: string): Set<string> {
  const names = [...new Set(kinds)];
  const counts = names.map((name) => kinds.filter((kind) => kind === name).length);
  const memo = new Map<string, Set<string>>();
  // Résultats possibles des événements restants (`left`, un compte par genre) depuis `status` : (statut final, notifications de ces seuls événements).
  const walk = (status: string, left: number[]): Set<string> => {
    const key = `${status}|${left.join(',')}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const result = new Set<string>();
    if (left.every((count) => count === 0)) result.add(`${status}|`);
    names.forEach((kind, index) => {
      if (left[index] === 0) return;
      const rest = left.slice();
      rest[index]--;
      const [next, notice] = modelApply(status, kind, provider);
      for (const tail of walk(next, rest)) {
        const cut = tail.indexOf('|');
        const told = tail.slice(cut + 1).split(',').filter(Boolean);
        result.add(`${tail.slice(0, cut)}|${(notice ? [notice, ...told] : told).sort().join(',')}`);
      }
    });
    memo.set(key, result);
    return result;
  };
  return walk(initial, counts);
}

function eventOfKind(kind: Kind, index: number) {
  switch (kind) {
    case 'lock':
      return index % 2 === 0
        ? fresh('account.locked', { object: 'Account', is_locked: true })
        : fresh('account.status.running', { object: 'Account', is_locked: true });
    case 'unlock': return fresh('account.unlocked', { object: 'Account', is_locked: false });
    case 'running': return fresh('account.status.running', { object: 'Account', is_locked: false });
    case 'degraded': return fresh('account.status.degraded');
    case 'partial': return fresh('account.status.partial');
    case 'disconnected': return fresh('account.status.disconnected');
    case 'errored': return fresh('account.status.errored');
  }
}

/** Générateur pseudo-aléatoire à graine (mulberry32) : les essais se rejouent. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Livre `kinds` en même temps (départs étalés de 0 à 3 ms) et rend le statut final et les notifications. */
async function deliverTogether(initial: string | null, kinds: Kind[], provider: [string, boolean], rng: () => number) {
  const rows = [marie(initial)];
  let outcome = { status: '', told: [] as string[] };
  await withEnv(WITH_KEY, linkedState(rows), async ({ calls }) => {
    await withFetch(providerSays(provider[0], provider[1]), async () => {
      const responses = await Promise.all(kinds.map(async (kind, index) => {
        await pause(Math.floor(rng() * 4));
        return await mod.handleRequest(post(URL_OK, eventOfKind(kind, index)));
      }));
      deepStrictEqual(responses.map((r) => r.status), Array(kinds.length).fill(200));
    });
    const titles = noticesOf(calls).map((n) => n.title);
    const told = (Object.keys(TITLE_OF) as Told[]).flatMap((notice) => titles.filter((t) => t === TITLE_OF[notice]).map(() => notice)).sort();
    outcome = { status: String(rows[0].account_status), told };
  });
  return outcome;
}

Deno.test('statut : N événements du même genre livrés ensemble (8 et 24) donnent une seule notification, depuis OK', async () => {
  const rng = seeded(7);
  for (const kind of ['lock', 'partial', 'disconnected', 'errored'] as const) {
    for (const count of [8, 24]) {
      const { status, told } = await deliverTogether('OK', Array(count).fill(kind), ['running', false], rng);
      const [finalStatus, notice] = modelApply('OK', kind, 'OK');
      strictEqual(status, finalStatus, `${count} × ${kind}`);
      deepStrictEqual(told, notice ? [notice] : [], `${count} × ${kind} : une notification`);
    }
  }
});

Deno.test('statut : événements mêlés livrés ensemble (8 et 24) : statut et notifications d\'un ordre série, jamais autre chose', async () => {
  const rng = seeded(20261012);
  const kinds: Kind[] = ['lock', 'unlock', 'running', 'degraded', 'partial', 'disconnected', 'errored'];
  const initials = ['OK', 'PARTIAL', 'LOCKED', 'CREDENTIALS', 'DEGRADED', null];
  const providers: Array<[string, boolean, string]> = [['running', false, 'OK'], ['partial', false, 'PARTIAL'], ['degraded', false, 'DEGRADED'], ['running', true, 'LOCKED']];
  const pick = <T>(list: T[]): T => list[Math.floor(rng() * list.length)];
  let rounds = 0;
  for (const count of [8, 24]) {
    for (let round = 0; round < (count === 8 ? 24 : 10); round++) {
      // 8 événements : les sept genres ; 24 : trois ou quatre genres (le modèle des ordres séries énumère les mélanges).
      const pool = count === 8 ? kinds : [...kinds].sort(() => rng() - 0.5).slice(0, 3 + (round % 2));
      const mix = Array.from({ length: count }, () => pick(pool));
      const initial = pick(initials);
      const [providerStatus, providerLocked, provider] = pick(providers);
      const { status, told } = await deliverTogether(initial, mix, [providerStatus, providerLocked], rng);
      const allowed = serialOutcomes(initial ?? '', mix, provider);
      ok(allowed.has(`${status}|${told.join(',')}`),
        `${count} événements depuis ${initial}, prestataire ${provider} : ${status}|${told.join(',')} n'est le résultat d'aucun ordre série de ${mix.join(' ')}`);
      rounds++;
    }
  }
  ok(rounds >= 30);
});

Deno.test('statut : partial et running livrés ensemble, répétés : statut et notifications d\'un ordre série', async () => {
  const rng = seeded(99);
  for (let round = 0; round < 40; round++) {
    const mix: Kind[] = round % 2 === 0 ? ['partial', 'running'] : ['running', 'partial'];
    const { status, told } = await deliverTogether('OK', mix, ['running', false], rng);
    ok(serialOutcomes('OK', mix, 'OK').has(`${status}|${told.join(',')}`), `${status}|${told.join(',')}`);
  }
});

Deno.test('statut : le modèle des ordres séries lui-même (partial/running depuis OK, verrou, pannes)', () => {
  deepStrictEqual([...serialOutcomes('OK', ['partial', 'running'], 'OK')].sort(), ['OK|partial', 'PARTIAL|partial']);
  deepStrictEqual([...serialOutcomes('OK', ['lock', 'lock', 'lock'], 'OK')], ['LOCKED|locked']);
  deepStrictEqual([...serialOutcomes('OK', ['disconnected', 'errored'], 'OK')].sort(), ['CREDENTIALS|error', 'ERROR|disconnected']);
  deepStrictEqual([...serialOutcomes('PARTIAL', ['lock', 'unlock'], 'PARTIAL')].sort(), ['LOCKED|locked', 'PARTIAL|locked,partial']);
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

Deno.test('account.add : state inconnu ou absent : aucun rattachement ; liaison LinkedIn déjà en place repasse OK quand l\'événement dit running, reprise des inscriptions', async () => {
  for (const state of [undefined, 'pas-un-uuid', '8d0a6a62-1b53-4f4e-9a52-2f0a8f6b1111']) {
    const rows = [marie('CREDENTIALS')];
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
      const response = await mod.handleRequest(post(URL_OK, fresh('account.add', { status: 'running', ...(state ? { state } : {}) })));
      strictEqual(response.status, 200, String(state));
      strictEqual(writes(calls, 'member_linkedin_accounts', 'upsert').length, 0, 'rien n\'est rattaché sans tentative connue');
      strictEqual(writes(calls, 'member_email_accounts', 'insert').length, 0);
      strictEqual((writes(calls, 'member_linkedin_accounts', 'update')[0].payload as { account_status: string }).account_status, 'OK');
      strictEqual(rows[0].account_status, 'OK');
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

Deno.test('account.reconnect sans tentative : l\'état rapporté suit les règles de account.status.* (verrou, PARTIAL, pannes), jamais forcé à OK, et seul OK reprend les inscriptions', async () => {
  const L = 'Compte LinkedIn restreint', P = 'Connexion LinkedIn partielle', E = 'Problème de connexion LinkedIn', D = 'Compte LinkedIn déconnecté';
  // [statut enregistré, charge de l'événement, statut final, titres des notifications, reprise des inscriptions]
  const cases: Array<[string | null, Record<string, unknown>, string, string[], boolean]> = [
    ['OK', { status: 'running', is_locked: true }, 'LOCKED', [L], false],
    [null, { status: 'running', is_locked: true }, 'LOCKED', [L], false],
    ['DEGRADED', { status: 'running', is_locked: true }, 'LOCKED', [L], false],
    ['PARTIAL', { status: 'running', is_locked: true }, 'LOCKED', [L], false],
    ['LOCKED', { status: 'running', is_locked: true }, 'LOCKED', [], false],
    ['CREDENTIALS', { status: 'running', is_locked: true }, 'CREDENTIALS', [], false],
    ['ERROR', { status: 'running', is_locked: true }, 'ERROR', [], false],
    ['OK', { status: 'partial' }, 'PARTIAL', [P], false],
    ['DEGRADED', { status: 'partial' }, 'PARTIAL', [P], false],
    ['PARTIAL', { status: 'partial' }, 'PARTIAL', [], false],
    ['CREDENTIALS', { status: 'partial' }, 'PARTIAL', [], false],
    ['OK', { status: 'errored' }, 'ERROR', [E], false],
    ['ERROR', { status: 'errored' }, 'ERROR', [], false],
    ['OK', { status: 'disconnected' }, 'CREDENTIALS', [D], false],
    ['CREDENTIALS', { status: 'degraded' }, 'DEGRADED', [], false],
    ['CREDENTIALS', { status: 'running', is_locked: false }, 'OK', [], true],
    // Un statut absent ne dit rien : le statut enregistré est gardé (voir « sans information » plus bas).
    ['CREDENTIALS', {}, 'CREDENTIALS', [], false],
    ['LOCKED', { status: 'running', is_locked: false }, 'OK', [], true],
  ];
  for (const [previous, payload, expected, titles, resumes] of cases) {
    const rows = [marie(previous)];
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
      const label = `${previous === null ? 'sans statut' : previous} + ${JSON.stringify(payload)}`;
      strictEqual((await mod.handleRequest(post(URL_OK, fresh('account.reconnect', payload)))).status, 200, label);
      strictEqual(rows[0].account_status, expected, `${label} : statut final`);
      deepStrictEqual(noticesOf(calls).map((n) => n.title), titles, `${label} : notifications`);
      strictEqual(calls.some((c) => c.table === 'sequence_enrollments'), resumes, `${label} : reprise`);
      if (expected === 'OK') strictEqual(rows[0].failure_reason ?? null, null, `${label} : raison d'échec effacée`);
    });
  }
});

Deno.test('account.reconnect sans tentative : rejeu ou répétition ne préviennent pas deux fois, des livraisons simultanées non plus', async () => {
  const rows = [marie('OK')];
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
    const event = fresh('account.reconnect', { status: 'partial' });
    await mod.handleRequest(post(URL_OK, event));
    deepStrictEqual(await (await mod.handleRequest(post(URL_OK, event))).json(), { ok: true, deduplicated: true });
    await mod.handleRequest(post(URL_OK, fresh('account.reconnect', { status: 'partial' })));
    strictEqual(noticesOf(calls).length, 1);
  });
  for (const [status, isLocked, title] of [['partial', false, 'Connexion LinkedIn partielle'], ['running', true, 'Compte LinkedIn restreint']] as const) {
    for (const count of [8, 24]) {
      const concurrent = [marie('OK')];
      await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(concurrent), async ({ calls }) => {
        const responses = await Promise.all(Array.from({ length: count }, () =>
          mod.handleRequest(post(URL_OK, fresh('account.reconnect', { status, is_locked: isLocked })))));
        deepStrictEqual(responses.map((r) => r.status), Array(count).fill(200));
        deepStrictEqual(noticesOf(calls).map((n) => n.title), [title], `${status} ${count} livraisons simultanées`);
      });
    }
  }
});

Deno.test('account.add et account.reconnect sans tentative : un statut absent ou hors spécification ne dit rien : statut gardé, aucune écriture, aucune notification, aucune reprise', async () => {
  const E = 'Problème de connexion LinkedIn';
  // Charges sans information utilisable sur l'état du compte.
  const noInformation: Array<Record<string, unknown>> = [
    {}, { status: 'paused' }, { status: 'PAUSED' }, { status: '' }, { status: '   ' }, { status: 'OK' }, { status: 'stopped' },
    { is_locked: false }, { status: 'paused', is_locked: false },
  ];
  for (const type of ['account.add', 'account.reconnect']) {
    for (const stored of ['OK', 'DEGRADED', 'PARTIAL', 'CREDENTIALS', 'ERROR', 'LOCKED', null]) {
      for (const payload of noInformation) {
        const rows = [marie(stored)];
        await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
          const label = `${type} ${JSON.stringify(payload)} sur ${stored}`;
          strictEqual((await mod.handleRequest(post(URL_OK, fresh(type, { object: 'Account', ...payload })))).status, 200, label);
          strictEqual(rows[0].account_status, stored, `${label} : statut enregistré gardé`);
          strictEqual(writes(calls, 'member_linkedin_accounts', 'update').length, 0, `${label} : aucune écriture`);
          strictEqual(noticesOf(calls).length, 0, `${label} : aucune notification (pas de « ${E} » pour un mot inconnu)`);
          strictEqual(calls.some((c) => c.table === 'sequence_enrollments'), false, `${label} : aucune reprise des inscriptions`);
        });
      }
    }
  }
  // Un verrou annoncé reste une information même sans statut lisible : le statut du verrou est écrit et annoncé.
  for (const payload of [{ is_locked: true }, { status: 'paused', is_locked: true }]) {
    const rows = [marie('OK')];
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
      strictEqual((await mod.handleRequest(post(URL_OK, fresh('account.reconnect', { object: 'Account', ...payload })))).status, 200);
      strictEqual(rows[0].account_status, 'LOCKED', JSON.stringify(payload));
      deepStrictEqual(noticesOf(calls).map((n) => n.title), [TITLES.locked]);
    });
  }
  // Les statuts connus gardent leurs règles (casse du mot ignorée) : running reprend, les pannes préviennent.
  for (const [payload, expected, titles] of [
    [{ status: 'RUNNING' }, 'OK', []], [{ status: 'running' }, 'OK', []], [{ status: 'disconnected' }, 'CREDENTIALS', [TITLES.disconnected]],
    [{ status: 'errored' }, 'ERROR', [TITLES.error]], [{ status: 'degraded' }, 'DEGRADED', []], [{ status: 'partial' }, 'PARTIAL', [TITLES.partial]],
  ] as const) {
    const rows = [marie('OK')];
    await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: TOKEN }, linkedState(rows), async ({ calls }) => {
      await mod.handleRequest(post(URL_OK, fresh('account.add', { object: 'Account', ...payload })));
      strictEqual(rows[0].account_status, expected, JSON.stringify(payload));
      deepStrictEqual(noticesOf(calls).map((n) => n.title), titles, JSON.stringify(payload));
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
    // Décision de conception (bascule v2) : événement acquitté, rien à clore ; seul le journal de la fonction garde la trace pour le diagnostic.
    const logged: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
    try {
      strictEqual((await mod.handleRequest(post(URL_OK, replyMail('candidat@exemple.fr')))).status, 200);
    } finally {
      console.log = originalLog;
    }
    strictEqual(calls.filter((c) => c.table === 'sequence_email_tracking').length, 0);
    strictEqual(calls.filter((c) => c.table === 'sequence_enrollments').length, 0);
    strictEqual(writes(calls, 'webhook_event_log', 'delete').length, 0);
    strictEqual(logged.filter((l) => l.includes('[unipile-webhook][mail] Skipping - mailbox linked to no organisation')).length, 1,
      'le cas est journalisé une fois pour le diagnostic');
    strictEqual(calls.filter((c) => c.op !== 'select' && c.table !== 'rpc:record_webhook_event').length, 0, 'aucune écriture hors de la clé de dédoublonnage');
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
