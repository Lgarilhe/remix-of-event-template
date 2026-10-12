// Webhooks : liste des événements, jeton de livraison, authentification, gestion
// des points de terminaison, journal de livraisons, rejeu, et aplatissement de
// l'enveloppe v2 (fonctions pures). Les appels sont joués contre un transport
// factice qui vérifie l'URL, la méthode, la requête et le corps.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/webhooks.test.ts

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { createHmac } from 'node:crypto';
import { isCandidateReplyCandidate } from './normalize/messages.ts';
import { isUnipileError } from './errors.ts';
import { fixtures, jsonResponse, withMockTransport } from './testing.ts';
import {
  accountChannelOf,
  accountStatusOfEvent,
  createEndpoint,
  deleteEndpoint,
  deriveWebhookToken,
  EVENT_ALIASES,
  flattenEnvelope,
  getEndpoint,
  handlerNameOf,
  isReceiverEndpoint,
  KNOWN_TRIGGER_EVENTS,
  listAllEndpoints,
  listDeliveries,
  listEndpoints,
  patchEndpoint,
  planEndpointSync,
  receiverEndpointUrl,
  redactWebhookUrl,
  replayEvent,
  resolveWebhookToken,
  STATUS_BY_EVENT,
  V2_TRIGGER_EVENTS,
  verifyWebhookRequest,
  webhookDedupKey,
  webhookFallbackDedupKey,
} from './webhooks.ts';

const validation = (e: unknown) => isUnipileError(e) && e.kind === 'validation';
const ACC = 'acc_01kyex2j0pexzt3v8prstne0ey';
const RECEIVER = 'https://project.supabase.co/functions/v1/unipile-webhook';

/** Énumération du fournisseur, recopiée de façon indépendante (spécification « Unipile API », 40 valeurs). */
const SPEC_ENUM = [
  'account.status.disconnected', 'account.status.running', 'account.status.errored', 'account.status.degraded',
  'account.status.partial', 'account.locked', 'account.unlocked', 'account.add', 'account.reconnect', 'account.remove',
  'account.initial_sync.running', 'account.initial_sync.failed', 'account.initial_sync.completed', 'message.new',
  'message.update', 'message.delete', 'message.receipt.read', 'message.receipt.delivery', 'message.reaction.new',
  'message.reaction.delete', 'chat.delete', 'chat.update', 'email.new', 'email.new.bounce', 'email.delete',
  'email.draft.new', 'email.draft.delete', 'email.folder.create', 'email.folder.update', 'email.folder.delete',
  'calendar.create', 'calendar.update', 'calendar.delete', 'calendar.event.new', 'calendar.event.update',
  'calendar.event.delete', 'tracking.open', 'tracking.click', 'relation.new', 'follower.new',
];

function envelope(type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: 'evt_01abc', type, created_at: '2026-10-11T08:00:00.000Z', account_id: ACC, account_name: 'Compte test',
    account_provider: 'linkedin', application_id: 'app_x', payload, ...extra,
  };
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

Deno.test('KNOWN_TRIGGER_EVENTS : les 40 valeurs de l\'énumération du fournisseur, sans doublon', () => {
  strictEqual(KNOWN_TRIGGER_EVENTS.length, 40);
  strictEqual(new Set(KNOWN_TRIGGER_EVENTS).size, 40);
  deepStrictEqual([...KNOWN_TRIGGER_EVENTS].sort(), [...SPEC_ENUM].sort());
});

Deno.test('V2_TRIGGER_EVENTS : chaque événement inscrit est dans l\'énumération, sans doublon', () => {
  strictEqual(V2_TRIGGER_EVENTS.length, 17);
  strictEqual(new Set(V2_TRIGGER_EVENTS).size, V2_TRIGGER_EVENTS.length);
  const known = new Set<string>(KNOWN_TRIGGER_EVENTS);
  for (const event of V2_TRIGGER_EVENTS) ok(known.has(event), `${event} refusé par POST /webhooks/endpoints/`);
});

Deno.test('V2_TRIGGER_EVENTS : liste conservée, noms retirés et événements non traités exclus', () => {
  deepStrictEqual([...V2_TRIGGER_EVENTS], [
    'message.new', 'message.reaction.new', 'message.receipt.read', 'relation.new', 'account.add', 'account.reconnect',
    'account.remove', 'account.status.running', 'account.status.degraded', 'account.status.partial',
    'account.status.disconnected', 'account.status.errored', 'account.locked', 'account.unlocked',
    'account.initial_sync.completed', 'account.initial_sync.failed', 'email.new',
  ]);
  const subscribed = new Set<string>(V2_TRIGGER_EVENTS);
  for (const removed of ['account.status.paused', 'relation.request.accept', 'message.read']) ok(!subscribed.has(removed), removed);
  for (const unhandled of ['email.new.bounce', 'tracking.open', 'tracking.click']) ok(!subscribed.has(unhandled), unhandled);
});

Deno.test('EVENT_ALIASES : tout événement inscrit a un nom de handler, tout alias part d\'un événement inscrit', () => {
  const subscribed = new Set<string>(V2_TRIGGER_EVENTS);
  for (const event of subscribed) ok(EVENT_ALIASES[event], `${event} sans alias`);
  for (const event of Object.keys(EVENT_ALIASES)) ok(subscribed.has(event), `${event} n'est pas inscrit`);
});

Deno.test('EVENT_ALIASES : message.receipt.read, message.reaction.new et account.initial_sync.* sont de première classe', () => {
  strictEqual(EVENT_ALIASES['message.receipt.read'], 'message_read');
  strictEqual(EVENT_ALIASES['message.reaction.new'], 'message_reaction');
  strictEqual(EVENT_ALIASES['account.initial_sync.completed'], 'account_sync_completed');
  strictEqual(EVENT_ALIASES['account.initial_sync.failed'], 'account_sync_failed');
});

Deno.test('EVENT_ALIASES : account.remove n\'est plus une déconnexion récupérable', () => {
  strictEqual(EVENT_ALIASES['account.remove'], 'account_removed');
  ok(EVENT_ALIASES['account.remove'] !== EVENT_ALIASES['account.status.disconnected']);
  strictEqual(EVENT_ALIASES['account.status.disconnected'], 'account_disconnected');
  strictEqual(EVENT_ALIASES['account.add'], 'account_connected');
  strictEqual(EVENT_ALIASES['account.reconnect'], 'account_connected');
  strictEqual(handlerNameOf('message.new'), 'new_message');
  strictEqual(handlerNameOf('chat.update'), 'chat.update');
});

Deno.test('STATUS_BY_EVENT : le nom de l\'événement porte le statut', () => {
  deepStrictEqual({ ...STATUS_BY_EVENT }, {
    'account.status.running': 'OK',
    'account.status.degraded': 'DEGRADED',
    'account.status.partial': 'PARTIAL',
  });
});

// ---------------------------------------------------------------------------
// Jeton et authentification
// ---------------------------------------------------------------------------

Deno.test('deriveWebhookToken : HMAC-SHA256 hexadécimal de la constante, identique à l\'ancienne dérivation', async () => {
  const expected = createHmac('sha256', 'secret-1').update('unipile-v2-webhook-endpoint').digest('hex');
  strictEqual(await deriveWebhookToken('secret-1'), expected);
  strictEqual(expected.length, 64);
  ok((await deriveWebhookToken('secret-2')) !== expected);
});

Deno.test('resolveWebhookToken : le jeton dédié prime, sinon dérivé du secret, sinon null', async () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];
  strictEqual(await resolveWebhookToken(env({ UNIPILE_V2_WEBHOOK_TOKEN: 'brut', UNIPILE_WEBHOOK_SECRET: 's' })), 'brut');
  strictEqual(await resolveWebhookToken(env({ UNIPILE_WEBHOOK_SECRET: 's' })), await deriveWebhookToken('s'));
  strictEqual(await resolveWebhookToken(env({})), null);
  strictEqual(await resolveWebhookToken(env({ UNIPILE_V2_WEBHOOK_TOKEN: '' })), null);
});

Deno.test('verifyWebhookRequest : matrice d\'authentification', async () => {
  const dedicatedOnly = (n: string) => (n === 'UNIPILE_V2_WEBHOOK_TOKEN' ? 'tok-123' : undefined);
  const call = (url: string, env: (n: string) => string | undefined) => verifyWebhookRequest(new Request(url, { method: 'POST' }), env);

  // Bon jeton, seul le jeton dédié est configuré : pas de dépendance au secret historique.
  deepStrictEqual(await call(`${RECEIVER}?v2_token=tok-123`, dedicatedOnly), { ok: true });
  deepStrictEqual(await call(`${RECEIVER}?foo=1&v2_token=tok-123`, dedicatedOnly), { ok: true });
  // Mauvais jeton, même préfixe, plus long, plus court.
  for (const bad of ['tok-124', 'tok-123x', 'tok-12', 'TOK-123']) {
    deepStrictEqual(await call(`${RECEIVER}?v2_token=${bad}`, dedicatedOnly), { ok: false, reason: 'bad_token', status: 401 });
  }
  // Jeton absent ou vide.
  deepStrictEqual(await call(RECEIVER, dedicatedOnly), { ok: false, reason: 'missing_token', status: 401 });
  deepStrictEqual(await call(`${RECEIVER}?v2_token=`, dedicatedOnly), { ok: false, reason: 'missing_token', status: 401 });
  // En-tête de l'ancienne génération : ignoré, seul le paramètre compte.
  const withHeader = new Request(RECEIVER, { method: 'POST', headers: { 'unipile-auth': 'tok-123' } });
  deepStrictEqual(await verifyWebhookRequest(withHeader, dedicatedOnly), { ok: false, reason: 'missing_token', status: 401 });
  // Rien de configuré : erreur du serveur (503), jamais 500 ni accès ouvert.
  deepStrictEqual(await call(`${RECEIVER}?v2_token=x`, () => undefined), { ok: false, reason: 'not_configured', status: 503 });
  // Jeton dérivé du secret historique.
  const legacyEnv = (n: string) => (n === 'UNIPILE_WEBHOOK_SECRET' ? 'legacy' : undefined);
  const derived = await deriveWebhookToken('legacy');
  deepStrictEqual(await call(`${RECEIVER}?v2_token=${derived}`, legacyEnv), { ok: true });
  deepStrictEqual(await call(`${RECEIVER}?v2_token=legacy`, legacyEnv), { ok: false, reason: 'bad_token', status: 401 });
});

Deno.test('redactWebhookUrl : retire la requête et le fragment', () => {
  strictEqual(redactWebhookUrl(`${RECEIVER}?v2_token=abc&x=1`), RECEIVER);
  strictEqual(redactWebhookUrl(`${RECEIVER}#frag`), RECEIVER);
  strictEqual(redactWebhookUrl(RECEIVER), RECEIVER);
});

// ---------------------------------------------------------------------------
// Points de terminaison
// ---------------------------------------------------------------------------

function endpoint(id = 'we_1', extra: Record<string, unknown> = {}) {
  return {
    object: 'WebhookEndpoint', id, application_id: 'app_x', enabled: true, description: null, url: `${RECEIVER}?v2_token=t`,
    trigger_events: ['message.new'], secret: 'whsec', account_ids: [], account_targets: [], ...extra,
  };
}

Deno.test('listEndpoints : GET /webhooks/endpoints/ avec offset et limit en chaînes', async () => {
  await withMockTransport(() => jsonResponse(fixtures.hasMorePage([endpoint()], true, 'WebhookEndpoints')), async (mock) => {
    const page = await listEndpoints({ offset: 20, limit: 20 });
    strictEqual(page.items[0].id, 'we_1');
    strictEqual(page.hasMore, true);
    strictEqual(mock.calls[0].method, 'GET');
    strictEqual(mock.calls[0].path, '/webhooks/endpoints/');
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { offset: '20', limit: '20' });
    await listEndpoints();
    strictEqual(mock.calls[1].url, 'https://api.unipile.com/v2/webhooks/endpoints/');
  });
});

Deno.test('listAllEndpoints : suit has_more (le nôtre peut dépasser la première page)', async () => {
  const pages = [fixtures.hasMorePage([endpoint('we_1'), endpoint('we_2')], true), fixtures.hasMorePage([endpoint('we_3')], false)];
  let i = 0;
  await withMockTransport(() => jsonResponse(pages[i++]), async (mock) => {
    const result = await listAllEndpoints({ limit: 2 });
    deepStrictEqual(result.items.map((e) => e.id), ['we_1', 'we_2', 'we_3']);
    deepStrictEqual(Object.fromEntries(mock.calls[1].query), { offset: '2', limit: '2' });
  });
});

Deno.test('getEndpoint : GET /webhooks/endpoints/{id} ; identifiant mal formé refusé', async () => {
  await withMockTransport(() => jsonResponse(endpoint('we_9')), async (mock) => {
    strictEqual((await getEndpoint('we_9')).id, 'we_9');
    strictEqual(mock.calls[0].path, '/webhooks/endpoints/we_9');
    await rejects(() => getEndpoint('9'), validation);
    await rejects(() => getEndpoint('we_9/../x'), validation);
    strictEqual(mock.calls.length, 1);
  });
  await withMockTransport(() => jsonResponse({ nope: 1 }), async () => {
    await rejects(() => getEndpoint('we_9'), (e: unknown) => isUnipileError(e) && e.kind === 'server');
  });
});

Deno.test('createEndpoint : POST /webhooks/endpoints/ {trigger_events, url, account_ids, description}', async () => {
  await withMockTransport(() => jsonResponse(endpoint('we_new')), async (mock) => {
    const created = await createEndpoint({
      url: `${RECEIVER}?v2_token=t`, triggerEvents: ['message.new', 'email.new', 'message.new'], accountIds: [ACC], description: 'Konekt',
    });
    strictEqual(created.id, 'we_new');
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, '/webhooks/endpoints/');
    deepStrictEqual(mock.calls[0].body, {
      trigger_events: ['message.new', 'email.new'], url: `${RECEIVER}?v2_token=t`, account_ids: [ACC], description: 'Konekt',
    });
    await createEndpoint({ url: RECEIVER, triggerEvents: [...V2_TRIGGER_EVENTS] });
    deepStrictEqual(mock.calls[1].body, { trigger_events: [...V2_TRIGGER_EVENTS], url: RECEIVER });
  });
});

Deno.test('createEndpoint : événement inconnu, URL trop longue ou sans schéma, liste vide, compte ancien refusés avant tout appel', async () => {
  await withMockTransport(() => jsonResponse(endpoint()), async (mock) => {
    await rejects(() => createEndpoint({ url: RECEIVER, triggerEvents: ['account.status.paused'] }), validation);
    await rejects(() => createEndpoint({ url: RECEIVER, triggerEvents: [] }), validation);
    await rejects(() => createEndpoint({ url: `https://x.test/${'a'.repeat(260)}`, triggerEvents: ['message.new'] }), validation);
    await rejects(() => createEndpoint({ url: 'ftp://x.test/hook', triggerEvents: ['message.new'] }), validation);
    await rejects(() => createEndpoint({ url: RECEIVER, triggerEvents: ['message.new'], accountIds: ['v1-account'] }), (e: unknown) => isUnipileError(e));
    await rejects(() => createEndpoint({ url: RECEIVER, triggerEvents: ['message.new'], description: 'x'.repeat(256) }), validation);
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('createEndpoint : jamais rejoué (deux appels créeraient deux points de terminaison)', async () => {
  await withMockTransport(() => new Response('boom', { status: 503 }), async (mock) => {
    await rejects(() => createEndpoint({ url: RECEIVER, triggerEvents: ['message.new'] }), (e: unknown) => isUnipileError(e) && e.kind === 'uncertain');
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('patchEndpoint : PATCH en place, champs fournis seulement', async () => {
  await withMockTransport(() => jsonResponse(endpoint('we_1', { enabled: false })), async (mock) => {
    await patchEndpoint('we_1', { triggerEvents: [...V2_TRIGGER_EVENTS], url: `${RECEIVER}?v2_token=n`, enabled: false, description: 'd', accountIds: [] });
    strictEqual(mock.calls[0].method, 'PATCH');
    strictEqual(mock.calls[0].path, '/webhooks/endpoints/we_1');
    deepStrictEqual(mock.calls[0].body, {
      trigger_events: [...V2_TRIGGER_EVENTS], account_ids: [], url: `${RECEIVER}?v2_token=n`, description: 'd', enabled: false,
    });
    await patchEndpoint('we_1', { enabled: true });
    deepStrictEqual(mock.calls[1].body, { enabled: true });
    await rejects(() => patchEndpoint('we_1', {}), validation);
    await rejects(() => patchEndpoint('we_1', { triggerEvents: ['nope'] }), validation);
    strictEqual(mock.calls.length, 2);
  });
});

Deno.test('deleteEndpoint : DELETE /webhooks/endpoints/{id} rend success', async () => {
  await withMockTransport(() => jsonResponse({ success: true }), async (mock) => {
    strictEqual(await deleteEndpoint('we_1'), true);
    strictEqual(mock.calls[0].method, 'DELETE');
    strictEqual(mock.calls[0].path, '/webhooks/endpoints/we_1');
  });
  await withMockTransport(() => jsonResponse({ success: false }), async () => {
    strictEqual(await deleteEndpoint('we_1'), false);
  });
});

Deno.test('listDeliveries : GET /webhooks/conversations/ avec endpoint_id obligatoire', async () => {
  await withMockTransport(
    () => jsonResponse(fixtures.hasMorePage([{ object: 'WebhookConversation', id: 'wc_1', endpoint_id: 'we_1', event_id: 'evt_1', http_status: 200 }], false, 'WebhookConversations')),
    async (mock) => {
      const page = await listDeliveries({ endpointId: 'we_1', eventId: 'evt_1', accountId: ACC, offset: 0, limit: 50 });
      strictEqual(page.items[0].id, 'wc_1');
      strictEqual(mock.calls[0].path, '/webhooks/conversations/');
      deepStrictEqual(Object.fromEntries(mock.calls[0].query), { endpoint_id: 'we_1', event_id: 'evt_1', account_id: ACC, offset: '0', limit: '50' });
      await listDeliveries({ endpointId: 'we_1' });
      deepStrictEqual(Object.fromEntries(mock.calls[1].query), { endpoint_id: 'we_1' });
      await rejects(() => listDeliveries({ endpointId: '' }), validation);
      await rejects(() => listDeliveries({ endpointId: 'we_1', eventId: 'e1' }), validation);
    },
  );
});

Deno.test('replayEvent : POST /webhooks/events/{evt}/replay, endpoint_id facultatif, réponse 202', async () => {
  await withMockTransport(() => jsonResponse({ object: 'EventReplay', event_id: 'evt_9', endpoint_ids: ['we_1'] }, 202), async (mock) => {
    deepStrictEqual(await replayEvent('evt_9'), { eventId: 'evt_9', endpointIds: ['we_1'] });
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, '/webhooks/events/evt_9/replay');
    strictEqual(mock.calls[0].url, 'https://api.unipile.com/v2/webhooks/events/evt_9/replay');
    strictEqual(mock.calls[0].body, null);
    await replayEvent('evt_9', 'we_2');
    strictEqual(mock.calls[1].query.get('endpoint_id'), 'we_2');
    await rejects(() => replayEvent('9'), validation);
    await rejects(() => replayEvent('evt_9', 'x'), validation);
  });
  await withMockTransport(() => jsonResponse({ object: 'EventReplay' }, 202), async () => {
    await rejects(() => replayEvent('evt_9'), (e: unknown) => isUnipileError(e) && e.kind === 'server');
  });
});

// ---------------------------------------------------------------------------
// Aplatissement de l'enveloppe
// ---------------------------------------------------------------------------

// message.new réel reçu le 2026-09-24 (texte et identité masqués par le fournisseur).
const REAL_MESSAGE_NEW = {
  created_at: '2026-09-24T13:58:19.577Z', type: 'message.new', hash: 'b8cde60b', account_scope_id: null,
  id: 'evt_01m39vbgn3e8p8a3zcnjq98ark', account_id: 'acc_01kyex2j0pexzt3v8prstne0ey', application_id: 'app_x',
  application_production: true, account_name: 'Compte test', account_provider: 'linkedin',
  payload: {
    id: 'CLASSIC_2-MSG', text: '<scrubbed for privacy>', object: 'Message',
    sender: { id: 'ACoAADKm2akB', object: 'User', display_name: '<scrubbed for privacy>' },
    chat_id: 'CLASSIC_2-CHAT', is_seen: false, is_sender: false, sender_id: 'ACoAADKm2akB',
    timestamp: '2026-09-24T13:58:19.184Z', attachments: [],
  },
};

Deno.test('flattenEnvelope : message.new réel remis au format des handlers', () => {
  const flat = flattenEnvelope(REAL_MESSAGE_NEW)!;
  strictEqual(flat.event, 'message.new');
  strictEqual(flat.v2_event, 'message.new');
  strictEqual(flat.account_id, 'acc_01kyex2j0pexzt3v8prstne0ey');
  strictEqual(flat.account_type, 'linkedin');
  strictEqual(flat.event_id, 'evt_01m39vbgn3e8p8a3zcnjq98ark');
  strictEqual(flat.message_id, 'CLASSIC_2-MSG');
  const data = flat.data as { message: Record<string, unknown>; chat: Record<string, unknown> };
  strictEqual(data.message.chat_id, 'CLASSIC_2-CHAT');
  strictEqual(data.message.sender_id, 'ACoAADKm2akB');
  strictEqual(data.message.is_sender, false);
  strictEqual(data.chat.id, 'CLASSIC_2-CHAT');
  // Ni expéditeur ni conversation à la racine : le handler prendrait la forme de l'ancienne génération.
  strictEqual(flat.sender, undefined);
  strictEqual(flat.chat_id, undefined);
});

Deno.test('flattenEnvelope : un corps de l\'ancienne génération ou incomplet n\'est pas une enveloppe', () => {
  strictEqual(flattenEnvelope({ event: 'message_received', chat_id: 'c', sender: {} }), null);
  strictEqual(flattenEnvelope({ AccountStatus: { account_id: 'a', message: 'OK' } }), null);
  strictEqual(flattenEnvelope(null), null);
  strictEqual(flattenEnvelope('texte'), null);
  strictEqual(flattenEnvelope({ type: 'message.new' }), null);
  strictEqual(flattenEnvelope({ type: 'message.new', payload: 'x' }), null);
  strictEqual(flattenEnvelope({ type: 'message.new', event: 'x', payload: {} }), null);
});

Deno.test('flattenEnvelope : email.new garde from_attendee, to_attendees, in_reply_to, thread_id', () => {
  const flat = flattenEnvelope(envelope('email.new', {
    id: 'em_1', message_id: '<m1@x>', thread_id: 'th_1', subject: 'Re: Poste', body: '<p>Oui</p>', body_plain: 'Oui', date: '2026-10-11T07:59:00.000Z',
    from: [{ email: 'Candidat@Exemple.fr', display_name: 'Marie Dupont' }],
    to: [{ email: 'moi@konekt.fr' }, { email: 'autre@konekt.fr', display_name: 'Autre' }],
    cc: [{ email: 'cc@konekt.fr' }], bcc: [],
    headers: [{ name: 'Message-ID', value: '<m1@x>' }, { name: 'In-Reply-To', value: '<orig@konekt.fr>' }, { name: 'References', value: '<a@x> <orig@konekt.fr>' }],
    folders: ['INBOX'], is_unread: true,
  }, { account_provider: 'google' }))!;
  strictEqual(flat.event, 'email.new');
  strictEqual(flat.account_type, 'google');
  strictEqual(flat.email_id, 'em_1');
  strictEqual(flat.message_id, '<m1@x>');
  strictEqual(flat.thread_id, 'th_1');
  deepStrictEqual(flat.from_attendee, { identifier: 'Candidat@Exemple.fr', email: 'Candidat@Exemple.fr', display_name: 'Marie Dupont' });
  deepStrictEqual(flat.to_attendees, [
    { identifier: 'moi@konekt.fr', email: 'moi@konekt.fr' },
    { identifier: 'autre@konekt.fr', email: 'autre@konekt.fr', display_name: 'Autre' },
  ]);
  deepStrictEqual(flat.cc_attendees, [{ identifier: 'cc@konekt.fr', email: 'cc@konekt.fr' }]);
  deepStrictEqual(flat.bcc_attendees, []);
  strictEqual(flat.in_reply_to, '<orig@konekt.fr>');
  strictEqual(flat.subject, 'Re: Poste');
  strictEqual(flat.body_plain, 'Oui');
  strictEqual((flat.headers as unknown[]).length, 3);
});

Deno.test('flattenEnvelope : email.new, réponse reconstruite depuis References ; sans en-tête ni expéditeur, rien d\'inventé', () => {
  const viaReferences = flattenEnvelope(envelope('email.new', {
    id: 'em_2', from: [{ email: 'a@b.fr' }], headers: [{ name: 'References', value: '<a@x>\r\n <b@x>' }],
  }))!;
  strictEqual(viaReferences.in_reply_to, '<b@x>');
  const bare = flattenEnvelope(envelope('email.new', { id: 'em_3', subject: 'Nouveau', headers: [] }))!;
  strictEqual('from_attendee' in bare, false);
  strictEqual('in_reply_to' in bare, false);
  strictEqual('thread_id' in bare, false);
  deepStrictEqual(bare.to_attendees, []);
  strictEqual(bare.email_id, 'em_3');
});

Deno.test('flattenEnvelope : email.new, les clés de l\'enveloppe ne sont pas écrasées par la charge', () => {
  const flat = flattenEnvelope(envelope('email.new', { id: 'em_4', event: 'piege', account_id: 'acc_autre', v2_event: 'x', event_id: 'evt_autre' }))!;
  strictEqual(flat.event, 'email.new');
  strictEqual(flat.account_id, ACC);
  strictEqual(flat.v2_event, 'email.new');
  strictEqual(flat.event_id, 'evt_01abc');
});

Deno.test('flattenEnvelope : message.receipt.read, forme du message', () => {
  const flat = flattenEnvelope(envelope('message.receipt.read', { id: 'MSG1', chat_id: 'CH1', is_seen: true }))!;
  strictEqual(flat.event, 'message.receipt.read');
  strictEqual(flat.message_id, 'MSG1');
  deepStrictEqual(flat.data, { message: { id: 'MSG1', chat_id: 'CH1' }, chat: { id: 'CH1' } });
  const explicit = flattenEnvelope(envelope('message.receipt.read', { message_id: 'MSG2', chat_id: 'CH2' }))!;
  strictEqual(explicit.message_id, 'MSG2');
});

Deno.test('flattenEnvelope : message.reaction.new, réaction directe ou message d\'événement', () => {
  const direct = flattenEnvelope(envelope('message.reaction.new', {
    message_id: 'MSG1', chat_id: 'CH1', reaction: 'like', sender: { id: 'ACoAAxxxxxx' }, is_sender: false,
  }))!;
  strictEqual(direct.message_id, 'MSG1');
  deepStrictEqual(direct.data, {
    message: { id: 'MSG1', chat_id: 'CH1', sender_id: 'ACoAAxxxxxx', is_sender: false }, chat: { id: 'CH1' }, reaction: 'like', reaction_reason: undefined,
  });
  const asMessage = flattenEnvelope(envelope('message.reaction.new', {
    id: 'EVT-MSG', chat_id: 'CH1', sender_id: 'ACoAAyyyyyy', is_event: true, event_type: 8,
    event_metadata: { reaction: 'love', reason: 'added', message_id: 'MSG7' },
  }))!;
  strictEqual(asMessage.message_id, 'MSG7');
  strictEqual((asMessage.data as { reaction: string }).reaction, 'love');
  strictEqual((asMessage.data as { reaction_reason: string }).reaction_reason, 'added');
});

Deno.test('flattenEnvelope : relation.new, utilisateur imbriqué ou à plat', () => {
  const nested = flattenEnvelope(envelope('relation.new', {
    id: 'rel_1', object: 'UserRelation', user: { id: 'ACoAAzzzzzz', display_name: 'Marie', public_identifier: 'marie-dupont', profile_url: 'https://www.linkedin.com/in/marie-dupont' },
  }))!;
  strictEqual(nested.user_provider_id, 'ACoAAzzzzzz');
  strictEqual(nested.user_full_name, 'Marie');
  strictEqual(nested.user_public_identifier, 'marie-dupont');
  strictEqual(nested.user_profile_url, 'https://www.linkedin.com/in/marie-dupont');
  const flatUser = flattenEnvelope(envelope('relation.new', { id: 'ACoAAwwwwww', display_name: 'Paul' }))!;
  strictEqual(flatUser.user_provider_id, 'ACoAAwwwwww');
});

Deno.test('flattenEnvelope : account.add et reconnect, état, nom et ancien identifiant', () => {
  const add = flattenEnvelope(envelope('account.add', { id: ACC, state: 'attempt-1', metadata: { v1_account_id: 'OldAcc123' } }, { account_provider: 'google' }))!;
  strictEqual(add.state, 'attempt-1');
  deepStrictEqual(add.data, { name: 'Compte test', account_type: 'google' });
  strictEqual(add.v1_account_id, 'OldAcc123');
  const reconnect = flattenEnvelope(envelope('account.reconnect', {}, { state: 'depuis-enveloppe' }))!;
  strictEqual(reconnect.state, 'depuis-enveloppe');
  strictEqual('v1_account_id' in reconnect, false);
});

Deno.test('flattenEnvelope : account.initial_sync.* porte l\'état de synchronisation', () => {
  for (const status of ['running', 'completed', 'failed']) {
    const flat = flattenEnvelope(envelope(`account.initial_sync.${status}`, { id: ACC, initial_sync: { status } }))!;
    strictEqual(flat.sync_status, status);
    deepStrictEqual(flat.data, { name: 'Compte test', account_type: 'linkedin' });
    deepStrictEqual(flat.initial_sync, { status });
  }
});

Deno.test('flattenEnvelope : statuts et autres événements, charge à plat sans écraser l\'enveloppe', () => {
  const flat = flattenEnvelope(envelope('account.status.partial', { object: 'Account', status: 'running', is_locked: false }))!;
  strictEqual(flat.event, 'account.status.partial');
  strictEqual(flat.v2_event, 'account.status.partial');
  strictEqual(flat.account_id, ACC);
  strictEqual(flat.account_type, 'linkedin');
  strictEqual(flat.status, 'running', 'copié tel quel : le nom de l\'événement fait foi, via STATUS_BY_EVENT');
  strictEqual(flat.is_locked, false);
  const noAccount = flattenEnvelope({ type: 'account.locked', payload: {} })!;
  strictEqual(noAccount.account_id, '');
  strictEqual(noAccount.account_type, undefined);
  strictEqual(noAccount.event_id, undefined);
});

Deno.test('webhookDedupKey : type brut + identifiant evt_, jamais le nom du handler', () => {
  const running = flattenEnvelope(envelope('account.status.running', {}, { id: 'evt_a' }))!;
  const degraded = flattenEnvelope(envelope('account.status.degraded', {}, { id: 'evt_a' }))!;
  strictEqual(webhookDedupKey(running), 'unipile:v2:account.status.running:evt_a');
  ok(webhookDedupKey(running) !== webhookDedupKey(degraded), 'running et degraded partagent un handler mais sont deux événements');
  strictEqual(handlerNameOf('account.status.running'), handlerNameOf('account.status.degraded'));
  // Un rejeu garde l'identifiant d'origine : même clé.
  deepStrictEqual(webhookDedupKey(flattenEnvelope(envelope('message.new', { id: 'm' }, { id: 'evt_z' }))!), 'unipile:v2:message.new:evt_z');
  // Pas d'identifiant evt_ : pas de clé (l'appelant en construit une autre).
  strictEqual(webhookDedupKey(flattenEnvelope(envelope('message.new', {}, { id: 'abc' }))!), null);
  strictEqual(webhookDedupKey({ event: 'message_received' }), null);
});

Deno.test('flattenEnvelope : message.new garde is_event, is_hidden, is_deleted et le type de la ligne', () => {
  const flat = flattenEnvelope(envelope('message.new', {
    id: 'MSG9', chat_id: 'CH9', sender_id: 'ACoAAxxxxxx', is_sender: false, is_event: true, event_type: 9, is_hidden: true, is_deleted: false,
    specifics: { type: 'INVITATION' },
  }))!;
  const message = (flat.data as { message: Record<string, unknown> }).message;
  strictEqual(message.is_event, true);
  strictEqual(message.event_type, 9);
  strictEqual(message.is_hidden, true);
  strictEqual(message.is_deleted, false);
  strictEqual(message.message_type, 'INVITATION');
  strictEqual(isCandidateReplyCandidate(message as never), false);
  const plain = (flattenEnvelope(envelope('message.new', { id: 'M', chat_id: 'C', sender_id: 'S', is_sender: false, is_event: false, is_hidden: false }))!.data as { message: Record<string, unknown> }).message;
  strictEqual(isCandidateReplyCandidate(plain as never), true);
});

Deno.test('account.status.running sur un compte verrouillé : LOCKED, comme la lecture de la liste', () => {
  strictEqual(accountStatusOfEvent('account.status.running', false), 'OK');
  strictEqual(accountStatusOfEvent('account.status.running', true), 'LOCKED');
  strictEqual(accountStatusOfEvent('account.status.degraded', true), 'LOCKED');
  strictEqual(accountStatusOfEvent('account.status.partial', undefined), 'PARTIAL');
  strictEqual(accountStatusOfEvent('message.new', true), null);
  const locked = flattenEnvelope(envelope('account.status.running', { object: 'Account', status: 'running', is_locked: true }))!;
  strictEqual(locked.account_status, 'LOCKED');
  strictEqual(locked.status, 'running', 'le texte du prestataire reste tel quel');
  const free = flattenEnvelope(envelope('account.status.running', { object: 'Account', status: 'running', is_locked: false }))!;
  strictEqual(free.account_status, 'OK');
  strictEqual('account_status' in flattenEnvelope(envelope('account.locked', {}))!, false);
});

Deno.test('points de terminaison : ni jeton de livraison ni secret ne sortent des fonctions publiques', async () => {
  const tokenised = (id: string) => endpoint(id, { url: `${RECEIVER}?v2_token=SECRETTOKEN`, secret: 'whsec_SECRET' });
  const check = (value: unknown) => {
    const text = JSON.stringify(value);
    ok(!text.includes('SECRETTOKEN'), text);
    ok(!text.includes('whsec_SECRET'), text);
  };
  await withMockTransport(() => jsonResponse(fixtures.hasMorePage([tokenised('we_1')], false, 'WebhookEndpoints')), async () => {
    const page = await listEndpoints();
    check(page);
    strictEqual(page.items[0].url, RECEIVER);
    check(await listAllEndpoints());
  });
  await withMockTransport(() => jsonResponse(tokenised('we_2')), async () => {
    check(await getEndpoint('we_2'));
    check(await createEndpoint({ url: `${RECEIVER}?v2_token=SECRETTOKEN`, triggerEvents: ['message.new'] }));
    check(await patchEndpoint('we_2', { enabled: true }));
  });
  const delivery = { object: 'WebhookConversation', id: 'wc_1', endpoint_id: 'we_1', event_id: 'evt_1', http_status: 200, endpoint_url: `${RECEIVER}?v2_token=SECRETTOKEN` };
  await withMockTransport(() => jsonResponse(fixtures.hasMorePage([delivery], false, 'WebhookConversations')), async () => {
    const page = await listDeliveries({ endpointId: 'we_1' });
    check(page);
    strictEqual(page.items[0].endpoint_url, RECEIVER);
  });
});

Deno.test('createEndpoint : l’URL porte le jeton, https obligatoire (http seulement en local)', async () => {
  await withMockTransport(() => jsonResponse(endpoint('we_new')), async (mock) => {
    await rejects(() => createEndpoint({ url: 'http://project.supabase.co/hook?v2_token=t', triggerEvents: ['message.new'] }), validation);
    await rejects(() => createEndpoint({ url: 'http://localhost.evil.test/hook', triggerEvents: ['message.new'] }), validation);
    strictEqual(mock.calls.length, 0);
    await createEndpoint({ url: 'http://localhost:54321/functions/v1/unipile-webhook?v2_token=t', triggerEvents: ['message.new'] });
    await createEndpoint({ url: 'http://127.0.0.1:8000/hook', triggerEvents: ['message.new'] });
    strictEqual(mock.calls.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Lot S2 : relation sans personne, statut du compte, clé de repli, canal, plan d'enregistrement
// ---------------------------------------------------------------------------

Deno.test('flattenEnvelope : relation.new, l\'identifiant de la relation n\'est jamais pris pour celui de la personne', () => {
  // Une UserRelation sans `user` : ni identifiant ni nom de personne, seulement l'id de la relation.
  const orphan = flattenEnvelope(envelope('relation.new', { id: 'rel_9', object: 'UserRelation' }))!;
  strictEqual(orphan.user_provider_id, undefined);
  strictEqual(orphan.relation_id, 'rel_9');
  // Une relation avec `user` : la personne vient de `user`, l'id de la relation est gardé à part.
  const nested = flattenEnvelope(envelope('relation.new', {
    id: 'rel_10', object: 'UserRelation', user: { id: 'ACoAAxxxxxx', public_identifier: 'jean-martin' },
  }))!;
  strictEqual(nested.user_provider_id, 'ACoAAxxxxxx');
  strictEqual(nested.relation_id, 'rel_10');
  strictEqual(nested.user_public_identifier, 'jean-martin');
});

Deno.test('flattenEnvelope : account.add garde le statut et le verrouillage de l\'Account', () => {
  const add = flattenEnvelope(envelope('account.add', { id: ACC, status: 'running', is_locked: true, state: 'x' }))!;
  strictEqual(add.provider_status, 'running');
  strictEqual(add.is_locked, true);
  const bare = flattenEnvelope(envelope('account.reconnect', { state: 'x' }))!;
  strictEqual('provider_status' in bare, false);
  strictEqual('is_locked' in bare, false);
});

Deno.test('webhookFallbackDedupKey : type brut, compte, référence de la charge et minute', () => {
  const flat = flattenEnvelope(envelope('message.new', { id: 'M1', chat_id: 'C1' }, { id: 'pas-evt' }))!;
  const at = Date.UTC(2026, 9, 11, 8, 0, 30);
  strictEqual(webhookFallbackDedupKey(flat, at), `unipile:v2:message.new:${ACC}:M1:${Math.floor(at / 60000)}`);
  // Même minute : même clé ; minute suivante : autre clé ; type différent : autre clé.
  strictEqual(webhookFallbackDedupKey(flat, at + 10_000), webhookFallbackDedupKey(flat, at));
  ok(webhookFallbackDedupKey(flat, at + 60_000) !== webhookFallbackDedupKey(flat, at));
  const status = flattenEnvelope(envelope('account.status.degraded', {}, { id: 'pas-evt' }))!;
  ok(webhookFallbackDedupKey(status, at).includes('account.status.degraded'));
  // Sans compte ni référence : repère neutre.
  strictEqual(webhookFallbackDedupKey({ v2_event: 'chat.update' }, 0), 'unipile:v2:chat.update:no-acc::0');
});

Deno.test('accountChannelOf : le fournisseur dit le canal', () => {
  strictEqual(accountChannelOf('linkedin'), 'linkedin');
  strictEqual(accountChannelOf('LinkedIn'), 'linkedin');
  strictEqual(accountChannelOf('whatsapp'), 'whatsapp');
  for (const provider of ['google', 'outlook', 'imap']) strictEqual(accountChannelOf(provider), 'email');
  for (const other of ['telegram', 'instagram', 'mock', '', undefined, null, 4]) strictEqual(accountChannelOf(other), null);
});

Deno.test('receiverEndpointUrl : jeton encodé dans la requête, barre finale du projet retirée', () => {
  strictEqual(
    receiverEndpointUrl('https://project.supabase.co/', 'a b+c'),
    'https://project.supabase.co/functions/v1/unipile-webhook?v2_token=a%20b%2Bc',
  );
  ok(receiverEndpointUrl('https://project.supabase.co', 'tok').length <= 255);
});

Deno.test('isReceiverEndpoint : même origine et même chemin, requête ignorée, autre fonction exclue', () => {
  ok(isReceiverEndpoint(`${RECEIVER}?v2_token=abc`, RECEIVER));
  ok(isReceiverEndpoint(`${RECEIVER}/`, RECEIVER));
  ok(isReceiverEndpoint(RECEIVER, `${RECEIVER}?v2_token=zzz`));
  ok(!isReceiverEndpoint('https://project.supabase.co/functions/v1/unipile-webhook-staging', RECEIVER));
  ok(!isReceiverEndpoint('https://other.supabase.co/functions/v1/unipile-webhook', RECEIVER));
  ok(!isReceiverEndpoint('https://project.supabase.co/functions/v1/sequence-webhooks-handler', RECEIVER));
  ok(!isReceiverEndpoint('pas une url', RECEIVER));
  ok(!isReceiverEndpoint(undefined, RECEIVER));
});

Deno.test('planEndpointSync : aucun point de terminaison, un seul, ou des doublons', () => {
  const wanted = ['message.new', 'relation.new', 'email.new'];
  const ep = (id: string, url: string, enabled: boolean, events: string[]) => ({ id, url, enabled, trigger_events: events });
  // Rien chez nous (un autre récepteur ne compte pas) : création.
  deepStrictEqual(planEndpointSync([ep('we_x', 'https://project.supabase.co/functions/v1/autre', true, wanted)], RECEIVER, wanted), { keepId: null, deleteIds: [] });
  deepStrictEqual(planEndpointSync([], RECEIVER, wanted), { keepId: null, deleteIds: [] });
  // Un seul : gardé, même sans jeton dans l'URL (il sera réécrit) ou incomplet.
  deepStrictEqual(planEndpointSync([ep('we_a', RECEIVER, true, ['message.new'])], RECEIVER, wanted), { keepId: 'we_a', deleteIds: [] });
  // Doublons : l'actif prime, puis celui qui couvre le plus d'événements voulus, puis le premier.
  const plan = planEndpointSync([
    ep('we_off', RECEIVER, false, wanted),
    ep('we_few', RECEIVER, true, ['message.new']),
    ep('we_many', `${RECEIVER}?v2_token=old`, true, wanted),
    ep('we_other', 'https://project.supabase.co/functions/v1/autre', true, wanted),
  ], RECEIVER, wanted);
  deepStrictEqual(plan, { keepId: 'we_many', deleteIds: ['we_off', 'we_few'] });
  // Égalité parfaite : le premier de la liste.
  deepStrictEqual(planEndpointSync([ep('we_1', RECEIVER, true, wanted), ep('we_2', RECEIVER, true, wanted)], RECEIVER, wanted), { keepId: 'we_1', deleteIds: ['we_2'] });
});
