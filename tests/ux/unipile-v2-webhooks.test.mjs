/**
 * Webhooks de l'API v2 du service de connexion LinkedIn.
 *
 * V2_TRIGGER_EVENTS (supabase/functions/_shared/unipile-v2.ts) part tel quel
 * dans `POST /v2/webhooks/endpoints/` : une seule valeur hors de l'enum
 * `trigger_events` et l'endpoint n'est pas créé. L'enum ci-dessous est recopié
 * de @unipile/sdk 2.48.0 (types.gen.d.ts, CreateWebhookEndpointData), relevé le
 * 2026-09-24. À mettre à jour quand le fournisseur publie de nouveaux noms.
 *
 * unipile-webhook remappe ces noms sur ses handlers : chaque alias doit viser
 * un événement inscrit et un `case` existant.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const { code } = transformSync(read('supabase/functions/_shared/unipile-v2.ts'), { loader: 'ts', format: 'esm' });
const { V2_TRIGGER_EVENTS } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const webhook = read('supabase/functions/unipile-webhook/index.ts');

const V2_WEBHOOK_EVENT_ENUM = new Set([
  'account.status.disconnected', 'account.status.running', 'account.status.errored',
  'account.status.degraded', 'account.status.partial', 'account.locked', 'account.unlocked',
  'account.add', 'account.reconnect', 'account.remove',
  'account.initial_sync.running', 'account.initial_sync.failed', 'account.initial_sync.completed',
  'message.new', 'message.update', 'message.delete', 'message.receipt.read', 'message.receipt.delivery',
  'message.reaction.new', 'message.reaction.delete', 'chat.delete', 'chat.update',
  'email.new', 'email.new.bounce', 'email.delete', 'email.draft.new', 'email.draft.delete',
  'email.folder.create', 'email.folder.update', 'email.folder.delete',
  'calendar.create', 'calendar.update', 'calendar.delete',
  'calendar.event.new', 'calendar.event.update', 'calendar.event.delete',
  'tracking.open', 'tracking.click', 'relation.new', 'follower.new',
]);

/** Objet littéral `const NAME: Record<string, string> = { 'a': 'b', ... };` du webhook. */
const literalMap = (name) => {
  const start = webhook.indexOf(`const ${name}: Record<string, string> = {`);
  assert.ok(start >= 0, `${name} introuvable`);
  const body = webhook.slice(start, webhook.indexOf('};', start));
  return Object.fromEntries([...body.matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
};

test('v2 — chaque événement inscrit existe dans l\'enum du fournisseur', () => {
  assert.ok(V2_TRIGGER_EVENTS.length > 0);
  for (const ev of V2_TRIGGER_EVENTS) assert.ok(V2_WEBHOOK_EVENT_ENUM.has(ev), `${ev} refusé par POST /v2/webhooks/endpoints/`);
  assert.equal(new Set(V2_TRIGGER_EVENTS).size, V2_TRIGGER_EVENTS.length, 'doublon dans V2_TRIGGER_EVENTS');
});

test('v2 — les noms retirés par le fournisseur ne reviennent pas', () => {
  for (const ev of ['account.status.paused', 'relation.request.accept']) {
    assert.ok(!V2_TRIGGER_EVENTS.includes(ev), ev);
    assert.doesNotMatch(webhook, new RegExp(`'${ev.replace(/\./g, '\\.')}'`), ev);
  }
});

test('v2 — les statuts de compte sont tous inscrits', () => {
  for (const ev of ['account.status.running', 'account.status.degraded', 'account.status.partial',
    'account.status.disconnected', 'account.status.errored', 'account.locked', 'account.unlocked']) {
    assert.ok(V2_TRIGGER_EVENTS.includes(ev), ev);
  }
});

test('v2 — chaque alias part d\'un événement inscrit et arrive sur un case du webhook', () => {
  const aliases = literalMap('V2_EVENT_ALIASES');
  assert.ok(Object.keys(aliases).length > 0);
  for (const [v2, target] of Object.entries(aliases)) {
    assert.ok(V2_TRIGGER_EVENTS.includes(v2), `${v2} n'est pas inscrit`);
    assert.match(webhook, new RegExp(`case '${target}':`), `${v2} → ${target} sans case`);
  }
});

test('v2 — le statut porté par le nom de l\'événement fait foi', () => {
  const statuses = literalMap('V2_STATUS_BY_EVENT');
  assert.deepEqual(statuses, {
    'account.status.running': 'OK',
    'account.status.degraded': 'DEGRADED',
    'account.status.partial': 'PARTIAL',
  });
  // Pas de `payload.status || …` : un 'running' du payload bloquerait les envois (garde !== 'OK').
  assert.match(webhook, /if \(V2_STATUS_BY_EVENT\[v2OriginEvent\]\) payload\.status = V2_STATUS_BY_EVENT\[v2OriginEvent\];/);
  // La clé de dédoublonnage garde le nom v2 d'origine (running, degraded et partial partagent un alias).
  assert.match(webhook, /\$\{v2OriginEvent \|\| payload\.event\}/);
});

/** Filtre PostgREST `.or('a,b')` réduit aux opérateurs utilisés ici : is.null, eq.X, in.(…), not.in.(…). */
const matchesOr = (filter, status) => filter.split(/,(?![^(]*\))/).some((clause) => {
  const m = clause.match(/^account_status\.(not\.)?(is|eq|in)\.(.+)$/);
  assert.ok(m, `clause non gérée : ${clause}`);
  const [, not, op, arg] = m;
  let hit;
  if (op === 'is') hit = arg === 'null' ? status === null : false;
  else if (op === 'eq') hit = status === arg;
  else hit = status !== null && arg.replace(/^\(|\)$/g, '').split(',').includes(status);
  // SQL : NOT (NULL IN (…)) reste NULL, donc faux
  return not ? (status !== null && !hit) : hit;
});

test('v2 — verrouillage puis déverrouillage rend exactement le statut d\'avant', () => {
  const start = webhook.indexOf("case 'account_locked':");
  assert.ok(start >= 0, 'case account_locked introuvable');
  const block = webhook.slice(start, webhook.indexOf('\n      default:', start));
  assert.match(block, /case 'account_unlocked':/);
  const lockFilters = [...block.matchAll(/Update\.or\('([^']+)'\)/g)].map((m) => m[1]);
  assert.equal(lockFilters.length, 2, 'garde sur les deux tables');
  assert.equal(new Set(lockFilters).size, 1, 'même garde sur les deux tables');
  assert.equal((block.match(/Update\.eq\('account_status', 'LOCKED'\)/g) || []).length, 2, 'déverrouillage limité à LOCKED');

  const lock = (status) => (matchesOr(lockFilters[0], status) ? 'LOCKED' : status);
  const unlock = (status) => (status === 'LOCKED' ? 'OK' : status);
  for (const status of ['OK', 'CREDENTIALS', 'ERROR', 'PARTIAL', 'DEGRADED', 'CONNECTING', 'STOPPED', 'PERMISSIONS']) {
    assert.equal(unlock(lock(status)), status, `${status} → verrouillé → déverrouillé`);
  }
  assert.equal(lock('OK'), 'LOCKED', 'un compte actif est bien bloqué');
  assert.equal(lock(null), 'LOCKED', 'une liaison sans statut est bien bloquée');
});

test('v2 — dédoublonnage : identifiant evt_ retenu seulement s\'il en a la forme', () => {
  assert.match(webhook, /v\.startsWith\('evt_'\)/);
  assert.match(webhook, /v2OriginEvent && v2EventId \? `\$\{payload\.account_id \|\| 'no-acc'\}:\$\{v2OriginEvent\}:\$\{v2EventId\}`/);
});
