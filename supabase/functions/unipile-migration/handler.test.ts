// Fonction unipile-migration : porte, actions, refus, ce qui ne sort jamais.
// Client de base et port du prestataire sont des faux : aucun réseau.
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-migration/handler.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { V2_TRIGGER_EVENTS } from '../_shared/unipile/index.ts';
import { APPLY_BUDGET_MS, handleRequest, skippedColumns, usageNotes, type HandlerDeps, type ProviderPort } from './handler.ts';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BATCH = '33333333-3333-4333-8333-333333333333';
const PROJECT = 'https://project.supabase.co';
const RECEIVER = `${PROJECT}/functions/v1/unipile-webhook`;

// Valeurs secrètes de test : elles ne doivent jamais apparaître dans une réponse.
const SECRET_KEY = 'sk-v2-secret-value-1234';
const SECRET_TOKEN = 'whtok-secret-value-5678';
const SECRET_LEGACY = 'legacy-dsn-secret-9999';

const SERVICE_ACCOUNTS = [
  { id: 'acc_LI1', provider: 'linkedin', name: 'Jean Dupont', metadata: { v1_account_id: 'v1-li-1' } },
  { id: 'acc_LI2', provider: 'linkedin', name: 'Claire Martin', metadata: { v1_account_id: 'v1-li-2' } },
  { id: 'acc_MAIL1', provider: 'outlook', name: 'sophie.bernard@cabinet.fr', metadata: {} },
];

const TABLES = {
  member_linkedin_accounts: [
    { linkedin_account_id: 'v1-li-1', linkedin_account_name: 'Jean Dupont' },
    { linkedin_account_id: 'v1-li-2', linkedin_account_name: 'Claire Martin' },
    { linkedin_account_id: 'v1-li-perdu', linkedin_account_name: 'Paul Perdu' },
  ],
  member_email_accounts: [{ email_account_id: 'v1-mail-1', email_address: 'sophie.bernard@cabinet.fr' }],
  member_whatsapp_accounts: [],
  member_calendar_accounts: [{ account_id: 'v1-mail-1', email_address: 'sophie.bernard@cabinet.fr' }],
};

type Rows = Record<string, Record<string, unknown>[]>;
interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}
type RpcFn = (name: string, args: Record<string, unknown>) => { data?: unknown; error?: Record<string, unknown> | null };

function fakeAdmin(rows: Rows, rpc: RpcFn, failTables: string[] = []) {
  const calls: RpcCall[] = [];
  const reads: string[] = [];
  const admin = {
    from(table: string) {
      reads.push(table);
      let range: [number, number] | null = null;
      const builder = {
        select() { return builder; },
        range(a: number, b: number) { range = [a, b + 1]; return builder; },
        order() { return builder; },
        limit() { return builder; },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          const all = rows[table] ?? [];
          const result = failTables.includes(table)
            ? { data: null, error: { code: 'XX000', message: 'boom with secret' } }
            : { data: range ? all.slice(range[0], range[1]) : all, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve(rpc(name, args));
    },
  };
  return { admin, calls, reads };
}

const okRpc: RpcFn = (name) => {
  if (name === 'provider_account_id_usage') {
    return { data: [
      { table_name: 'sequence_enrollments', column_name: 'account_id', rows_holding: 12, status: 'remap' },
      { table_name: 'member_linkedin_accounts', column_name: 'linkedin_account_id', rows_holding: 1, status: 'remap' },
      { table_name: 'sourcing_agents', column_name: 'account_id', rows_holding: 1, status: 'remap' },
      { table_name: 'webhook_event_log', column_name: 'account_id', rows_holding: 40, status: 'report_only' },
      { table_name: 'inmail_queue', column_name: 'account_id', rows_holding: 0, status: 'remap' },
    ], error: null };
  }
  if (name === 'provider_account_id_orphans') {
    return { data: [
      { table_name: 'linkedin_action_log', column_name: 'account_id', value: 'v1-gone-account-0042', rows_holding: 5 },
      { table_name: 'inmail_queue', column_name: 'account_id', value: 'v1-gone-account-0042', rows_holding: 2 },
    ], error: null };
  }
  if (name === 'remap_provider_account_id') return { data: { total_rows: 7 }, error: null };
  if (name === 'rollback_provider_account_id_remap') {
    return { data: {
      pairs: 2, restored_rows: 9, moved_rows: 1, still_new_rows: 3, still_new: [{ table: 'linkedin_action_log', column: 'account_id', rows: 3 }],
      columns: [{ table: 'inmail_queue', column: 'account_id', restored: 0, moved: 1, status: 'restored', old_id: 'x' }],
    }, error: null };
  }
  return { data: null, error: null };
};

const baseEnv: Record<string, string> = {
  SUPABASE_URL: PROJECT,
  UNIPILE_V2_API_KEY: SECRET_KEY,
  UNIPILE_V2_WEBHOOK_TOKEN: SECRET_TOKEN,
  UNIPILE_HOSTED_DOMAIN: 'connexion.konekt.fr',
  KONEKT_PLATFORM_ADMIN_USER_IDS: ADMIN,
};

function provider(overrides: Partial<ProviderPort> = {}): ProviderPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listAccounts: overrides.listAccounts ?? (() => { calls.push('accounts'); return Promise.resolve({ items: SERVICE_ACCOUNTS, truncated: false }); }),
    listEndpoints: overrides.listEndpoints ?? (() => {
      calls.push('endpoints');
      return Promise.resolve({ items: [{ url: RECEIVER, enabled: true, trigger_events: [...V2_TRIGGER_EVENTS] }], truncated: false });
    }),
  };
}

function setup(opts: {
  env?: Record<string, string | undefined>;
  user?: string | null;
  rows?: Rows;
  rpc?: RpcFn;
  provider?: ProviderPort;
  failTables?: string[];
  now?: () => number;
} = {}) {
  const env = { ...baseEnv, ...(opts.env ?? {}) };
  const { admin, calls, reads } = fakeAdmin((opts.rows ?? TABLES) as Rows, opts.rpc ?? okRpc, opts.failTables);
  const prov = opts.provider ?? provider();
  const user = opts.user === undefined ? ADMIN : opts.user;
  const deps: HandlerDeps = {
    authenticate: () => Promise.resolve({ userId: user, method: user ? 'jwt' : 'service_role' }),
    createAdmin: () => admin,
    provider: prov,
    env: (name) => env[name],
    now: opts.now ?? (() => 1_700_000_000_000),
    newBatchId: () => BATCH,
  };
  return { deps, calls, reads, prov: prov as ProviderPort & { calls?: string[] } };
}

async function call(deps: HandlerDeps, body: unknown): Promise<{ status: number; json: Record<string, any>; text: string }> {
  const req = new Request('https://x.test/functions/v1/unipile-migration', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: JSON.stringify(body),
  });
  const res = await handleRequest(req, deps);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {}, text };
}

/** Empreinte de la simulation courante, comme la page la renvoie à la conversion. */
async function fingerprintOf(deps: HandlerDeps): Promise<string> {
  const preview = await quiet(() => call(deps, { action: 'remap_preview' }));
  return preview.json.plan_fingerprint as string;
}

/** Conversion précédée de sa simulation (même plan), comme la page. */
async function applyWith(deps: HandlerDeps, extra: Record<string, unknown> = {}) {
  const plan_fingerprint = await fingerprintOf(deps);
  return quiet(() => call(deps, { action: 'remap_apply', confirm: 'BASCULER', plan_fingerprint, ...extra }));
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const [e, i] = [console.error, console.info];
  console.error = () => {};
  console.info = () => {};
  try { return await fn(); } finally { console.error = e; console.info = i; }
};

function assertNoLeak(text: string) {
  for (const secret of [SECRET_KEY, SECRET_TOKEN, SECRET_LEGACY]) ok(!text.includes(secret), `secret rendu : ${secret}`);
  ok(!/unipile/i.test(text), 'nom de prestataire rendu');
  ok(!text.includes('sophie.bernard@cabinet.fr'), 'adresse entière rendue');
  ok(!text.includes('Jean Dupont') && !text.includes('Paul Perdu'), 'nom entier rendu');
  ok(!/\+33\d/.test(text), 'numéro rendu');
  ok(!text.includes('v2_token'), 'jeton de livraison rendu');
  // Aucun identifiant de compte entier, ancien ou nouveau : seulement leur fin.
  for (const id of ['v1-li-1', 'v1-li-2', 'v1-li-perdu', 'v1-mail-1', 'acc_LI1', 'acc_LI2', 'acc_MAIL1', 'v1-gone-account-0042']) {
    ok(!text.includes(id), `identifiant entier rendu : ${id}`);
  }
}

// ---------------------------------------------------------------------------
// Porte
// ---------------------------------------------------------------------------

Deno.test('porte : liste absente = 403 neutre, sans lire le corps, la base ni le service', async () => {
  const s = setup({ env: { KONEKT_PLATFORM_ADMIN_USER_IDS: undefined } });
  const r = await call(s.deps, { action: 'readiness' });
  strictEqual(r.status, 403);
  strictEqual(r.json.error_code, 'admin_only');
  strictEqual(r.json.success, false);
  deepStrictEqual(s.calls, []);
  deepStrictEqual(s.reads, []);
  deepStrictEqual((s.prov as { calls: string[] }).calls, []);
});

Deno.test('porte : utilisateur non listé, appel sans utilisateur (clé de service) = 403', async () => {
  for (const user of [OTHER, null]) {
    const s = setup({ user });
    const r = await call(s.deps, { action: 'remap_apply', confirm: 'BASCULER' });
    strictEqual(r.status, 403, String(user));
    strictEqual(s.calls.length, 0);
    strictEqual(s.reads.length, 0);
  }
});

Deno.test('porte : le refus d\'authentification de requireAuth passe tel quel', async () => {
  const s = setup();
  s.deps.authenticate = () => Promise.reject(new Response('{"error":"Unauthorized"}', { status: 401 }));
  const r = await call(s.deps, { action: 'readiness' });
  strictEqual(r.status, 401);
});

Deno.test('OPTIONS : réponse CORS sans authentification', async () => {
  const s = setup();
  s.deps.authenticate = () => Promise.reject(new Error('ne doit pas être appelé'));
  const res = await handleRequest(new Request('https://x.test/', { method: 'OPTIONS' }), s.deps);
  strictEqual(res.status, 200);
});

Deno.test('CORS : liste d\'origines autorisées, jamais le joker, y compris sur un refus', async () => {
  const s = setup();
  const send = async (origin: string, body: unknown = { action: 'access' }, deps: HandlerDeps = s.deps) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', authorization: 'Bearer t' };
    if (origin) headers.origin = origin;
    return handleRequest(new Request('https://x.test/functions/v1/unipile-migration', { method: 'POST', headers, body: JSON.stringify(body) }), deps);
  };
  const allowed = await send('https://konekt-app-navy.vercel.app');
  strictEqual(allowed.headers.get('access-control-allow-origin'), 'https://konekt-app-navy.vercel.app');
  const evil = await send('https://evil.example');
  strictEqual(evil.headers.get('access-control-allow-origin'), null, 'origine inconnue : pas d\'autorisation');
  strictEqual(evil.status, 200, 'le serveur répond, c\'est le navigateur qui bloque');
  // Un refus (porte fermée) porte les mêmes en-têtes.
  const denied = setup({ user: OTHER });
  const refused = await send('https://konekt-app-navy.vercel.app', { action: 'access' }, denied.deps);
  strictEqual(refused.status, 403);
  strictEqual(refused.headers.get('access-control-allow-origin'), 'https://konekt-app-navy.vercel.app');
  strictEqual(refused.headers.get('content-type'), 'application/json');
  // Préflight.
  const pre = await handleRequest(new Request('https://x.test/', { method: 'OPTIONS', headers: { origin: 'https://konekt-app-navy.vercel.app' } }), s.deps);
  strictEqual(pre.status, 200);
  strictEqual(pre.headers.get('access-control-allow-origin'), 'https://konekt-app-navy.vercel.app');
  ok((pre.headers.get('access-control-allow-headers') ?? '').includes('authorization'));
});

Deno.test('lecture des comptes de la base : ordre stable sur la clé primaire, table trop longue = lecture en échec', async () => {
  // Pagination : un tri par id est demandé à chaque page.
  const orders: string[] = [];
  const s = setup();
  const original = s.deps.createAdmin;
  s.deps.createAdmin = () => {
    const admin = original();
    const from = admin.from.bind(admin);
    admin.from = (table: string) => {
      const builder = from(table);
      const order = builder.order.bind(builder);
      builder.order = (column: string, opts?: unknown) => { orders.push(`${table}:${column}`); return order(column, opts); };
      return builder;
    };
    return admin;
  };
  await quiet(() => call(s.deps, { action: 'remap_preview' }));
  for (const table of ['member_linkedin_accounts', 'member_email_accounts', 'member_whatsapp_accounts', 'member_calendar_accounts']) {
    ok(orders.includes(`${table}:id`), `${table} sans tri`);
  }
  // 100 000 lignes ou plus : le plan serait incomplet, la lecture est refusée.
  const many = Array.from({ length: 100_000 }, (_, i) => ({ linkedin_account_id: `v1-many-${i}`, linkedin_account_name: null }));
  const big = setup({ rows: { ...TABLES, member_linkedin_accounts: many } as Rows });
  const r = await quiet(() => call(big.deps, { action: 'remap_preview' }));
  strictEqual(r.status, 500);
  strictEqual(r.json.error_code, 'database_unavailable');
  const apply = await quiet(() => call(big.deps, { action: 'remap_apply', confirm: 'BASCULER', allow_unmapped: true, plan_fingerprint: 'x' }));
  strictEqual(apply.status, 500);
  strictEqual(big.calls.filter((c) => c.name === 'remap_provider_account_id').length, 0);
});

Deno.test('access : administrateur = succès sans lecture ; autre utilisateur = 403', async () => {
  const s = setup();
  const r = await call(s.deps, { action: 'access' });
  strictEqual(r.status, 200);
  deepStrictEqual(r.json, { success: true });
  deepStrictEqual(s.reads, []);
  deepStrictEqual(s.calls, []);
  deepStrictEqual((s.prov as { calls: string[] }).calls, []);
  const denied = setup({ user: OTHER });
  const d = await call(denied.deps, { action: 'access' });
  strictEqual(d.status, 403);
  strictEqual(d.json.error_code, 'admin_only');
});

Deno.test('action inconnue ou corps invalide : 400', async () => {
  const s = setup();
  strictEqual((await call(s.deps, { action: 'drop_everything' })).status, 400);
  strictEqual((await call(s.deps, {})).status, 400);
  const bad = await handleRequest(new Request('https://x.test/', { method: 'POST', body: '{pas du json' }), s.deps);
  strictEqual(bad.status, 400);
});

// ---------------------------------------------------------------------------
// readiness
// ---------------------------------------------------------------------------

Deno.test('readiness : dix contrôles, secrets en booléens, rien de sensible dans la réponse', async () => {
  const s = setup({ env: { UNIPILE_API_KEY: SECRET_LEGACY, UNIPILE_DSN: 'api1.example.test' } });
  const r = await quiet(() => call(s.deps, { action: 'readiness' }));
  strictEqual(r.status, 200);
  strictEqual(r.json.success, true);
  strictEqual(r.json.checks.length, 10);
  const byId = Object.fromEntries(r.json.checks.map((c: { id: string }) => [c.id, c]));
  strictEqual(byId.api_key.status, 'ok');
  strictEqual(byId.service_reachable.status, 'ok');
  strictEqual(byId.hosted_domain.status, 'ok');
  strictEqual(byId.webhook_endpoint.status, 'ok');
  strictEqual(byId.webhook_token.status, 'ok');
  strictEqual(byId.admin_list.status, 'ok');
  strictEqual(byId.legacy_secrets.status, 'warn');
  strictEqual(byId.remap_installed.status, 'ok');
  strictEqual(byId.accounts_mapping.status, 'warn');
  strictEqual(byId.accounts_mapping.data.counts.all.total, 4);
  strictEqual(byId.accounts_mapping.data.counts.all.unmapped, 1);
  deepStrictEqual(byId.accounts_mapping.data.unmapped.map((u: { label: string }) => u.label), ['P*** P***']);
  strictEqual(r.json.summary.ko, 0);
  strictEqual(r.json.summary.ready, true);
  assertNoLeak(r.text);
  ok(!r.text.includes(RECEIVER), 'adresse du récepteur non rendue');
});

Deno.test('readiness : clé absente, aucun appel au service, ko partout où il le faut', async () => {
  const s = setup({ env: { UNIPILE_V2_API_KEY: undefined, UNIPILE_V2_WEBHOOK_TOKEN: undefined } });
  const r = await quiet(() => call(s.deps, { action: 'readiness' }));
  strictEqual(r.status, 200);
  deepStrictEqual((s.prov as { calls: string[] }).calls, [], 'aucun appel au service sans clé');
  const byId = Object.fromEntries(r.json.checks.map((c: { id: string }) => [c.id, c]));
  strictEqual(byId.api_key.status, 'ko');
  strictEqual(byId.service_reachable.status, 'ko');
  strictEqual(byId.webhook_endpoint.status, 'ko');
  strictEqual(byId.webhook_token.status, 'ko');
  strictEqual(r.json.summary.ready, false);
  assertNoLeak(r.text);
});

Deno.test('readiness : le service lève une erreur = ko, sans texte du prestataire', async () => {
  const s = setup({
    provider: provider({
      listAccounts: () => Promise.reject(new Error('Unipile 500 internal secret-detail')),
    }),
  });
  const r = await quiet(() => call(s.deps, { action: 'readiness' }));
  strictEqual(r.status, 200);
  const byId = Object.fromEntries(r.json.checks.map((c: { id: string }) => [c.id, c]));
  strictEqual(byId.service_reachable.status, 'ko');
  strictEqual(byId.webhook_endpoint.status, 'ko');
  ok(!r.text.includes('secret-detail'));
  assertNoLeak(r.text);
});

Deno.test('readiness : notifications d\'un autre projet ignorées, doublon signalé', async () => {
  const other = { url: 'https://autre.supabase.co/functions/v1/unipile-webhook', enabled: true, trigger_events: [] as string[] };
  const mine = { url: RECEIVER, enabled: true, trigger_events: [...V2_TRIGGER_EVENTS] };
  const s = setup({ provider: provider({ listEndpoints: () => Promise.resolve({ items: [other, mine, { ...mine }], truncated: false }) }) });
  const r = await quiet(() => call(s.deps, { action: 'readiness' }));
  const endpoint = r.json.checks.find((c: { id: string }) => c.id === 'webhook_endpoint');
  strictEqual(endpoint.status, 'warn');
  strictEqual(endpoint.data.endpoints, 2);
  ok(!r.text.includes('autre.supabase.co'));
});

Deno.test('readiness : base illisible ou migration absente, signalées sans planter', async () => {
  const s = setup({ failTables: ['member_whatsapp_accounts'], rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'no function' } }) });
  const r = await quiet(() => call(s.deps, { action: 'readiness' }));
  strictEqual(r.status, 200);
  const byId = Object.fromEntries(r.json.checks.map((c: { id: string }) => [c.id, c]));
  strictEqual(byId.accounts_mapping.status, 'ko');
  strictEqual(byId.remap_installed.status, 'ko');
  ok(!r.text.includes('boom with secret'));
});

// ---------------------------------------------------------------------------
// remap_preview
// ---------------------------------------------------------------------------

Deno.test('remap_preview : paires, effectifs par table, notes, libellés masqués', async () => {
  const rows: Rows = { ...TABLES, account_id_remap: [
    { batch_id: BATCH, kind: 'linkedin', applied_at: '2026-10-10T10:00:00Z', rolled_back_at: null },
    { batch_id: BATCH, kind: 'email', applied_at: '2026-10-10T10:00:01Z', rolled_back_at: null },
  ] };
  const s = setup({ rows });
  const r = await quiet(() => call(s.deps, { action: 'remap_preview' }));
  strictEqual(r.status, 200);
  strictEqual(r.json.success, true);
  strictEqual(r.json.pairs.length, 3);
  const pair = r.json.pairs.find((p: { label: string }) => p.label === 'J*** D***');
  strictEqual(pair.ref, '…li-1');
  strictEqual('old_id' in pair || 'new_id' in pair, false, 'ni ancien ni nouvel identifiant entier');
  strictEqual(pair.kind, 'linkedin');
  strictEqual(pair.via, 'v1_account_id');
  strictEqual(pair.label, 'J*** D***');
  strictEqual(pair.total_rows, 14, '12 inscriptions + 1 liaison + 1 agent ; le journal n\'est pas compté');
  strictEqual(pair.usage.length, 4, 'les colonnes à zéro ne sont pas rendues');
  ok(pair.notes.some((n: string) => n.includes('recalibrer')));
  ok(pair.notes.some((n: string) => n.includes('journal')));
  const mail = r.json.pairs.find((p: { kind: string }) => p.kind === 'email');
  strictEqual(mail.via, 'email');
  strictEqual(r.json.unmapped.length, 1);
  strictEqual(r.json.unmapped[0].label, 'P*** P***');
  strictEqual(r.json.previous_batches.length, 1);
  strictEqual(r.json.previous_batches[0].pairs, 2);
  strictEqual(r.json.previous_batches[0].rolled_back, false);
  const usageCalls = s.calls.filter((c) => c.name === 'provider_account_id_usage');
  strictEqual(usageCalls.length, 3, 'un relevé par paire, aucun pour les comptes sans correspondance');
  strictEqual(s.calls.filter((c) => c.name === 'remap_provider_account_id').length, 0, 'aucune écriture');
  strictEqual(typeof r.json.plan_fingerprint, 'string');
  ok(/^[0-9a-f]{64}$/.test(r.json.plan_fingerprint), 'empreinte SHA-256');
  assertNoLeak(r.text);
});

Deno.test('remap_preview : identifiants sans compte relié rendus par table, colonne et fin d\'identifiant', async () => {
  const s = setup();
  const r = await quiet(() => call(s.deps, { action: 'remap_preview' }));
  strictEqual(r.json.orphans_error, false);
  strictEqual(r.json.orphans_truncated, false);
  deepStrictEqual(r.json.orphans, [
    { table: 'linkedin_action_log', column: 'account_id', ref: '…0042', rows: 5 },
    { table: 'inmail_queue', column: 'account_id', ref: '…0042', rows: 2 },
  ]);
  strictEqual(s.calls.filter((c) => c.name === 'provider_account_id_orphans').length, 1);
  assertNoLeak(r.text);
  // Relevé en échec (fonction absente, erreur) : annoncé, la simulation reste rendue.
  const failing = setup({ rpc: (name, args) => (name === 'provider_account_id_orphans' ? { data: null, error: { code: 'XX000', message: 'boom v1-gone-account-0042' } } : okRpc(name, args)) });
  const f = await quiet(() => call(failing.deps, { action: 'remap_preview' }));
  strictEqual(f.status, 200);
  strictEqual(f.json.orphans_error, true);
  deepStrictEqual(f.json.orphans, []);
  ok(!f.text.includes('boom'));
  // Colonne pleine : la liste est dite tronquée.
  const full = setup({ rpc: (name, args) => (name === 'provider_account_id_orphans'
    ? { data: Array.from({ length: 50 }, (_, i) => ({ table_name: 'inmail_queue', column_name: 'account_id', value: `gone-${String(i).padStart(4, '0')}`, rows_holding: 1 })), error: null }
    : okRpc(name, args)) });
  const t = await quiet(() => call(full.deps, { action: 'remap_preview' }));
  strictEqual(t.json.orphans_truncated, true);
});

Deno.test('remap_preview : clé absente 409, service muet 503, base illisible 500', async () => {
  let r = await quiet(() => call(setup({ env: { UNIPILE_V2_API_KEY: undefined } }).deps, { action: 'remap_preview' }));
  strictEqual(r.status, 409);
  strictEqual(r.json.error_code, 'key_missing');
  r = await quiet(() => call(setup({ provider: provider({ listAccounts: () => Promise.reject(new Error('down')) }) }).deps, { action: 'remap_preview' }));
  strictEqual(r.status, 503);
  r = await quiet(() => call(setup({ failTables: ['member_linkedin_accounts'] }).deps, { action: 'remap_preview' }));
  strictEqual(r.status, 500);
  strictEqual(r.json.error_code, 'database_unavailable');
});

Deno.test('usageNotes : agent, propositions, journaux, colonne sans clé', () => {
  const notes = usageNotes([
    { table: 'sourcing_agents', column: 'account_id', rows: 1, status: 'remap' },
    { table: 'agent_tool_executions', column: 'params', rows: 2, status: 'report_only' },
    { table: 'webhook_event_log', column: 'account_id', rows: 5, status: 'report_only' },
    { table: 'chat_categories', column: 'account_id', rows: 3, status: 'no_primary_key' },
  ]);
  strictEqual(notes.length, 4);
  deepStrictEqual(usageNotes([{ table: 'inmail_queue', column: 'account_id', rows: 9, status: 'remap' }]), []);
  // Colonne d'un type inattendu : ses lignes sont dites non converties, jamais passées sous silence.
  const unusual = usageNotes([{ table: 'nurturing_opportunities', column: 'linkedin_account_id', rows: 2, status: 'unsupported_type' }]);
  strictEqual(unusual.length, 1);
  ok(unusual[0].includes('2 lignes') && unusual[0].includes('pas convertie'));
  deepStrictEqual(usageNotes([{ table: 'sequence_steps', column: 'sender_id', rows: 0, status: 'unsupported_type' }]), []);
});

// ---------------------------------------------------------------------------
// remap_apply
// ---------------------------------------------------------------------------

Deno.test('remap_apply : sans la confirmation exacte, rien n\'est lu ni écrit', async () => {
  for (const confirm of [undefined, 'bascule', 'BASCULER ', true]) {
    const s = setup();
    const r = await quiet(() => call(s.deps, { action: 'remap_apply', confirm, allow_unmapped: true }));
    strictEqual(r.status, 400);
    strictEqual(r.json.error_code, 'confirmation_required');
    strictEqual(s.calls.length, 0);
    strictEqual(s.reads.length, 0);
    deepStrictEqual((s.prov as { calls: string[] }).calls, []);
  }
});

Deno.test('remap_apply : clé absente, service muet, liste tronquée : refusés sans écriture', async () => {
  let s = setup({ env: { UNIPILE_V2_API_KEY: undefined } });
  let r = await quiet(() => call(s.deps, { action: 'remap_apply', confirm: 'BASCULER', allow_unmapped: true }));
  strictEqual(r.status, 409);
  strictEqual(r.json.error_code, 'key_missing');
  strictEqual(s.calls.filter((c) => c.name === 'remap_provider_account_id').length, 0);

  s = setup({ provider: provider({ listAccounts: () => Promise.reject(new Error('down')) }) });
  r = await quiet(() => call(s.deps, { action: 'remap_apply', confirm: 'BASCULER', allow_unmapped: true }));
  strictEqual(r.status, 503);
  strictEqual(r.json.error_code, 'service_unreachable');
  strictEqual(s.calls.filter((c) => c.name === 'remap_provider_account_id').length, 0);

  s = setup({ provider: provider({ listAccounts: () => Promise.resolve({ items: SERVICE_ACCOUNTS, truncated: true }) }) });
  r = await quiet(() => call(s.deps, { action: 'remap_apply', confirm: 'BASCULER', allow_unmapped: true }));
  strictEqual(r.status, 409);
  strictEqual(r.json.error_code, 'list_truncated');
  strictEqual(s.calls.filter((c) => c.name === 'remap_provider_account_id').length, 0);
});

Deno.test('remap_apply : comptes sans correspondance refusés sans allow_unmapped', async () => {
  const s = setup();
  const r = await quiet(() => call(s.deps, { action: 'remap_apply', confirm: 'BASCULER' }));
  strictEqual(r.status, 409);
  strictEqual(r.json.error_code, 'unmapped_accounts');
  strictEqual(s.calls.filter((c) => c.name === 'remap_provider_account_id').length, 0);
  assertNoLeak(r.text);
});

Deno.test('remap_apply : migration absente ou non vérifiable = 409, aucune écriture', async () => {
  const s = setup({ rpc: (name) => (name === 'provider_account_id_columns' ? { data: null, error: { code: 'PGRST202' } } : okRpc(name, {})) });
  const r = await quiet(() => call(s.deps, { action: 'remap_apply', confirm: 'BASCULER', allow_unmapped: true }));
  strictEqual(r.status, 409);
  strictEqual(r.json.error_code, 'not_installed');
  strictEqual(s.calls.filter((c) => c.name === 'remap_provider_account_id').length, 0);
});

Deno.test('remap_apply : avec allow_unmapped, une paire par compte, lot unique, utilisateur tracé', async () => {
  const s = setup();
  const r = await applyWith(s.deps, { allow_unmapped: true });
  strictEqual(r.status, 200);
  strictEqual(r.json.success, true);
  strictEqual(r.json.batch_id, BATCH);
  strictEqual(r.json.applied, 3);
  strictEqual(r.json.failed, 0);
  strictEqual(r.json.rows_total, 21);
  strictEqual(r.json.unmapped_left, 1);
  strictEqual(r.json.incomplete, false);
  const writes = s.calls.filter((c) => c.name === 'remap_provider_account_id');
  strictEqual(writes.length, 3);
  deepStrictEqual(writes.map((w) => w.args), [
    { p_batch: BATCH, p_old: 'v1-mail-1', p_new: 'acc_MAIL1', p_kind: 'email', p_applied_by: ADMIN },
    { p_batch: BATCH, p_old: 'v1-li-1', p_new: 'acc_LI1', p_kind: 'linkedin', p_applied_by: ADMIN },
    { p_batch: BATCH, p_old: 'v1-li-2', p_new: 'acc_LI2', p_kind: 'linkedin', p_applied_by: ADMIN },
  ]);
  ok(!writes.some((w) => w.args.p_old === 'v1-li-perdu'), 'le compte sans correspondance n\'est pas touché');
  strictEqual(r.json.skipped_rows, 0);
  // Les résultats disent le type, le libellé masqué et la fin de l'identifiant : jamais l'identifiant entier.
  strictEqual(r.json.results.length, 3);
  for (const result of r.json.results) {
    strictEqual('old_id' in result || 'new_id' in result, false);
    ok(/^…/.test(result.ref));
  }
  assertNoLeak(r.text);
});

Deno.test('remap_apply : la simulation périmée ou absente est refusée sans écriture (409 plan_changed)', async () => {
  // Sans empreinte, ou avec une empreinte qui n'est pas celle du plan : aucune écriture.
  for (const plan_fingerprint of [undefined, '', 'abc', 42, '0'.repeat(64)]) {
    const s = setup();
    const r = await quiet(() => call(s.deps, { action: 'remap_apply', confirm: 'BASCULER', allow_unmapped: true, plan_fingerprint }));
    strictEqual(r.status, 409, String(plan_fingerprint));
    strictEqual(r.json.error_code, 'plan_changed');
    strictEqual(s.calls.filter((c) => c.name === 'remap_provider_account_id').length, 0);
  }
  // Un compte relié entre la simulation et la conversion change l'empreinte.
  const rows = structuredClone(TABLES) as Rows;
  const s = setup({ rows });
  const plan_fingerprint = await fingerprintOf(s.deps);
  rows.member_linkedin_accounts.push({ linkedin_account_id: 'v1-li-nouveau', linkedin_account_name: 'Nina Nouvelle' });
  let r = await quiet(() => call(s.deps, { action: 'remap_apply', confirm: 'BASCULER', allow_unmapped: true, plan_fingerprint }));
  strictEqual(r.status, 409);
  strictEqual(r.json.error_code, 'plan_changed');
  strictEqual(s.calls.filter((c) => c.name === 'remap_provider_account_id').length, 0);
  // Une correspondance qui change côté service aussi.
  const accounts = [...SERVICE_ACCOUNTS];
  const s2 = setup({ provider: provider({ listAccounts: () => Promise.resolve({ items: accounts, truncated: false }) }) });
  const fp2 = await fingerprintOf(s2.deps);
  accounts[1] = { id: 'acc_LI2_AUTRE', provider: 'linkedin', name: 'Claire Martin', metadata: { v1_account_id: 'v1-li-2' } };
  r = await quiet(() => call(s2.deps, { action: 'remap_apply', confirm: 'BASCULER', allow_unmapped: true, plan_fingerprint: fp2 }));
  strictEqual(r.status, 409);
  strictEqual(r.json.error_code, 'plan_changed');
  strictEqual(s2.calls.filter((c) => c.name === 'remap_provider_account_id').length, 0);
});

Deno.test('remap_apply : une paire en échec ne bloque pas les autres, erreur réduite à un code', async () => {
  const rpc: RpcFn = (name, args) => {
    if (name === 'remap_provider_account_id' && args.p_old === 'v1-li-1') {
      return { data: null, error: { code: '23505', message: 'duplicate key acc_LI1 secret', hint: 'REMAP_CONFLICT', details: 'member_linkedin_accounts' } };
    }
    return okRpc(name, args);
  };
  const s = setup({ rpc });
  const r = await applyWith(s.deps, { allow_unmapped: true });
  strictEqual(r.status, 200);
  strictEqual(r.json.success, false);
  strictEqual(r.json.error_code, 'partial_failure');
  strictEqual(r.json.applied, 2);
  strictEqual(r.json.failed, 1);
  const failed = r.json.results.find((x: { status: string }) => x.status === 'failed');
  strictEqual(failed.ref, '…li-1');
  strictEqual(failed.label, 'J*** D***');
  strictEqual('old_id' in failed || 'new_id' in failed, false);
  strictEqual(failed.error_code, 'conflict');
  ok(!r.text.includes('duplicate key'));
  ok(!r.text.includes('secret'));
  strictEqual(s.calls.filter((c) => c.name === 'remap_provider_account_id').length, 3);
});

Deno.test('remap_apply : budget de temps épuisé = arrêt propre, paires restantes comptées', async () => {
  let t = 0;
  const s = setup({ now: () => (t += APPLY_BUDGET_MS / 2 + 1) });
  const r = await applyWith(s.deps, { allow_unmapped: true });
  strictEqual(r.status, 200);
  strictEqual(r.json.incomplete, true);
  strictEqual(r.json.success, false);
  strictEqual(r.json.error_code, 'time_budget');
  ok(r.json.remaining > 0);
  strictEqual(r.json.applied + r.json.remaining, 3);
});

Deno.test('remap_apply : le budget de temps compte aussi les lectures du service et de la base', async () => {
  // Les lectures préalables (liste des comptes du service) prennent 29 s, un compte 2 s : sans le temps des
  // lectures, les trois comptes partiraient (jusqu'à 29 + 6 s de plus que le budget ne le prévoit).
  let t = 1_000;
  const s = setup({
    now: () => t,
    provider: provider({ listAccounts: () => { t += 29_000; return Promise.resolve({ items: SERVICE_ACCOUNTS, truncated: false }); } }),
    rpc: (name, args) => { if (name === 'remap_provider_account_id') t += 2_000; return okRpc(name, args); },
  });
  const r = await applyWith(s.deps, { allow_unmapped: true });
  strictEqual(r.json.incomplete, true);
  strictEqual(r.json.error_code, 'time_budget');
  strictEqual(r.json.applied, 1, 'un compte part, le suivant dépasserait le budget');
  strictEqual(r.json.remaining, 2);
  ok(APPLY_BUDGET_MS <= 30_000, 'marge sous les 55 s du navigateur et les 60 s de la fonction');
});

Deno.test('remap_apply : les colonnes sautées avec des lignes (sans clé, type inattendu) sont rapportées', async () => {
  const rpc: RpcFn = (name, args) => {
    if (name === 'remap_provider_account_id') {
      return { data: { total_rows: 3, columns: [
        { table: 'sequence_enrollments', column: 'account_id', rows: 3, status: 'remapped' },
        { table: 'chat_categories', column: 'account_id', rows: 0, skipped_rows: 4, status: 'no_primary_key' },
        { table: 'nurturing_opportunities', column: 'linkedin_account_id', rows: 0, skipped_rows: 2, status: 'unsupported_type' },
        { table: 'sequence_steps', column: 'sender_id', rows: 0, skipped_rows: 0, status: 'unsupported_type' },
        { table: 'candidate_action_messages', column: 'account_id', rows: 0, skipped_rows: 0, status: 'missing_table' },
      ] }, error: null };
    }
    return okRpc(name, args);
  };
  const s = setup({ rpc });
  const r = await applyWith(s.deps, { allow_unmapped: true });
  strictEqual(r.status, 200);
  strictEqual(r.json.rows_total, 9);
  strictEqual(r.json.skipped_rows, 18, '6 lignes sautées par compte, trois comptes');
  for (const result of r.json.results) {
    deepStrictEqual(result.skipped, [
      { table: 'chat_categories', column: 'account_id', status: 'no_primary_key', rows: 4 },
      { table: 'nurturing_opportunities', column: 'linkedin_account_id', status: 'unsupported_type', rows: 2 },
    ]);
  }
  assertNoLeak(r.text);
});

Deno.test('skippedColumns : seules les colonnes sautées avec des lignes comptent', () => {
  deepStrictEqual(skippedColumns(null), []);
  deepStrictEqual(skippedColumns({ columns: 'x' }), []);
  deepStrictEqual(skippedColumns({ columns: [{ table: 'a', column: 'b', skipped_rows: 0, status: 'unsupported_type' }, { table: 'c', column: 'd', rows: 5, status: 'remapped' }] }), []);
  deepStrictEqual(skippedColumns({ columns: [{ table: 'a', column: 'b', skipped_rows: '3', status: 'no_primary_key' }] }), [{ table: 'a', column: 'b', status: 'no_primary_key', rows: 3 }]);
});

Deno.test('remap_apply : rien à basculer = succès sans lot', async () => {
  const rows: Rows = { ...TABLES, member_linkedin_accounts: [{ linkedin_account_id: 'acc_DEJA', linkedin_account_name: 'x' }], member_email_accounts: [], member_calendar_accounts: [] };
  const s = setup({ rows });
  const r = await quiet(() => call(s.deps, { action: 'remap_apply', confirm: 'BASCULER' }));
  strictEqual(r.status, 200);
  strictEqual(r.json.success, true);
  strictEqual(r.json.batch_id, null);
  strictEqual(r.json.applied, 0);
  strictEqual(s.calls.filter((c) => c.name === 'remap_provider_account_id').length, 0);
});

// ---------------------------------------------------------------------------
// remap_rollback
// ---------------------------------------------------------------------------

Deno.test('remap_rollback : sans le mot ANNULER, rien n\'est appelé (lot valide compris)', async () => {
  const s = setup();
  for (const confirm of [undefined, '', 'annuler', 'ANNULER ', 'BASCULER', true]) {
    const r = await quiet(() => call(s.deps, { action: 'remap_rollback', batch_id: BATCH, confirm }));
    strictEqual(r.status, 400, String(confirm));
    strictEqual(r.json.error_code, 'rollback_confirmation_required');
    ok(r.json.error.includes('ANNULER'));
  }
  strictEqual(s.calls.length, 0);
});

Deno.test('remap_rollback : lot invalide refusé sans appel, lot valide restauré', async () => {
  const s = setup();
  for (const batch_id of [undefined, '', 'pas-un-uuid', 42, "x'; drop table account_id_remap; --"]) {
    const r = await quiet(() => call(s.deps, { action: 'remap_rollback', batch_id, confirm: 'ANNULER' }));
    strictEqual(r.status, 400);
    strictEqual(r.json.error_code, 'validation');
  }
  strictEqual(s.calls.length, 0);
  const r = await quiet(() => call(s.deps, { action: 'remap_rollback', batch_id: BATCH, confirm: 'ANNULER' }));
  strictEqual(r.status, 200);
  strictEqual(r.json.success, true);
  strictEqual(r.json.restored_rows, 9);
  strictEqual(r.json.moved_rows, 1);
  strictEqual(r.json.still_new_rows, 3, 'lignes créées depuis la conversion, restées au nouvel identifiant');
  deepStrictEqual(r.json.still_new, [{ table: 'linkedin_action_log', column: 'account_id', rows: 3 }]);
  deepStrictEqual(s.calls[0], { name: 'rollback_provider_account_id_remap', args: { p_batch: BATCH } });
  assertNoLeak(r.text);
});

Deno.test('remap_rollback : lot inconnu 404, déjà restauré 409, autre refus 500 neutre', async () => {
  const mk = (hint: string, code: string) => setup({ rpc: () => ({ data: null, error: { code, hint, message: 'detail with acc_X secret' } }) });
  let r = await quiet(() => call(mk('REMAP_BATCH_UNKNOWN', 'P0002').deps, { action: 'remap_rollback', batch_id: BATCH, confirm: 'ANNULER' }));
  strictEqual(r.status, 404);
  strictEqual(r.json.error_code, 'batch_unknown');
  r = await quiet(() => call(mk('REMAP_BATCH_ALREADY_ROLLED_BACK', '22023').deps, { action: 'remap_rollback', batch_id: BATCH, confirm: 'ANNULER' }));
  strictEqual(r.status, 409);
  strictEqual(r.json.error_code, 'batch_already_rolled_back');
  r = await quiet(() => call(mk('', 'XX000').deps, { action: 'remap_rollback', batch_id: BATCH, confirm: 'ANNULER' }));
  strictEqual(r.status, 500);
  strictEqual(r.json.error_code, 'database');
  ok(!r.text.includes('acc_X'));
});
