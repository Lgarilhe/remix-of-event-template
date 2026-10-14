import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build, transformSync } from 'esbuild';

const { code } = transformSync(readFileSync('src/lib/missionAppearance.ts', 'utf8'), { loader: 'ts', format: 'esm' });
const appearance = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('Mission markers are deterministic, and unsafe or obsolete preferences fall back to defaults', () => {
  const { defaultMissionAppearance, parseMissionAppearance, MISSION_COLORS } = appearance;
  assert.deepEqual(defaultMissionAppearance('mission-a'), defaultMissionAppearance('mission-a'));
  assert.ok(MISSION_COLORS.includes(defaultMissionAppearance('mission-a').color));
  assert.deepEqual(parseMissionAppearance('{"icon":"dot","color":"teal"}'), { icon: 'dot', color: 'teal' });
  assert.deepEqual(parseMissionAppearance('{"icon":"code","color":"violet"}'), { icon: 'code', color: 'violet' });
  for (const raw of [null, '', 'null', 'broken', '[]', '{"icon":"javascript","color":"teal"}', '{"icon":"code","color":"red"}']) {
    assert.equal(parseMissionAppearance(raw), null);
  }
});

const result = await build({
  entryPoints: ['src/hooks/sidebar/useUnreadMessages.ts'], bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'query-boundary', setup(builder) {
    builder.onResolve({ filter: /^(@tanstack\/react-query|@\/hooks\/useAuthReady|@\/hooks\/useOrganization|@\/integrations\/supabase\/client)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: {
      '@tanstack/react-query': 'export const useQuery = options => { globalThis.__unreadTest.options = options; return globalThis.__unreadTest.result; };',
      '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: globalThis.__unreadTest.user });',
      '@/hooks/useOrganization': 'export const useOrganization = () => globalThis.__unreadTest.org;',
      '@/integrations/supabase/client': 'export const supabase = { from: table => globalThis.__unreadTest.from(table) };',
    }[args.path], loader: 'js' }));
  } }],
});
const { useUnreadMessages } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
function harness(response = { count: 21, error: null }) {
  const calls = [];
  const query = {};
  for (const method of ['select', 'eq', 'or']) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  query.is = (...args) => { calls.push(['is', ...args]); return Promise.resolve(response); };
  globalThis.__unreadTest = {
    user: { id: 'user-a' }, org: { organizationId: 'org-a', isLoading: false }, result: { data: undefined, isError: false },
    from: table => { calls.push(['from', table]); return query; },
  };
  return { calls, state: globalThis.__unreadTest };
}

test('Unread count uses all unread messages, scoped to the user and organization, without a row or age cap', async () => {
  const { calls, state } = harness();
  assert.equal(useUnreadMessages().count, null, 'loading must not claim zero unread messages');
  assert.equal(await state.options.queryFn(), 21);
  assert.deepEqual(calls, [
    ['from', 'notifications'], ['select', 'id', { count: 'exact', head: true }], ['eq', 'user_id', 'user-a'],
    ['or', 'organization_id.eq.org-a,organization_id.is.null'], ['eq', 'type', 'new_message'], ['is', 'read_at', null],
  ]);
  assert.deepEqual(state.options.queryKey, ['sidebar', 'unread-messages', 'user-a', 'org-a']);
  state.result = { data: 0, isError: false };
  assert.equal(useUnreadMessages().count, 0);
});

test('Unread count preserves query errors and waits for authentication and organization readiness', async () => {
  const error = new Error('Database unavailable');
  const { state } = harness({ count: null, error });
  useUnreadMessages();
  await assert.rejects(state.options.queryFn(), error);
  state.result = { data: undefined, isError: true };
  assert.deepEqual(useUnreadMessages(), { count: null, unavailable: true });
  state.user = null;
  useUnreadMessages();
  assert.equal(state.options.enabled, false);
  state.user = { id: 'user-b' };
  state.org.isLoading = true;
  useUnreadMessages();
  assert.equal(state.options.enabled, false);
  state.org = { organizationId: 'org-b', isLoading: false };
  useUnreadMessages();
  assert.deepEqual(state.options.queryKey, ['sidebar', 'unread-messages', 'user-b', 'org-b']);
});
