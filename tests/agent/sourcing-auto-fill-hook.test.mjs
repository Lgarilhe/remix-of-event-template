import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

// Run the complete hook and its shared mapper. Only scheduling and external
// boundaries are doubled; paid generation, persistence and network are forbidden.
function scheduler() {
  const slots = [], pending = [];
  let index = 0;
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  return {
    hooks: {
      useRef(value) { const i = index++; return slots[i] ??= { current: value }; },
      useCallback(fn, deps) {
        const i = index++;
        if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { fn, deps };
        return slots[i].fn;
      },
      useEffect(fn, deps) {
        const i = index++;
        const slot = slots[i] ??= {};
        if (changed(slot.deps, deps)) pending.push({ slot, fn, deps });
      },
    },
    render(fn) {
      index = 0;
      fn();
      const effects = pending.splice(0);
      for (const { slot } of effects) slot.cleanup?.();
      for (const { slot, fn, deps } of effects) { slot.deps = deps; slot.cleanup = fn(); }
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

function modules(overrides) {
  const cache = new Map();
  const forbidden = () => { throw new Error('Unexpected real network or paid call'); };
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, fetch: forbidden });
  function load(path) {
    if (Object.hasOwn(overrides, path)) return overrides[path];
    if (cache.has(path)) return cache.get(path);
    const file = path.startsWith('@/') ? 'src/' + path.slice(2) + '.ts' : path;
    const source = readFileSync(new URL(file, root), 'utf8');
    const compiled = ts.transpileModule(source, { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const exports = {};
    cache.set(path, exports);
    const run = vm.runInContext('(function (exports, require) {\n' + compiled + '\n})', context, { filename: file });
    run(exports, request => load(request.startsWith('.')
      ? posix.normalize(posix.join(posix.dirname(file), request)) : request));
    return exports;
  }
  return load;
}

function harness(initial = {}, account = 'account-a') {
  const react = scheduler(), requests = [], pending = [], messages = [], applied = [];
  const forbidden = () => { throw new Error('Unexpected real network, paid generation or write'); };
  const load = modules({
    react: react.hooks,
    sonner: { toast: { error: message => messages.push(message) } },
    '@/lib/invokeUnipile': { invokeUnipile(options) {
      assert.equal(options.body.action, 'get_parameters');
      assert.equal(options.body.type, 'LOCATION');
      const task = deferred();
      requests.push(plain(options.body)); pending.push(task);
      return task.promise;
    } },
    '@/lib/invokeWithCredits': { invokeWithCredits: forbidden },
    '@/integrations/supabase/client': { supabase: new Proxy({}, { get: forbidden }) },
  });
  const { INITIAL_FILTERS } = load('@/components/outreach/types');
  const { useAutoFillFilters } = load('@/hooks/useAutoFillFilters');
  const filtersRef = { current: { ...plain(INITIAL_FILTERS), ...plain(initial) } };
  let selectedAccount = account, actions;
  const setFilters = update => {
    filtersRef.current = typeof update === 'function' ? update(filtersRef.current) : update;
    applied.push(plain(filtersRef.current));
  };
  const render = () => react.render(() => { actions = useAutoFillFilters({ selectedAccount, filtersRef, setFilters }); });
  render();
  return {
    requests, pending, messages, applied,
    get actions() { return actions; },
    get filters() { return filtersRef.current; },
    edit(patch, rerender = true) {
      filtersRef.current = { ...filtersRef.current, ...plain(patch) };
      if (rerender) render();
    },
    account(value) { selectedAccount = value; render(); },
    render,
    unmount: () => react.unmount(),
  };
}

const generated = patch => ({
  keywords: '', role: [], seniority: [], years_of_experience_min: null, years_of_experience_max: null,
  skills_keywords: [], industry_keywords: [], location_keywords: [], company_keywords: [], school: [],
  spotlight: '', ...patch,
});
const role = (keywords, priority = 'MUST_HAVE', scope = 'CURRENT') => ({ keywords, priority, scope });
const location = (id = '100', scope = 'CURRENT') => ({ id, name: 'Manual location', priority: 'MUST_HAVE', scope });
const resolved = (id = '200', title = 'Paris') => ({ data: { success: true, items: [{ id, title }] } });

for (const [api, scope] of [['classic', 'CURRENT_OR_PAST'], ['sales_navigator', 'CURRENT'], ['recruiter', 'PAST']]) {
  test(`${api} legacy auto-fill keeps manual keywords, required roles, exclusions and location`, async () => {
    const prior = [role('Architecture', 'MUST_HAVE', scope), role('Intern', 'DOESNT_HAVE', scope)];
    const manualLocation = location('100', api === 'recruiter' ? 'OPEN_TO_RELOCATE_ONLY' : 'CURRENT');
    const h = harness({ api, keywords: 'Python', role: prior, location: [manualLocation] });
    await h.actions.handleAutoFillFilters(generated({
      keywords: 'Distributed systems', role: [role('Backend Engineer', 'MUST_HAVE', scope)], location_keywords: ['Paris'],
    }));
    assert.equal(h.filters.keywords, '(Python) AND (Distributed systems)');
    assert.deepEqual(plain(h.filters.role), [role('Backend Engineer', 'MUST_HAVE', scope), ...prior]);
    assert.deepEqual(plain(h.filters.location), [manualLocation]);
    assert.equal(h.requests.length, 0);
    assert.equal(h.messages.length, 0);
  });
}

test('partial legacy generation preserves manual schools and both native and calculated experience', async () => {
  const school = [{ id: '12', name: 'Manual school', priority: 'DOESNT_HAVE' }];
  const h = harness({ api: 'recruiter', school, years_of_experience_min: 5, years_of_experience_max: 10,
    calculated_experience_min: 3, calculated_experience_max: 12 });
  await h.actions.handleAutoFillFilters(generated({ keywords: 'Rust' }));
  assert.deepEqual(plain(h.filters.school), school);
  assert.equal(h.filters.years_of_experience_min, 5);
  assert.equal(h.filters.years_of_experience_max, 10);
  assert.equal(h.filters.calculated_experience_min, 3);
  assert.equal(h.filters.calculated_experience_max, 12);
});

test('zero generated experience uses the shared calculated range and clears native experience', async () => {
  const h = harness({ api: 'recruiter', years_of_experience_min: 5, years_of_experience_max: 10 });
  await h.actions.handleAutoFillFilters(generated({ years_of_experience_min: 0, years_of_experience_max: 2 }));
  assert.equal(h.filters.calculated_experience_min, 0);
  assert.equal(h.filters.calculated_experience_max, 2);
  assert.equal(h.filters.years_of_experience_min, null);
  assert.equal(h.filters.years_of_experience_max, null);
});

test('legacy explicit school priorities and a missing calculated experience bound retain their meaning', async () => {
  const schools = [
    { id: '12', name: 'Required school', priority: 'MUST_HAVE' },
    { id: '13', name: 'Excluded school', priority: 'DOESNT_HAVE' },
  ];
  const h = harness({ api: 'recruiter', years_of_experience_min: 5, years_of_experience_max: 10,
    calculated_experience_min: 3, calculated_experience_max: 12 });
  await h.actions.handleAutoFillFilters(generated({ school: schools, years_of_experience_min: 0 }));
  assert.deepEqual(plain(h.filters.school), schools);
  assert.equal(h.filters.calculated_experience_min, 0);
  assert.equal(h.filters.calculated_experience_max, 12);
  assert.equal(h.filters.years_of_experience_min, null);
  assert.equal(h.filters.years_of_experience_max, null);

  h.render();
  await h.actions.handleAutoFillFilters(generated({ years_of_experience_max: 8 }));
  assert.equal(h.filters.calculated_experience_min, 0);
  assert.equal(h.filters.calculated_experience_max, 8);
});

test('different manual and generated alternatives are rejected before any location request or update', async () => {
  const h = harness({ api: 'sales_navigator', role: [role('Platform Engineer', 'CAN_HAVE')] });
  const before = plain(h.filters);
  await h.actions.handleAutoFillFilters(generated({ role: [role('Backend Engineer', 'CAN_HAVE')], location_keywords: ['Paris'] }));
  assert.deepEqual(plain(h.filters), before);
  assert.equal(h.applied.length, 0);
  assert.equal(h.requests.length, 0);
  assert.match(h.messages[0], /alternatives existantes et générées diffèrent/i);
});

for (const [api, service, scope] of [['classic', 'CLASSIC', 'CURRENT'], ['sales_navigator', 'SALES_NAVIGATOR', 'CURRENT'], ['recruiter', 'RECRUITER', 'CURRENT_OR_OPEN_TO_RELOCATE']]) {
  test(`${api} legacy location resolution uses the shared licence service and scope`, async () => {
    const h = harness({ api });
    const request = h.actions.handleAutoFillFilters(generated({ location_keywords: ['Paris'] }));
    assert.equal(h.requests[0].service, service);
    h.pending[0].resolve(resolved());
    await request;
    assert.deepEqual(plain(h.filters.location), [{ id: '200', name: 'Paris', priority: 'MUST_HAVE', scope }]);
  });
}

for (const rerender of [true, false]) {
  test(`manual edits during location resolution reject the complete stale update (rerender=${rerender})`, async () => {
    const h = harness({ api: 'recruiter', keywords: 'Python', years_of_experience_min: 8 });
    const request = h.actions.handleAutoFillFilters(generated({
      keywords: 'Rust', role: [role('Backend Engineer')], years_of_experience_min: 0, location_keywords: ['Paris'],
    }));
    assert.equal(h.applied.length, 0, 'mapping must finish before any partial update');
    h.edit({ keywords: 'Manual keyword', role: [role('Manual title')], location: [location('500')] }, rerender);
    const manual = plain(h.filters);
    h.pending[0].resolve(resolved());
    await request;
    assert.deepEqual(plain(h.filters), manual);
    assert.equal(h.filters.years_of_experience_min, 8);
    assert.equal(h.applied.length, 0);
    assert.equal(h.messages.length, 0);
  });
}

for (const change of ['account', 'licence', 'unmount']) {
  test(`${change} change during mapping prevents stale legacy auto-fill`, async () => {
    const h = harness({ api: 'classic' });
    const callback = h.actions.handleAutoFillFilters;
    const request = callback(generated({ keywords: 'Old generation', location_keywords: ['Paris'] }));
    if (change === 'account') h.account('account-b');
    if (change === 'licence') h.edit({ api: 'recruiter' });
    if (change === 'unmount') h.unmount();
    const after = plain(h.filters);
    h.pending[0].resolve(resolved());
    await request;
    await callback(generated({ location_keywords: ['Old callback'] }));
    assert.deepEqual(plain(h.filters), after);
    assert.equal(h.applied.length, 0);
    assert.equal(h.requests.length, 1, 'stale callbacks must not start another request');
    assert.equal(h.messages.length, 0);
  });
}

test('a newer legacy generation wins when the older location request finishes last', async () => {
  const h = harness({ api: 'recruiter' });
  const old = h.actions.handleAutoFillFilters(generated({ keywords: 'Old keyword', role: [role('Old title')], location_keywords: ['Paris'] }));
  await h.actions.handleAutoFillFilters(generated({ keywords: 'New keyword', role: [role('New title')] }));
  const latest = plain(h.filters);
  h.pending[0].resolve(resolved());
  await old;
  assert.deepEqual(plain(h.filters), latest);
  assert.equal(h.filters.keywords, 'New keyword');
  assert.equal(h.applied.length, 1);
});

test('without an account legacy auto-fill maps constraints without starting location or paid requests', async () => {
  const h = harness({ api: 'classic' }, null);
  await h.actions.handleAutoFillFilters(generated({ role: [role('Engineer', 'MUST_HAVE', 'CURRENT_OR_PAST')], location_keywords: ['Paris'] }));
  assert.deepEqual(plain(h.filters.role), [role('Engineer', 'MUST_HAVE', 'CURRENT_OR_PAST')]);
  assert.equal(h.requests.length, 0);
});
