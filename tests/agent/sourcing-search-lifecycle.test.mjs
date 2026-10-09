import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Execute the complete production hook bodies. Only React's scheduler and
// boundary services are doubled; requests, guards, payloads and reducers are real.
function scheduler() {
  const slots = [], scheduled = [];
  let index = 0, dirty = false, render;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const state = initial => {
    const i = index++;
    if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
    return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; dirty = true; }];
  };
  const effect = (fn, deps) => {
    const i = index++;
    if (!slots[i]) slots[i] = {};
    if (changed(slots[i].deps, deps)) scheduled.push({ slot: slots[i], fn, deps });
  };
  const hooks = {
    useRef: value => { const i = index++; return slots[i] ??= { current: value }; },
    useCallback: (fn, deps) => {
      const i = index++;
      if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, fn };
      return slots[i].fn;
    },
    useState: state,
    useReducer: (reducer, initial) => {
      const [value, set] = state(initial);
      const i = index++;
      if (!slots[i]) slots[i] = action => set(previous => reducer(previous, action));
      return [value, slots[i]];
    },
    useEffect: effect,
    useLayoutEffect: effect,
  };
  return {
    hooks,
    render(fn) {
      render = fn;
      let rounds = 0;
      do {
        assert.ok(++rounds < 50, 'hook scheduler did not settle');
        dirty = false; index = 0; render();
        const effects = scheduled.splice(0);
        for (const { slot } of effects) slot.cleanup?.();
        for (const { slot, fn, deps } of effects) { slot.deps = deps; slot.cleanup = fn(); }
      } while (dirty);
    },
    flush() { this.render(render); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

function modules(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(path) {
    if (Object.hasOwn(overrides, path)) return overrides[path];
    if (cache.has(path)) return cache.get(path);
    const file = path.startsWith('@/') ? 'src/' + path.slice(2) + '.ts' : path;
    const source = readFileSync(new URL(file, root), 'utf8');
    const transpiled = ts.transpileModule(source, { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const exports = {};
    cache.set(path, exports);
    vm.runInNewContext(transpiled, { exports, require: load, structuredClone,
      console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, ...globals }, { filename: file });
    return exports;
  }
  return load;
}

function searchHarness() {
  const react = scheduler(), pending = [], requests = [], discovered = [], messages = [], quotas = [], invalidations = [];
  const fetch = options => {
    const task = deferred(); pending.push(task); requests.push(plain(options.body)); return task.promise;
  };
  const load = modules({
    react: react.hooks,
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: input => invalidations.push(input) }) },
    sonner: { toast: Object.fromEntries(['error', 'info', 'warning'].map(kind => [kind, message => messages.push({ kind, message })])) },
    '@/lib/invokeUnipile': { invokeUnipile: fetch },
    '@/lib/invokeCoresignal': { invokeCoresignal: fetch },
    '@/lib/invokeEdgeFunction': {},
    '@/integrations/supabase/client': { supabase: {} },
    '@/lib/companyClassification': { classifyFromProfile: () => ({ type: 'other' }) },
    '@/hooks/linkedin/preScoring': { calculatePreScore: () => ({ score: 1 }) },
    '@/hooks/useBaseKonekt': { BASE_KONEKT_QUERY_KEY: 'base' },
    '@/components/outreach/calculateExperience': { filterByCalculatedExperience: profiles => profiles },
  });
  const { INITIAL_FILTERS } = load('@/components/outreach/types');
  const state = { results: [], cursor: null, hasMoreResults: true, total: null,
    hasSearched: false, loading: false, loadingMore: false, executedSearch: null };
  const setters = Object.fromEntries(Object.keys(state).map(key => ['set' + key[0].toUpperCase() + key.slice(1), value => {
    state[key] = typeof value === 'function' ? value(state[key]) : value;
  }]));
  const filters = { ...plain(INITIAL_FILTERS), api: 'recruiter', keywords: 'Python' };
  const filtersRef = { current: filters };
  let context = { organizationId: 'org-a', userId: 'user-a', selectedAccount: 'account-a',
    selectedJob: { id: 'job-a', title: 'Backend Engineer', skills: ['Python'] },
    activeProject: { id: 'project-a', kind: 'mission', job_details: { title: 'Backend Engineer' } },
    filters, filtersRef, searchSource: 'linkedin', autoHideTreatedRef: { current: true },
    quota: { canPerformAction: () => true, recordAction: (...args) => quotas.push(args), isNearLimit: () => false },
    candidateStatus: { treatedIds: new Set(), dismissedIds: new Set(), batchDiscover: async rows => { discovered.push(plain(rows)); } },
  };
  const { useLinkedInSearchActions, buildSearchParams } = load('@/hooks/useLinkedInSearchActions');
  let actions;
  const render = () => { actions = useLinkedInSearchActions({ ...context, ...state }, setters); };
  const refresh = () => react.render(render);
  refresh();
  return { state, requests, pending, messages, discovered, quotas, invalidations, buildSearchParams,
    get actions() { return actions; },
    refresh,
    change(patch) {
      context = { ...context, ...patch };
      if (patch.filters) filtersRef.current = patch.filters;
      refresh();
    },
    edit(patch) { this.change({ filters: { ...filtersRef.current, ...patch } }); },
    unmount: () => react.unmount(),
    get filters() { return filtersRef.current; },
  };
}
const page = (id, cursor = null, count = 25) => ({ data: { success: true, results: Array.from({ length: count }, (_, i) => ({
  id: id + '-' + i, name: 'Synthetic Candidate', location: 'Berlin',
})), cursor, total: 500 } });

// Out-of-order completions and errors must never commit results or clear a new spinner.
test('late search A cannot replace B results, cursor, total, discoveries or loading', async () => {
  const h = searchHarness();
  const a = h.actions.handleSearch();
  h.edit({ keywords: 'Rust' });
  const b = h.actions.handleSearch();
  h.pending[0].resolve(page('old', 'old-cursor'));
  await a;
  assert.equal(h.state.loading, true);
  assert.equal(h.state.results.length, 0);
  assert.equal(h.discovered.length, 0);
  h.pending[1].resolve(page('new', 'new-cursor'));
  await b;
  assert.equal(h.state.loading, false);
  assert.equal(h.state.cursor, 'new-cursor');
  assert.ok(h.state.results.every(profile => profile.id.startsWith('new')));
  assert.equal(h.discovered.length, 1);
  assert.equal(h.quotas.length, 2, 'served stale pages still count toward LinkedIn limits');
});

test('late failure A stays silent while successful B remains intact', async () => {
  const h = searchHarness();
  const a = h.actions.handleSearch();
  h.edit({ keywords: 'Go' });
  const b = h.actions.handleSearch();
  h.pending[1].resolve(page('new', 'new-cursor'));
  await b;
  const before = plain(h.state);
  h.pending[0].reject(new Error('old error'));
  await a;
  assert.deepEqual(plain(h.state), before);
  assert.equal(h.messages.length, 0);
});

for (const [label, patch] of [
  ['organization', { organizationId: 'org-b' }], ['user', { userId: 'user-b' }],
  ['account', { selectedAccount: 'account-b' }], ['source', { searchSource: 'database' }],
  ['mission', { activeProject: { id: 'project-b' } }],
  ['brief', { selectedJob: { id: 'job-a', title: 'Data Engineer', skills: ['SQL'] } }],
  ['memory', { searchMemoryVersionKey: 'memory-b' }],
]) test(`leaving the ${label} ignores an in-flight response and all later rounds`, async () => {
  const h = searchHarness();
  const request = h.actions.handleSearch();
  h.change(patch);
  h.pending[0].resolve(page('stale', 'cursor', 1));
  await request;
  assert.equal(h.requests.length, 1);
  assert.equal(h.state.results.length, 0);
  assert.equal(h.state.cursor, null);
  assert.equal(h.discovered.length, 0);
  assert.equal(h.state.loading, false);
});

test('unmount ignores response and performs no discoveries', async () => {
  const h = searchHarness();
  const request = h.actions.handleSearch();
  h.unmount(); h.pending[0].resolve(page('stale', 'cursor'));
  await request;
  assert.equal(h.state.results.length, 0);
  assert.equal(h.discovered.length, 0);
});

test('double first-page click and double next-page click each invoke only once', async () => {
  const h = searchHarness();
  const first = h.actions.handleSearch();
  await h.actions.handleSearch();
  assert.equal(h.requests.length, 1);
  h.pending[0].resolve(page('first', 'cursor-one')); await first; h.refresh();
  const next = h.actions.handleSearch(true);
  await h.actions.handleSearch(true);
  assert.equal(h.requests.length, 2);
  h.pending[1].resolve(page('next')); await next;
  assert.equal(h.state.results.length, 50);
});

test('edited draft blocks pagination; reverting to the executed draft preserves its exact cursor', async () => {
  const h = searchHarness();
  const first = h.actions.handleSearch(); h.pending[0].resolve(page('first', 'cursor-one')); await first; h.refresh();
  const original = plain(h.filters);
  h.edit({ keywords: 'Rust' });
  assert.equal(h.actions.searchNeedsRerun, true);
  await h.actions.handleSearch(true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.state.cursor, 'cursor-one');
  h.change({ filters: original });
  const next = h.actions.handleSearch(true);
  assert.equal(h.requests[1].keywords, 'Python');
  assert.equal(h.requests[1].cursor, 'cursor-one');
  h.pending[1].resolve(page('next')); await next;
});

test('next-page error preserves existing profiles and permits the same cursor retry', async () => {
  const h = searchHarness();
  const first = h.actions.handleSearch(); h.pending[0].resolve(page('first', 'cursor-one')); await first; h.refresh();
  const next = h.actions.handleSearch(true); h.pending[1].reject(new Error('Temporary failure')); await next; h.refresh();
  assert.equal(h.state.results.length, 25);
  assert.equal(h.state.cursor, 'cursor-one');
  assert.equal(h.state.hasMoreResults, true);
  assert.equal(h.state.loadingMore, false);
  const retry = h.actions.handleSearch(true);
  assert.deepEqual(h.requests[2], h.requests[1]);
  h.pending[2].resolve(page('next')); await retry;
  assert.equal(h.state.results.length, 50);
});

test('partial first-page success retains the next successful cursor after a later round fails', async () => {
  const h = searchHarness();
  const first = h.actions.handleSearch(); h.pending[0].resolve(page('first', 'cursor-one', 1));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.requests.length, 2);
  h.pending[1].reject(new Error('Temporary failure')); await first; h.refresh();
  assert.equal(h.state.results.length, 1);
  assert.equal(h.state.cursor, 'cursor-one');
  assert.equal(h.state.hasSearched, true);
  assert.equal(h.state.hasMoreResults, true);
  const retry = h.actions.handleSearch(true);
  assert.equal(h.requests[2].cursor, 'cursor-one');
  h.pending[2].resolve(page('next')); await retry;
  assert.equal(h.state.results.length, 26);
});

test('native geography keeps relocation-eligible and excluded-location results without substring filtering', async () => {
  const h = searchHarness();
  h.edit({ location: [
    { id: 'paris', name: 'Paris', priority: 'CAN_HAVE', scope: 'OPEN_TO_RELOCATE_ONLY' },
    { id: 'lyon', name: 'Lyon', priority: 'DOESNT_HAVE', scope: 'CURRENT' },
  ] });
  const first = h.actions.handleSearch(); h.pending[0].resolve(page('eligible', null, 1)); await first;
  assert.equal(h.state.results.length, 1);
  assert.equal(h.state.results[0].location, 'Berlin');
  assert.deepEqual(h.requests[0].location, plain(h.filters.location));
});

function persistenceHarness() {
  const react = scheduler(), writes = [], timers = new Map();
  let id = 0;
  const competitors = [];
  const statuses = new Map();
  const updateProject = async payload => { writes.push(plain(payload)); return payload; };
  const load = modules({
    react: react.hooks,
    sonner: { toast: { info() {} } },
    '@/integrations/supabase/client': { supabase: {} },
    '@/hooks/useUnipileQuota': { useUnipileQuota: () => ({ setApiMode() {} }) },
    '@/hooks/useJobCandidateStatus': { useJobCandidateStatus: () => ({ statuses }) },
    '@/hooks/useSourcingProjects': { useSourcingProjects: () => ({ updateProject, findOrCreateForJob() {} }) },
    '@/lib/invokeUnipile': { invokeUnipile: async () => ({ data: { success: false } }) },
    '@/hooks/useClientCompetitors': { useClientCompetitors: () => ({ enabledCompetitors: competitors }) },
    '@/components/outreach/calculateExperience': {},
  }, {
    setTimeout: fn => { const key = ++id; timers.set(key, fn); return key; },
    clearTimeout: key => timers.delete(key),
  });
  let project = { id: 'persistence-a', name: 'Mission A', job_details: { title: 'Backend Engineer' },
    filters_snapshot: { keywords: 'Python', last_manual_edit: '2026-10-01', suggestions: { alt_skills: ['Go'] } } };
  const { useLinkedInSearch } = load('@/hooks/useLinkedInSearch');
  let hook;
  const render = () => { hook = useLinkedInSearch({ organizationId: 'org', userId: 'user', selectedAccount: null, activeProject: project }); };
  react.render(render);
  return { writes, timers, get hook() { return hook; },
    refresh: () => react.render(render),
    changeProject(value) { project = value; react.render(render); },
    unmount: () => react.unmount(),
    fireTimers() { for (const [key, fn] of [...timers]) { timers.delete(key); fn(); } },
  };
}

test('initial snapshot hydration is never rewritten as an edit', async () => {
  const h = persistenceHarness();
  assert.equal(h.hook.filters.keywords, 'Python');
  assert.equal(h.timers.size, 0);
  await tick();
  assert.equal(h.writes.length, 0);
});

test('functional edits update the request ref synchronously before React render', () => {
  const h = persistenceHarness();
  h.hook.setFilters(filters => ({ ...filters, keywords: 'Rust' }));
  assert.equal(h.hook.filtersRef.current.keywords, 'Rust');
  h.refresh(); h.unmount();
});

test('tab unmount before debounce flushes the final draft and preserves snapshot metadata', async () => {
  const h = persistenceHarness();
  h.hook.setFilters(filters => ({ ...filters, keywords: 'Rust' })); h.refresh();
  h.hook.mergeProjectSnapshotMeta({ memory_context: { versionKey: 'new-memory' } });
  h.unmount(); await tick();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].id, 'persistence-a');
  assert.equal(h.writes[0].filters_snapshot.keywords, 'Rust');
  assert.equal(h.writes[0].filters_snapshot.memory_context.versionKey, 'new-memory');
  assert.deepEqual(h.writes[0].filters_snapshot.suggestions, { alt_skills: ['Go'] });
  assert.equal(h.timers.size, 0);
});

test('mission switch flushes only the previous mission, never its filters into the next mission', async () => {
  const h = persistenceHarness();
  h.hook.setFilters(filters => ({ ...filters, keywords: 'Rust' })); h.refresh();
  h.changeProject({ id: 'persistence-b', name: 'Mission B', job_details: { title: 'Data Engineer' },
    filters_snapshot: { keywords: 'SQL', last_manual_edit: '2026-10-02' } });
  await tick();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].id, 'persistence-a');
  assert.equal(h.writes[0].filters_snapshot.keywords, 'Rust');
  assert.equal(h.hook.filters.keywords, 'SQL');
  assert.equal(h.timers.size, 0);
  h.unmount();
});

test('reverting a draft cancels its obsolete debounce', async () => {
  const h = persistenceHarness();
  h.hook.setFilters(filters => ({ ...filters, keywords: 'Rust' })); h.refresh();
  h.hook.setFilters(filters => ({ ...filters, keywords: 'Python' })); h.refresh();
  h.unmount(); await tick();
  assert.equal(h.writes.length, 0);
});

test('explicitly clearing loaded filters saves that empty draft', async () => {
  const h = persistenceHarness();
  h.hook.handleClearFilters(); h.refresh(); h.unmount(); await tick();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].filters_snapshot.keywords, '');
});

const helperLoad = modules();
const helpers = helperLoad('@/lib/sourcingSearchLifecycle');
const { INITIAL_FILTERS } = helperLoad('@/components/outreach/types');
test('filter writes serialize across tab lifecycles; errors do not poison the next save', async () => {
  const started = [], first = deferred();
  const a = helpers.enqueueSourcingFilterSave('serial-project', () => { started.push('a'); return first.promise; });
  const b = helpers.enqueueSourcingFilterSave('serial-project', async () => { started.push('b'); });
  await tick(); assert.deepEqual(started, ['a']);
  first.reject(new Error('Failure')); await a.catch(() => undefined); await b;
  assert.deepEqual(started, ['a', 'b']);
});

test('cache accepts the exact freshly persisted draft, rejects different snapshots, briefs and memories', () => {
  const filters = { ...plain(INITIAL_FILTERS), keywords: 'Rust' };
  const cached = { schemaVersion: 1, snapshotKey: helpers.sourcingSnapshotKey({ keywords: 'Python' }),
    briefKey: 'brief-a', memoryKey: 'memory-a', filters };
  const current = { snapshot: { ...filters, last_manual_edit: '2026-10-09' }, briefKey: 'brief-a', memoryKey: 'memory-a' };
  assert.equal(helpers.isSourcingCacheCurrent(cached, current), true);
  for (const patch of [
    { snapshot: { ...current.snapshot, keywords: 'Go' } },
    { briefKey: 'brief-b' }, { memoryKey: 'memory-b' },
    { snapshot: { ...filters, generated_at: '2026-10-09' } },
  ]) assert.equal(helpers.isSourcingCacheCurrent(cached, { ...current, ...patch }), false);
  assert.equal(helpers.isSourcingCacheCurrent({ ...cached, schemaVersion: 0 }, current), false);
});


test('reviewed native experience survives save and reload while legacy aliases stay calculated', async () => {
  const h = persistenceHarness();
  h.hook.setFilters(filters => ({ ...filters, years_of_experience_min: 6, years_of_experience_max: 12 }));
  h.refresh(); h.fireTimers(); await tick();
  const saved = h.writes[0].filters_snapshot;
  assert.equal(saved.native_experience_reviewed, true);
  h.changeProject({ id: 'persistence-native', name: 'Native XP', job_details: { title: 'Backend Engineer' }, filters_snapshot: saved });
  assert.equal(h.hook.filters.years_of_experience_min, 6);
  assert.equal(h.hook.filters.years_of_experience_max, 12);
  const legacy = { ...saved }; delete legacy.native_experience_reviewed;
  h.changeProject({ id: 'persistence-legacy', name: 'Legacy XP', job_details: { title: 'Backend Engineer' }, filters_snapshot: legacy });
  assert.equal(h.hook.filters.years_of_experience_min, null);
  assert.equal(h.hook.filters.years_of_experience_max, null);
  h.unmount();
});

test('local save acknowledgements cannot restore an older snapshot after a tab remount', () => {
  const a = { keywords: 'Python', last_manual_edit: '2026-10-09T08:00:00Z' };
  const b = { keywords: 'Rust', last_manual_edit: '2026-10-09T08:00:02Z' };
  helpers.rememberLocalSourcingSnapshot('remount-save-project', a);
  helpers.rememberLocalSourcingSnapshot('remount-save-project', b);
  assert.equal(helpers.isSupersededSourcingSnapshot('remount-save-project', structuredClone(a)), true);
  assert.equal(helpers.isSupersededSourcingSnapshot('remount-save-project', b), false);
  assert.equal(helpers.isSupersededSourcingSnapshot('another-project', a), false);
  assert.equal(helpers.isSupersededSourcingSnapshot('remount-save-project', { ...a, last_manual_edit: 'external-edit' }), false);
});

test('company IDs preserve explicit Recruiter priority/scope and Sales Navigator exclusions', () => {
  const h = searchHarness();
  const company = [{ id: 'target', name: 'Target', priority: 'CAN_HAVE', scope: 'PAST' },
    { id: 'excluded', name: 'Excluded', priority: 'DOESNT_HAVE', scope: 'CURRENT' }];
  const recruiter = h.buildSearchParams({ ...h.filters, company }, 'account');
  assert.deepEqual(plain(recruiter.company), company.map(({ id, priority, scope }) => ({ id, priority, scope })));
  const basic = h.buildSearchParams({ ...h.filters, company: [{ id: 'target', name: 'Target' }] }, 'account');
  assert.deepEqual(plain(basic.company), [{ id: 'target', priority: 'CAN_HAVE', scope: 'CURRENT_OR_PAST' }]);
  const sales = h.buildSearchParams({ ...h.filters, api: 'sales_navigator', company: company.map(({ scope, ...rest }) => rest) }, 'account');
  assert.deepEqual(plain(sales.company), { include: ['target'], exclude: ['excluded'] });
});

test('unsupported company exclusions/AND/scopes are actionable failures before a provider call', async () => {
  const h = searchHarness();
  for (const patch of [
    { api: 'classic', company: [{ id: 'x', name: 'Excluded', priority: 'DOESNT_HAVE' }] },
    { api: 'sales_navigator', company: [{ id: 'a', name: 'A', priority: 'MUST_HAVE' }, { id: 'b', name: 'B', priority: 'CAN_HAVE' }] },
    { api: 'sales_navigator', company: [{ id: 'a', name: 'A', scope: 'PAST' }] },
  ]) {
    h.edit(patch);
    await h.actions.handleSearch();
    assert.equal(h.state.loading, false);
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.messages.filter(message => message.kind === 'error').length, 3);
});

test('append pages without a total retain the first-page total', async () => {
  const h = searchHarness();
  const first = h.actions.handleSearch(); h.pending[0].resolve(page('first', 'cursor-one')); await first; h.refresh();
  const next = h.actions.handleSearch(true);
  const response = page('next'); delete response.data.total;
  h.pending[1].resolve(response); await next;
  assert.equal(h.state.total, 500);
});

test('a failed later local save stops hiding the last confirmed snapshot', async () => {
  const a = { keywords: 'Python', last_manual_edit: 'save-a' };
  const b = { keywords: 'Rust', last_manual_edit: 'save-b' };
  helpers.rememberLocalSourcingSnapshot('failed-save-project', a);
  const confirmed = helpers.enqueueSourcingFilterSave('failed-save-project', async () => a);
  helpers.rememberLocalSourcingSnapshot('failed-save-project', b);
  const failed = helpers.enqueueSourcingFilterSave('failed-save-project', async () => { throw new Error('Save unavailable'); });
  await confirmed;
  assert.equal(helpers.isSupersededSourcingSnapshot('failed-save-project', a), true);
  await failed.catch(() => helpers.forgetFailedSourcingSnapshot('failed-save-project', b));
  assert.equal(helpers.isSupersededSourcingSnapshot('failed-save-project', a), false);
});

test('stored geography exclusions, relocation and radius fail clearly on incompatible LinkedIn licences', async () => {
  const h = searchHarness();
  for (const api of ['classic', 'sales_navigator']) {
    for (const location of [
      { id: 'city', name: 'City', priority: 'DOESNT_HAVE', scope: 'CURRENT' },
      { id: 'city', name: 'City', priority: 'MUST_HAVE', scope: 'OPEN_TO_RELOCATE_ONLY' },
    ]) {
      h.edit({ api, location: [location], location_within_area: null });
      await h.actions.handleSearch();
    }
    h.edit({ api, location: [{ id: 'city', name: 'City', priority: 'MUST_HAVE', scope: 'CURRENT' }], location_within_area: 25 });
    await h.actions.handleSearch();
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.messages.filter(message => message.kind === 'error').length, 6);
});

test('changing a standalone job resets both filter state and the immediate request ref', () => {
  const h = persistenceHarness();
  h.changeProject(null);
  h.hook.setFilters(filters => ({ ...filters, keywords: 'Previous job query' })); h.refresh();
  h.hook.setSelectedJob({ id: 'different-job', title: 'Data Engineer', skills: ['SQL'] }); h.refresh();
  assert.equal(h.hook.filters.keywords, '');
  assert.equal(h.hook.filtersRef.current.keywords, '');
  h.unmount();
});

test('a queued click callback cannot start a request after its tab unmounted', async () => {
  const h = searchHarness();
  const callback = h.actions.handleSearch;
  h.unmount();
  await callback();
  assert.equal(h.requests.length, 0);
});
