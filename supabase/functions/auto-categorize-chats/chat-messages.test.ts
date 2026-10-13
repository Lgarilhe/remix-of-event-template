// deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/auto-categorize-chats/chat-messages.test.ts
import { deepStrictEqual, strictEqual } from 'node:assert';
import { fixtures, jsonResponse, withMockTransport } from '../_shared/unipile/testing.ts';
import { checkChatAccounts, distinctAccountIds, gateChatAccounts } from './chat-accounts.ts';
import { fetchChatMessages, toCategorizeMessages } from './chat-messages.ts';

const ACC = 'acc_abc123';
const CHAT = 'CLASSIC_2-Zm9v==';
const ctx = { accountId: ACC, chatId: CHAT };

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
    text: 'Bonjour',
    ...overrides,
  };
}

/** Stand-in of the service client for `assertAccountOwnedByOrg`: the given (organisation, account) pairs are linked. */
function fakeAdmin(linked: Array<{ organization_id: string; linkedin_account_id: string }>, failWith?: unknown) {
  return {
    from(table: string) {
      return {
        select() {
          const filters: Record<string, string> = {};
          const chain = {
            eq(column: string, value: string) {
              filters[column] = value;
              return chain;
            },
            limit() {
              if (failWith) return Promise.resolve({ data: null, error: failWith });
              const hit = table === 'member_linkedin_accounts' &&
                linked.some((l) => l.organization_id === filters.organization_id && l.linkedin_account_id === filters.linkedin_account_id);
              return Promise.resolve({ data: hit ? [{ id: 'row-1', user_id: 'user-1' }] : [], error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

Deno.test('toCategorizeMessages: chronological order, text trimmed to 300 characters, empty texts dropped', () => {
  const out = toCategorizeMessages(
    [message({ id: 'b', text: `  ${'x'.repeat(400)}  ` }), message({ id: 'empty', text: '   ' }), message({ id: 'a', is_sender: true, text: 'Premier' })],
    ctx,
  );
  strictEqual(out.length, 2);
  deepStrictEqual(out[0], { text: 'Premier', is_sender: true });
  strictEqual(out[1].text.length, 300);
});

Deno.test('toCategorizeMessages: lifecycle rows of the candidate do not count as a reply', () => {
  const out = toCategorizeMessages(
    [
      message({ id: 'call', is_event: true, text: 'Appel manqué' }),
      message({ id: 'invite', specifics: { type: 'INVITATION' }, text: 'Bonjour, connectons-nous' }),
      message({ id: 'decline', specifics: { type: 'INMAIL_DECLINE' }, text: 'Non merci' }),
      message({ id: 'hidden', is_hidden: true }),
      message({ id: 'ours', is_sender: true, text: 'Notre message' }),
    ],
    ctx,
  );
  deepStrictEqual(out, [{ text: 'Notre message', is_sender: true }]);
  strictEqual(out.some((m) => !m.is_sender), false, 'no candidate reply: the chat stays no_response');
});

Deno.test('fetchChatMessages reads /{acc}/chats/{chat}/messages with the limit and fails soft', async () => {
  await withMockTransport(() => jsonResponse(fixtures.page([message({ text: 'Oui' })])), async (mock) => {
    deepStrictEqual(await fetchChatMessages(ACC, CHAT, 6), [{ text: 'Oui', is_sender: false }]);
    strictEqual(mock.calls[0].path, `/${ACC}/chats/${encodeURIComponent(CHAT)}/messages`);
    strictEqual(mock.calls[0].query.get('limit'), '12', 'twice the window, the filter runs after the page');
    strictEqual(mock.calls[0].url.startsWith('https://api.unipile.com/v2/'), true);
  });
  await withMockTransport(() => ({ status: 500, body: { message: 'panne' } }), async () => {
    deepStrictEqual(await fetchChatMessages(ACC, CHAT, 6), []);
  });
  await withMockTransport(() => jsonResponse(fixtures.page([message()])), async (mock) => {
    deepStrictEqual(await fetchChatMessages('ancien-id', CHAT, 6), []);
    strictEqual(mock.calls.length, 0, 'an outdated account id never reaches the service');
  });
});

Deno.test('fetchChatMessages: system rows at the head of the page do not thin the 6 message window', async () => {
  const systemRows = Array.from({ length: 4 }, (_, i) => message({ id: `ev${i}`, is_event: true, text: 'Appel manqué' }));
  const written = Array.from({ length: 8 }, (_, i) => message({ id: `w${7 - i}`, text: `msg ${7 - i}` }));
  await withMockTransport(() => jsonResponse(fixtures.page([...systemRows, ...written])), async () => {
    const out = await fetchChatMessages(ACC, CHAT, 6);
    strictEqual(out.length, 6);
    strictEqual(out[out.length - 1].text, 'msg 7', 'newest last');
    strictEqual(out[0].text, 'msg 2');
  });
});

Deno.test('distinctAccountIds lists each account once and ignores chats without one', () => {
  deepStrictEqual(distinctAccountIds([{ account_id: ACC }, { account_id: ACC }, { id: 'x' }, null, { account_id: '' }, { account_id: 'acc_other' }]), [ACC, 'acc_other']);
});

Deno.test('checkChatAccounts accepts accounts linked to the organisation', async () => {
  const admin = fakeAdmin([{ organization_id: 'org-1', linkedin_account_id: ACC }]);
  strictEqual(await checkChatAccounts(admin, 'org-1', [ACC]), null);
  strictEqual(await checkChatAccounts(admin, 'org-1', []), null);
});

Deno.test('checkChatAccounts refuses an account of another organisation (403) before any read', async () => {
  const admin = fakeAdmin([{ organization_id: 'org-2', linkedin_account_id: ACC }]);
  const refusal = await checkChatAccounts(admin, 'org-1', [ACC]);
  strictEqual(refusal?.status, 403);
  strictEqual(refusal?.error_code, 'ACCOUNT_NOT_LINKED');
  strictEqual(/unipile/i.test(refusal?.error ?? ''), false);
});

Deno.test('checkChatAccounts refuses an outdated account id (409) and an unreadable one (400) with a neutral message', async () => {
  const admin = fakeAdmin([{ organization_id: 'org-1', linkedin_account_id: 'abc123' }]);
  const outdated = await checkChatAccounts(admin, 'org-1', ['abc123']);
  strictEqual(outdated?.status, 409);
  strictEqual(outdated?.error_code, 'ACCOUNT_OUTDATED');
  strictEqual(/unipile|acc_/i.test(outdated?.error ?? ''), false);
  const invalid = await checkChatAccounts(admin, 'org-1', [12]);
  strictEqual(invalid?.status, 400);
  strictEqual(invalid?.error_code, 'ACCOUNT_INVALID');
});

Deno.test('checkChatAccounts: one bad account among several refuses the whole batch', async () => {
  const admin = fakeAdmin([{ organization_id: 'org-1', linkedin_account_id: ACC }]);
  strictEqual((await checkChatAccounts(admin, 'org-1', [ACC, 'acc_foreign']))?.status, 403);
});

Deno.test('checkChatAccounts: a failing lookup is an error, never a pass', async () => {
  const admin = fakeAdmin([], { message: 'db down' });
  let thrown = false;
  try {
    await checkChatAccounts(admin, 'org-1', [ACC]);
  } catch {
    thrown = true;
  }
  strictEqual(thrown, true);
});

Deno.test('gateChatAccounts: no active organisation is ORG_REQUIRED (403) and no account is looked up', async () => {
  const admin = fakeAdmin([{ organization_id: 'org-1', linkedin_account_id: ACC }]);
  const refusal = await gateChatAccounts(admin, () => Promise.resolve(null), [ACC]);
  strictEqual(refusal?.status, 403);
  strictEqual(refusal?.error_code, 'ORG_REQUIRED');
  strictEqual(/unipile/i.test(refusal?.error ?? ''), false);
});

Deno.test('gateChatAccounts: an account of another organisation is refused, a linked one passes, no account needs no organisation', async () => {
  const admin = fakeAdmin([{ organization_id: 'org-2', linkedin_account_id: ACC }]);
  strictEqual((await gateChatAccounts(admin, () => Promise.resolve('org-1'), [ACC]))?.error_code, 'ACCOUNT_NOT_LINKED');
  strictEqual(await gateChatAccounts(admin, () => Promise.resolve('org-2'), [ACC]), null);
  let resolved = 0;
  strictEqual(await gateChatAccounts(admin, () => { resolved++; return Promise.resolve(null); }, []), null);
  strictEqual(resolved, 0);
});
