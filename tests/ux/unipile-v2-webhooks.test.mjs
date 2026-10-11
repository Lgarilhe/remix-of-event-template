/**
 * Webhooks de l'API v2 du service de connexion LinkedIn.
 *
 * V2_TRIGGER_EVENTS (supabase/functions/_shared/unipile/webhooks.ts, réexporté par
 * supabase/functions/_shared/unipile-v2.ts) part tel quel dans
 * `POST /v2/webhooks/endpoints/` : une seule valeur hors de l'enum
 * `trigger_events` et l'endpoint n'est pas créé. L'enum ci-dessous est recopié
 * de @unipile/sdk 2.48.0 (types.gen.d.ts, CreateWebhookEndpointData), relevé le
 * 2026-09-24, et confirmé sur la spécification du 2026-10-11 (40 valeurs). À
 * mettre à jour quand le fournisseur publie de nouveaux noms.
 *
 * unipile-webhook remappe ces noms sur ses handlers : chaque alias doit viser
 * un événement inscrit et un `case` existant.
 *
 * Les faits sont gardés à deux endroits : le module partagé (liste, alias,
 * aplatissement, clé de dédoublonnage) et le récepteur (tables locales tant
 * qu'il en garde, `case` des handlers). Tests unitaires du module :
 * supabase/functions/_shared/unipile/webhooks.test.ts (deno test).
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

/** Charge un module TypeScript du dépôt avec ses imports locaux (un seul fichier ESM, sans réseau). */
const load = async (rel) => {
  const { outputFiles } = buildSync({
    entryPoints: [new URL(`../../${rel}`, import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
};

// Ancien chemin d'import (réexport de compatibilité) et module partagé.
const compat = await load('supabase/functions/_shared/unipile-v2.ts');
const shared = await load('supabase/functions/_shared/unipile/webhooks.ts');
const { V2_TRIGGER_EVENTS, flattenV2WebhookEnvelope } = compat;
const { KNOWN_TRIGGER_EVENTS, EVENT_ALIASES, STATUS_BY_EVENT, flattenEnvelope, webhookDedupKey } = shared;

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

/** Le récepteur garde-t-il encore sa table locale `const NAME: Record<string, string> = {...}` ? */
const hasLocalTable = (name) => webhook.includes(`const ${name}: Record<string, string> = {`);

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
  // Le module partagé porte l'énumération complète (40 valeurs) et la liste inscrite en est un sous-ensemble.
  assert.deepEqual([...KNOWN_TRIGGER_EVENTS].sort(), [...V2_WEBHOOK_EVENT_ENUM].sort());
  assert.deepEqual([...shared.V2_TRIGGER_EVENTS], [...V2_TRIGGER_EVENTS], 'le réexport de compatibilité rend la même liste');
});

test('v2 — les événements sans handler ne sont pas inscrits', () => {
  // Les rebonds arrivent déjà comme e-mails entrants (email.new) ; le suivi natif n'est pas utilisé.
  for (const ev of ['email.new.bounce', 'tracking.open', 'tracking.click']) {
    assert.ok(!V2_TRIGGER_EVENTS.includes(ev), ev);
  }
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
  // Table du module partagé : chaque alias part d'un événement inscrit, chaque événement inscrit a un handler.
  assert.ok(Object.keys(EVENT_ALIASES).length > 0);
  for (const v2 of Object.keys(EVENT_ALIASES)) assert.ok(V2_TRIGGER_EVENTS.includes(v2), `${v2} n'est pas inscrit`);
  for (const v2 of V2_TRIGGER_EVENTS) assert.ok(EVENT_ALIASES[v2], `${v2} est inscrit sans handler`);
  if (hasLocalTable('V2_EVENT_ALIASES')) {
    // Le récepteur garde sa propre table : mêmes garanties qu'avant.
    const aliases = literalMap('V2_EVENT_ALIASES');
    assert.ok(Object.keys(aliases).length > 0);
    for (const [v2, target] of Object.entries(aliases)) {
      assert.ok(V2_TRIGGER_EVENTS.includes(v2), `${v2} n'est pas inscrit`);
      assert.match(webhook, new RegExp(`case '${target}':`), `${v2} → ${target} sans case`);
    }
  } else {
    // Le récepteur lit la table partagée : chacune de ses cibles doit avoir un case.
    for (const [v2, target] of Object.entries(EVENT_ALIASES)) {
      assert.match(webhook, new RegExp(`case '${target}':`), `${v2} → ${target} sans case`);
    }
  }
});

test('v2 — account.remove est un compte supprimé, pas une déconnexion récupérable', () => {
  assert.notEqual(EVENT_ALIASES['account.remove'], EVENT_ALIASES['account.status.disconnected']);
  assert.equal(EVENT_ALIASES['account.remove'], 'account_removed');
  assert.equal(EVENT_ALIASES['account.status.disconnected'], 'account_disconnected');
});

test('v2 — message.receipt.read, message.reaction.new et account.initial_sync.* ont chacun leur handler', () => {
  for (const ev of ['message.receipt.read', 'message.reaction.new', 'account.initial_sync.completed', 'account.initial_sync.failed']) {
    assert.ok(V2_TRIGGER_EVENTS.includes(ev), `${ev} inscrit`);
    assert.ok(EVENT_ALIASES[ev] && EVENT_ALIASES[ev] !== ev, `${ev} n'est plus renvoyé vers « événement inconnu »`);
  }
});

test('v2 — le statut porté par le nom de l\'événement fait foi', () => {
  const expected = {
    'account.status.running': 'OK',
    'account.status.degraded': 'DEGRADED',
    'account.status.partial': 'PARTIAL',
  };
  assert.deepEqual({ ...STATUS_BY_EVENT }, expected);
  if (hasLocalTable('V2_STATUS_BY_EVENT')) {
    assert.deepEqual(literalMap('V2_STATUS_BY_EVENT'), expected);
    // Pas de `payload.status || …` : un 'running' du payload bloquerait les envois (garde !== 'OK').
    assert.match(webhook, /if \(V2_STATUS_BY_EVENT\[v2OriginEvent\]\) payload\.status = V2_STATUS_BY_EVENT\[v2OriginEvent\];/);
    // La clé de dédoublonnage garde le nom v2 d'origine (running, degraded et partial partagent un alias).
    assert.match(webhook, /\$\{v2OriginEvent \|\| payload\.event\}/);
  } else {
    assert.match(webhook, /STATUS_BY_EVENT\[/, 'le récepteur lit la table partagée');
  }
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
  assert.equal(lockFilters.length, 3, 'garde sur LinkedIn, e-mail et WhatsApp');
  assert.equal(new Set(lockFilters).size, 1, 'même garde sur les trois canaux');
  assert.equal((block.match(/Update\.eq\('account_status', 'LOCKED'\)/g) || []).length, 3, 'déverrouillage limité à LOCKED');

  const lock = (status) => (matchesOr(lockFilters[0], status) ? 'LOCKED' : status);
  const unlock = (status) => (status === 'LOCKED' ? 'OK' : status);
  for (const status of ['OK', 'CREDENTIALS', 'ERROR', 'PARTIAL', 'DEGRADED', 'CONNECTING', 'STOPPED', 'PERMISSIONS']) {
    assert.equal(unlock(lock(status)), status, `${status} → verrouillé → déverrouillé`);
  }
  assert.equal(lock('OK'), 'LOCKED', 'un compte actif est bien bloqué');
  assert.equal(lock(null), 'LOCKED', 'une liaison sans statut est bien bloquée');
});

test('v2 — dédoublonnage : identifiant evt_ retenu seulement s\'il en a la forme', () => {
  if (/v\.startsWith\('evt_'\)/.test(webhook)) {
    assert.match(webhook, /v2OriginEvent && v2EventId \? `\$\{payload\.account_id \|\| 'no-acc'\}:\$\{v2OriginEvent\}:\$\{v2EventId\}`/);
  } else {
    assert.match(webhook, /webhookDedupKey\(/, 'le récepteur utilise la clé du module partagé');
  }
  // Module partagé : type v2 brut + identifiant evt_, jamais le nom du handler.
  const running = flattenEnvelope({ type: 'account.status.running', id: 'evt_a', account_id: 'acc_1', payload: {} });
  const degraded = flattenEnvelope({ type: 'account.status.degraded', id: 'evt_a', account_id: 'acc_1', payload: {} });
  assert.equal(webhookDedupKey(running), 'unipile:v2:account.status.running:evt_a');
  assert.notEqual(webhookDedupKey(running), webhookDedupKey(degraded));
  assert.equal(webhookDedupKey(flattenEnvelope({ type: 'message.new', id: 'pas-evt', payload: {} })), null);
});

// message.new réel reçu le 2026-09-24 (texte et identité masqués par le fournisseur).
const REAL_MESSAGE_NEW = {
  created_at: '2026-09-24T13:58:19.577Z',
  type: 'message.new',
  hash: 'b8cde60b',
  account_scope_id: null,
  id: 'evt_01m39vbgn3e8p8a3zcnjq98ark',
  account_id: 'acc_01kyex2j0pexzt3v8prstne0ey',
  application_id: 'app_x',
  application_production: true,
  account_name: 'Compte test',
  account_provider: 'linkedin',
  payload: {
    id: 'CLASSIC_2-MSG',
    text: '<scrubbed for privacy>',
    object: 'Message',
    sender: { id: 'ACoAADKm2akB', object: 'User', display_name: '<scrubbed for privacy>' },
    chat_id: 'CLASSIC_2-CHAT',
    is_seen: false,
    is_sender: false,
    sender_id: 'ACoAADKm2akB',
    timestamp: '2026-09-24T13:58:19.184Z',
    attachments: [],
  },
};

test('v2 — enveloppe message.new réelle remise au format des handlers', () => {
  const flat = flattenV2WebhookEnvelope(REAL_MESSAGE_NEW);
  assert.equal(flat.event, 'message.new');
  assert.equal(flat.account_id, 'acc_01kyex2j0pexzt3v8prstne0ey');
  assert.equal(flat.account_type, 'linkedin');
  assert.equal(flat.event_id, 'evt_01m39vbgn3e8p8a3zcnjq98ark');
  assert.equal(flat.message_id, 'CLASSIC_2-MSG');
  assert.equal(flat.data.message.chat_id, 'CLASSIC_2-CHAT');
  assert.equal(flat.data.message.sender_id, 'ACoAADKm2akB');
  assert.equal(flat.data.message.is_sender, false);
  assert.equal(flat.data.chat.id, 'CLASSIC_2-CHAT');
  // Pas de sender + chat_id à la racine : sinon le handler prendrait la forme v1
  // message_received et interrogerait les participants par l'API v1.
  assert.equal(flat.sender, undefined);
  assert.equal(flat.chat_id, undefined);
});

test('v2 — message.new réel : la charge réelle n\'a pas de drapeau d\'événement, le message reste une réponse possible', () => {
  const message = flattenV2WebhookEnvelope(REAL_MESSAGE_NEW).data.message;
  assert.equal(message.is_event, undefined);
  assert.equal(message.is_hidden, undefined);
  assert.equal(message.message_type, undefined);
});

test('v2 — message.new d\'une ligne système ou d\'une invitation garde ses drapeaux (jamais lue comme une réponse)', () => {
  const flat = flattenV2WebhookEnvelope({
    ...REAL_MESSAGE_NEW,
    payload: { ...REAL_MESSAGE_NEW.payload, is_event: true, event_type: 9, is_hidden: true, specifics: { type: 'INVITATION' } },
  });
  assert.equal(flat.data.message.is_event, true);
  assert.equal(flat.data.message.event_type, 9);
  assert.equal(flat.data.message.is_hidden, true);
  assert.equal(flat.data.message.message_type, 'INVITATION');
});

test('v2 — account.status.running sur un compte verrouillé : account_status LOCKED, texte du fournisseur inchangé', () => {
  const locked = flattenV2WebhookEnvelope({
    type: 'account.status.running', id: 'evt_s1', account_id: 'acc_x', payload: { status: 'running', is_locked: true },
  });
  assert.equal(locked.account_status, 'LOCKED');
  assert.equal(locked.status, 'running');
  const free = flattenV2WebhookEnvelope({
    type: 'account.status.running', id: 'evt_s2', account_id: 'acc_x', payload: { status: 'running', is_locked: false },
  });
  assert.equal(free.account_status, 'OK');
});

test('v2 — un corps v1 n\'est pas pris pour une enveloppe v2', () => {
  assert.equal(flattenV2WebhookEnvelope({ event: 'message_received', chat_id: 'c', sender: {} }), null);
  assert.equal(flattenV2WebhookEnvelope({ AccountStatus: { account_id: 'a', message: 'OK' } }), null);
  assert.equal(flattenV2WebhookEnvelope(null), null);
  assert.equal(flattenV2WebhookEnvelope({ type: 'message.new' }), null, 'sans payload');
});

test('v2 — statut de compte : nom d\'événement et fournisseur conservés', () => {
  const flat = flattenV2WebhookEnvelope({
    type: 'account.status.partial', id: 'evt_1', account_id: 'acc_1', account_provider: 'linkedin', payload: { object: 'Account' },
  });
  assert.equal(flat.event, 'account.status.partial');
  assert.equal(flat.account_id, 'acc_1');
  assert.equal(flat.account_type, 'linkedin');
});

test('v2 — le webhook lit l\'enveloppe aplatie', () => {
  assert.match(webhook, /flatten(V2WebhookEnvelope|Envelope)\(rawPayload\) \?\? rawPayload/);
  assert.match(webhook, /\.\.\.source,/);
});

test('v2 — l\'ancien chemin d\'import rend le même aplatissement que le module partagé', () => {
  assert.deepEqual(flattenV2WebhookEnvelope(REAL_MESSAGE_NEW), flattenEnvelope(REAL_MESSAGE_NEW));
});

const envelope = (type, payload, extra = {}) => ({
  id: 'evt_01abc', type, account_id: 'acc_1', account_name: 'Compte', account_provider: 'google', payload, ...extra,
});

test('v2 — email.new garde from_attendee, to_attendees, in_reply_to et thread_id (réponses et rebonds ne sont plus ignorés)', () => {
  const flat = flattenEnvelope(envelope('email.new', {
    id: 'em_1', message_id: '<m1@x>', thread_id: 'th_1', subject: 'Re: Poste',
    from: [{ email: 'candidat@exemple.fr', display_name: 'Marie' }],
    to: [{ email: 'moi@konekt.fr' }],
    headers: [{ name: 'In-Reply-To', value: '<orig@konekt.fr>' }],
  }));
  assert.equal(flat.email_id, 'em_1');
  assert.equal(flat.thread_id, 'th_1');
  assert.equal(flat.from_attendee.identifier, 'candidat@exemple.fr');
  assert.equal(flat.from_attendee.display_name, 'Marie');
  assert.deepEqual(flat.to_attendees.map((a) => a.identifier), ['moi@konekt.fr']);
  assert.equal(flat.in_reply_to, '<orig@konekt.fr>');
  assert.equal(flat.subject, 'Re: Poste');
  // Sans en-tête de réponse : rien d'inventé.
  const bare = flattenEnvelope(envelope('email.new', { id: 'em_2', from: [{ email: 'a@b.fr' }], headers: [] }));
  assert.equal('in_reply_to' in bare, false);
});

test('v2 — message.receipt.read, message.reaction.new et account.initial_sync.* sont aplatis comme événements à part entière', () => {
  const read = flattenEnvelope(envelope('message.receipt.read', { id: 'M1', chat_id: 'C1' }));
  assert.equal(read.event, 'message.receipt.read');
  assert.equal(read.message_id, 'M1');
  assert.deepEqual(read.data, { message: { id: 'M1', chat_id: 'C1' }, chat: { id: 'C1' } });
  const reaction = flattenEnvelope(envelope('message.reaction.new', { message_id: 'M2', chat_id: 'C2', reaction: 'like' }));
  assert.equal(reaction.message_id, 'M2');
  assert.equal(reaction.data.reaction, 'like');
  for (const status of ['completed', 'failed']) {
    const sync = flattenEnvelope(envelope(`account.initial_sync.${status}`, { initial_sync: { status } }));
    assert.equal(sync.sync_status, status);
    assert.equal(sync.v2_event, `account.initial_sync.${status}`);
  }
});
