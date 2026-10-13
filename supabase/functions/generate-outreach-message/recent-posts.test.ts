// deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/generate-outreach-message/recent-posts.test.ts
import { deepStrictEqual } from 'node:assert';
import { fixtures, jsonResponse, withMockTransport } from '../_shared/unipile/testing.ts';
import { fetchRecentPosts, POSTS_READ_LIMIT, sumReactions, toPromptPosts } from './recent-posts.ts';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const TEXT = 'Une publication assez longue pour être gardée dans le prompt.';

function post(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: 'Post',
    id: 'p1',
    text: TEXT,
    created_at: '2026-10-01T08:00:00.000Z',
    is_repost: false,
    reactions_counter: [{ reaction: 'LIKE', count: 7 }, { reaction: 'PRAISE', count: 3 }],
    ...overrides,
  };
}

/** Minimal stand-in of the service client for `assertAccountOwnedByOrg`: one linked LinkedIn account. */
function fakeAdmin(linked: { organization_id: string; linkedin_account_id: string; user_id?: string } | null) {
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
              const hit = table === 'member_linkedin_accounts' && linked !== null &&
                filters.organization_id === linked.organization_id && filters.linkedin_account_id === linked.linkedin_account_id &&
                (filters.user_id === undefined || filters.user_id === (linked.user_id ?? 'user-1'));
              return Promise.resolve({ data: hit ? [{ id: 'row-1', user_id: linked.user_id ?? 'user-1' }] : [], error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

Deno.test('sumReactions adds the counters and tolerates null or junk', () => {
  deepStrictEqual(sumReactions([{ reaction: 'LIKE', count: 7 }, { reaction: 'PRAISE', count: 3 }]), 10);
  deepStrictEqual(sumReactions(null), 0);
  deepStrictEqual(sumReactions([{ reaction: 'LIKE' }, null, { count: -4 }, { count: 'x' }]), 0);
});

Deno.test('toPromptPosts keeps own recent posts, in the order received, at most three', () => {
  const items = [post({ id: 'a' }), post({ id: 'b', text: `${TEXT} deux` }), post({ id: 'c', text: `${TEXT} trois` }), post({ id: 'd', text: `${TEXT} quatre` })];
  const out = toPromptPosts(items, { now: NOW });
  deepStrictEqual(out.length, 3);
  deepStrictEqual(out[0], { text: TEXT, date: new Date('2026-10-01T08:00:00.000Z').toLocaleDateString('fr-FR'), reactions: 10 });
  deepStrictEqual(out[2].text.endsWith('trois'), true);
});

Deno.test('toPromptPosts drops reposts, short texts and posts older than 90 days', () => {
  const out = toPromptPosts(
    [
      post({ id: 'repost', is_repost: true }),
      post({ id: 'short', text: 'trop court' }),
      post({ id: 'old', created_at: '2026-05-01T08:00:00.000Z' }),
      post({ id: 'ok' }),
    ],
    { now: NOW },
  );
  deepStrictEqual(out.length, 1);
});

Deno.test('toPromptPosts: no reactions gives undefined, a bad date reads as recent and is kept, text cut at 500', () => {
  const out = toPromptPosts([post({ reactions_counter: null, created_at: 'pas une date', text: 'x'.repeat(800) })], { now: NOW });
  deepStrictEqual(out.length, 1);
  deepStrictEqual(out[0].reactions, undefined);
  deepStrictEqual(out[0].date, 'récent');
  deepStrictEqual(out[0].text.length, 500);
});

Deno.test('toPromptPosts ignores items that are not objects', () => {
  deepStrictEqual(toPromptPosts([null, 'texte', 12, [], post()], { now: NOW }).length, 1);
});

Deno.test('fetchRecentPosts reads /{acc}/users/{id}/posts with a limit, for an account linked in the organisation', async () => {
  const accountId = 'acc_abc123';
  const admin = fakeAdmin({ organization_id: 'org-1', linkedin_account_id: accountId });
  await withMockTransport(() => jsonResponse(fixtures.page([post(), post({ id: 'r', is_repost: true })])), async (mock) => {
    const posts = await fetchRecentPosts({ admin, organizationId: 'org-1', userId: 'user-1' }, accountId, 'ACoAAAbcdefghij', 90);
    deepStrictEqual(posts.length, 1);
    deepStrictEqual(mock.calls.length, 1);
    deepStrictEqual(mock.calls[0].path, `/${accountId}/users/ACoAAAbcdefghij/posts`);
    deepStrictEqual(mock.calls[0].query.get('limit'), String(POSTS_READ_LIMIT));
    deepStrictEqual(mock.calls[0].url.startsWith('https://api.unipile.com/v2/'), true);
  });
});

Deno.test('fetchRecentPosts makes no provider call for an outdated (non acc_) account id', async () => {
  const admin = fakeAdmin({ organization_id: 'org-1', linkedin_account_id: 'abc123xyz' });
  await withMockTransport(() => jsonResponse(fixtures.page([post()])), async (mock) => {
    deepStrictEqual(await fetchRecentPosts({ admin, organizationId: 'org-1', userId: 'user-1' }, 'abc123xyz', 'ACoAAAbcdefghij'), []);
    deepStrictEqual(mock.calls.length, 0);
  });
});

Deno.test('fetchRecentPosts makes no provider call for an account not linked in the organisation', async () => {
  const admin = fakeAdmin({ organization_id: 'org-2', linkedin_account_id: 'acc_abc123' });
  await withMockTransport(() => jsonResponse(fixtures.page([post()])), async (mock) => {
    deepStrictEqual(await fetchRecentPosts({ admin, organizationId: 'org-1', userId: 'user-1' }, 'acc_abc123', 'ACoAAAbcdefghij'), []);
    deepStrictEqual(mock.calls.length, 0);
  });
});

Deno.test('fetchRecentPosts makes no provider call for the account of a colleague (same organisation, other member)', async () => {
  const admin = fakeAdmin({ organization_id: 'org-1', linkedin_account_id: 'acc_abc123', user_id: 'colleague' });
  await withMockTransport(() => jsonResponse(fixtures.page([post()])), async (mock) => {
    deepStrictEqual(await fetchRecentPosts({ admin, organizationId: 'org-1', userId: 'user-1' }, 'acc_abc123', 'ACoAAAbcdefghij'), []);
    deepStrictEqual(mock.calls.length, 0);
    const own = await fetchRecentPosts({ admin, organizationId: 'org-1', userId: 'colleague' }, 'acc_abc123', 'ACoAAAbcdefghij');
    deepStrictEqual(own.length, 1);
  });
});

Deno.test('fetchRecentPosts returns an empty list when the service refuses or fails', async () => {
  const admin = fakeAdmin({ organization_id: 'org-1', linkedin_account_id: 'acc_abc123' });
  for (const status of [403, 404, 422, 500]) {
    await withMockTransport(() => ({ status, body: { message: 'refus' } }), async () => {
      deepStrictEqual(await fetchRecentPosts({ admin, organizationId: 'org-1', userId: 'user-1' }, 'acc_abc123', 'ACoAAAbcdefghij'), []);
    });
  }
});

Deno.test('fetchRecentPosts without account or profile does nothing', async () => {
  const admin = fakeAdmin(null);
  await withMockTransport(() => jsonResponse(fixtures.page([])), async (mock) => {
    deepStrictEqual(await fetchRecentPosts({ admin, organizationId: 'org-1', userId: 'user-1' }, '', 'ACoAAAbcdefghij'), []);
    deepStrictEqual(await fetchRecentPosts({ admin, organizationId: 'org-1', userId: 'user-1' }, 'acc_abc123', ''), []);
    deepStrictEqual(mock.calls.length, 0);
  });
});
