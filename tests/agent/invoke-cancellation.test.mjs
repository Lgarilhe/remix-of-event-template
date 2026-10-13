import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
function load(file, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(file, root), 'utf8')
    .replace(/import\.meta\.env\.VITE_SUPABASE_URL/g, 'globalThis.edgeUrl')
    .replace(/import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY/g, '"fixture-key"');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: name => {
    assert.ok(name in dependencies, `Unmocked dependency ${name}`);
    return dependencies[name];
  }, ...globals });
  return exports;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
const session = token => ({ data: { session: { access_token: token } }, error: null });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness({ fetch: transport = async () => json({ success: true }), edgeUrl = 'http://fixture.test',
  getSession = async () => session('initial-token'), refreshSession = async () => session('new-token'),
  getOrg = async () => 'org-a', timeout } = {}) {
  const calls = [], toasts = [], logs = [], timers = new Set(), timeouts = [];
  const clearTimer = timer => { timers.delete(timer); clearTimeout(timer); };
  const globals = {
    edgeUrl, Response, AbortController,
    console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    window: { setTimeout: (callback, ms) => {
      timeouts.push(ms);
      const timer = setTimeout(callback, timeout ?? ms); timers.add(timer); return timer;
    } },
    clearTimeout: clearTimer,
    fetch: async (url, options) => { calls.push({ url, options }); return transport(url, options); },
  };
  const edge = load('src/lib/invokeEdgeFunction.ts', {
    '@/integrations/supabase/client': { supabase: { auth: { getSession, refreshSession } } },
    '@/lib/orgContext': { getActiveOrganizationId: getOrg },
  }, globals);
  const credits = load('src/lib/invokeWithCredits.ts', {
    '@/lib/invokeEdgeFunction': edge,
    '@/types/aiCredits': load('src/types/aiCredits.ts'),
    sonner: { toast: { error: (...args) => toasts.push(args) } },
  }, globals);
  return { ...edge, ...credits, calls, toasts, logs, timers, timeouts };
}
function assertCancelled(result) {
  assert.equal(result.error?.name, 'AbortError');
  assert.equal(result.error?.code, 'ABORTED');
  assert.equal(result.data.error_code, 'ABORTED');
  assert.doesNotMatch(result.error.message, /trop de temps|timeout/i);
}

for (const phase of ['pre-auth', 'model request', 'response body']) {
test(`external cancellation aborts the real HTTP ${phase}`, { timeout: 5000 }, async () => {
  const received = deferred(), disconnected = deferred(), paths = [];
  const server = createServer((request, response) => {
    paths.push(request.url);
    if (phase !== 'pre-auth' && request.url === '/functions/v1/ai-credits') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ has_credits: true }));
      return;
    }
    response.once('close', () => disconnected.resolve(!response.writableEnded));
    request.resume();
    if (phase === 'response body') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"reply":');
    }
    received.resolve();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const h = harness({ edgeUrl: `http://127.0.0.1:${server.address().port}`, fetch });
    const controller = new AbortController();
    const pending = h.invokeWithCredits('sourcing-interview', 'sourcing_interview', {}, { signal: controller.signal });
    await received.promise;
    controller.abort();
    assertCancelled(await pending);
    assert.equal(await disconnected.promise, true, 'the HTTP connection was cancelled');
    assert.deepEqual(paths, phase === 'pre-auth' ? ['/functions/v1/ai-credits']
      : ['/functions/v1/ai-credits', '/functions/v1/sourcing-interview']);
    assert.equal(h.toasts.length, 0);
    assert.equal(h.logs.length, 0);
    assert.equal(h.timers.size, 0);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  }
});
}

test('an already aborted request does not resolve the organization, session, or make an HTTP request', async () => {
  const controller = new AbortController(); controller.abort('closed');
  const h = harness({
    getOrg: () => { throw new Error('Unexpected org lookup'); },
    getSession: () => { throw new Error('Unexpected session lookup'); },
  });
  for (const skipCreditCheck of [false, true]) {
    assertCancelled(await h.invokeWithCredits('sourcing-interview', 'sourcing_interview', {}, {
      signal: controller.signal, skipCreditCheck,
    }));
  }
  assert.equal(h.calls.length, 0);
  assert.equal(h.logs.length, 0);
});

test('cancellation during organization or session resolution prevents the HTTP request', async () => {
  for (const dependency of ['getOrg', 'getSession']) {
    const controller = new AbortController();
    const entered = deferred(), resolution = deferred();
    const h = harness({ [dependency]: () => { entered.resolve(); return resolution.promise; } });
    const pending = h.invokeEdgeFunction('sourcing-interview', {}, { signal: controller.signal });
    await entered.promise;
    controller.abort();
    resolution.resolve(dependency === 'getOrg' ? 'org-a' : session('initial-token'));
    assertCancelled(await pending);
    assert.equal(h.calls.length, 0);
  }
});

test('cancellation on a 401 does not refresh or retry the request', async () => {
  const controller = new AbortController();
  let refreshes = 0;
  const h = harness({ fetch: async () => { controller.abort(); return json({}, 401); },
    refreshSession: async () => { refreshes++; return session('new-token'); } });
  assertCancelled(await h.invokeEdgeFunction('sourcing-interview', {}, { signal: controller.signal }));
  assert.equal(refreshes, 0);
  assert.equal(h.calls.length, 1);
});

test('cancellation while refreshing a session prevents the retry', async () => {
  const controller = new AbortController(), refreshing = deferred(), refreshed = deferred();
  const h = harness({ fetch: async () => json({}, 401),
    refreshSession: () => { refreshing.resolve(); return refreshed.promise; } });
  const pending = h.invokeEdgeFunction('sourcing-interview', {}, { signal: controller.signal });
  await refreshing.promise;
  controller.abort();
  refreshed.resolve(session('new-token'));
  assertCancelled(await pending);
  assert.equal(h.calls.length, 1);
  assert.equal(h.timers.size, 0);
});

test('both successful credit steps use the external signal and clean up its listeners', async () => {
  const controller = new AbortController();
  let added = 0, removed = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => { added++; return add(...args); };
  controller.signal.removeEventListener = (...args) => { removed++; return remove(...args); };
  const h = harness({ fetch: async url => url.endsWith('/ai-credits') ? json({ has_credits: true }) : json({ reply: 'Quel budget ?' }) });
  const result = await h.invokeWithCredits('sourcing-interview', 'sourcing_interview', {}, { signal: controller.signal });
  assert.equal(result.error, null);
  assert.equal(result.data.reply, 'Quel budget ?');
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.timeouts, [55_000, 90_000], 'the sourcing interview allows its billed correction to finish');
  assert.equal(added, 2);
  assert.equal(removed, added);
  assert.equal(h.timers.size, 0);
});

test('an internal timeout remains a timeout and does not abort the caller signal', async () => {
  const controller = new AbortController();
  const h = harness({ timeout: 5, fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const result = await h.invokeEdgeFunction('sourcing-interview', {}, { signal: controller.signal });
  assert.match(result.error.message, /trop de temps/);
  assert.equal(result.error.code, undefined);
  assert.equal(controller.signal.aborted, false);
  assert.equal(h.timers.size, 0);
});

test('default session recovery and graceful pre-auth network failures remain unchanged', async () => {
  const h = harness({ fetch: async (url, options) => {
    if (url.endsWith('/ai-credits')) throw new TypeError('Failed to fetch');
    return options.headers.Authorization === 'Bearer initial-token' ? json({}, 401) : json({ success: true });
  } });
  const result = await h.invokeWithCredits('sourcing-interview', 'sourcing_interview');
  assert.equal(result.error, null);
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[2].options.headers.Authorization, 'Bearer new-token');
  const body = JSON.parse(h.calls[2].options.body);
  assert.equal(body.organization_id, 'org-a');
  assert.equal(body._ai_action, 'sourcing_interview');
  assert.equal(h.toasts.length, 0);
});
