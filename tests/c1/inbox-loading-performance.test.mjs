import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Le vrai hook et ses effets tournent avec un ordonnanceur et des transports
// contrôlés. Aucun compte, appel fournisseur ou génération IA n'est utilisé.
const fixtures = {
  react: `const f=()=>globalThis.__inboxHookTest;
    const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
    export function useRef(initial){const s=f(),i=s.cursor++;return s.slots[i]??={current:initial};}
    export function useState(initial){const s=f(),i=s.cursor++;if(!(i in s.slots))s.slots[i]=typeof initial==='function'?initial():initial;return [s.slots[i],v=>{const next=typeof v==='function'?v(s.slots[i]):v;if(!Object.is(next,s.slots[i])){s.slots[i]=next;s.dirty=true;}}];}
    export function useReducer(reducer,initial){const [state,set]=useState(initial);const dispatch=useRef(null);dispatch.current??=(action)=>set(value=>reducer(value,action));return [state,dispatch.current];}
    export function useMemo(fn,deps){const s=f(),i=s.cursor++;if(!s.slots[i]||!same(s.slots[i].deps,deps))s.slots[i]={deps,value:fn()};return s.slots[i].value;}
    export function useCallback(fn,deps){return useMemo(()=>fn,deps);}
    export function useEffect(fn,deps){const s=f(),i=s.cursor++;if(!s.slots[i]||!same(s.slots[i].deps,deps)){const previous=s.slots[i];s.slots[i]={deps,cleanup:previous?.cleanup};s.effects.set(i,()=>{previous?.cleanup?.();s.slots[i].cleanup=fn();});}}`,
  '@/hooks/useAuthReady': `export const useAuthReady=()=>globalThis.__inboxHookTest.auth;`,
  '@/hooks/useOrganization': `export const useOrganization=()=>({organizationId:globalThis.__inboxHookTest.org});`,
  '@/hooks/sidebar/useNow': `export const useNow=()=>Date.parse('2026-10-09T10:00:00Z');`,
  './useChatCategories': `export const useChatCategories=()=>globalThis.__inboxHookTest.categories;`,
  './useChatStatus': `export const useChatStatus=()=>globalThis.__inboxHookTest.status;export const getEffectiveStatus=()=> 'active';`,
  '@/integrations/supabase/client': `export const supabase={from:table=>globalThis.__inboxHookTest.query(table),functions:{invoke:()=>{throw new Error('Unexpected model call');}}};`,
  '@/lib/invokeUnipile': `export const invokeUnipile=options=>globalThis.__inboxHookTest.request(options.body);`,
  '@/lib/invokeEdgeFunction': `export const invokeEdgeFunction=()=>{throw new Error('Unexpected edge action');};`,
  '@/lib/quotaEvents': `export const emitQuotaAction=()=>{};`,
  '@/lib/autoAnalyzeGuard': `export const autoAnalyzeKey=()=>'';export const runAutoAnalyzeOnce=()=>{throw new Error('Unexpected model call');};`,
  '@/lib/inboxEnrollments': `export const fetchInboxEnrollmentRows=async()=>{globalThis.__inboxHookTest.enrollmentReads++;return [];};export const indexInboxEnrollments=()=>new Map();`,
  sonner: `export const toast={success:(...args)=>globalThis.__inboxHookTest.toasts.push(args),error:(...args)=>globalThis.__inboxHookTest.toasts.push(args),info:()=>{}};`,
};
const bundled = await build({
  entryPoints: ['src/hooks/useMessagesInbox.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  alias: { '@': process.cwd() + '/src' },
  plugins: [{ name: 'inbox-fixtures', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => args.path in fixtures ? { path: args.path, namespace: 'fixture' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: fixtures[args.path], loader: 'js' }));
  } }],
});
const { useMessagesInbox } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const chat = (id, profile = id, timestamp = '2026-10-09T09:00:00Z') => ({ id, account_id: 'account-a', attendees: [{ provider_id: profile, name: profile }], timestamp });
const page = (chats = [], cursors = {}) => ({ data: { success: true, chats, cursors } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function setup(t, options = {}) {
  const state = {
    cursor: 0, slots: [], effects: new Map(), dirty: false, calls: [], intervals: new Map(), toasts: [],
    org: 'org-a', auth: { isReady: true, user: { id: 'user-a' } }, enrollmentReads: 0, queries: [],
    categories: { categoryFilter: 'all', categoriesMap: new Map() }, status: { statusFilter: 'all', statusMap: new Map() },
    props: { selectedAccount: 'account-a', ...options }, respond: async () => page(),
  };
  state.request = async body => {
    state.calls.push(body);
    if (body.action !== 'get_chats') return { data: { success: true, messages: [], cursor: null } };
    return state.respond(body);
  };
  state.query = table => {
    state.queries.push(table);
    const result = single => ({ data: table === 'message_analysis_cache' ? { analysis: { replySuggestions: [{ text: 'Suggestion existante', type: 'short' }] } } : single ? null : [], error: null });
    const query = new Proxy({}, { get: (_, key) => key === 'then'
      ? (resolve, reject) => Promise.resolve(result(false)).then(resolve, reject)
      : key === 'maybeSingle' ? () => Promise.resolve(result(true)) : () => query });
    return query;
  };
  const oldSet = globalThis.setInterval, oldClear = globalThis.clearInterval, oldError = console.error;
  console.error = (...args) => { state.errors ??= []; state.errors.push(args); };
  globalThis.setInterval = fn => { const id = Symbol(); state.intervals.set(id, fn); return id; };
  globalThis.clearInterval = id => state.intervals.delete(id);
  state.render = () => { globalThis.__inboxHookTest = state; state.cursor = 0; state.dirty = false; state.output = useMessagesInbox(state.props); return state.output; };
  state.flush = async () => {
    for (let n = 0; n < 12; n++) {
      if (state.dirty || !state.output) state.render();
      const effects = [...state.effects.values()]; state.effects.clear(); effects.forEach(fn => fn());
      await Promise.resolve(); await Promise.resolve();
    }
    if (state.dirty) state.render();
    return state.output;
  };
  state.unmount = () => { for (const slot of state.slots) slot?.cleanup?.(); state.effects.clear(); };
  state.poll = () => { for (const fn of [...state.intervals.values()]) fn(); };
  state.listCalls = () => state.calls.filter(call => call.action === 'get_chats');
  t.after(() => { state.unmount(); globalThis.setInterval = oldSet; globalThis.clearInterval = oldClear; console.error = oldError; });
  globalThis.__inboxHookTest = state;
  return state;
}

test('first render is loading; slow first read, refresh and poll share one small request', async t => {
  const s = setup(t), pending = deferred(); s.respond = () => pending.promise;
  assert.equal(s.render().loadingChats, true);
  await s.flush();
  const refresh = s.output.fetchChats(true); s.poll(); s.poll();
  assert.equal(s.listCalls().length, 1);
  assert.equal(s.listCalls()[0].limit, 25);
  assert.equal(s.listCalls()[0].organization_id, 'org-a');
  assert.equal(s.output.chatsError, null);
  pending.resolve(page([chat('a')])); await refresh; await s.flush();
  assert.equal(s.output.loadingChats, false);
  assert.deepEqual(s.output.filteredChats.map(c => c.id), ['a']);
});

test('token refresh with an equivalent user does not reload the list, context or selected chat', async t => {
  const s = setup(t); s.respond = async () => page([chat('a')]); await s.flush();
  s.output.setSelectedChat(s.output.chats[0]); await s.flush();
  s.output.setNewMessage('Brouillon conservé'); await s.flush();
  const queryCount = s.queries.length, contextCount = s.enrollmentReads;
  s.auth = { isReady: true, user: { id: 'user-a', token: 'renewed' } }; s.render(); await s.flush();
  assert.equal(s.listCalls().length, 1);
  assert.equal(s.queries.length, queryCount);
  assert.equal(s.enrollmentReads, contextCount);
  assert.equal(s.output.selectedChat.id, 'a');
  assert.equal(s.output.newMessage, 'Brouillon conservé');
});

test('pagination and refresh preserve older chats, merged thread ids and the last pagination cursor', async t => {
  const s = setup(t);
  s.respond = async body => !body.cursors ? page([chat('recent', 'same')], { classic: 'page-2' })
    : page([chat('old-thread', 'same', '2026-10-08T09:00:00Z'), chat('older', 'other')], { classic: 'page-3' });
  await s.flush(); await s.output.loadMoreChats(); await s.flush();
  assert.deepEqual(s.output.chats.find(c => c.id === 'recent')._mergedChatIds, ['recent', 'old-thread']);
  await s.output.fetchChats(); await s.flush();
  assert.equal(s.output.chats.length, 2);
  assert.deepEqual(s.output.chats.find(c => c.id === 'recent')._mergedChatIds, ['recent', 'old-thread']);
  await s.output.loadMoreChats();
  assert.deepEqual(s.listCalls().at(-1).cursors, { classic: 'page-3' });
});

test('polls retain loaded history and do not overlap a slow pagination request', async t => {
  const s = setup(t); s.respond = async () => page([chat('recent')], { classic: 'page-2' }); await s.flush();
  const pending = deferred(); s.respond = () => pending.promise;
  const next = s.output.loadMoreChats(); s.poll(); const refresh = s.output.fetchChats(false);
  assert.equal(s.listCalls().length, 2);
  pending.resolve(page([chat('older')], { classic: null })); await next; await refresh; await s.flush();
  s.respond = async () => page([chat('new')], { classic: 'page-2' }); s.poll(); await s.flush();
  assert.equal(s.listCalls().length, 3);
  assert.deepEqual(new Set(s.output.chats.map(c => c.id)), new Set(['new', 'recent', 'older']));
  assert.equal(s.output.hasMoreChats, false);
});

test('failed first read stays an error; explicit retry can legitimately resolve to an empty inbox', async t => {
  const s = setup(t); s.respond = async () => ({ data: { success: false, error: 'Connexion interrompue' } }); await s.flush();
  assert.equal(s.output.loadingChats, false);
  assert.equal(s.output.chatsError, 'Connexion interrompue');
  s.respond = async () => page(); await s.output.fetchChats(); await s.flush();
  assert.equal(s.output.chatsError, null);
  assert.equal(s.output.loadingChats, false);
  assert.deepEqual(s.output.chats, []);
});

test('an old account response cannot replace the new account list or hide its loading state', async t => {
  const s = setup(t), old = deferred(), fresh = deferred();
  s.respond = body => body.account_id === 'account-a' ? old.promise : fresh.promise;
  await s.flush();
  s.props = { selectedAccount: 'account-b' }; s.render(); await s.flush();
  old.resolve(page([chat('private-old-account')])); await s.flush();
  assert.equal(s.output.loadingChats, true);
  assert.deepEqual(s.output.chats, []);
  fresh.resolve(page([chat('fresh-account')])); await s.flush();
  assert.deepEqual(s.output.chats.map(c => c.id), ['fresh-account']);
  assert.equal(s.enrollmentReads, 1);
});

test('late responses after unmount cannot update state or produce success toasts', async t => {
  const s = setup(t), pending = deferred(); s.respond = () => pending.promise; await s.flush();
  const request = s.output.fetchChats(true); s.unmount(); s.dirty = false;
  pending.resolve(page([chat('late')])); await request;
  assert.equal(s.dirty, false);
  assert.deepEqual(s.toasts, []);
});


test('load all preserves each successful page and its retry cursor if a later page fails', async t => {
  const s = setup(t);
  s.respond = async body => !body.cursors ? page([chat('first')], { classic: 'page-2' })
    : body.cursors.classic === 'page-2' ? page([chat('second')], { classic: 'page-3' })
    : ({ data: { success: false, error: 'Lecture interrompue' } });
  await s.flush(); await s.output.loadAllChats(); await s.flush();
  assert.deepEqual(s.output.chats.map(c => c.id), ['first', 'second']);
  assert.equal(s.output.hasMoreChats, true);
  assert.equal(s.output.loadingAllChats, false);
  assert.equal(s.output.chatsError, 'Lecture interrompue');
  s.respond = async () => page([chat('third')], { classic: null });
  await s.output.loadAllChats(); await s.flush();
  assert.deepEqual(s.listCalls().at(-1).cursors, { classic: 'page-3' });
  assert.equal(s.output.chats.length, 3);
  assert.equal(s.output.hasMoreChats, false);
});

test('successful deletion removes only that thread and a previously started poll cannot restore it', async t => {
  const s = setup(t); s.respond = async () => page([chat('recent', 'same'), chat('secondary', 'same', '2026-10-08T09:00:00Z')]);
  await s.flush(); const pending = deferred(); s.respond = () => pending.promise;
  const refresh = s.output.fetchChats();
  s.output.removeChatFromList('recent'); await s.flush();
  assert.deepEqual(s.output.chats.map(c => c.id), ['secondary']);
  pending.resolve(page([chat('recent', 'same')])); await refresh; await s.flush();
  assert.deepEqual(s.output.chats.map(c => c.id), ['secondary']);
});

test('an older deep link resolves on page two without blocking the first page', async t => {
  const s = setup(t, { initialChatId: 'deep-old' }), pending = deferred();
  s.respond = body => !body.cursors ? Promise.resolve(page([chat('recent')], { classic: 'page-2' })) : pending.promise;
  await s.flush();
  assert.equal(s.output.loadingChats, false);
  assert.deepEqual(s.output.chats.map(c => c.id), ['recent']);
  assert.equal(s.output.selectedChat.id, 'deep-old');
  assert.equal(s.listCalls().length, 2);
  pending.resolve(page([chat('deep-old')], { classic: 'page-3' })); await s.flush();
  assert.equal(s.output.selectedChat.attendees[0].name, 'deep-old');
  assert.equal(s.listCalls().length, 2);
});

test('a later page never overrides an explicit selection made while restoring a deep link', async t => {
  const s = setup(t, { initialChatId: 'deep-old' }), pending = deferred();
  s.respond = body => !body.cursors ? Promise.resolve(page([chat('recent')], { classic: 'page-2' })) : pending.promise;
  await s.flush(); s.output.setSelectedChat(s.output.chats[0]); await s.flush();
  pending.resolve(page([chat('deep-old')], { classic: 'page-3' })); await s.flush();
  assert.equal(s.output.selectedChat.id, 'recent');
  assert.equal(s.listCalls().length, 2);
});

test('Back also cancels restoration and stops further background pages', async t => {
  const s = setup(t, { initialChatId: 'deep-old' }), pending = deferred();
  s.respond = body => !body.cursors ? Promise.resolve(page([chat('recent')], { classic: 'page-2' })) : pending.promise;
  await s.flush(); s.output.setSelectedChat(null); await s.flush();
  pending.resolve(page([chat('other')], { classic: 'page-3' })); await s.flush();
  assert.equal(s.output.selectedChat, null);
  assert.equal(s.listCalls().length, 2);
});

test('org and user changes isolate earlier data even when the account id is reused', async t => {
  const s = setup(t), old = deferred(); s.respond = () => old.promise; await s.flush();
  s.org = 'org-b'; s.auth = { isReady: true, user: { id: 'user-b' } };
  s.respond = async () => page([chat('new-scope')]); s.render(); await s.flush();
  old.resolve(page([chat('previous-scope')])); await s.flush();
  assert.deepEqual(s.output.chats.map(c => c.id), ['new-scope']);
  assert.equal(s.listCalls().length, 2);
  assert.equal(s.listCalls().at(-1).organization_id, 'org-b');
});

test('auth and organization readiness delay the first request without manufacturing empty results', async t => {
  const s = setup(t); s.auth = { isReady: false, user: null }; s.org = null;
  assert.equal(s.render().loadingChats, true); await s.flush(); assert.equal(s.listCalls().length, 0);
  s.auth = { isReady: true, user: { id: 'user-a' } }; s.render(); await s.flush();
  assert.equal(s.output.loadingChats, true); assert.equal(s.listCalls().length, 0);
  s.org = 'org-a'; s.render(); await s.flush();
  assert.equal(s.listCalls().length, 1); assert.equal(s.output.loadingChats, false);
});


test('a next-page click during a poll is queued once, then uses the current cursor', async t => {
  const s = setup(t); s.respond = async () => page([chat('recent')], { classic: 'page-2' }); await s.flush();
  const pending = deferred();
  s.respond = body => !body.cursors ? pending.promise : Promise.resolve(page([chat('older')], { classic: null }));
  s.poll(); const first = s.output.loadMoreChats(); const second = s.output.loadMoreChats();
  assert.equal(s.listCalls().length, 2);
  pending.resolve(page([chat('new')], { classic: 'ignored-head-cursor' }));
  await first; await second; await s.flush();
  assert.equal(s.listCalls().length, 3);
  assert.deepEqual(s.listCalls().at(-1).cursors, { classic: 'page-2' });
  assert.equal(s.output.chats.length, 3);
});


test('an explicit retry during a failing poll remains visible and performs one new read', async t => {
  const s = setup(t); s.respond = async () => ({ data: { success: false, error: 'Première lecture échouée' } }); await s.flush();
  const poll = deferred(); s.respond = () => poll.promise; s.poll();
  const retry = s.output.fetchChats(true); const repeated = s.output.fetchChats(true); await s.flush();
  assert.equal(s.output.loadingChats, true);
  assert.equal(s.listCalls().length, 2);
  s.respond = async () => page([chat('retried')]);
  poll.resolve({ data: { success: false, error: 'Poll échoué' } });
  await retry; await repeated; await s.flush();
  assert.equal(s.listCalls().length, 3);
  assert.equal(s.output.loadingChats, false);
  assert.equal(s.output.chatsError, null);
  assert.deepEqual(s.output.chats.map(c => c.id), ['retried']);
});


test('the first account-change render hides the previous list and thread before effects run', async t => {
  const s = setup(t);
  const previousChat = { ...chat('old-account'), last_message: { is_sender: false, timestamp: '2026-10-09T09:00:00Z' } };
  s.respond = async () => page([previousChat], { classic: 'next' }); await s.flush();
  s.output.setSelectedChat(s.output.chats[0]); await s.flush();
  assert.equal(s.output.selectedChat.id, 'old-account');
  assert.equal(s.output.threadCounts.to_reply, 1);
  const context = s.output.enrollmentsMap;
  const pending = deferred(); s.respond = () => pending.promise;
  s.props = { selectedAccount: 'account-b' };
  const immediate = s.render(); // Intentionally no flush/effect between switch and assertions.
  assert.deepEqual(immediate.chats, []);
  assert.deepEqual(immediate.filteredChats, []);
  assert.deepEqual(immediate.messages, []);
  assert.equal(immediate.selectedChat, null);
  assert.equal(immediate.loadingChats, true);
  assert.equal(immediate.chatsError, null);
  assert.equal(immediate.hasMoreChats, false);
  assert.deepEqual(immediate.threadCounts, { to_reply: 0, to_follow_up: 0, waiting: 0 });
  assert.equal(immediate.enrollmentsMap, context);
  await s.flush(); pending.resolve(page([chat('new-account')])); await s.flush();
  assert.deepEqual(s.output.chats.map(c => c.id), ['new-account']);
});


test('a deep link waits for the sending account before message, read-status or analysis requests', async t => {
  const s = setup(t, { selectedAccount: null, initialChatId: 'deep-link' });
  s.respond = async () => page([chat('deep-link')]); await s.flush();
  assert.equal(s.calls.length, 0);
  assert.equal(s.queries.includes('message_analysis_cache'), false);
  s.props = { selectedAccount: 'account-a', initialChatId: 'deep-link' };
  s.render(); await s.flush();
  assert.equal(s.output.selectedChat.id, 'deep-link');
  assert.equal(s.listCalls().length, 1);
  assert.ok(s.calls.some(call => call.action === 'get_messages' && call.chat_id === 'deep-link'));
  assert.ok(s.calls.some(call => call.action === 'mark_as_read' && call.chat_id === 'deep-link'));
  assert.ok(s.calls.every(call => call.account_id === 'account-a'));
  assert.ok(s.queries.includes('message_analysis_cache'));
});
