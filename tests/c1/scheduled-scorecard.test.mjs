import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../../supabase/functions/_shared/scheduled-scorecard.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  const rows = {
    qualification_sessions: [{ id: 'interview', organization_id: 'org', created_by: 'owner', manager_id: 'owner', candidate_profile_id: 'candidate', candidate_name: 'Camille', candidate_headline: 'Developer', project_id: null, job_id: null, status: 'scheduled' }],
    candidate_evaluations: [],
    job_candidate_status: [{ candidate_id: 'candidate', organization_id: 'org', candidate_name: 'Camille', linkedin_profile_data: { skills: ['TypeScript'] } }],
    candidate_profiles: [], sourcing_projects: [], mission_process_steps: [],
  };
  const credits = [];
  const background = [];
  const generations = [];
  let id = 0;
  let generateResult = () => Response.json({ success: true, criteria: [{ id: 'criterion', label: 'TypeScript' }], usage: { tokensInput: 100, tokensOutput: 400, modelId: 'test' } });
  const admin = {
    from(table) {
      let mode = 'select', patch, filters = [], limit = Infinity, selected = false;
      const q = {
        select() { selected = true; return q; },
        eq(key, value) { filters.push(row => key === 'criteria' ? JSON.stringify(row[key]) === value : row[key] === value); return q; },
        is(key, value) { filters.push(row => (row[key] ?? null) === value); return q; },
        order() { return q; }, limit(value) { limit = value; return q; },
        insert(value) { mode = 'insert'; patch = value; return q; },
        update(value) { mode = 'update'; patch = value; return q; },
        maybeSingle() { return execute(true); }, single() { return execute(true); },
        then(resolve, reject) { return execute(false).then(resolve, reject); },
      };
      async function execute(single) {
        let result;
        if (mode === 'insert') {
          if (rows[table].some(row => row.qualification_session_id === patch.qualification_session_id && row.created_by === patch.created_by)) return { data: null, error: { code: '23505' } };
          const row = { id: `evaluation-${++id}`, updated_at: 'constant-to-prove-token-cas', ...structuredClone(patch) };
          rows[table].push(row); result = [row];
        } else {
          result = rows[table].filter(row => filters.every(filter => filter(row))).slice(0, limit);
          if (mode === 'update') for (const row of result) Object.assign(row, structuredClone(patch));
        }
        const data = mode !== 'select' && !selected ? null : structuredClone(single ? result[0] || null : result);
        return { data, error: null };
      }
      return q;
    },
    rpc: async () => ({ data: true, error: null }),
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === './require-auth.ts') return { verifyOrgMembership: async (_db, user, org) => org === 'org' && ['owner', 'creator', 'teammate'].includes(user) };
    if (name === './settle-credits.ts') return { settleCredits: async (_db, value) => { credits.push(value); } };
    throw new Error(`Unexpected import ${name}`);
  }, module, module.exports);
  const invoke = async (body = {}, auth = { userId: 'owner', method: 'jwt' }) => {
    const response = await module.exports.prepareScheduledScorecard({
      background: work => background.push(work),
      body: { qualificationSessionId: 'interview', organization_id: 'org', ...body }, auth, admin, corsHeaders: {},
      generate: async (context, ownerId, organizationId) => { generations.push({ context, ownerId, organizationId }); return generateResult(); },
    });
    return { status: response.status, data: await response.json() };
  };
  return { rows, credits, generations, background, invoke, setGenerate: value => { generateResult = value; } };
}

test('prepared grid persists before opening and repeated ensure does not regenerate or charge', async () => {
  const f = fixture();
  const first = await f.invoke();
  assert.equal(first.data.status, 'ready');
  assert.equal(first.data.evaluation.qualification_session_id, 'interview');
  assert.equal(f.generations[0].context.candidateProfile.skills[0], 'TypeScript');
  await f.invoke({ retry: true });
  assert.equal(f.generations.length, 1);
  assert.equal(f.credits.length, 1);
  assert.equal(f.credits[0].organizationId, 'org');
  assert.equal(f.rows.candidate_evaluations.length, 1);
});

test('two simultaneous planning requests claim one generation and one debit', async () => {
  const f = fixture();
  await Promise.all([f.invoke(), f.invoke()]);
  assert.equal(f.generations.length, 1);
  assert.equal(f.credits.length, 1);
  assert.equal(f.rows.candidate_evaluations.length, 1);
});

test('failed preparation stays retryable and concurrent retry claims only once, even without timestamp advance', async () => {
  const f = fixture();
  f.setGenerate(() => Response.json({ error: 'insufficient' }, { status: 402 }));
  const first = await f.invoke();
  assert.equal(first.data.status, 'failed');
  assert.match(first.data.error, /Crédits IA insuffisants/);
  await f.invoke();
  assert.equal(f.generations.length, 1);
  assert.equal(f.credits.length, 0);
  f.setGenerate(() => Response.json({ success: true, criteria: [{ id: 'retry' }], usage: { tokensInput: 10, tokensOutput: 10, modelId: 'test' } }));
  await Promise.all([f.invoke({ retry: true }), f.invoke({ retry: true })]);
  assert.equal(f.generations.length, 2);
  assert.equal(f.credits.length, 1);
});

test('cross-org user and forged org never load/generate a grid', async () => {
  const f = fixture();
  assert.equal((await f.invoke({}, { userId: 'outsider', method: 'jwt' })).status, 403);
  assert.equal((await f.invoke({ organization_id: 'other' })).status, 403);
  assert.equal(f.generations.length, 0);
  assert.equal(f.rows.candidate_evaluations.length, 0);
});

test('teammate cannot generate or receive another interviewer editable grid', async () => {
  const f = fixture();
  await f.invoke();
  const other = await f.invoke({}, { userId: 'teammate', method: 'jwt' });
  assert.equal(other.data.reason, 'assigned_elsewhere');
  assert.equal(other.data.evaluation, undefined);
  assert.equal(f.generations.length, 1);
});

test('planner can prepare assigned interviewer without receiving their editable grid', async () => {
  const f = fixture();
  f.rows.qualification_sessions[0].created_by = 'creator';
  const result = await f.invoke({ planning: true }, { userId: 'creator', method: 'jwt' });
  assert.equal(result.data.status, 'ready');
  assert.equal(result.data.evaluation, undefined);
  assert.equal(f.credits[0].userId, 'owner');
  assert.equal(f.rows.candidate_evaluations[0].created_by, 'owner');
});

test('missing candidate and cancelled appointment skip inference', async () => {
  const f = fixture();
  f.rows.qualification_sessions[0].candidate_profile_id = null;
  assert.equal((await f.invoke()).data.reason, 'candidate_missing');
  f.rows.qualification_sessions[0].candidate_profile_id = 'candidate';
  f.rows.qualification_sessions[0].status = 'cancelled';
  assert.equal((await f.invoke()).data.reason, 'interview_closed');
  assert.equal(f.generations.length, 0);
});

test('cancelled during generation never publishes criteria or bills', async () => {
  const f = fixture();
  f.setGenerate(() => { f.rows.qualification_sessions[0].status = 'cancelled'; return Response.json({ success: true, criteria: [{ id: 'late' }], usage: { tokensInput: 10, tokensOutput: 10 } }); });
  await f.invoke();
  assert.deepEqual(f.rows.candidate_evaluations[0].criteria, []);
  assert.equal(f.credits.length, 0);
});

test('rescheduling the same session preserves the prepared grid and debit', async () => {
  const f = fixture();
  await f.invoke();
  f.rows.qualification_sessions[0].event_start_at = '2030-01-01T10:00:00Z';
  await f.invoke();
  assert.equal(f.generations.length, 1);
  assert.equal(f.credits.length, 1);
});

test('a manually edited grid is never overwritten by retry of a stale preparation', async () => {
  const f = fixture();
  f.setGenerate(() => Response.json({ error: 'failed' }, { status: 503 }));
  await f.invoke();
  Object.assign(f.rows.candidate_evaluations[0], { preparation_status: 'preparing', preparation_started_at: '2020-01-01T00:00:00Z' });
  assert.equal((await f.invoke()).data.status, 'failed');
  f.rows.candidate_evaluations[0].criteria = [{ id: 'manual' }];
  assert.equal((await f.invoke({ retry: true })).data.status, 'ready');
  assert.equal(f.generations.length, 1);
  assert.equal(f.credits.length, 0);
});


test('background request acknowledges before inference finishes and persists when it completes', async () => {
  const f = fixture();
  let finish;
  f.setGenerate(() => new Promise(resolve => { finish = resolve; }));
  assert.equal((await f.invoke({ background: true })).data.status, 'preparing');
  for (let i = 0; i < 15 && !finish; i++) await Promise.resolve();
  assert.equal(typeof finish, 'function');
  assert.equal(f.credits.length, 0);
  assert.equal((await f.invoke()).data.status, 'preparing');
  finish(Response.json({ success: true, criteria: [{ id: 'prepared' }], usage: { tokensInput: 10, tokensOutput: 10, modelId: 'test' } }));
  await Promise.all(f.background);
  assert.equal((await f.invoke()).data.status, 'ready');
  assert.equal(f.credits.length, 1);
});

test('an expired preparation can recover with one explicit retry', async () => {
  const f = fixture();
  f.setGenerate(() => Response.json({ error: 'temporary' }, { status: 503 }));
  await f.invoke();
  Object.assign(f.rows.candidate_evaluations[0], { preparation_status: 'preparing', preparation_started_at: '2020-01-01T00:00:00Z' });
  f.setGenerate(() => Response.json({ success: true, criteria: [{ id: 'retried' }] }));
  assert.equal((await f.invoke({ retry: true })).data.status, 'ready');
  assert.equal(f.generations.length, 2);
  assert.equal(f.rows.candidate_evaluations.length, 1);
});

test('manual criteria saved during inference survive without a debit for discarded generation', async () => {
  const f = fixture();
  f.setGenerate(() => { f.rows.candidate_evaluations[0].criteria = [{ id: 'manual' }]; return Response.json({ success: true, criteria: [{ id: 'late' }], usage: { tokensInput: 10, tokensOutput: 10 } }); });
  await f.invoke();
  assert.deepEqual(f.rows.candidate_evaluations[0].criteria, [{ id: 'manual' }]);
  assert.equal(f.credits.length, 0);
});

test('legacy job-only session retains stored context without guessing another mission', async () => {
  const f = fixture();
  Object.assign(f.rows.qualification_sessions[0], { job_id: 'legacy', job_title: 'Data Scientist', job_criteria: { skills: ['Python'] } });
  Object.assign(f.rows.job_candidate_status[0], { job_id: 'legacy', linkedin_profile_data: { positions: [{ title: 'Developer', company: 'Example' }], about: 'Ten years experience', occupation: 'Engineer', education: [{ school_details: { name: 'Example school' }, degree: 'Master' }] } });
  const result = await f.invoke({ candidateProfile: { name: 'FORGED' }, jobContext: { title: 'FORGED' } });
  assert.equal(result.data.status, 'ready');
  assert.equal(f.generations[0].context.jobContext.title, 'Data Scientist');
  assert.equal(f.generations[0].context.candidateProfile.summary, 'Ten years experience');
  assert.equal(f.generations[0].context.candidateProfile.experiences[0].title, 'Developer');
  assert.equal(f.generations[0].context.candidateProfile.education[0].school, 'Example school');
  assert.equal(f.generations[0].context.candidateProfile.name, 'Camille');
});

test('missing explicitly assigned mission fails without paid inference', async () => {
  const f = fixture();
  f.rows.qualification_sessions[0].project_id = 'missing-mission';
  assert.equal((await f.invoke()).data.status, 'failed');
  assert.equal(f.generations.length, 0);
  assert.equal(f.credits.length, 0);
});
