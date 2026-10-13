// Messagerie : lectures (chats, messages, boîtes) et envois (démarrer un chat,
// InMail par licence, message dans un chat existant). Chaque appel est joué
// contre un transport factice qui vérifie l'URL, la méthode, la requête et le
// corps ; les envois sont vérifiés sur leur issue (sent, uncertain, refused).
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/messaging.test.ts

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { isUnipileError } from './errors.ts';
import { OutdatedAccountIdError } from './ids.ts';
import {
  collectChats,
  getChat,
  getChatForUser,
  getMessage,
  listChats,
  listInboxes,
  listMessages,
  markRead,
  sendMessage,
  startChat,
} from './messaging.ts';
import { fixtures, jsonResponse, networkError, withMockTransport } from './testing.ts';

const ACC = 'acc_01abc';
const USER = 'ACoAABBCCDDEE';

function chat(id: string, extra: Record<string, unknown> = {}) {
  return { object: 'Chat', id, name: `Chat ${id}`, type: '1to1', is_1to1: true, ...extra };
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

Deno.test('listInboxes : GET /{acc}/inboxes', async () => {
  await withMockTransport(
    () => jsonResponse({ data: [{ object: 'Inbox', id: 'in_1', disabled: false }, { object: 'Inbox', id: 'in_2', disabled: true }] }),
    async (mock) => {
      const inboxes = await listInboxes(ACC);
      deepStrictEqual(inboxes.map((i) => i.id), ['in_1', 'in_2']);
      strictEqual(mock.calls[0].path, `/${ACC}/inboxes`);
      strictEqual(mock.calls[0].method, 'GET');
    },
  );
});

Deno.test('listChats : GET /{acc}/chats avec filtres et dates ISO', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([chat('c1')], { nextCursor: 'n1', totalCount: 9 })), async (mock) => {
    const page = await listChats(ACC, {
      type: '1to1', isUnread: true, isArchived: false, before: new Date('2026-10-01T00:00:00Z'), after: '2026-09-01T00:00:00.000Z',
      cursor: 'c0', limit: 10,
    });
    strictEqual(page.nextCursor, 'n1');
    strictEqual(page.totalCount, 9);
    strictEqual(mock.calls[0].path, `/${ACC}/chats`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), {
      type: '1to1', is_unread: 'true', is_archived: 'false',
      before: '2026-10-01T00:00:00.000Z', after: '2026-09-01T00:00:00.000Z', cursor: 'c0', limit: '10',
    });
  });
});

Deno.test('listChats : avec inboxId, la variante par boîte ; offset pris en charge', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([])), async (mock) => {
    await listChats(ACC, { inboxId: 'in_9', offset: 20 });
    strictEqual(mock.calls[0].path, `/${ACC}/inboxes/in_9/chats`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), { offset: '20' });
  });
});

Deno.test('collectChats : lit chaque boîte active, dédoublonne et trie du plus récent au plus ancien', async () => {
  await withMockTransport((req) => {
    if (req.path === `/${ACC}/inboxes`) {
      return jsonResponse({ data: [{ id: 'in_a', disabled: false }, { id: 'in_b', disabled: false }, { id: 'in_off', disabled: true }] });
    }
    if (req.path === `/${ACC}/inboxes/in_a/chats`) {
      return jsonResponse(fixtures.page([
        chat('c1', { last_message_timestamp: '2026-10-01T10:00:00.000Z' }),
        chat('c2', { last_message_timestamp: '2026-09-01T10:00:00.000Z' }),
      ]));
    }
    if (req.path === `/${ACC}/inboxes/in_b/chats`) {
      return jsonResponse(fixtures.page([
        chat('c2', { last_message_timestamp: '2026-09-01T10:00:00.000Z' }),
        chat('c3', { last_message_timestamp: '2026-10-05T10:00:00.000Z' }),
      ]));
    }
    return jsonResponse({ error: 'unexpected' }, 500);
  }, async (mock) => {
    const result = await collectChats(ACC, { isUnread: true, limit: 50 });
    deepStrictEqual(result.items.map((c) => c.id), ['c3', 'c1', 'c2']);
    strictEqual(result.truncated, false);
    ok(!mock.calls.some((c) => c.path.includes('in_off')), 'boîte désactivée ignorée');
    const chatCalls = mock.calls.filter((c) => c.path.endsWith('/chats'));
    strictEqual(chatCalls.length, 2);
    for (const call of chatCalls) {
      deepStrictEqual(Object.fromEntries(call.query), { is_unread: 'true', limit: '50' });
    }
  });
});

Deno.test('collectChats : maxItems vaut pour la liste fusionnée des boîtes, les plus récentes sont gardées', async () => {
  await withMockTransport((req) => {
    if (req.path === `/${ACC}/inboxes`) return jsonResponse({ data: [{ id: 'in_a' }, { id: 'in_b' }, { id: 'in_c' }] });
    const day = { in_a: '01', in_b: '02', in_c: '03' }[req.path.split('/')[3] as 'in_a'];
    return jsonResponse(fixtures.page([
      chat(`${req.path.split('/')[3]}_1`, { last_message_timestamp: `2026-10-${day}T10:00:00.000Z` }),
      chat(`${req.path.split('/')[3]}_2`, { last_message_timestamp: `2026-09-${day}T10:00:00.000Z` }),
    ]));
  }, async () => {
    const result = await collectChats(ACC, { maxItems: 4 });
    deepStrictEqual(result.items.map((c) => c.id), ['in_c_1', 'in_b_1', 'in_a_1', 'in_c_2']);
    strictEqual(result.truncated, true, 'six chats reçus pour un plafond de quatre');
    strictEqual(result.nextCursor, null, 'une liste fusionnée n’a pas de point de reprise unique');
  });
});

Deno.test('collectChats : une seule boîte rend son point de reprise, et deadlineMs arrête après la première page', async () => {
  let n = 0;
  await withMockTransport(() => jsonResponse(fixtures.page([chat(`c${++n}`)], { nextCursor: `p${n + 1}` })), async (mock) => {
    const result = await collectChats(ACC, { inboxId: 'in_z', deadlineMs: 0 });
    strictEqual(mock.calls.length, 1, 'le délai est épuisé après la première page');
    strictEqual(result.truncated, true);
    strictEqual(result.nextCursor, 'p2');
    // Reprise depuis ce point.
    await collectChats(ACC, { inboxId: 'in_z', startCursor: result.nextCursor ?? undefined, deadlineMs: 0 });
    strictEqual(mock.calls[1].query.get('cursor'), 'p2');
  });
});

Deno.test('collectChats : sans boîte (liste vide ou fournisseur sans ce concept), lit /{acc}/chats et suit next_cursor', async () => {
  for (const inboxAnswer of [jsonResponse({ data: [] }), jsonResponse({ error: 'nope' }, 404)]) {
    let page = 0;
    await withMockTransport((req) => {
      if (req.path === `/${ACC}/inboxes`) return inboxAnswer;
      page++;
      return page === 1
        ? jsonResponse(fixtures.page([chat('c1')], { nextCursor: 'p2' }))
        : jsonResponse(fixtures.page([chat('c2')]));
    }, async (mock) => {
      const result = await collectChats(ACC);
      deepStrictEqual(result.items.map((c) => c.id), ['c1', 'c2']);
      const chats = mock.calls.filter((c) => c.path === `/${ACC}/chats`);
      strictEqual(chats.length, 2);
      strictEqual(chats[1].query.get('cursor'), 'p2');
    });
  }
});

Deno.test('collectChats : une erreur d\'authentification sur la liste des boîtes se propage', async () => {
  await withMockTransport(() => jsonResponse({ error: 'bad key' }, 401), async () => {
    await rejects(() => collectChats(ACC), (e: unknown) => isUnipileError(e) && e.kind === 'auth');
  });
});

Deno.test('collectChats : avec inboxId, une seule boîte sans appel à la liste des boîtes', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([chat('c1')])), async (mock) => {
    const result = await collectChats(ACC, { inboxId: 'in_z' });
    strictEqual(result.items.length, 1);
    strictEqual(mock.calls.length, 1);
    strictEqual(mock.calls[0].path, `/${ACC}/inboxes/in_z/chats`);
  });
});

Deno.test('getChat : GET /{acc}/chats/{chat} ; ancien identifiant de compte refusé ; réponse illisible = erreur', async () => {
  await withMockTransport(() => jsonResponse(chat('CH1', { user_id: USER })), async (mock) => {
    const c = await getChat(ACC, 'CH1');
    strictEqual(c.user_id, USER);
    strictEqual(mock.calls[0].path, `/${ACC}/chats/CH1`);
    await rejects(() => getChat('v1-account', 'CH1'), OutdatedAccountIdError);
    strictEqual(mock.calls.length, 1);
  });
  await withMockTransport(() => jsonResponse({ nothing: true }), async () => {
    await rejects(() => getChat(ACC, 'CH1'), (e: unknown) => isUnipileError(e) && e.kind === 'server');
  });
});

Deno.test('getChat : un identifiant de chat contenant un séparateur est refusé', async () => {
  await withMockTransport(() => jsonResponse(chat('x')), async (mock) => {
    await rejects(() => getChat(ACC, 'a/../b'), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('getChatForUser : GET /{acc}/users/{user}/chat, une entrée par boîte', async () => {
  await withMockTransport(
    () => jsonResponse({ object: 'ChatLookup', data: [{ chat_id: 'CH1', inbox_id: 'in_a', has_history: true }, { chat_id: 'CH2' }] }),
    async (mock) => {
      const entries = await getChatForUser(ACC, USER);
      deepStrictEqual(entries.map((e) => e.chat_id), ['CH1', 'CH2']);
      strictEqual(mock.calls[0].path, `/${ACC}/users/${USER}/chat`);
    },
  );
});

Deno.test('getChatForUser : repli sur le slug quand l\'identifiant fournisseur ne donne rien', async () => {
  await withMockTransport((req) => {
    if (req.path.endsWith(`/users/${USER}/chat`)) return jsonResponse({ object: 'ChatLookup', data: [] });
    return jsonResponse({ object: 'ChatLookup', data: [{ chat_id: 'CHX' }] });
  }, async (mock) => {
    const entries = await getChatForUser(ACC, { providerId: USER, slug: 'marie-dupont' });
    deepStrictEqual(entries.map((e) => e.chat_id), ['CHX']);
    deepStrictEqual(mock.calls.map((c) => c.path), [`/${ACC}/users/${USER}/chat`, `/${ACC}/users/marie-dupont/chat`]);
  });
});

Deno.test('getChatForUser : aucun chat = liste vide ; toutes les formes refusées = erreur', async () => {
  await withMockTransport(() => jsonResponse({ object: 'ChatLookup', data: [] }), async () => {
    deepStrictEqual(await getChatForUser(ACC, USER), []);
  });
  await withMockTransport(() => jsonResponse({ error: 'unknown user' }, 404), async (mock) => {
    await rejects(
      () => getChatForUser(ACC, { providerId: USER, slug: 'marie-dupont' }),
      (e: unknown) => isUnipileError(e) && e.kind === 'not_found',
    );
    strictEqual(mock.calls.length, 2);
  });
});

Deno.test('markRead : PATCH /{acc}/chats/{chat} {read_status}', async () => {
  await withMockTransport(() => jsonResponse(chat('CH1', { unread_count: 0 })), async (mock) => {
    await markRead(ACC, 'CH1');
    await markRead(ACC, 'CH1', false);
    strictEqual(mock.calls[0].method, 'PATCH');
    strictEqual(mock.calls[0].path, `/${ACC}/chats/CH1`);
    deepStrictEqual(mock.calls[0].body, { read_status: true });
    deepStrictEqual(mock.calls[1].body, { read_status: false });
  });
});

Deno.test('listMessages : GET /{acc}/chats/{chat}/messages avec filtres', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([{ id: 'm1', chat_id: 'CH1', sender_id: USER, timestamp: 't', is_sender: false }])), async (mock) => {
    const page = await listMessages(ACC, 'CH1', { userId: USER, after: '2026-10-01T00:00:00.000Z', offset: 5, limit: 50 });
    strictEqual(page.items[0].id, 'm1');
    strictEqual(mock.calls[0].path, `/${ACC}/chats/CH1/messages`);
    deepStrictEqual(Object.fromEntries(mock.calls[0].query), {
      user_id: USER, after: '2026-10-01T00:00:00.000Z', offset: '5', limit: '50',
    });
    await rejects(() => listMessages(ACC, 'CH1', { before: 'hier' }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
  });
});

Deno.test('getMessage : GET /{acc}/chats/{chat}/messages/{message}', async () => {
  await withMockTransport(() => jsonResponse({ id: 'M1', chat_id: 'CH1', sender_id: USER, timestamp: 't', is_sender: true }), async (mock) => {
    const m = await getMessage(ACC, 'CH1', 'M1');
    strictEqual(m.is_sender, true);
    strictEqual(mock.calls[0].path, `/${ACC}/chats/CH1/messages/M1`);
  });
});

// ---------------------------------------------------------------------------
// startChat
// ---------------------------------------------------------------------------

Deno.test('startChat : POST /{acc}/chats/send {text, users_ids} ; message_id normalisé', async () => {
  await withMockTransport(() => jsonResponse({ object: 'ChatStarted', chat_id: 'CH9', message_id: 'MSG9' }), async (mock) => {
    const out = await startChat({ accountId: ACC, user: USER, text: 'Bonjour' });
    deepStrictEqual(out, { outcome: 'sent', messageId: 'MSG9', messageIds: ['MSG9'], chatId: 'CH9' });
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, `/${ACC}/chats/send`);
    deepStrictEqual(mock.calls[0].body, { text: 'Bonjour', users_ids: USER });
  });
});

Deno.test('startChat : message_id tableau (pièces jointes séparées) ou nul avec texte vide', async () => {
  await withMockTransport(() => jsonResponse({ object: 'ChatStarted', chat_id: 'CH9', message_id: ['A', 'B', 'A'] }), async () => {
    const out = await startChat({ accountId: ACC, user: USER, text: 'Bonjour' });
    deepStrictEqual(out, { outcome: 'sent', messageId: 'A', messageIds: ['A', 'B'], chatId: 'CH9' });
  });
  await withMockTransport(() => jsonResponse({ object: 'ChatStarted', chat_id: 'CH9', message_id: null }), async () => {
    const out = await startChat({ accountId: ACC, user: USER, text: '' });
    deepStrictEqual(out, { outcome: 'sent', messageId: null, messageIds: [], chatId: 'CH9' });
  });
});

Deno.test('startChat : message_id nul alors qu\'un texte a été envoyé = incertain, jamais sent', async () => {
  await withMockTransport(() => jsonResponse({ object: 'ChatStarted', chat_id: 'CH9', message_id: null }), async () => {
    const out = await startChat({ accountId: ACC, user: USER, text: 'Bonjour' });
    strictEqual(out.outcome, 'uncertain');
    if (out.outcome === 'uncertain') strictEqual(out.error.kind, 'uncertain');
  });
});

Deno.test('startChat : réponse sans chat_id ou sans message_id = incertain', async () => {
  for (const answer of [{ object: 'ChatStarted', message_id: 'M1' }, { object: 'ChatStarted', chat_id: 'CH' }, 'texte', null]) {
    await withMockTransport(() => answer === null ? new Response(null, { status: 200 }) : jsonResponse(answer), async () => {
      const out = await startChat({ accountId: ACC, user: USER, text: 'Bonjour' });
      strictEqual(out.outcome, 'uncertain');
    });
  }
});

Deno.test('startChat : variante par boîte', async () => {
  await withMockTransport(() => jsonResponse({ object: 'ChatStarted', chat_id: 'CH9', message_id: 'M' }), async (mock) => {
    await startChat({ accountId: ACC, user: USER, text: 'Bonjour', inboxId: 'in_7' });
    strictEqual(mock.calls[0].path, `/${ACC}/inboxes/in_7/chats/send`);
  });
});

Deno.test('startChat : InMail classique = specifics.linkedin.classic.inmail', async () => {
  await withMockTransport(() => jsonResponse({ object: 'ChatStarted', chat_id: 'CH9', message_id: 'M' }), async (mock) => {
    await startChat({ accountId: ACC, user: USER, text: 'Bonjour', inmail: { licence: 'classic' } });
    deepStrictEqual(mock.calls[0].body, {
      text: 'Bonjour', users_ids: USER, specifics: { linkedin: { classic: { inmail: true } } },
    });
  });
});

Deno.test('startChat : InMail Recruiter = objet, signature ; Sales Navigator = objet', async () => {
  await withMockTransport(() => jsonResponse({ object: 'ChatStarted', chat_id: 'CH9', message_id: 'M' }), async (mock) => {
    await startChat({
      accountId: ACC, user: USER, text: 'Bonjour', inboxId: 'in_r',
      inmail: { licence: 'recruiter', subject: 'Un poste pour vous', signature: 'Marie, Konekt' },
    });
    deepStrictEqual(mock.calls[0].body, {
      text: 'Bonjour', users_ids: USER,
      specifics: { linkedin: { recruiter: { subject: 'Un poste pour vous', signature: 'Marie, Konekt' } } },
    });
    await startChat({ accountId: ACC, user: USER, text: 'Bonjour', inmail: { licence: 'sales_navigator', subject: 'Objet' } });
    deepStrictEqual(mock.calls[1].body, {
      text: 'Bonjour', users_ids: USER, specifics: { linkedin: { sales_navigator: { subject: 'Objet' } } },
    });
  });
});

Deno.test('startChat : InMail Recruiter sans signature ou Sales Navigator sans objet refusés avant tout appel', async () => {
  await withMockTransport(() => jsonResponse({}), async (mock) => {
    const bad = [
      { licence: 'recruiter', subject: 'x', signature: '' },
      { licence: 'recruiter', subject: '', signature: 'x' },
      { licence: 'sales_navigator', subject: ' ' },
    ] as const;
    for (const inmail of bad) {
      let threw = false;
      try {
        await startChat({ accountId: ACC, user: USER, text: 'Bonjour', inmail });
      } catch (error) {
        threw = isUnipileError(error) && error.kind === 'validation';
      }
      ok(threw);
    }
    strictEqual(mock.calls.length, 0);
  });
});

Deno.test('startChat : pièces jointes en JSON base64, send_mode transmis', async () => {
  await withMockTransport(() => jsonResponse({ object: 'ChatStarted', chat_id: 'CH9', message_id: ['A'] }), async (mock) => {
    await startChat({
      accountId: ACC, user: USER, text: '',
      attachments: [{ content: 'QUJD', contentType: 'application/pdf', filename: 'cv.pdf', sendMode: 'file' }],
    });
    deepStrictEqual(mock.calls[0].body, {
      text: '', users_ids: USER,
      attachments: [{ content: 'QUJD', content_type: 'application/pdf', filename: 'cv.pdf', send_mode: 'file' }],
    });
  });
});

Deno.test('startChat : refus du fournisseur = refused avec la nature de l\'erreur', async () => {
  await withMockTransport(() => jsonResponse({ error: 'INMAIL credits exhausted, limit reached' }, 429), async (mock) => {
    const out = await startChat({ accountId: ACC, user: USER, text: 'Bonjour' });
    strictEqual(out.outcome, 'refused');
    if (out.outcome === 'refused') strictEqual(out.kind, 'provider_limit');
    strictEqual(mock.calls.length, 1, 'jamais rejoué');
  });
  await withMockTransport(() => jsonResponse({ error: 'account disconnected, reconnect' }, 403), async () => {
    const out = await startChat({ accountId: ACC, user: USER, text: 'Bonjour' });
    strictEqual(out.outcome, 'refused');
    if (out.outcome === 'refused') strictEqual(out.kind, 'account_disconnected');
  });
});

Deno.test('startChat : 5xx, délai ou panne réseau = incertain, un seul appel', async () => {
  await withMockTransport(() => new Response('boom', { status: 502 }), async (mock) => {
    const out = await startChat({ accountId: ACC, user: USER, text: 'Bonjour' });
    strictEqual(out.outcome, 'uncertain');
    strictEqual(mock.calls.length, 1);
  });
  await withMockTransport(() => networkError(), async (mock) => {
    const out = await startChat({ accountId: ACC, user: USER, text: 'Bonjour' });
    strictEqual(out.outcome, 'uncertain');
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('startChat : identifiant fournisseur refusé (introuvable), le slug est tenté ensuite', async () => {
  await withMockTransport((req) => {
    const body = req.body as { users_ids: string };
    return body.users_ids === USER
      ? jsonResponse({ error: 'user not found' }, 404)
      : jsonResponse({ object: 'ChatStarted', chat_id: 'CH5', message_id: 'M5' });
  }, async (mock) => {
    const out = await startChat({ accountId: ACC, user: { providerId: USER, slug: 'marie-dupont' }, text: 'Bonjour' });
    deepStrictEqual(out, { outcome: 'sent', messageId: 'M5', messageIds: ['M5'], chatId: 'CH5' });
    deepStrictEqual(mock.calls.map((c) => (c.body as { users_ids: string }).users_ids), [USER, 'marie-dupont']);
  });
});

Deno.test('startChat : deux formes refusées = la première refusation est rendue', async () => {
  await withMockTransport(() => jsonResponse({ error: 'user not found' }, 404), async (mock) => {
    const out = await startChat({ accountId: ACC, user: { providerId: USER, slug: 'marie-dupont' }, text: 'Bonjour' });
    strictEqual(out.outcome, 'refused');
    if (out.outcome === 'refused') strictEqual(out.kind, 'not_found');
    strictEqual(mock.calls.length, 2);
  });
});

Deno.test('startChat : un envoi incertain ne tente jamais la seconde forme (doublon possible)', async () => {
  await withMockTransport(() => new Response('boom', { status: 500 }), async (mock) => {
    const out = await startChat({ accountId: ACC, user: { providerId: USER, slug: 'marie-dupont' }, text: 'Bonjour' });
    strictEqual(out.outcome, 'uncertain');
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('startChat : références inutilisables et ancien identifiant de compte jettent une erreur', async () => {
  await withMockTransport(() => jsonResponse({}), async (mock) => {
    await rejects(() => startChat({ accountId: ACC, user: '', text: 'x' }), (e: unknown) => isUnipileError(e) && e.kind === 'validation');
    await rejects(() => startChat({ accountId: 'old-id', user: USER, text: 'x' }), OutdatedAccountIdError);
    strictEqual(mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

Deno.test('sendMessage : POST /{acc}/chats/{chat}/messages/send {text}', async () => {
  await withMockTransport(() => jsonResponse(fixtures.messageSent('MSG1')), async (mock) => {
    const out = await sendMessage({ accountId: ACC, chatId: 'CH1', text: 'Merci pour votre retour' });
    deepStrictEqual(out, { outcome: 'sent', messageId: 'MSG1', messageIds: ['MSG1'], chatId: null });
    strictEqual(mock.calls[0].method, 'POST');
    strictEqual(mock.calls[0].path, `/${ACC}/chats/CH1/messages/send`);
    deepStrictEqual(mock.calls[0].body, { text: 'Merci pour votre retour' });
  });
});

Deno.test('sendMessage : quote_id et pièces jointes ; identifiants multiples normalisés', async () => {
  await withMockTransport(() => jsonResponse(fixtures.messageSent(['A', 'B'])), async (mock) => {
    const out = await sendMessage({
      accountId: ACC, chatId: 'CH1', text: 'Voir ci-joint', quoteId: 'MQ',
      attachments: [{ content: 'QUJD', contentType: 'application/pdf', filename: 'fiche.pdf' }],
    });
    deepStrictEqual(out, { outcome: 'sent', messageId: 'A', messageIds: ['A', 'B'], chatId: null });
    deepStrictEqual(mock.calls[0].body, {
      text: 'Voir ci-joint', quote_id: 'MQ',
      attachments: [{ content: 'QUJD', content_type: 'application/pdf', filename: 'fiche.pdf' }],
    });
  });
});

Deno.test('sendMessage : message_id nul avec un texte = incertain ; réponse sans message_id = incertain', async () => {
  await withMockTransport(() => jsonResponse(fixtures.messageSent(null)), async () => {
    strictEqual((await sendMessage({ accountId: ACC, chatId: 'CH1', text: 'Bonjour' })).outcome, 'uncertain');
  });
  await withMockTransport(() => jsonResponse({ object: 'MessageSent' }), async () => {
    strictEqual((await sendMessage({ accountId: ACC, chatId: 'CH1', text: 'Bonjour' })).outcome, 'uncertain');
  });
});

Deno.test('sendMessage : chat en lecture seule ou compte limité = refused ; 5xx = incertain', async () => {
  await withMockTransport(() => jsonResponse({ error: 'chat is readonly' }, 403), async () => {
    const out = await sendMessage({ accountId: ACC, chatId: 'CH1', text: 'Bonjour' });
    strictEqual(out.outcome, 'refused');
    if (out.outcome === 'refused') strictEqual(out.kind, 'forbidden');
  });
  await withMockTransport(() => new Response('', { status: 503 }), async (mock) => {
    strictEqual((await sendMessage({ accountId: ACC, chatId: 'CH1', text: 'Bonjour' })).outcome, 'uncertain');
    strictEqual(mock.calls.length, 1);
  });
});

Deno.test('sendMessage : texte non textuel et quote_id vide refusés avant tout appel', async () => {
  await withMockTransport(() => jsonResponse(fixtures.messageSent()), async (mock) => {
    await rejects(
      () => sendMessage({ accountId: ACC, chatId: 'CH1', text: undefined as unknown as string }),
      (e: unknown) => isUnipileError(e) && e.kind === 'validation',
    );
    await rejects(
      () => sendMessage({ accountId: ACC, chatId: 'CH1', text: 'x', quoteId: '' }),
      (e: unknown) => isUnipileError(e) && e.kind === 'validation',
    );
    strictEqual(mock.calls.length, 0);
  });
});
