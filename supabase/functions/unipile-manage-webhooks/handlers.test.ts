// Gestion du point de terminaison de notifications : list, register (idempotent, mise à jour sur place,
// doublons supprimés, jeton réécrit), delete, et ce qui ne sort jamais vers le navigateur.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-manage-webhooks/handlers.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { jsonResponse, withMockTransport, type MockHandler } from '../_shared/unipile/testing.ts';
import { V2_TRIGGER_EVENTS } from '../_shared/unipile/index.ts';
import { handleDelete, handleList, handleRegister } from './handlers.ts';
import { legacyItems, summarizeEndpoint } from './view.ts';

const PROJECT = 'https://project.supabase.co';
const RECEIVER = `${PROJECT}/functions/v1/unipile-webhook`;
const TOKEN = 'tok-v2-secret';

function endpoint(id: string, extra: Record<string, unknown> = {}) {
  return {
    object: 'WebhookEndpoint', id, application_id: 'app_x', enabled: true, description: null, url: `${RECEIVER}?v2_token=old`,
    trigger_events: [...V2_TRIGGER_EVENTS], secret: 'whsec-should-never-leave', account_ids: [], account_targets: [], ...extra,
  };
}

const page = (items: unknown[], hasMore = false) => ({ object: 'WebhookEndpoints', data: items, has_more: hasMore });

/** Environnement du lot : projet, jeton dédié, clé de l'API ; rétabli ensuite. */
async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const names = ['SUPABASE_URL', 'UNIPILE_V2_WEBHOOK_TOKEN', 'UNIPILE_WEBHOOK_SECRET'];
  const saved = names.map((name) => [name, Deno.env.get(name)] as const);
  for (const name of names) Deno.env.delete(name);
  for (const [name, value] of Object.entries({ SUPABASE_URL: PROJECT, UNIPILE_V2_WEBHOOK_TOKEN: TOKEN, ...env })) {
    if (value !== undefined) Deno.env.set(name, value);
  }
  const error = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = error;
    for (const [name, value] of saved) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

const body = async (response: Response) => await response.json() as Record<string, unknown>;

Deno.test('register : aucun point de terminaison : créé avec tous les événements, jeton dans l\'URL, jamais renvoyé', async () => {
  await withEnv({}, async () => {
    const handler: MockHandler = (request) => (request.method === 'GET' ? jsonResponse(page([])) : jsonResponse(endpoint('we_new')));
    await withMockTransport(handler, async (mock) => {
      const result = await body(await handleRegister());
      strictEqual(result.success, true);
      strictEqual(result.action, 'created');
      strictEqual(result.id, 'we_new');
      strictEqual(result.webhook_url, RECEIVER);
      const create = mock.calls.find((c) => c.method === 'POST')!;
      strictEqual(create.path, '/webhooks/endpoints/');
      const sent = create.body as { url: string; trigger_events: string[]; description: string };
      strictEqual(sent.url, `${RECEIVER}?v2_token=${TOKEN}`);
      deepStrictEqual(sent.trigger_events, [...V2_TRIGGER_EVENTS]);
      ok(!JSON.stringify(result).includes(TOKEN), 'le jeton n\'est pas dans la réponse');
      ok(!JSON.stringify(result).includes('whsec'));
    });
  });
});

Deno.test('register : idempotent, un point de terminaison existant est mis à jour sur place (PATCH), jamais recréé', async () => {
  await withEnv({}, async () => {
    // Existant : jeton périmé, événement manquant, désactivé. Il faut le réécrire sans le supprimer.
    const stale = endpoint('we_old', { enabled: false, trigger_events: ['message.new'] });
    const handler: MockHandler = (request) => (request.method === 'GET'
      ? jsonResponse(page([stale]))
      : jsonResponse(endpoint('we_old')));
    await withMockTransport(handler, async (mock) => {
      for (let run = 0; run < 2; run++) {
        const result = await body(await handleRegister());
        strictEqual(result.action, 'updated');
        strictEqual(result.id, 'we_old');
        strictEqual(result.deleted_duplicates, 0);
      }
      const writes = mock.calls.filter((c) => c.method !== 'GET');
      strictEqual(writes.length, 2);
      for (const write of writes) {
        strictEqual(write.method, 'PATCH');
        strictEqual(write.path, '/webhooks/endpoints/we_old');
        deepStrictEqual(write.body, {
          trigger_events: [...V2_TRIGGER_EVENTS],
          url: `${RECEIVER}?v2_token=${TOKEN}`,
          description: 'Konekt, notifications en temps réel (messages, relations, comptes, e-mails)',
          enabled: true,
        });
      }
      ok(!mock.calls.some((c) => c.method === 'POST' || c.method === 'DELETE'));
    });
  });
});

Deno.test('register : doublons de notre récepteur supprimés après la mise à jour ; les autres adresses ne sont pas touchées', async () => {
  await withEnv({}, async () => {
    const list = page([
      endpoint('we_dup', { enabled: false }),
      endpoint('we_keep'),
      endpoint('we_staging', { url: 'https://staging.supabase.co/functions/v1/unipile-webhook?v2_token=zz' }),
      endpoint('we_sequences', { url: `${PROJECT}/functions/v1/sequence-webhooks-handler?v2_token=zz`, trigger_events: ['tracking.open'] }),
    ]);
    const handler: MockHandler = (request) => {
      if (request.method === 'GET') return jsonResponse(list);
      if (request.method === 'DELETE') return jsonResponse({ success: true });
      return jsonResponse(endpoint('we_keep'));
    };
    await withMockTransport(handler, async (mock) => {
      const result = await body(await handleRegister());
      strictEqual(result.id, 'we_keep');
      strictEqual(result.deleted_duplicates, 1);
      const writes = mock.calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);
      deepStrictEqual(writes, ['PATCH /webhooks/endpoints/we_keep', 'DELETE /webhooks/endpoints/we_dup']);
    });
  });
});

Deno.test('register : doublon impossible à supprimer : la mise à jour reste acquise et l\'échec est signalé', async () => {
  await withEnv({}, async () => {
    const handler: MockHandler = (request) => {
      if (request.method === 'GET') return jsonResponse(page([endpoint('we_keep'), endpoint('we_dup', { enabled: false })]));
      if (request.method === 'DELETE') return { status: 500, body: { message: 'boom' } };
      return jsonResponse(endpoint('we_keep'));
    };
    await withMockTransport(handler, async () => {
      const result = await body(await handleRegister());
      strictEqual(result.success, true);
      strictEqual(result.duplicates_not_deleted, 1);
    });
  });
});

Deno.test('register : lit toutes les pages avant de décider (le nôtre peut être au-delà de 20)', async () => {
  await withEnv({}, async () => {
    const first = Array.from({ length: 20 }, (_, i) => endpoint(`we_other${i}`, { url: `https://other.example.com/hook${i}` }));
    let listCalls = 0;
    const handler: MockHandler = (request) => {
      if (request.method === 'GET') return jsonResponse(++listCalls === 1 ? page(first, true) : page([endpoint('we_ours')]));
      return jsonResponse(endpoint('we_ours'));
    };
    await withMockTransport(handler, async (mock) => {
      const result = await body(await handleRegister());
      strictEqual(result.action, 'updated');
      strictEqual(result.id, 'we_ours');
      ok(!mock.calls.some((c) => c.method === 'POST'), 'pas de second point de terminaison créé');
    });
  });
});

Deno.test('register : jeton dérivé du secret historique quand le jeton dédié est absent ; aucun jeton : refus sans appel', async () => {
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: undefined, UNIPILE_WEBHOOK_SECRET: 'legacy' }, async () => {
    const { deriveWebhookToken } = await import('../_shared/unipile/index.ts');
    const derived = await deriveWebhookToken('legacy');
    await withMockTransport((request) => (request.method === 'GET' ? jsonResponse(page([])) : jsonResponse(endpoint('we_n'))), async (mock) => {
      await handleRegister();
      strictEqual((mock.calls.find((c) => c.method === 'POST')!.body as { url: string }).url, `${RECEIVER}?v2_token=${derived}`);
    });
  });
  await withEnv({ UNIPILE_V2_WEBHOOK_TOKEN: undefined, UNIPILE_WEBHOOK_SECRET: undefined }, async () => {
    await withMockTransport(() => jsonResponse(page([])), async (mock) => {
      const result = await body(await handleRegister());
      strictEqual(result.success, false);
      strictEqual(result.error_code, 'not_configured');
      strictEqual(mock.calls.length, 0);
      ok(!/unipile/i.test(String(result.error)));
    });
  });
});

Deno.test('list : ni jeton ni secret, une ligne par famille avec sa propre clé, seulement NOTRE récepteur', async () => {
  await withEnv({}, async () => {
    const other = endpoint('we_other', { url: 'https://other.example.com/hook?v2_token=abc', trigger_events: ['message.new'], description: 'autre service', account_ids: ['acc_autre'] });
    await withMockTransport(() => jsonResponse(page([endpoint('we_ours'), other])), async () => {
      const result = await body(await handleList());
      strictEqual(result.success, true);
      const text = JSON.stringify(result);
      ok(!text.includes('v2_token') && !text.includes('whsec') && !text.includes('secret'), 'ni jeton ni secret');
      const items = (result.webhooks as { items: Array<{ id: string; endpoint_id: string; source: string; request_url: string }> }).items;
      // Trois familles de l'écran (les e-mails comptent avec les messages) : pas de ligne « Autre notification ».
      deepStrictEqual(items.map((i) => i.source).sort(), ['accounts', 'messaging', 'users']);
      // Une clé par ligne (l'écran s'en sert comme clé React et comme état « en cours de suppression »).
      strictEqual(new Set(items.map((i) => i.id)).size, items.length, 'identifiants de ligne distincts');
      ok(items.every((i) => i.id === `we_ours:${i.source}` && i.endpoint_id === 'we_ours' && i.request_url === RECEIVER), 'seul notre récepteur compte');
      // L'application est commune à tous les espaces de travail : l'adresse, la description et les comptes
      // d'un autre récepteur ne sortent jamais.
      const endpoints = result.endpoints as Array<{ id: string; is_receiver: boolean; url: string }>;
      deepStrictEqual(endpoints.map((e) => e.id), ['we_ours']);
      ok(!text.includes('we_other') && !text.includes('other.example.com') && !text.includes('acc_autre') && !text.includes('autre service'));
    });
  });
});

Deno.test('list : un point de terminaison incomplet ou désactivé ne couvre pas les familles manquantes', () => {
  const partial = { id: 'we_p', url: `${RECEIVER}?v2_token=x`, enabled: true, trigger_events: ['message.new', 'relation.new'] };
  // Sans email.new, les réponses des candidats ne sont pas toutes couvertes (messages ET e-mails).
  deepStrictEqual(legacyItems([partial], RECEIVER).map((i) => i.source), ['users']);
  deepStrictEqual(legacyItems([{ ...partial, trigger_events: [...partial.trigger_events, 'email.new'] }], RECEIVER).map((i) => i.source), ['messaging', 'users']);
  deepStrictEqual(legacyItems([{ ...partial, enabled: false }], RECEIVER), []);
  const summary = summarizeEndpoint(partial, RECEIVER);
  ok(summary.missing_events.includes('email.new') && !summary.missing_events.includes('message.new'));
  strictEqual(summary.url, RECEIVER);
});

Deno.test('delete : identifiant we_… (ou we_…:famille d\'une ligne de l\'écran) exigé ; supprime NOTRE point de terminaison entier', async () => {
  await withEnv({}, async () => {
    await withMockTransport((request) => (request.method === 'GET' ? jsonResponse(page([endpoint('we_77')])) : jsonResponse({ success: true })), async (mock) => {
      for (const bad of ['', 'abc', 'we_', 'we_a/b', 'we_a?x=1', '../we_a', 'we_a:', 'we_a:Users', 'we_a:users:x', 4, undefined]) {
        const response = await handleDelete({ webhook_id: bad });
        strictEqual(response.status, 400, String(bad));
      }
      strictEqual(mock.calls.length, 0);
      for (const id of ['we_77', 'we_77:messaging']) {
        mock.calls.length = 0;
        const done = await body(await handleDelete({ webhook_id: id }));
        strictEqual(done.success, true, id);
        const deletes = mock.calls.filter((c) => c.method === 'DELETE');
        strictEqual(deletes.length, 1, id);
        strictEqual(deletes[0].path, '/webhooks/endpoints/we_77', 'jamais le suffixe de famille chez le prestataire');
      }
    });
  });
});

Deno.test('delete : le point de terminaison d\'un autre récepteur ou inconnu n\'est jamais supprimé', async () => {
  await withEnv({}, async () => {
    const other = endpoint('we_other', { url: 'https://staging.supabase.co/functions/v1/unipile-webhook?v2_token=zz' });
    const sequences = endpoint('we_sequences', { url: `${PROJECT}/functions/v1/sequence-webhooks-handler?v2_token=zz`, trigger_events: ['tracking.open'] });
    await withMockTransport((request) => (request.method === 'GET' ? jsonResponse(page([endpoint('we_ours'), other, sequences])) : jsonResponse({ success: true })), async (mock) => {
      for (const id of ['we_other', 'we_sequences', 'we_sequences:messaging']) {
        const response = await handleDelete({ webhook_id: id });
        strictEqual(response.status, 403, id);
        strictEqual((await body(response)).success, false);
      }
      const unknown = await handleDelete({ webhook_id: 'we_inconnu' });
      strictEqual(unknown.status, 404);
      ok(!mock.calls.some((c) => c.method === 'DELETE'), 'aucune suppression');
    });
  });
});
