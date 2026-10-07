import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual hook with a small hook lifecycle and scripted local DB.
// No network, authenticated remote client or production write is available.
const source = readFileSync(new URL('../../src/hooks/useJobCandidateStatus.ts', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
});
assert.equal(compiled.diagnostics?.length ?? 0, 0);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const row = (id, jobId = 'job-a', overrides = {}) => ({
  id: `row-${id}`, job_id: jobId, candidate_id: id, candidate_name: id,
  status: 'discovered', score: null, recommendation: null, created_by: 'actor-a',
  organization_id: 'org-a', updated_at: '2026-10-07T10:00:00Z', ...overrides,
});

function harness({ reads = [], profiles = [] } = {}) {
  let scope = { organizationId: 'org-a', jobId: 'job-a', actorId: 'actor-a' };
  let cursor = 0;
  let mounted = false;
  let stateWrites = 0;
  const slots = [];
  const effects = [];
  const requests = [];
  const writes = [];
  const writeReplies = [];
  const queryClient = {};
  const sameDeps = (a, b) => a?.length === b?.length && a.every((item, i) => Object.is(item, b[i]));
  const useState = initial => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
    return [slots[index].value, update => {
      stateWrites += 1;
      slots[index].value = typeof update === 'function' ? update(slots[index].value) : update;
    }];
  };
  const useRef = initial => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: { current: initial } };
    return slots[index].value;
  };
  const useCallback = (callback, deps) => {
    const index = cursor++;
    if (!slots[index] || !sameDeps(slots[index].deps, deps)) slots[index] = { value: callback, deps };
    return slots[index].value;
  };
  const useEffect = (callback, deps) => {
    const index = cursor++;
    const previous = slots[index];
    if (previous && sameDeps(previous.deps, deps)) return;
    const next = { deps, cleanup: previous?.cleanup };
    slots[index] = next;
    effects.push(() => {
      next.cleanup?.();
      next.cleanup = callback();
    });
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: scope.actorId } } }) },
    from(table) {
      assert.equal(table, 'job_candidate_status');
      const request = { operation: 'read', filters: {}, columns: null, records: null };
      const query = {
        select(columns) { request.columns = columns; return query; },
        eq(key, value) { request.filters[key] = value; return query; },
        in(key, value) { request.filters[key] = value; return query; },
        range() { return query; },
        not() { return query; },
        overrideTypes() { return query; },
        upsert(records) { request.operation = 'upsert'; request.records = records; return query; },
        update() { request.operation = 'mark-scored'; return query; },
        then(resolve, reject) {
          requests.push(request);
          let response;
          if (request.operation === 'upsert') {
            writes.push(request);
            response = writeReplies.shift() ?? { data: [], error: null };
          } else if (request.operation === 'mark-scored') {
            response = { data: null, error: null };
          } else {
            const queue = request.columns === 'candidate_id,linkedin_profile_data' ? profiles : reads;
            response = queue.shift() ?? { data: [], error: null };
          }
          return Promise.resolve(response).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const sandbox = {
    exports: {}, useState, useRef, useCallback, useEffect,
    useOrganization: () => ({ organizationId: scope.organizationId }),
    useAuthReady: () => ({ isReady: true, user: { id: scope.actorId } }),
    useQueryClient: () => queryClient, supabase,
    console: { error() {}, warn() {}, log() {} },
  };
  vm.runInNewContext(compiled.outputText, sandbox, { filename: 'useJobCandidateStatus.ts' });
  const render = (next = {}) => {
    scope = { ...scope, ...next };
    cursor = 0;
    const value = sandbox.exports.useJobCandidateStatus(scope.jobId);
    while (effects.length) effects.shift()();
    mounted = true;
    return value;
  };
  const unmount = () => {
    for (const slot of slots) slot?.cleanup?.();
    mounted = false;
  };
  render();
  return {
    render, view: () => render(), unmount, requests, writes, reads, profiles, writeReplies,
    stateWrites: () => stateWrites, mounted: () => mounted,
  };
}

const save = (h, method) => method === 'saveScore'
  ? h.view().saveScore('scored-a', { score: 91, recommendation: 'go' })
  : h.view().batchSaveScores([{ id: 'scored-a', score: 91, recommendation: 'go' }]);

for (const method of ['saveScore', 'batchSaveScores']) {
  for (const transition of ['mission', 'organization', 'return-to-a', 'unmount']) {
    test(`${method}: a pending DB write cannot update another context (${transition})`, async () => {
      const h = harness();
      await tick();
      const pause = deferred();
      h.writeReplies.push(pause.promise);
      const pending = save(h, method);
      await tick();
      assert.equal(h.writes.length, 1, 'the original authorized write started');
      const written = Array.isArray(h.writes[0].records) ? h.writes[0].records[0] : h.writes[0].records;
      assert.equal(written.job_id, 'job-a');
      assert.equal(written.organization_id, 'org-a');
      if (transition === 'unmount') h.unmount();
      else {
        h.reads.push({ data: [row('legitimate-b', 'job-b')], error: null });
        h.render(transition === 'organization' ? { organizationId: 'org-b' } : { jobId: 'job-b' });
        await tick();
        if (transition === 'return-to-a') {
          h.reads.push({ data: [row('legitimate-new-a')], error: null });
          h.render({ jobId: 'job-a' });
          await tick();
        }
      }
      const before = h.stateWrites();
      pause.resolve({ data: [{ id: 'saved-a', candidate_id: 'scored-a', status: 'discovered' }], error: null });
      await pending;
      await tick();
      assert.equal(h.stateWrites(), before, 'a stale completion performs no state writes');
      if (transition !== 'unmount') {
        const current = h.view();
        assert.equal(current.statuses.has('scored-a'), false);
        const legitimate = transition === 'return-to-a' ? 'legitimate-new-a' : 'legitimate-b';
        assert.equal(current.statuses.has(legitimate), true, 'the current context retains its data');
        assert.equal(current.treatedIds.has(legitimate), true);
      }
    });
  }
}

test('a stale light fetch cannot inject rows or stop the current loading indicator', async () => {
  const a = deferred();
  const b = deferred();
  const h = harness({ reads: [a.promise] });
  await tick();
  h.reads.push(b.promise);
  h.render({ jobId: 'job-b' });
  await tick();
  a.resolve({ data: [row('foreign-a')], error: null });
  await tick();
  assert.equal(h.view().loading, true);
  assert.equal(h.view().statuses.size, 0);
  b.resolve({ data: [row('current-b', 'job-b')], error: null });
  await tick();
  assert.deepEqual([...h.view().statuses.keys()], ['current-b']);
  assert.equal(h.view().loading, false);
  for (const request of h.requests.filter(request => request.operation === 'read')) {
    assert.equal(request.filters.organization_id, 'org-a');
  }
});

test('returning to A does not revive its old light fetch', async () => {
  const oldA = deferred();
  const h = harness({ reads: [oldA.promise] });
  await tick();
  h.render({ jobId: 'job-b' });
  await tick();
  h.reads.push({ data: [row('current-a')], error: null });
  h.render({ jobId: 'job-a' });
  await tick();
  oldA.resolve({ data: [row('old-a')], error: null });
  await tick();
  assert.deepEqual([...h.view().statuses.keys()], ['current-a']);
});

test('late profile hydration never decorates the same candidate in another mission', async () => {
  const oldProfile = deferred();
  const h = harness({ reads: [{ data: [row('shared')], error: null }], profiles: [oldProfile.promise] });
  await tick();
  h.reads.push({ data: [row('shared', 'job-b', { candidate_name: 'Current B' })], error: null });
  h.render({ jobId: 'job-b' });
  await tick();
  oldProfile.resolve({ data: [{ candidate_id: 'shared', linkedin_profile_data: { headline: 'Old A data' } }], error: null });
  await tick();
  const current = h.view().statuses.get('shared');
  assert.equal(current.candidate_name, 'Current B');
  assert.equal(current.linkedin_profile_data, undefined);
});

test('same-context batch completion keeps concurrent rows and advanced recruiting decisions', async () => {
  const h = harness({ reads: [{ data: [row('scored-a')], error: null }] });
  await tick();
  const pause = deferred();
  h.writeReplies.push(pause.promise);
  const pending = save(h, 'batchSaveScores');
  await tick();
  h.reads.push({ data: [row('scored-a', 'job-a', { status: 'shortlisted' }), row('concurrent-c', 'job-a', { status: 'messaged' })], error: null });
  await h.view().refresh();
  pause.resolve({ data: [{ id: 'saved-a', candidate_id: 'scored-a', status: 'discovered' }], error: null });
  await pending;
  const current = h.view();
  assert.equal(current.statuses.get('scored-a').score, 91);
  assert.equal(current.statuses.get('scored-a').status, 'shortlisted');
  assert.equal(current.statuses.get('concurrent-c').status, 'messaged');
  assert.equal(current.treatedIds.has('concurrent-c'), true);
});

test('a newer refresh supersedes an older fetch in the same context', async () => {
  const older = deferred();
  const h = harness({ reads: [older.promise] });
  await tick();
  h.reads.push({ data: [row('latest')], error: null });
  await h.view().refresh();
  older.resolve({ data: [row('obsolete')], error: null });
  await tick();
  assert.deepEqual([...h.view().statuses.keys()], ['latest']);
});

for (const phase of ['light', 'profile']) {
  test(`unmount ignores a pending ${phase} fetch without touching state`, async () => {
    const pending = deferred();
    const h = phase === 'light' ? harness({ reads: [pending.promise] })
      : harness({ reads: [{ data: [row('shared')], error: null }], profiles: [pending.promise] });
    await tick();
    h.unmount();
    const before = h.stateWrites();
    pending.resolve({ data: phase === 'light' ? [row('late')]
      : [{ candidate_id: 'shared', linkedin_profile_data: { headline: 'late' } }], error: null });
    await tick();
    assert.equal(h.stateWrites(), before);
  });
}
