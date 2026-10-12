// Journal des livraisons (list_deliveries) et rejeu (replay_event) : porte des administrateurs de la
// plateforme dans les deux sens (403 sans le secret), formes rendues, rejeu limité à NOTRE récepteur,
// et preuve que le récepteur reste idempotent sur un rejeu (clé de dédoublonnage identique).
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read --allow-write --allow-net=127.0.0.1,localhost supabase/functions/unipile-manage-webhooks/deliveries.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { jsonResponse, withMockTransport, type MockHandler } from '../_shared/unipile/testing.ts';
import { flattenEnvelope, V2_TRIGGER_EVENTS, webhookDedupKey, webhookFallbackDedupKey } from '../_shared/unipile/index.ts';
import { handleListDeliveries, handleReplayEvent, runAction } from './handlers.ts';
import { deliveryStatusOf, isPlatformAdminId, summarizeDelivery } from './view.ts';

const PROJECT = 'https://project.supabase.co';
const RECEIVER = `${PROJECT}/functions/v1/unipile-webhook`;
const ADMIN = 'user-admin';
const OTHER = 'user-other';

function endpoint(id: string, extra: Record<string, unknown> = {}) {
  return {
    object: 'WebhookEndpoint', id, application_id: 'app_x', enabled: true, description: null, url: `${RECEIVER}?v2_token=tok-secret`,
    trigger_events: [...V2_TRIGGER_EVENTS], secret: 'whsec-should-never-leave', account_ids: [], account_targets: [], ...extra,
  };
}

function delivery(id: string, extra: Record<string, unknown> = {}) {
  return {
    object: 'WebhookConversation', id, endpoint_id: 'we_ours', event_id: `evt_${id}`, event_type: 'message.new', first_attempt: true,
    created_at: '2026-10-11T08:00:00.000Z', http_status: 200, endpoint_url: `${RECEIVER}?v2_token=tok-secret`,
    response_body: '{"ok":true,"secret":"body-should-never-leave"}', latency_ms: 120, response_time_ms: 45, ...extra,
  };
}

const endpointsPage = (items: unknown[]) => ({ object: 'WebhookEndpoints', data: items, has_more: false });
const deliveriesPage = (items: unknown[], hasMore = false) => ({ object: 'WebhookConversations', data: items, has_more: hasMore });
const body = async (response: Response) => await response.json() as Record<string, unknown>;

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const names = ['SUPABASE_URL', 'UNIPILE_V2_WEBHOOK_TOKEN', 'KONEKT_PLATFORM_ADMIN_USER_IDS'];
  const saved = names.map((name) => [name, Deno.env.get(name)] as const);
  for (const name of names) Deno.env.delete(name);
  for (const [name, value] of Object.entries({ SUPABASE_URL: PROJECT, UNIPILE_V2_WEBHOOK_TOKEN: 'tok-secret', ...env })) {
    if (value !== undefined) Deno.env.set(name, value);
  }
  const error = console.error;
  const log = console.log;
  console.error = () => {};
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.error = error;
    console.log = log;
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

/**
 * Faux prestataire : points de terminaison, journal, rejeu. Une lecture filtrée par `event_id` rend les
 * tentatives de cet événement (échecs par défaut : seul un événement non reçu se rejoue) ; `ignoreEventFilter`
 * imite un fournisseur qui ne tient pas compte du filtre ; `replayEndpointIds` fixe la réponse du rejeu.
 */
function provider(options: {
  deliveries?: unknown[];
  eventDeliveries?: unknown[];
  hasMore?: boolean;
  endpoints?: unknown[];
  known?: boolean;
  ignoreEventFilter?: boolean;
  replayEndpointIds?: string[];
} = {}): MockHandler {
  const failedAttempts = [delivery('abc123', { http_status: 500 }), delivery('a', { http_status: 500 })];
  return (request) => {
    if (request.path === '/webhooks/endpoints/') return jsonResponse(endpointsPage(options.endpoints ?? [endpoint('we_ours')]));
    if (request.path === '/webhooks/conversations/') {
      const eventId = request.query.get('event_id');
      if (eventId && options.known === false) return jsonResponse(deliveriesPage([]));
      if (eventId) {
        const pool = (options.eventDeliveries ?? failedAttempts) as Array<Record<string, unknown>>;
        return jsonResponse(deliveriesPage(options.ignoreEventFilter ? pool : pool.filter((item) => item.event_id === eventId)));
      }
      return jsonResponse(deliveriesPage(options.deliveries ?? [delivery('a')], options.hasMore));
    }
    if (request.method === 'POST' && request.path.startsWith('/webhooks/events/')) {
      return jsonResponse({ object: 'EventReplay', event_id: request.path.split('/')[3], endpoint_ids: options.replayEndpointIds ?? ['we_ours'] }, 202);
    }
    return jsonResponse({}, 404);
  };
}

// ---------------------------------------------------------------------------
// Porte des administrateurs de la plateforme
// ---------------------------------------------------------------------------

Deno.test('isPlatformAdminId : strict, un secret absent ou vide ne donne le droit à personne', () => {
  strictEqual(isPlatformAdminId('u1', undefined), false);
  strictEqual(isPlatformAdminId('u1', null), false);
  strictEqual(isPlatformAdminId('u1', ''), false);
  strictEqual(isPlatformAdminId('u1', ' , ,'), false);
  strictEqual(isPlatformAdminId('u1', 'u1'), true);
  strictEqual(isPlatformAdminId('u2', ' u1 , u2 '), true);
  strictEqual(isPlatformAdminId('u3', 'u1,u2'), false);
  strictEqual(isPlatformAdminId('u', 'u1,u2'), false, 'pas de correspondance partielle');
});

Deno.test('list_deliveries et replay_event : 403 sans le secret (échec fermé), sans aucun appel au prestataire', async () => {
  await withEnv({}, async () => {
    await withMockTransport(provider(), async (mock) => {
      for (const action of ['list_deliveries', 'replay_event']) {
        const response = await runAction(action, { event_id: 'evt_a' }, ADMIN);
        strictEqual(response.status, 403, action);
        const result = await body(response);
        strictEqual(result.success, false);
        strictEqual(result.error, 'Action réservée aux administrateurs de la plateforme.');
        strictEqual(result.error_code, 'platform_admin_required');
      }
      strictEqual(mock.calls.length, 0);
    });
  });
  // Secret défini mais vide : même refus.
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: ' , ' }, async () => {
    await withMockTransport(provider(), async (mock) => {
      strictEqual((await runAction('list_deliveries', {}, ADMIN)).status, 403);
      strictEqual(mock.calls.length, 0);
    });
  });
});

Deno.test('list_deliveries et replay_event : 403 pour un utilisateur absent de la liste, accès pour un administrateur de la plateforme', async () => {
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: `${ADMIN},user-b` }, async () => {
    await withMockTransport(provider(), async (mock) => {
      for (const action of ['list_deliveries', 'replay_event']) {
        const denied = await runAction(action, { event_id: 'evt_a' }, OTHER);
        strictEqual(denied.status, 403, action);
      }
      strictEqual(mock.calls.length, 0);
      const list = await runAction('list_deliveries', {}, ADMIN);
      strictEqual(list.status, 200);
      strictEqual((await body(list)).success, true);
      const replay = await runAction('replay_event', { event_id: 'evt_a' }, 'user-b');
      strictEqual(replay.status, 200);
      strictEqual((await body(replay)).success, true);
    });
  });
});

Deno.test('register et delete gardent la porte historique : sans secret, le rôle de l\'organisation suffit ; avec lui, la liste', async () => {
  await withEnv({}, async () => {
    await withMockTransport((request) => (request.method === 'GET' ? jsonResponse(endpointsPage([])) : jsonResponse(endpoint('we_new'))), async () => {
      const response = await runAction('register', {}, OTHER);
      strictEqual(response.status, 200);
    });
  });
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: ADMIN }, async () => {
    await withMockTransport(provider(), async (mock) => {
      strictEqual((await runAction('register', {}, OTHER)).status, 403);
      strictEqual((await runAction('delete', { webhook_id: 'we_ours' }, OTHER)).status, 403);
      strictEqual(mock.calls.length, 0);
    });
  });
});

Deno.test('runAction : action inconnue ou absente : 400, y compris pour un administrateur de la plateforme', async () => {
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: ADMIN }, async () => {
    for (const action of ['purge', '', undefined, 5]) {
      const response = await runAction(action, {}, ADMIN);
      strictEqual(response.status, 400);
      strictEqual((await body(response)).error_code, 'unknown_action');
    }
  });
});

// ---------------------------------------------------------------------------
// list_deliveries
// ---------------------------------------------------------------------------

Deno.test('list_deliveries : forme fermée, ni charge, ni corps de réponse, ni jeton, ni secret', async () => {
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: ADMIN }, async () => {
    const items = [
      delivery('a'),
      delivery('b', { http_status: 500, first_attempt: false }),
      delivery('c', { http_status: null, latency_ms: null, response_time_ms: null }),
      delivery('d', { http_status: 401 }),
    ];
    await withMockTransport(provider({ deliveries: items }), async (mock) => {
      const result = await body(await runAction('list_deliveries', {}, ADMIN));
      strictEqual(result.success, true);
      strictEqual(result.endpoint_id, 'we_ours');
      const rows = result.deliveries as Array<Record<string, unknown>>;
      deepStrictEqual(rows.map((r) => r.status), ['delivered', 'failed', 'no_response', 'failed']);
      deepStrictEqual(Object.keys(rows[0]).sort(), [
        'created_at', 'event_id', 'event_type', 'first_attempt', 'http_status', 'id', 'latency_ms', 'response_time_ms', 'status',
      ]);
      strictEqual(rows[0].event_id, 'evt_a');
      strictEqual(rows[1].first_attempt, false);
      strictEqual(rows[2].http_status, null);
      const serialized = JSON.stringify(result);
      for (const leak of ['tok-secret', 'v2_token', 'whsec', 'body-should-never-leave', 'endpoint_url', 'response_body']) {
        ok(!serialized.includes(leak), `fuite : ${leak}`);
      }
      // Le journal demandé est celui de NOTRE point de terminaison.
      const call = mock.calls.find((c) => c.path === '/webhooks/conversations/')!;
      strictEqual(call.query.get('endpoint_id'), 'we_ours');
    });
  });
});

Deno.test('list_deliveries : pagination bornée, next_offset seulement s\'il reste des pages', async () => {
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: ADMIN }, async () => {
    await withMockTransport(provider({ deliveries: [delivery('a'), delivery('b')], hasMore: true }), async (mock) => {
      const more = await body(await handleListDeliveries({ offset: 20, limit: 2 }));
      strictEqual(more.has_more, true);
      strictEqual(more.next_offset, 22);
      const call = mock.calls.find((c) => c.path === '/webhooks/conversations/')!;
      strictEqual(call.query.get('offset'), '20');
      strictEqual(call.query.get('limit'), '2');
      mock.calls.length = 0;
      await handleListDeliveries({ limit: 9999 });
      strictEqual(mock.calls.find((c) => c.path === '/webhooks/conversations/')!.query.get('limit'), '50');
      mock.calls.length = 0;
      // Au-dessus du plafond : ramené à 50 (200), pas de 400.
      strictEqual((await handleListDeliveries({ limit: 51 })).status, 200);
      strictEqual(mock.calls.find((c) => c.path === '/webhooks/conversations/')!.query.get('limit'), '50');
    });
    await withMockTransport(provider({ deliveries: [delivery('a')], hasMore: false }), async () => {
      const last = await body(await handleListDeliveries({}));
      strictEqual(last.has_more, false);
      strictEqual(last.next_offset, null);
    });
    await withMockTransport(provider(), async (mock) => {
      for (const bad of [{ limit: 0 }, { limit: '5' }, { limit: 1.5 }, { offset: -1 }, { offset: 'x' }]) {
        const response = await handleListDeliveries(bad);
        strictEqual(response.status, 400, JSON.stringify(bad));
        strictEqual((await body(response)).error_code, 'validation');
      }
      strictEqual(mock.calls.length, 0);
    });
  });
});

Deno.test('list_deliveries : seulement NOTRE récepteur ; sans point de terminaison, une liste vide', async () => {
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: ADMIN }, async () => {
    const other = endpoint('we_other', { url: 'https://staging.supabase.co/functions/v1/unipile-webhook?v2_token=zz' });
    await withMockTransport(provider({ endpoints: [other, endpoint('we_ours')] }), async (mock) => {
      const refused = await handleListDeliveries({ endpoint_id: 'we_other' });
      strictEqual(refused.status, 404);
      ok(!mock.calls.some((c) => c.path === '/webhooks/conversations/'), 'le journal d\'un autre récepteur n\'est pas lu');
      const bad = await handleListDeliveries({ endpoint_id: 'nope' });
      strictEqual(bad.status, 400);
      const mine = await body(await handleListDeliveries({ endpoint_id: 'we_ours' }));
      strictEqual(mine.endpoint_id, 'we_ours');
    });
    await withMockTransport(provider({ endpoints: [other] }), async (mock) => {
      const none = await body(await handleListDeliveries({}));
      deepStrictEqual(none, { success: true, endpoint_id: null, deliveries: [], has_more: false, next_offset: null });
      ok(!mock.calls.some((c) => c.path === '/webhooks/conversations/'));
    });
  });
});

Deno.test('deliveryStatusOf et summarizeDelivery : lecture défensive', () => {
  strictEqual(deliveryStatusOf(200), 'delivered');
  strictEqual(deliveryStatusOf(299), 'delivered');
  strictEqual(deliveryStatusOf(300), 'failed');
  strictEqual(deliveryStatusOf(401), 'failed');
  strictEqual(deliveryStatusOf(503), 'failed');
  strictEqual(deliveryStatusOf(null), 'no_response');
  strictEqual(deliveryStatusOf(undefined), 'no_response');
  strictEqual(deliveryStatusOf('200'), 'no_response');
  const empty = summarizeDelivery({});
  strictEqual(empty.status, 'no_response');
  strictEqual(empty.id, '');
  strictEqual(empty.first_attempt, true);
  strictEqual(empty.latency_ms, null);
});

// ---------------------------------------------------------------------------
// replay_event
// ---------------------------------------------------------------------------

Deno.test('replay_event : identifiant evt_ exigé, rejeu vers NOTRE point de terminaison seulement, forme rendue', async () => {
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: ADMIN }, async () => {
    await withMockTransport(provider(), async (mock) => {
      for (const bad of ['', 'abc', 'evt_', 'evt_a/b', 'evt_a?x=1', 'we_a', 4, undefined]) {
        const response = await handleReplayEvent({ event_id: bad }, ADMIN);
        strictEqual(response.status, 400, String(bad));
      }
      strictEqual(mock.calls.length, 0);

      const done = await body(await handleReplayEvent({ event_id: 'evt_abc123' }, ADMIN));
      deepStrictEqual(done, { success: true, queued: true, event_id: 'evt_abc123', endpoint_ids: ['we_ours'] });
      const replay = mock.calls.find((c) => c.method === 'POST')!;
      strictEqual(replay.path, '/webhooks/events/evt_abc123/replay');
      strictEqual(replay.query.get('endpoint_id'), 'we_ours', 'jamais vers les autres points de terminaison de l\'application');
      ok(!JSON.stringify(done).includes('tok-secret'));
    });
  });
});

Deno.test('replay_event : événement absent du journal de notre récepteur ou point de terminaison étranger : 404, aucun rejeu', async () => {
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: ADMIN }, async () => {
    await withMockTransport(provider({ known: false }), async (mock) => {
      const unknownEvent = await handleReplayEvent({ event_id: 'evt_ailleurs' }, ADMIN);
      strictEqual(unknownEvent.status, 404);
      const foreign = await handleReplayEvent({ event_id: 'evt_a', endpoint_id: 'we_other' }, ADMIN);
      strictEqual(foreign.status, 404);
      ok(!mock.calls.some((c) => c.method === 'POST'), 'aucun rejeu');
    });
    const other = endpoint('we_other', { url: 'https://staging.supabase.co/functions/v1/unipile-webhook?v2_token=zz' });
    await withMockTransport(provider({ endpoints: [other] }), async (mock) => {
      strictEqual((await handleReplayEvent({ event_id: 'evt_a' }, ADMIN)).status, 404);
      ok(!mock.calls.some((c) => c.method === 'POST'));
    });
  });
});

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

Deno.test('replay_event : un événement déjà reçu (une tentative 2xx, même vieille de plus de 30 jours) n\'est pas rejoué', async () => {
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: ADMIN }, async () => {
    // Journal le plus récent d'abord : un nouvel essai a reçu 200 il y a 31 jours, la première tentative avait échoué.
    const attempts = [
      delivery('retry', { event_id: 'evt_old', http_status: 200, first_attempt: false, created_at: daysAgo(31) }),
      delivery('first', { event_id: 'evt_old', http_status: 503, created_at: daysAgo(31) }),
    ];
    await withMockTransport(provider({ eventDeliveries: attempts }), async (mock) => {
      const response = await handleReplayEvent({ event_id: 'evt_old' }, ADMIN);
      strictEqual(response.status, 409);
      const result = await body(response);
      strictEqual(result.success, false);
      strictEqual(result.error_code, 'already_received');
      ok(!mock.calls.some((c) => c.method === 'POST'), 'aucun rejeu : la ligne de dédoublonnage a pu être purgée');
    });
    // Un événement dont toutes les tentatives ont échoué se rejoue, quel que soit son âge.
    const failed = [delivery('x', { event_id: 'evt_failed', http_status: 500, created_at: daysAgo(40) }), delivery('y', { event_id: 'evt_failed', http_status: null })];
    await withMockTransport(provider({ eventDeliveries: failed }), async (mock) => {
      strictEqual((await body(await handleReplayEvent({ event_id: 'evt_failed' }, ADMIN))).success, true);
      ok(mock.calls.some((c) => c.method === 'POST'));
    });
  });
});

Deno.test('replay_event : un fournisseur qui ignore le filtre event_id n\'autorise pas le rejeu d\'un autre événement', async () => {
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: ADMIN }, async () => {
    await withMockTransport(provider({ ignoreEventFilter: true, eventDeliveries: [delivery('other', { http_status: 500 })] }), async (mock) => {
      const response = await handleReplayEvent({ event_id: 'evt_not_in_log' }, ADMIN);
      strictEqual(response.status, 404);
      ok(!mock.calls.some((c) => c.method === 'POST'), 'aucun rejeu');
    });
  });
});

Deno.test('replay_event : rien mis en file par le fournisseur (aucun point de terminaison actif) : échec, jamais un succès', async () => {
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: ADMIN }, async () => {
    for (const replayEndpointIds of [[], ['we_other']]) {
      await withMockTransport(provider({ replayEndpointIds }), async () => {
        const result = await body(await handleReplayEvent({ event_id: 'evt_a' }, ADMIN));
        strictEqual(result.success, false);
        strictEqual(result.error_code, 'replay_not_queued');
        strictEqual(result.error, 'Aucune notification active à rejouer.');
        ok(!('queued' in result));
      });
    }
  });
});

Deno.test('replay_event : erreur du prestataire : propagée à index.ts, jamais d\'une réponse de succès', async () => {
  await withEnv({ KONEKT_PLATFORM_ADMIN_USER_IDS: ADMIN }, async () => {
    const handler: MockHandler = (request) => {
      if (request.method === 'POST') return jsonResponse({ message: 'vendor text' }, 500);
      return provider()(request);
    };
    await withMockTransport(handler, async () => {
      let thrown: unknown = null;
      try {
        await handleReplayEvent({ event_id: 'evt_a' }, ADMIN);
      } catch (error) {
        thrown = error;
      }
      ok(thrown instanceof Error, 'l\'erreur remonte au gestionnaire d\'index.ts qui répond un texte neutre');
      ok(!String((thrown as Error).message).includes('vendor text'));
    });
  });
});

// ---------------------------------------------------------------------------
// Le récepteur reste idempotent sur un rejeu
// ---------------------------------------------------------------------------

/** Enveloppe d'événement telle que le récepteur la reçoit. */
function envelope(type: string, id: string, createdAt: string) {
  return {
    id, type, created_at: createdAt, account_id: 'acc_01kyex2j0pexzt3v8prstne0ey', account_name: 'Compte test',
    account_provider: 'linkedin', application_id: 'app_x', payload: { id: 'MSG1', chat_id: 'CH1', sender_id: 'ACoAAxxxxxx', is_sender: false },
  };
}

/** Réplique de `record_webhook_event` : vrai à la première vue d'une clé, faux ensuite. */
function dedupStore() {
  const seen = new Set<string>();
  return (flat: Record<string, unknown>) => {
    const key = (webhookDedupKey(flat) ?? webhookFallbackDedupKey(flat)).slice(0, 500);
    const isNew = !seen.has(key);
    seen.add(key);
    return { key, isNew };
  };
}

Deno.test('rejeu : le même evt_ donne la même clé de dédoublonnage, la livraison rejouée est ignorée par le récepteur', () => {
  const record = dedupStore();
  const original = flattenEnvelope(envelope('message.new', 'evt_01rejeu', '2026-10-11T08:00:00.000Z'))!;
  // Le rejeu garde l'identifiant et la charge d'origine ; l'instant de la livraison, lui, change.
  const replayed = flattenEnvelope(envelope('message.new', 'evt_01rejeu', '2026-10-12T09:30:00.000Z'))!;

  const first = record(original);
  strictEqual(first.key, 'unipile:v2:message.new:evt_01rejeu');
  strictEqual(first.isNew, true);

  const second = record(replayed);
  strictEqual(second.key, first.key, 'même clé au niveau du récepteur');
  strictEqual(second.isNew, false, 'rejeu d\'un événement déjà vu : dédoublonné, rien n\'est retraité');

  // Et encore après plusieurs rejeux (nouvelles tentatives comprises).
  for (let i = 0; i < 3; i++) strictEqual(record(replayed).isNew, false);
});

Deno.test('rejeu : un autre evt_, ou un autre type pour le même evt_, reste un événement distinct', () => {
  const record = dedupStore();
  strictEqual(record(flattenEnvelope(envelope('message.new', 'evt_01a', '2026-10-11T08:00:00.000Z'))!).isNew, true);
  strictEqual(record(flattenEnvelope(envelope('message.new', 'evt_01b', '2026-10-11T08:00:00.000Z'))!).isNew, true);
  strictEqual(record(flattenEnvelope(envelope('account.status.running', 'evt_01a', '2026-10-11T08:00:00.000Z'))!).isNew, true);
  strictEqual(record(flattenEnvelope(envelope('account.status.degraded', 'evt_01a', '2026-10-11T08:00:00.000Z'))!).isNew, true);
});

Deno.test('rejeu : la clé ne dépend ni de l\'instant ni du point de terminaison, le repli à la minute ne sert jamais quand evt_ existe', () => {
  const flat = flattenEnvelope(envelope('message.new', 'evt_01c', '2026-10-11T08:00:00.000Z'))!;
  const key = webhookDedupKey(flat);
  strictEqual(key, 'unipile:v2:message.new:evt_01c');
  // Le repli (sans evt_) change de minute en minute : s'il servait, un rejeu tardif ne serait pas dédoublonné.
  const early = webhookFallbackDedupKey(flat, Date.parse('2026-10-11T08:00:00Z'));
  const late = webhookFallbackDedupKey(flat, Date.parse('2026-10-12T09:30:00Z'));
  ok(early !== late);
  ok(key !== null && key !== early && key !== late);
});
