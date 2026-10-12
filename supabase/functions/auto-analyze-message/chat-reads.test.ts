// deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/auto-analyze-message/chat-reads.test.ts
import { deepStrictEqual, strictEqual } from 'node:assert';
import { fixtures, jsonResponse, withMockTransport } from '../_shared/unipile/testing.ts';
import { fetchChatDetails, fetchChatMessages, MESSAGES_RAW_LIMIT, MESSAGES_READ_LIMIT, toAnalysisMessages, toChatDetails } from './chat-reads.ts';

const ACC = 'acc_abc123';
const CHAT = 'CLASSIC_2-Zm9v==';

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'Message',
    id: 'm1',
    chat_id: CHAT,
    sender_id: 'ACoAAcandidate',
    timestamp: '2026-10-10T10:00:00.000Z',
    is_sender: false,
    is_event: false,
    is_hidden: false,
    is_deleted: false,
    text: 'Bonjour, oui volontiers',
    ...overrides,
  };
}

function chat(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'Chat',
    id: CHAT,
    type: '1to1',
    is_1to1: true,
    is_group: false,
    provider: 'LINKEDIN',
    user_id: 'ACoAAcandidate',
    user: {
      object: 'User',
      id: 'ACoAAcandidate',
      display_name: 'Camille Martin',
      description: 'Ingénieure logiciel',
      profile_url: 'https://www.linkedin.com/in/camille-martin',
    },
    ...overrides,
  };
}

Deno.test('toAnalysisMessages reverses to oldest first and keeps the three fields', () => {
  const out = toAnalysisMessages(
    [message({ id: 'm2', text: 'Dernier', timestamp: '2026-10-10T11:00:00.000Z' }), message({ id: 'm1', is_sender: true, text: 'Premier', timestamp: '2026-10-10T09:00:00.000Z' })],
    { accountId: ACC, chatId: CHAT },
  );
  deepStrictEqual(out, [
    { text: 'Premier', is_sender: true, timestamp: '2026-10-10T09:00:00.000Z' },
    { text: 'Dernier', is_sender: false, timestamp: '2026-10-10T11:00:00.000Z' },
  ]);
});

Deno.test('toAnalysisMessages drops system rows, hidden and deleted rows on both sides', () => {
  const out = toAnalysisMessages(
    [
      message({ id: 'call', is_event: true, text: '' }),
      message({ id: 'hidden', is_hidden: true }),
      message({ id: 'gone', is_deleted: true }),
      message({ id: 'own-event', is_sender: true, is_event: true }),
      message({ id: 'ok' }),
    ],
    { accountId: ACC, chatId: CHAT },
  );
  strictEqual(out.length, 1);
});

Deno.test('toAnalysisMessages: an invitation or an InMail decline from the candidate is not a reply', () => {
  const out = toAnalysisMessages(
    [
      message({ id: 'decline', specifics: { type: 'INMAIL_DECLINE' }, text: '' }),
      message({ id: 'accept', specifics: { type: 'INMAIL_ACCEPT' } }),
      message({ id: 'invite', specifics: { type: 'INVITATION' }, text: 'Je me présente' }),
      message({ id: 'inmail-reply', specifics: { type: 'INMAIL_REPLY' }, text: 'Merci pour votre message' }),
      message({ id: 'ours', is_sender: true, specifics: { type: 'INVITATION' }, text: 'Notre note' }),
    ],
    { accountId: ACC, chatId: CHAT },
  );
  deepStrictEqual(out.map((m) => m.text), ['Notre note', 'Merci pour votre message']);
  strictEqual(out.some((m) => !m.is_sender && m.text === 'Je me présente'), false);
});

Deno.test('toAnalysisMessages tolerates a message without text or timestamp', () => {
  const out = toAnalysisMessages([message({ text: undefined, timestamp: undefined }), 'junk', null], { accountId: ACC, chatId: CHAT });
  deepStrictEqual(out, [{ text: '', is_sender: false, timestamp: undefined }]);
});

Deno.test('toAnalysisMessages: system rows do not thin the window, the N most recent written messages are kept', () => {
  const systemRows = Array.from({ length: 10 }, (_, i) => message({ id: `ev${i}`, is_event: true, text: '' }));
  const written = Array.from({ length: 20 }, (_, i) => message({ id: `w${19 - i}`, text: `msg ${19 - i}`, is_sender: i % 2 === 0 }));
  const out = toAnalysisMessages([...systemRows, ...written], { accountId: ACC, chatId: CHAT });
  strictEqual(out.length, MESSAGES_READ_LIMIT);
  strictEqual(out[out.length - 1].text, 'msg 19', 'the newest written message ends the window');
  strictEqual(out[0].text, `msg ${20 - MESSAGES_READ_LIMIT}`, 'oldest first');
});

Deno.test('fetchChatMessages: a page that starts with ten system rows still yields the full window of written messages', async () => {
  const systemRows = Array.from({ length: 10 }, (_, i) => message({ id: `ev${i}`, is_event: true, text: '' }));
  const written = Array.from({ length: 15 }, (_, i) => message({ id: `w${i}`, text: `msg ${i}` }));
  await withMockTransport(() => jsonResponse(fixtures.page([...systemRows, ...written])), async () => {
    strictEqual((await fetchChatMessages(ACC, CHAT)).length, MESSAGES_READ_LIMIT);
  });
});

Deno.test('toChatDetails reads the other participant of a one to one chat from user', () => {
  deepStrictEqual(toChatDetails(chat(), ACC), {
    attendeeName: 'Camille Martin',
    attendeeHeadline: 'Ingénieure logiciel',
    attendeeProfileUrl: 'https://www.linkedin.com/in/camille-martin',
    attendeeProviderId: 'ACoAAcandidate',
  });
});

Deno.test('toChatDetails: group chat takes the first participant that is not the account', () => {
  const details = toChatDetails(
    chat({
      type: 'group',
      is_1to1: false,
      is_group: true,
      user: undefined,
      user_id: undefined,
      participants: [
        { is_self: true, user: { id: 'ACoAAme', display_name: 'Moi' } },
        { is_self: false, user: { id: 'ACoAAother', display_name: 'Léa Durand' } },
      ],
    }),
    ACC,
  );
  strictEqual(details.attendeeName, 'Léa Durand');
  strictEqual(details.attendeeProviderId, 'ACoAAother');
});

Deno.test('toChatDetails: only the id when the chat has no user object, nothing when it has no id either', () => {
  deepStrictEqual(toChatDetails(chat({ user: undefined }), ACC), { attendeeProviderId: 'ACoAAcandidate' });
  deepStrictEqual(toChatDetails(chat({ user: undefined, user_id: undefined }), ACC), {});
  deepStrictEqual(toChatDetails(null, ACC), {});
});

Deno.test('toChatDetails: a user without display name is named Inconnu', () => {
  strictEqual(toChatDetails(chat({ user: { id: 'ACoAAcandidate' } }), ACC).attendeeName, 'Inconnu');
});

Deno.test('fetchChatMessages reads /{acc}/chats/{chat}/messages with the limit', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([message({ id: 'm2', text: 'Dernier' }), message({ id: 'm1', is_sender: true, text: 'Premier' })])), async (mock) => {
    const out = await fetchChatMessages(ACC, CHAT);
    deepStrictEqual(out.map((m) => m.text), ['Premier', 'Dernier']);
    strictEqual(mock.calls.length, 1);
    strictEqual(mock.calls[0].path, `/${ACC}/chats/${encodeURIComponent(CHAT)}/messages`);
    strictEqual(mock.calls[0].query.get('limit'), String(MESSAGES_RAW_LIMIT));
    strictEqual(MESSAGES_RAW_LIMIT > MESSAGES_READ_LIMIT, true);
    strictEqual(mock.calls[0].url.startsWith('https://api.unipile.com/v2/'), true);
  });
});

Deno.test('fetchChatDetails reads /{acc}/chats/{chat}', async () => {
  await withMockTransport(() => jsonResponse(chat()), async (mock) => {
    const out = await fetchChatDetails(ACC, CHAT);
    strictEqual(out.attendeeName, 'Camille Martin');
    strictEqual(mock.calls[0].path, `/${ACC}/chats/${encodeURIComponent(CHAT)}`);
  });
});

Deno.test('reads fail soft: an error from the service gives an empty result', async () => {
  for (const status of [403, 404, 500]) {
    await withMockTransport(() => ({ status, body: { message: 'refus' } }), async () => {
      deepStrictEqual(await fetchChatMessages(ACC, CHAT), []);
      deepStrictEqual(await fetchChatDetails(ACC, CHAT), {});
    });
  }
});

Deno.test('reads fail soft and make no call for an outdated account id', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([message()])), async (mock) => {
    deepStrictEqual(await fetchChatMessages('abc123xyz', CHAT), []);
    deepStrictEqual(await fetchChatDetails('abc123xyz', CHAT), {});
    strictEqual(mock.calls.length, 0);
  });
});
