import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function compile(path, { suffix = '', globals = {} } = {}) {
  const source = readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '');
  const { outputText, diagnostics } = ts.transpileModule(source + suffix, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path, reportDiagnostics: true,
  });
  assert.equal(diagnostics?.length ?? 0, 0);
  const context = { exports: {}, Deno: { serve() {} }, Response, AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} }, ...globals };
  vm.runInNewContext(outputText, context, { filename: path });
  return context.exports;
}

const profileData = compile('supabase/functions/_shared/profile-data.ts');
const projectId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const externalJobId = 'external-ats-job';

function harness(projectOrganization = organizationId) {
  const calls = { queries: [], requests: [] };
  const task = { id: 'task-a', organization_id: organizationId, created_by: userId,
    params: { project_id: projectId, scoring_instructions: 'Vérifier les réserves.' },
    result: { initial_remaining: 1 }, progress_done: 0, attempts: 0 };
  const supabase = {
    from(table) {
      const operation = { table, filters: {} };
      calls.queries.push(operation);
      const result = () => {
        if (table === 'sourcing_projects') return { data: { id: projectId, organization_id: projectOrganization,
          name: 'Data Engineer', job_details: { skills_must_have: ['Python'], skills_should_have: ['Spark'] } } };
        if (table === 'job_candidate_status') {
          if (operation.fields === 'job_id') return { data: { job_id: externalJobId } };
          if (operation.options?.head) return { count: 1 };
          return { data: [{ candidate_id: 'candidate-a', candidate_name: 'Alice', linkedin_profile_data: {
            first_name: 'Alice', last_name: 'Martin', skills: ['Python'],
          } }] };
        }
        if (table === 'agent_background_tasks') return operation.patch ? { data: [{ id: task.id }] } : { data: { status: 'running' } };
        if (table === 'notifications') return { data: [] };
        throw new Error('Unexpected table: ' + table);
      };
      const query = {
        select(fields, options) { operation.fields = fields; operation.options = options; return query; },
        eq(column, value) { operation.filters[column] = value; return query; },
        is() { return query; }, not() { return query; }, order() { return query; }, limit() { return query; },
        update(patch) { operation.patch = patch; return query; },
        insert(value) { operation.insert = value; return query; },
        maybeSingle: async () => result(),
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return query;
    },
  };
  const worker = compile('supabase/functions/process-agent-tasks/index.ts', {
    suffix: '\nexports.run = runScoreMissionProfiles;',
    globals: { ...profileData, fetch: async (url, options) => {
      assert.equal(url, 'http://local.test/functions/v1/score-profile-job');
      calls.requests.push({ headers: options.headers, body: JSON.parse(options.body) });
      // End the tick after one request without executing scoring or other services.
      return new Response('{}', { status: 429 });
    } },
  });
  return { calls, run: () => worker.run(supabase, 'http://local.test', 'fake-service-key', task, Date.now()) };
}

test('background scoring retains the verified mission context when candidate rows use an external job ID', async () => {
  const h = harness();
  await h.run();
  assert.equal(h.calls.requests.length, 1);
  const request = h.calls.requests[0];
  assert.equal(request.headers.Authorization, 'Bearer fake-service-key');
  assert.equal(request.body.organization_id, organizationId);
  assert.equal(request.body.project_id, projectId);
  assert.equal(request.body.user_id, userId);
  assert.equal(request.body.job.id, externalJobId, 'candidate persistence keeps its original job key');
  assert.equal(request.body.job.mustHave, 'Python');
  assert.equal(request.body.job.shouldHave, 'Spark');
  assert.equal(request.body.customScoringInstructions, 'Vérifier les réserves.');
  assert.equal(request.body.profiles[0].id, 'candidate-a');
  assert.equal(h.calls.queries[0].filters.id, projectId);
  for (const query of h.calls.queries.filter(query => query.table === 'job_candidate_status')) {
    assert.equal(query.filters.organization_id, organizationId);
    assert.equal(query.filters.project_id, projectId);
  }
});

test('a foreign mission blocks before candidate reads or any scoring request', async () => {
  const h = harness('44444444-4444-4444-8444-444444444444');
  await h.run();
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.calls.queries.filter(query => query.table === 'job_candidate_status').length, 0);
  const failure = h.calls.queries.find(query => query.table === 'agent_background_tasks' && query.patch);
  assert.equal(failure.patch.status, 'error');
  assert.match(failure.patch.last_error, /hors de l'organisation/);
});
