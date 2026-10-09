import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
const cache = new Map();
function compile(path, globals = {}) {
  const source = readFileSync(new URL(path, root), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '');
  let output = cache.get(source);
  if (!output) {
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
    });
    assert.equal(compiled.diagnostics?.length ?? 0, 0);
    output = compiled.outputText;
    cache.set(source, output);
  }
  const context = { exports: {}, crypto: webcrypto, TextEncoder, Request, Response, URL, AbortController, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} }, fetch() { throw new Error('Unexpected HTTP'); },
    Deno: { env: { get: () => undefined }, serve() {} }, ...globals };
  vm.runInNewContext(output, context, { filename: path });
  return context.exports;
}
const boolean = compile('supabase/functions/_shared/search-boolean.ts');
const filter = compile('supabase/functions/_shared/continuous-sourcing-filters.ts', boolean);
const scoring = compile('supabase/functions/_shared/scoring-context.ts');
const experience = compile('supabase/functions/_shared/profile-experience.ts');
const profileData = compile('supabase/functions/_shared/profile-data.ts', experience);
const models = compile('supabase/functions/_shared/ai-config.ts');
const stableKey = value => JSON.stringify(value, (_key, next) => next && typeof next === 'object' && !Array.isArray(next)
  ? Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))) : next);
const slug = value => { try { return new URL(value).pathname.match(/\/in\/([^/]+)/)?.[1]?.toLowerCase() ?? null; } catch { return null; } };
const imports = { ...filter, ...profileData, ...models, ...experience, SOURCING_SCORING_ENGINE_VERSION: scoring.SOURCING_SCORING_ENGINE_VERSION, stableScoringContextKey: stableKey, linkedInProfileSlug: slug };
const shared = compile('supabase/functions/_shared/continuous-sourcing.ts', imports);
const now = Date.parse('2026-10-08T20:00:00.000Z');
const organizationId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
function agent(patch = {}) {
  return { id: '44444444-4444-4444-8444-444444444444', organization_id: organizationId, project_id: projectId,
    created_by: userId, source: 'pool', account_id: null, api: null, settings: plain(shared.CONTINUOUS_DEFAULTS),
    status: 'active', revision: 2, approved_context_key: 'context-a', context_snapshot: { context_key: 'context-a' },
    search_filters_snapshot: {}, checkpoint: { phase: 'discover', cursor: null }, next_run_at: null,
    lease_token: 'lease-a', lease_until: new Date(now + 300_000).toISOString(), daily_date: '2026-10-08',
    profiles_used: 0, credits_reserved: 0, credits_used: 0, ...patch };
}
function profile(id) { return { id, name: 'Profil ' + id, profile_url: 'https://www.linkedin.com/in/' + id }; }
function candidate(id, patch = {}) {
  const identity = shared.profileIdentity(profile(id));
  return { id: 'candidate-' + id, candidate_id: id, agent_id: 'agent-a', person_key: identity.personKey,
    profile: profile(id), source_aliases: plain(identity.aliases), score: null, result: {}, provenance: {},
    context_key: 'context-a', state: 'discovered', decision: null, reason: null, credits_reserved: 0, credits_used: 0, ...patch };
}
function harness(options = {}) {
  const claimed = agent(options.agent);
  const fresh = plain(claimed);
  const stored = (options.candidates || []).map(plain);
  const calls = { writes: [], checkpoints: [], discover: 0, prepare: 0, evaluate: 0, reserve: 0, guards: 0 };
  const hooks = options.hooks || {};
  const deps = {
    now: () => now,
    claim: async () => options.noAgent ? null : claimed,
    reread: async () => { calls.guards++; await hooks.reread?.(fresh, calls); return fresh; },
    context: async () => ({ context_key: options.contextKey || 'context-a' }),
    eligibility: async (_agent, guard) => { await hooks.eligibility?.(fresh, guard); },
    candidates: async () => stored,
    privateAllowed: async (_agent, selected) => options.privacy !== false && !selected.no_ai_scoring,
    discover: async (_agent, limit) => { calls.discover++; calls.limit = limit; await hooks.discover?.(fresh);
      return { profiles: options.profiles || [profile('new')], cursor: 'next-cursor', exhausted: false }; },
    prepare: async (_agent, selected) => { calls.prepare++; await hooks.prepare?.(fresh);
      return options.prepared || { ...selected.profile, work_experience: [{ role: 'Engineer' }] }; },
    reserve: async () => { calls.reserve++; return options.budget !== false; },
    write: async (_agent, key, patch) => {
      calls.writes.push({ key, patch: plain(patch) });
      const existing = stored.find(item => item.person_key === key);
      if (existing) Object.assign(existing, plain(patch)); else stored.push(candidate('new', { ...plain(patch), person_key: key }));
    },
    quote: () => 12,
    evaluate: async () => { calls.evaluate++; await hooks.evaluate?.(fresh);
      if (options.scoringError) throw options.scoringError;
      return { result: options.result || { finalScore: options.score ?? 88, scoringContext: { fingerprint: 'score-a' } }, credits: 7 }; },
    checkpoint: async (_agent, patch) => { calls.checkpoints.push(plain(patch)); },
  };
  return { claimed, fresh, calls, stored, run: () => shared.runContinuousSourcingTick(deps) };
}

test('a tick without a due opt-in agent does no work', async () => {
  const h = harness({ noAgent: true });
  assert.deepEqual(plain(await h.run()), { processed: 0 });
  assert.equal(h.calls.discover + h.calls.evaluate + h.calls.writes.length, 0);
});
test('one discover phase persists a deduplicated page without scoring or retaining anyone', async () => {
  const h = harness({ candidates: [candidate('old', { state: 'reviewed', decision: 'reject' })],
    profiles: [profile('old'), profile('new'), { ...profile('new'), id: 'other-id' }, { name: 'Unidentified' }] });
  const result = await h.run();
  assert.equal(result.added, 1);
  assert.equal(h.calls.evaluate, 0);
  assert.equal(h.calls.reserve, 0);
  assert.equal(h.calls.writes[0].patch.state, 'discovered');
  assert.equal(h.calls.checkpoints[0].checkpoint.cursor, 'next-cursor');
});
test('pause, lease expiry and revision changes fence all work before a provider call', async () => {
  for (const patch of [{ status: 'paused' }, { lease_until: new Date(now).toISOString() }, { revision: 3 }]) {
    const h = harness({ hooks: { reread: fresh => Object.assign(fresh, patch) } });
    assert.equal((await h.run()).reason, 'LEASE_LOST');
    assert.equal(h.calls.discover + h.calls.evaluate + h.calls.prepare, 0);
    assert.equal(h.calls.checkpoints.length, 0, 'an obsolete worker cannot clear another lease');
  }
});
test('a changed brief or memory fences search and scoring before any paid operation', async () => {
  const h = harness({ contextKey: 'context-b', candidates: [candidate('ready')] });
  assert.equal((await h.run()).reason, 'CONTEXT_CHANGED');
  assert.equal(h.calls.reserve + h.calls.evaluate + h.calls.discover, 0);
  assert.equal(h.calls.checkpoints[0].status, 'blocked');
});
test('provider account eligibility receives the fence before metadata verification', async () => {
  const h = harness({ hooks: { eligibility: async (fresh, guard) => { fresh.status = 'paused'; await guard(); } } });
  assert.equal((await h.run()).reason, 'LEASE_LOST');
  assert.equal(h.calls.discover, 0);
});
test('pause during discovery prevents publishing the fetched profiles', async () => {
  const h = harness({ hooks: { discover: fresh => { fresh.status = 'paused'; } } });
  assert.equal((await h.run()).reason, 'LEASE_LOST');
  assert.equal(h.calls.discover, 1);
  assert.equal(h.calls.writes.length, 0);
});
test('a stored privacy opposition skips scoring before reservation', async () => {
  const h = harness({ candidates: [candidate('ready')], privacy: false });
  assert.equal((await h.run()).phase, 'privacy_skipped');
  assert.equal(h.calls.reserve + h.calls.evaluate, 0);
  assert.equal(h.calls.writes[0].patch.provenance.skip_reason, 'PRIVACY_OPPOSITION');
  assert.equal(h.calls.writes[0].patch.state, 'skipped');
});
test('an uncertain paid operation is never automatically submitted again', async () => {
  for (const patch of [{ credits_reserved: 12 }, { provenance: { scoring_started_at: new Date(now).toISOString() } }]) {
    const h = harness({ candidates: [candidate('ready', patch)] });
    assert.equal((await h.run()).phase, 'uncertain');
    assert.equal(h.calls.evaluate + h.calls.reserve, 0);
    assert.equal(h.calls.checkpoints[0].last_reason, 'SCORING_UNCERTAIN');
  }
});
test('a daily cap refusal prevents scoring and resumes at the next UTC budget day', async () => {
  const h = harness({ candidates: [candidate('ready')], budget: false });
  assert.equal((await h.run()).phase, 'budget');
  assert.equal(h.calls.evaluate + h.calls.writes.length, 0);
  assert.equal(h.calls.checkpoints[0].next_run_at, '2026-10-09T00:00:00.000Z');
});
test('one scoring phase reserves durably before evaluation and proposes only one result', async () => {
  const h = harness({ candidates: [candidate('one'), candidate('two')] });
  assert.equal((await h.run()).phase, 'score');
  assert.equal(h.calls.evaluate, 1);
  assert.equal(h.calls.discover, 0);
  assert.equal(h.calls.writes[0].patch.credits_reserved, 12);
  assert.equal(h.calls.writes[0].patch.provenance.scoring_started_at, new Date(now).toISOString());
  assert.equal(h.calls.writes[1].patch.credits_used, 7);
  assert.equal(h.calls.writes[1].patch.state, 'proposed');
  assert.equal(h.stored[1].score, null);
});
test('scores below the shortlist threshold remain available without filling pending review capacity', async () => {
  const h = harness({ candidates: [candidate('ready'), ...Array.from({ length: 10 }, (_, i) => candidate('low-' + i,
    { state: 'scored', score: 20, result: { finalScore: 20 } }))], score: 65 });
  assert.equal((await h.run()).phase, 'score');
  assert.equal(h.calls.writes.at(-1).patch.state, 'scored');
});
test('a full shortlist stops before discovering or scoring more people', async () => {
  const h = harness({ candidates: Array.from({ length: 10 }, (_, i) => candidate('good-' + i, { state: 'proposed' })) });
  assert.equal((await h.run()).phase, 'waiting_review');
  assert.equal(h.calls.discover + h.calls.evaluate + h.calls.reserve, 0);
});
test('the fifth calibration score requires a human review instead of autonomous activation', async () => {
  const h = harness({ agent: { status: 'calibrating', approved_context_key: null }, candidates: [candidate('ready'),
    ...Array.from({ length: 4 }, (_, i) => candidate('sample-' + i, { state: 'proposed', result: { finalScore: 80 } }))] });
  assert.equal((await h.run()).phase, 'score');
  assert.equal(h.calls.checkpoints.at(-1).status, 'awaiting_review');
  assert.equal(h.calls.checkpoints.at(-1).last_reason, 'CALIBRATION_REQUIRED');
});
test('LinkedIn details are prepared in their own durable phase before scoring', async () => {
  const h = harness({ agent: { source: 'linkedin', account_id: 'own-account', api: 'recruiter' }, candidates: [candidate('ready')] });
  assert.equal((await h.run()).phase, 'prepare');
  assert.equal(h.calls.prepare, 1);
  assert.equal(h.calls.evaluate + h.calls.reserve, 0);
  assert.equal(h.calls.writes[0].patch.profile.work_experience[0].role, 'Engineer');
  assert.equal(h.calls.writes[0].patch.provenance.profile_prepared_at, new Date(now).toISOString());
});
test('a different identity returned by a profile lookup is never saved or scored', async () => {
  const h = harness({ agent: { source: 'linkedin', account_id: 'own-account', api: 'classic' },
    candidates: [candidate('ready')], prepared: profile('different-person') });
  assert.equal((await h.run()).reason, 'PROFILE_IDENTITY_CHANGED');
  assert.equal(h.calls.writes.length + h.calls.evaluate, 0);
});
test('a stopped mission after paid scoring cannot publish a suggestion', async () => {
  const h = harness({ candidates: [candidate('ready')], hooks: { evaluate: fresh => { fresh.status = 'stopped'; } } });
  assert.equal((await h.run()).reason, 'LEASE_LOST');
  assert.equal(h.calls.evaluate, 1);
  assert.equal(h.calls.writes.length, 1, 'only the uncertainty marker remains durable');
});
test('missing score context blocks the result instead of producing a trusted shortlist', async () => {
  const h = harness({ candidates: [candidate('ready')], result: { finalScore: 99 } });
  assert.equal((await h.run()).reason, 'SCORING_UNCERTAIN');
  assert.equal(h.calls.writes.length, 1);
});
test('a timeout leaves the paid operation marker, so a resumed tick cannot retry the charge', async () => {
  const h = harness({ candidates: [candidate('ready')], scoringError: new Error('timeout') });
  await h.run();
  const resumed = harness({ candidates: h.stored });
  assert.equal((await resumed.run()).phase, 'uncertain');
  assert.equal(resumed.calls.evaluate, 0);
});
test('settings reject an unsupported model, unknown key and out-of-range profile limits', () => {
  for (const settings of [{ model_id: 'claude-opus-5-5' }, { tool: 'send_message' }, { daily_profile_limit: 101 }, { cadence_hours: 1 }]) {
    assert.throws(() => shared.normalizeContinuousSettings(settings), error => error.code === 'INVALID_SETTINGS');
  }
  assert.equal(shared.normalizeContinuousSettings({ daily_profile_limit: 100 }).daily_profile_limit, 100);
});
test('the IA target must cover one conservative quote before an agent can be configured', async () => {
  for (const daily_credit_limit of [1, 11]) {
    assert.throws(() => shared.normalizeContinuousSettings({ daily_credit_limit }), error => error.code === 'INVALID_SETTINGS');
    const h = await controlHarness({ noAgent: true });
    const response = await h.request({ action: 'configure', expected_revision: 0, source: 'pool', settings: { daily_credit_limit } });
    assert.equal(response.body.error_code, 'INVALID_SETTINGS');
    assert.equal(h.calls.rpc.some(call => call.name === 'mutate_sourcing_agent'), false);
  }
  const h = await controlHarness({ noAgent: true });
  const response = await h.request({ action: 'configure', expected_revision: 0, source: 'pool', settings: { daily_credit_limit: 12 } });
  assert.equal(response.status, 200);
  assert.equal(response.body.agent.settings.daily_credit_limit, 12);
  assert.equal(response.body.credits_estimate.per_profile, 12);
});
test('an existing target below the model quote is not eligible and cannot start', async () => {
  const h = await controlHarness({ agent: { settings: { ...shared.CONTINUOUS_DEFAULTS, daily_credit_limit: 11 } } });
  const snapshot = await h.request({ action: 'get' });
  assert.equal(snapshot.body.eligibility.allowed, false);
  assert.match(snapshot.body.eligibility.reasons.join(' '), /au moins une évaluation.*12 crédits/);
  const start = await h.request({ action: 'start_calibration', expected_revision: 2, expected_context_key: h.contextKey });
  assert.equal(start.body.error_code, 'AGENT_NOT_READY');
  assert.equal(h.calls.rpc.some(call => call.name === 'mutate_sourcing_agent'), false);
  const backend = await adapterHarness({ agent: { settings: { ...shared.CONTINUOUS_DEFAULTS, daily_credit_limit: 11 } } });
  await assert.rejects(backend.deps.eligibility(backend.current, async () => {}), error => error.code === 'INVALID_SETTINGS');
  assert.equal(backend.calls.requests.length, 0);
});
test('context fingerprints include the entire brief, filters, source, model and memory versions', async () => {
  const initial = { job_details: { title: 'Engineer', remote: 'hybrid' }, filters_snapshot: { keywords: 'Go' },
    source: 'pool', model_id: 'claude-sonnet-5-5', scoring_memory_version_key: 'v1' };
  const first = await shared.continuousContextKey(initial);
  assert.equal(first, await shared.continuousContextKey({ ...initial, job_details: { remote: 'hybrid', title: 'Engineer' } }));
  for (const patch of [{ source: 'linkedin' }, { model_id: 'other' }, { scoring_memory_version_key: 'v2' },
    { job_details: { ...initial.job_details, remote: 'remote' } }, { filters_snapshot: { keywords: 'Rust' } }]) {
    assert.notEqual(first, await shared.continuousContextKey({ ...initial, ...patch }));
  }
});

async function adapterHarness(options = {}) {
  const calls = { queries: [], requests: [], rpc: [], quotas: [], creditChecks: 0 };
  const mission = { id: projectId, organization_id: organizationId, created_by: userId, kind: 'mission', status: 'active',
    name: 'Engineer', job_details: { title: 'Engineer', skills_must_have: ['Go'] }, filters_snapshot: options.filtersSnapshot || { keywords: 'Go' } };
  const current = agent({ lease_until: new Date(Date.now() + 300_000).toISOString(), ...options.agent });
  const admin = {
    from(table) {
      const call = { table, filters: {} }; calls.queries.push(call);
      const data = () => table === 'sourcing_agents' ? current : table === 'sourcing_projects' ? mission :
        table === 'organization_members' ? { role: 'owner' } : table === 'member_linkedin_accounts' ? [{ linkedin_account_id: 'own-account' }] :
          table === 'job_candidate_status' ? [{ id: '55555555-5555-4555-8555-555555555555', created_at: '2026-10-08T18:00:00.000000+00:00', candidate_id: 'pool-person', candidate_name: 'Alice',
            linkedin_profile_url: profile('pool-person').profile_url, linkedin_profile_data: { ...profile('pool-person'), no_ai_scoring: options.sourceNoAi === true } }] : [];
      const query = { select(fields) { call.fields = fields; return query; }, eq(key, value) { call.filters[key] = value; return query; },
        not(...args) { call.not = args; return query; }, gt(key, value) { call.gt = [key, value]; return query; },
        or(value) { call.or = value; return query; },
        order() { return query; }, limit(value) { call.limit = value; return query; }, range(from, to) { call.range = [from, to]; return query; },
        maybeSingle: async () => ({ data: Array.isArray(data()) ? data()[0] : data(), error: null }), then(resolve, reject) { return Promise.resolve({ data: data(), error: null }).then(resolve, reject); } };
      return query;
    },
    async rpc(name, args) { calls.rpc.push({ name, args }); return { data: true, error: options.rpcError || null }; },
  };
  const module = compile('supabase/functions/_shared/continuous-sourcing.ts', { ...imports,
    estimateCredits: options.estimatedQuote === undefined ? models.estimateCredits : () => options.estimatedQuote,
    loadSourcingMemoryContext: async (_admin, input) => ({ versionKey: input.effect + '-v' + (options.memoryRevision || 1),
      provenance: input.effect === 'search' && options.searchMemory ? [{ id: 'confirmed-rule', version: 2 }] : [] }),
    getSubscriptionGate: async () => ({ effectivePlanId: 'pro', seatCount: 1, seatLimit: 2, status: 'active' }),
    resolveUnipileCredentials: async () => ({ dsn: 'https://provider.test', apiKey: 'fake-provider-key' }),
    getUserQuotas: async () => ({ timezone: 'Europe/Paris', business_hours_start: 9, business_hours_end: 18 }),
    isWithinBusinessHours: () => options.withinHours !== false,
    nextBusinessHoursStart: () => '2026-10-09T07:00:00.000Z',
    enforceLinkedInAction: async (_admin, input) => { calls.quotas.push(input); await options.afterQuota?.(current); return { allowed: options.quota !== false }; },
    assertCredits: async () => { calls.creditChecks++; return { ok: options.creditOk !== false, remaining: options.balance === undefined ? 100 : options.balance }; },
    isCandidateErasedForOrg: async () => options.erased === true,
    fetch: async (url, init) => {
      if (url.startsWith('https://provider.test/')) return new Response(JSON.stringify({ id: 'own-account', type: 'LINKEDIN',
        sources: [{ status: 'OK' }], connection_params: { im: { premiumFeatures: options.features || ['recruiter'] } } }));
      const body = JSON.parse(init.body); calls.requests.push({ url, body });
      if (url.endsWith('/unipile-search')) return new Response(JSON.stringify({ success: true,
        profile: profile(options.returnedPerson || 'ready'), results: options.searchProfiles || [profile('new')], cursor: options.searchCursor ?? null }));
      if (url.endsWith('/score-profile-job')) return new Response(JSON.stringify({ success: true,
        results: [{ finalScore: 84, scoringContext: { fingerprint: 'score-key' } }], stats: { totalTokens: 4000, escalated: 0 } }));
      throw new Error('Unexpected provider: ' + url);
    },
  });
  const context = await module.loadContinuousContext(admin, mission, userId, current);
  current.context_snapshot = plain(context); current.approved_context_key = context.context_key;
  current.search_filters_snapshot = mission.filters_snapshot;
  return { calls, current, module, admin, mission, deps: module.createContinuousDependencies(admin, 'http://local.test', 'fake-service-key') };
}
test('personal pool queries remain actor/org scoped even when the actor is an owner', async () => {
  const h = await adapterHarness({ withinHours: false });
  const result = await h.deps.discover(h.current, 5);
  assert.equal(result.profiles.length, 1);
  const query = h.calls.queries.find(call => call.table === 'job_candidate_status');
  assert.equal(query.filters.organization_id, organizationId);
  assert.equal(query.filters.created_by, userId);
  assert.equal(h.calls.requests.length + h.calls.quotas.length, 0);
});
test('LinkedIn search gates actual hours and auto quotas before any search call', async () => {
  for (const options of [{ withinHours: false, expected: 'OUTSIDE_HOURS' }, { quota: false, expected: 'QUOTA_REACHED' }]) {
    const h = await adapterHarness({ ...options, agent: { source: 'linkedin', account_id: 'own-account', api: 'recruiter' } });
    await assert.rejects(h.deps.discover(h.current, 5), error => error.code === options.expected);
    assert.equal(h.calls.requests.length, 0);
  }
});
test('LinkedIn search uses only the saved source account and accounts quota in auto mode', async () => {
  const h = await adapterHarness({ agent: { source: 'linkedin', account_id: 'own-account', api: 'recruiter' } });
  await h.deps.discover(h.current, 5);
  assert.equal(h.calls.quotas[0].mode, 'auto');
  assert.equal(h.calls.quotas[0].actionType, 'search');
  assert.equal(h.calls.requests[0].body.account_id, 'own-account');
  assert.equal(h.calls.requests[0].body.organization_id, organizationId);
  assert.equal(h.calls.requests[0].body.api, 'recruiter');
  assert.equal(h.calls.requests[0].body.keywords, 'Go');
});
test('the worker applies calculated experience bounds while preserving incomplete profiles and the provider cursor', async () => {
  const year = new Date().getUTCFullYear();
  const since = count => ({ year: year - count, month: 1 });
  const profiles = [
    { ...profile('short'), work_experience: [{ start: since(1), current: true }] },
    { ...profile('fit'), work_experience: [{ start: since(5), current: true }], education: [{ end: { year: year - 1 } }] },
    { ...profile('long'), work_experience: [{ start: since(20), current: true }] },
    { ...profile('summary'), current_positions: [{ start: since(1) }] },
    { ...profile('education-only'), education: [{ end: { year: year - 1 } }] },
    profile('unknown'),
  ];
  for (const filtersSnapshot of [
    { keywords: 'Go', last_manual_edit: '2026-10-09', calculated_experience_min: 3, calculated_experience_max: 8 },
    { keywords: 'Go', skills_keywords: [], years_of_experience_min: 3, years_of_experience_max: 8 },
  ]) {
    const h = await adapterHarness({ agent: { source: 'linkedin', account_id: 'own-account', api: 'recruiter' },
      filtersSnapshot, searchProfiles: profiles, searchCursor: 'page-two' });
    const result = await h.deps.discover(h.current, 10);
    assert.deepEqual(plain(result.profiles.map(profile => profile.id)), ['fit', 'summary', 'education-only', 'unknown']);
    assert.equal(result.cursor, 'page-two');
    assert.equal(result.exhausted, false);
    assert.equal(h.calls.requests[0].body.years_of_experience, undefined);
    assert.equal(h.calls.requests[0].body.calculated_experience_min, undefined);
    assert.equal(h.calls.requests.length, 1);
  }
});

test('a page entirely filtered by calculated experience does not exhaust a provider search with a next page', async () => {
  const h = await adapterHarness({ agent: { source: 'linkedin', account_id: 'own-account', api: 'recruiter' },
    filtersSnapshot: { keywords: 'Go', last_manual_edit: '2026-10-09', calculated_experience_max: 5 },
    searchProfiles: [{ ...profile('long'), work_experience: [{ start: { year: 2000, month: 1 }, current: true }] }],
    searchCursor: 'next-page' });
  const result = await h.deps.discover(h.current, 5);
  assert.equal(result.profiles.length, 0);
  assert.equal(result.cursor, 'next-page');
  assert.equal(result.exhausted, false);
});

test('an engine update invalidates a previous agent context before a provider operation', async () => {
  const h = await adapterHarness({ agent: { source: 'linkedin', account_id: 'own-account', api: 'recruiter' } });
  assert.equal(h.current.context_snapshot.scoring_engine_version, 'sourcing-v3');
  const previousInputs = { ...h.current.context_snapshot };
  delete previousInputs.context_key;
  delete previousInputs.search_memory_provenance;
  delete previousInputs.scoring_memory_provenance;
  delete previousInputs.scoring_engine_version;
  h.current.context_snapshot.context_key = await shared.continuousContextKey(previousInputs);
  h.current.approved_context_key = h.current.context_snapshot.context_key;
  await assert.rejects(h.deps.discover(h.current, 5), error => error.code === 'CONTEXT_CHANGED');
  assert.equal(h.calls.requests.length + h.calls.quotas.length, 0);
});

test('a pause after quota reservation still prevents the outbound LinkedIn operation', async () => {
  const h = await adapterHarness({ agent: { source: 'linkedin', account_id: 'own-account', api: 'classic' },
    afterQuota: current => { current.status = 'paused'; } });
  await assert.rejects(h.deps.discover(h.current, 5), error => error.code === 'LEASE_LOST');
  assert.equal(h.calls.requests.length, 0);
});
test('preparation uses a separately gated profile visit and rejects identity substitution', async () => {
  const h = await adapterHarness({ agent: { source: 'linkedin', account_id: 'own-account', api: 'classic' }, returnedPerson: 'different' });
  await assert.rejects(h.deps.prepare(h.current, candidate('ready')), error => error.code === 'PROFILE_IDENTITY_CHANGED');
  assert.equal(h.calls.quotas[0].actionType, 'profile_view');
  assert.equal(h.calls.quotas[0].mode, 'auto');
  assert.equal(h.calls.requests[0].body.action, 'get_profile');
  assert.equal(h.calls.requests[0].body.profile_id, 'ready');
});
test('an unknown credit balance fails closed before budget reservation or the scoring function', async () => {
  const h = await adapterHarness({ balance: null });
  await assert.rejects(h.deps.reserve(h.current, 1, 12), error => error.code === 'INSUFFICIENT_CREDITS');
  await assert.rejects(h.deps.evaluate(h.current, candidate('ready'), 12), error => error.code === 'INSUFFICIENT_CREDITS');
  assert.equal(h.calls.rpc.length + h.calls.requests.length, 0);
});
test('stored profile scoring can work outside LinkedIn hours and carries the fenced service contract', async () => {
  const h = await adapterHarness({ withinHours: false });
  const result = await h.deps.evaluate(h.current, candidate('ready'), 12);
  assert.equal(result.result.finalScore, 84);
  assert.equal(h.calls.quotas.length, 0);
  const body = h.calls.requests[0].body;
  assert.equal(body.profiles.length, 1);
  assert.equal(body.job.id, 'project:' + projectId);
  assert.equal(body.project_id, projectId);
  assert.equal(body.user_id, userId);
  assert.equal(body._ai_model, 'claude-sonnet-5-5');
  assert.equal(body.continuous_agent_run, true);
  assert.equal(body.continuous_agent_id, h.current.id);
  assert.equal(body.continuous_lease_token, h.current.lease_token);
  assert.equal(body.continuous_context_key, h.current.context_snapshot.context_key);
  assert.equal(body.expected_memory_version_key, 'scoring-v1');
});
test('Recruiter Lite metadata never grants the full Recruiter search API', async () => {
  const h = await adapterHarness({ features: ['recruiter_lite'], agent: { source: 'linkedin', account_id: 'own-account', api: 'recruiter' } });
  await assert.rejects(h.deps.eligibility(h.current, async () => {}), error => error.code === 'LICENSE_UNAVAILABLE');
  assert.equal(h.calls.requests.length, 0);
});
test('a verified erasure or explicit no-AI flag prevents scoring consent', async () => {
  const h = await adapterHarness({ erased: true });
  assert.equal(await h.deps.privateAllowed(h.current, profile('ready')), false);
  assert.equal(await h.deps.privateAllowed(h.current, { ...profile('ready'), noAiScoring: true }), false);
});
test('a daily profile or credit cap prevents LinkedIn discovery and profile visits before they consume quotas', async () => {
  for (const limits of [{ profiles_used: 20 }, { credits_used: 95 }]) {
    for (const candidates of [[], [candidate('ready')]]) {
      const h = harness({ agent: { source: 'linkedin', account_id: 'own-account', api: 'classic', ...limits }, candidates });
      assert.equal((await h.run()).phase, 'budget');
      assert.equal(h.calls.discover + h.calls.prepare + h.calls.evaluate + h.calls.reserve, 0);
    }
  }
});
test('an exhausted pool page keeps its chronological cursor so later new entries can be discovered', async () => {
  const h = await adapterHarness();
  const first = await h.deps.discover(h.current, 5);
  assert.equal(first.exhausted, true);
  const after = JSON.parse(first.cursor);
  assert.equal(after.created_at, '2026-10-08T18:00:00.000000+00:00');
  h.current.checkpoint.cursor = first.cursor;
  await h.deps.discover(h.current, 5);
  const query = h.calls.queries.filter(call => call.table === 'job_candidate_status').at(-1);
  assert.equal(query.or, `created_at.gt.${after.created_at},and(created_at.eq.${after.created_at},id.gt.${after.id})`);
});
test('a pool privacy flag changed after discovery is re-read before scoring the copied suggestion', async () => {
  const h = await adapterHarness({ sourceNoAi: true });
  const copiedBeforeOpposition = { ...profile('pool-person'), _mission_row_id: '55555555-5555-4555-8555-555555555555' };
  assert.equal(await h.deps.privateAllowed(h.current, copiedBeforeOpposition), false);
  const query = h.calls.queries.find(call => call.table === 'job_candidate_status');
  assert.equal(query.filters.created_by, userId);
  assert.equal(query.filters.organization_id, organizationId);
  assert.equal(h.calls.requests.length, 0);
});
test('the configured discovery cadence still applies after a page has finished scoring', async () => {
  const next = new Date(now + 6 * 3600_000).toISOString();
  const h = harness({ agent: { checkpoint: { phase: 'score', cursor: 'next', next_discovery_at: next } },
    candidates: [candidate('finished', { state: 'scored', score: 50 })] });
  assert.equal((await h.run()).phase, 'cadence');
  assert.equal(h.calls.discover, 0);
  assert.equal(h.calls.checkpoints[0].next_run_at, next);
  const backlog = harness({ agent: { checkpoint: { next_discovery_at: next } }, candidates: [candidate('ready')] });
  assert.equal((await backlog.run()).phase, 'score', 'an already discovered profile can be evaluated before the next search passage');
});

async function controlHarness(options = {}) {
  const calls = { rpc: [], queries: [], accountReads: 0, contextReads: 0, projectReads: 0 };
  let storedAgent = options.noAgent ? null : agent({ lease_token: null, lease_until: null, ...options.agent });
  const mission = { id: projectId, organization_id: organizationId, created_by: userId, name: 'Engineer',
    status: 'active', job_details: { title: 'Engineer', original_brief_text: 'Go, SaaS et français impératifs.' }, filters_snapshot: options.filtersSnapshot || { keywords: 'Go' } };
  const proposals = options.candidates || [];
  const contextFor = async (_admin, selectedMission, _actor, config) => {
    const input = { job_details: selectedMission.job_details, filters_snapshot: selectedMission.filters_snapshot,
      source: config.source, api: config.api, account_id: config.account_id, model_id: config.settings.model_id,
      search_memory_version_key: 'search-v1', scoring_memory_version_key: 'scoring-v1' };
    return { ...input, context_key: await shared.continuousContextKey(input),
      search_memory_provenance: options.searchMemory ? [{ id: 'confirmed-rule', version: 2 }] : [] };
  };
  const initialContext = await contextFor(null, mission, userId, storedAgent ||
    { source: 'pool', api: null, account_id: null, settings: shared.CONTINUOUS_DEFAULTS });
  if (storedAgent) {
    storedAgent.context_snapshot = initialContext;
    storedAgent.approved_context_key = initialContext.context_key;
    proposals.forEach(item => { item.context_key = initialContext.context_key; });
  }
  const admin = {
    from(table) {
      const call = { table, filters: {} }; calls.queries.push(call);
      const data = () => table === 'profiles' ? { active_organization_id: options.activeOrg || organizationId } :
        table === 'sourcing_agents' ? storedAgent : table === 'sourcing_agent_candidates' ? proposals : null;
      const selected = () => {
        if (table !== 'sourcing_agent_candidates') return data();
        let rows = proposals.filter(row => !call.filters.state || row.state === call.filters.state);
        if (call.or) rows = rows.filter(shared.isContinuousCandidateUncertain);
        rows = rows.toSorted((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
        if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
        if (call.limit !== undefined) rows = rows.slice(0, call.limit);
        return rows;
      };
      const query = { select() { return query; }, eq(key, value) { call.filters[key] = value; return query; }, order() { return query; },
        or(value) { call.or = value; return query; }, range(from, to) { call.range = [from, to]; return query; },
        limit(value) { call.limit = value; return query; },
        maybeSingle: async () => ({ data: selected(), error: null }), then(resolve, reject) { return Promise.resolve({ data: selected(), error: null }).then(resolve, reject); } };
      return query;
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args: plain(args) });
      if (name === 'check_rate_limit') return { data: options.rateAllowed !== false, error: options.rateError || null };
      if (name === 'assert_sourcing_agent_actor') return { data: mission, error: null };
      if (name === 'mutate_sourcing_agent') {
        if (options.mutationError) return { data: null, error: options.mutationError };
        const payload = args.p_payload;
        storedAgent = { ...(storedAgent || agent({ status: 'draft' })), ...payload,
          revision: (storedAgent?.revision || 0) + 1 };
        if (args.p_action === 'configure') storedAgent.status = 'draft';
        if (args.p_action === 'start_calibration') storedAgent.status = 'calibrating';
        if (args.p_action === 'pause' || args.p_action === 'stop') {
          storedAgent.status = args.p_action === 'pause' ? 'paused' : 'stopped';
          storedAgent.lease_token = null; storedAgent.lease_until = null;
        }
        if (args.p_action === 'resume') storedAgent.status = 'active';
        if (args.p_action === 'skip_uncertain') {
          const selected = proposals.find(item => item.id === payload.candidate_id);
          const reserved = selected.credits_reserved;
          storedAgent.credits_reserved = Math.max(0, storedAgent.credits_reserved - reserved);
          storedAgent.credits_used += reserved;
          selected.credits_used += reserved; selected.credits_reserved = 0;
          selected.state = 'skipped'; selected.score = null; selected.result = {};
          selected.provenance = { ...selected.provenance, skip_reason: 'HUMAN_SKIP_UNCERTAIN', human_skip_reason: payload.reason };
          storedAgent.status = 'paused';
        }
        if (args.p_action === 'approve_calibration') { storedAgent.status = 'active'; mission.job_details.calibration_profiles = payload.calibration_profiles; }
        return { data: storedAgent, error: null };
      }
      if (name === 'review_sourcing_agent_candidate') {
        storedAgent.revision++;
        return { data: { agent: storedAgent, candidate: proposals.find(item => item.id === args.p_candidate_id) }, error: null };
      }
      throw new Error('Unexpected control mutation: ' + name);
    },
  };
  let handler;
  compile('supabase/functions/sourcing-agent/index.ts', { ...shared,
    estimateCredits: options.estimatedQuote === undefined ? models.estimateCredits : () => options.estimatedQuote,
    createClient: () => admin,
    requireAuth: async () => ({ userId: options.serviceRole ? null : userId }),
    readAgentProject: async () => { calls.projectReads++; if (options.memoryReadError) throw new Error('Memory RPC unavailable'); return plain(mission); },
    loadContinuousContext: async (...args) => { calls.contextReads++; if (options.contextReadError) throw new Error('Memory RPC unavailable'); return contextFor(...args); },
    readOwnAgentAccounts: async () => { calls.accountReads++; if (options.accountReadError) throw new Error('Provider unavailable');
      if (options.accountNeverResponds) return new Promise(() => {});
      return [{ id: 'own-account', name: 'Mon compte', apis: ['classic'], status: 'OK' }]; },
    requireAgentPlan: async () => { if (options.planBlocked) throw new shared.ContinuousError('PLAN_REQUIRED', 'Abonnement requis.', 403); },
    Deno: { env: { get: () => 'local-only-fake' }, serve: fn => { handler = fn; } },
  });
  return { calls, mission, contextKey: initialContext.context_key, get agent() { return storedAgent; },
    async request(body) {
      const response = await handler(new Request('http://local.test/functions/v1/sourcing-agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-user-jwt' },
        body: typeof body === 'string' ? body : JSON.stringify({ project_id: projectId, organization_id: organizationId, ...body }),
      }));
      return { status: response.status, body: await response.json() };
    } };
}
test('opening and configuring the authenticated agent never activates it or starts model/provider work', async () => {
  const h = await controlHarness({ noAgent: true });
  const opened = await h.request({ action: 'get' });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.agent, null);
  assert.equal(opened.body.credits_estimate.daily_limit, 100);
  assert.equal(h.calls.rpc.filter(call => call.name === 'mutate_sourcing_agent').length, 0);
  const configured = await h.request({ action: 'configure', expected_revision: 0, source: 'pool', settings: { daily_profile_limit: 15 } });
  assert.equal(configured.status, 200);
  assert.equal(configured.body.agent.status, 'draft');
  assert.deepEqual(h.calls.rpc.filter(call => call.name === 'mutate_sourcing_agent').map(call => call.args.p_action), ['configure']);
});
test('control API rejects service-role browsers, another active space and another agent owner', async () => {
  for (const options of [{ serviceRole: true }, { activeOrg: 'other-space' }, { agent: { created_by: 'another-actor' } }]) {
    const h = await controlHarness(options);
    const result = await h.request({ action: 'get' });
    assert.equal(result.status, 403);
    assert.equal(result.body.error_code, 'AGENT_FORBIDDEN');
    assert.equal(h.calls.accountReads, 0);
  }
});
test('control API validates malformed JSON and rate-limits before account-provider reads', async () => {
  const malformed = await controlHarness();
  assert.equal((await malformed.request('{bad-json')).status, 400);
  const limited = await controlHarness({ rateAllowed: false });
  assert.equal((await limited.request({ action: 'get' })).status, 429);
  assert.equal(limited.calls.accountReads, 0);
  const failed = await controlHarness({ rateError: { code: 'RPC_UNAVAILABLE' } });
  assert.equal((await failed.request({ action: 'get' })).status, 503);
  assert.equal(failed.calls.accountReads, 0);
});
test('mutations reject a stale revision and calibration requires the viewed complete context', async () => {
  const h = await controlHarness();
  assert.equal((await h.request({ action: 'pause', expected_revision: 1 })).body.error_code, 'REVISION_CONFLICT');
  assert.equal((await h.request({ action: 'start_calibration', expected_revision: 2, expected_context_key: 'old' })).body.error_code, 'CONTEXT_CHANGED');
  assert.equal(h.calls.rpc.filter(call => call.name === 'mutate_sourcing_agent').length, 0);
});
test('a forged LinkedIn account or unsupported model is refused on configure', async () => {
  const h = await controlHarness();
  const forged = await h.request({ action: 'configure', expected_revision: 2, source: 'linkedin', api: 'classic', account_id: 'someone-else-account' });
  assert.equal(forged.status, 403);
  assert.equal(forged.body.error_code, 'ACCOUNT_FORBIDDEN');
  const model = await h.request({ action: 'configure', expected_revision: 2, source: 'pool', settings: { model_id: 'claude-opus-5-5' } });
  assert.equal(model.body.error_code, 'INVALID_SETTINGS');
});
test('pause remains available when subscription prerequisites no longer allow starting', async () => {
  const h = await controlHarness({ planBlocked: true });
  const result = await h.request({ action: 'pause', expected_revision: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.body.agent.status, 'paused');
  assert.equal(result.body.eligibility.allowed, false);
});
test('approval requires consent and three reasoned reviews including a positive reference', async () => {
  const h = await controlHarness({ agent: { status: 'awaiting_review' } });
  assert.equal((await h.request({ action: 'approve_calibration', expected_revision: 2, expected_context_key: h.contextKey })).body.error_code,
    'CALIBRATION_CONSENT_REQUIRED');
  assert.equal((await h.request({ action: 'approve_calibration', expected_revision: 2, expected_context_key: h.contextKey,
    save_calibration_profiles: true })).body.error_code, 'CALIBRATION_REQUIRED');
  assert.equal(h.calls.rpc.filter(call => call.name === 'mutate_sourcing_agent').length, 0);
});
test('explicit calibration approval sends only consented positive references in the real brief shape', async () => {
  const samples = [candidate('fit', { state: 'reviewed', decision: 'fit', reason: 'Expérience SaaS pertinente.' }),
    candidate('no-one', { state: 'reviewed', decision: 'reject', reason: 'Pas de pratique du français.' }),
    candidate('no-two', { state: 'reviewed', decision: 'reject', reason: 'Expérience trop junior.' })];
  const h = await controlHarness({ agent: { status: 'awaiting_review' }, candidates: samples });
  const result = await h.request({ action: 'approve_calibration', expected_revision: 2, expected_context_key: h.contextKey,
    save_calibration_profiles: true });
  assert.equal(result.status, 200);
  const payload = h.calls.rpc.find(call => call.name === 'mutate_sourcing_agent').args.p_payload;
  assert.equal(payload.expected_job_details.original_brief_text, 'Go, SaaS et français impératifs.');
  assert.equal(payload.calibration_profiles.length, 1);
  assert.deepEqual(payload.calibration_profiles[0].why_good_fit, ['Expérience SaaS pertinente.']);
  assert.equal(payload.calibration_profiles[0].areas_of_improvement, '');
  assert.notEqual(payload.approved_context_key, h.contextKey, 'the approved references are included in the new immutable scoring context');
  const mapped = profileData.buildJobFromBrief(result.body.agent.context_snapshot.job_details, { id: 'project:' + projectId });
  assert.deepEqual(plain(mapped.calibrationProfiles[0].whyGoodFit), ['Expérience SaaS pertinente.']);
});
test('review uses the suggestion UUID, a five-character human reason and actor revision', async () => {
  const proposalId = '66666666-6666-4666-8666-666666666666';
  const h = await controlHarness({ candidates: [candidate('ready', { id: proposalId, state: 'proposed' })] });
  const body = { action: 'review', expected_revision: 2, expected_context_key: h.contextKey,
    candidate_id: proposalId, decision: 'reject', reason: 'Non' };
  assert.equal((await h.request(body)).body.error_code, 'REVIEW_REQUIRED');
  const accepted = await h.request({ ...body, reason: 'Expérience insuffisante.' });
  assert.equal(accepted.status, 200);
  const call = h.calls.rpc.find(call => call.name === 'review_sourcing_agent_candidate');
  assert.equal(call.args.p_candidate_id, proposalId);
  assert.equal(call.args.p_user_id, userId);
  assert.equal(call.args.p_expected_revision, 2);
});

function linkedinHandlerHarness(options = {}) {
  const calls = { requests: [], rpc: [], quota: [] };
  const saved = agent({ source: 'linkedin', account_id: 'own-account', api: 'classic' });
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from(table) {
      const value = () => table === 'organization_integrations' ? { unipile_connected: true,
        unipile_api_key: 'fake-unipile-key', unipile_dsn: 'provider.test' } : table === 'member_linkedin_accounts'
        ? [{ linkedin_account_id: 'own-account' }] : table === 'organization_members' ? { id: 'member-a' } : [];
      const query = { select() { return query; }, eq() { return query; }, insert() { return query; },
        single: async () => ({ data: value(), error: null }), maybeSingle: async () => ({ data: value(), error: null }),
        then(resolve, reject) { return Promise.resolve({ data: value(), error: null }).then(resolve, reject); } };
      return query;
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (name === 'sourcing_agent_assert_lease') return { data: options.leaseLost ? null : saved,
        error: options.leaseLost ? { code: '40001' } : null };
      if (name === 'check_rate_limit') return { data: true, error: null };
      throw new Error('Unexpected LinkedIn RPC: ' + name);
    },
  };
  let handler;
  compile('supabase/functions/unipile-search/index.ts', {
    ...boolean,
    createClient: () => admin,
    assertContinuousOperationContext: async () => {
      if (options.pauseDuringContext) options.leaseLost = true;
      if (options.contextChanged) throw new shared.ContinuousError('CONTEXT_CHANGED', 'Brief updated');
    },
    enforceLinkedInAction: async (_admin, gate) => { calls.quota.push(gate); return { allowed: options.quota !== false }; },
    recordUsageSignal: async () => {}, parseUsagePct: () => null,
    // Retry delays are virtual; no LinkedIn, sleeps or paid providers run in this suite.
    setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds === 6000 || milliseconds === 15000 ? 0 : milliseconds),
    fetch: async (url, init) => {
      calls.requests.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      if (options.multipleSessions) return new Response(JSON.stringify({ type: 'multiple_sessions', detail: 'multiple sessions' }), { status: 502 });
      return new Response(JSON.stringify(url.includes('/users/') ? profile('ready') : { items: [profile('ready')] }));
    },
    Deno: { env: { get: name => name === 'SUPABASE_URL' ? 'http://local.test' : name.includes('SERVICE_ROLE') || name === 'SB_SECRET_KEY'
      ? 'fake-service-key' : 'fake-anon-key' }, serve: fn => { handler = fn; } },
  });
  return { calls, async request(action, patch = {}) {
    const body = { action, account_id: 'own-account', organization_id: organizationId, api: 'classic', keywords: 'Go',
      profile_id: 'ready', continuous_agent_run: !options.manual, continuous_agent_id: saved.id,
      continuous_lease_token: saved.lease_token, continuous_context_key: saved.context_snapshot.context_key,
      user_id: userId, ...patch };
    const response = await handler(new Request('http://local.test/functions/v1/unipile-search', {
      method: 'POST', headers: { Authorization: 'Bearer ' + (options.userJwt ? 'fake-user-jwt' : 'fake-service-key'), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  } };
}
test('the actual LinkedIn handler fences a stopped agent immediately before search and profile fetch', async () => {
  for (const action of ['search', 'get_profile']) {
    const h = linkedinHandlerHarness({ leaseLost: true });
    const result = await h.request(action);
    assert.equal(result.status, 409);
    assert.equal(result.body.error_code, 'AGENT_LEASE_CHANGED');
    assert.equal(h.calls.requests.length, 0);
  }
});
test('the actual LinkedIn handler allows only read actions for a continuous service request', async () => {
  const h = linkedinHandlerHarness();
  const result = await h.request('send_message', { chat_id: 'chat-a', text: 'Unwanted message' });
  assert.equal(result.status, 403);
  assert.equal(h.calls.requests.length, 0);
});
test('the actual profile handler preserves the working manual path and the fenced continuous path', async () => {
  for (const options of [{}, { manual: true, userJwt: true }]) {
    const h = linkedinHandlerHarness(options);
    const result = await h.request('get_profile');
    assert.equal(result.status, 200);
    assert.equal(result.body.profile.id, 'ready');
    assert.equal(h.calls.requests.length, 1);
    assert.match(h.calls.requests[0].url, /\/users\/ready\?account_id=own-account$/);
    assert.equal(h.calls.rpc.some(call => call.name === 'sourcing_agent_assert_lease'), !options.manual);
  }
});
test('continuous search makes one accounted provider attempt while manual search retains existing retries', async () => {
  for (const [manual, count] of [[false, 1], [true, 3]]) {
    const h = linkedinHandlerHarness({ manual, multipleSessions: true });
    const result = await h.request('search');
    assert.equal(result.status, 502);
    assert.equal(h.calls.requests.length, count);
  }
});
test('a JWT caller cannot forge the continuous flag to bypass the manual LinkedIn quota', async () => {
  const h = linkedinHandlerHarness({ userJwt: true, quota: false });
  const result = await h.request('get_profile', { continuous_agent_run: true });
  assert.equal(result.status, 429);
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.calls.quota.length, 1);
  assert.equal(h.calls.quota[0].mode, 'manual');
  assert.equal(h.calls.rpc.some(call => call.name === 'sourcing_agent_assert_lease'), false);
});
test('search memories require saved filters from the same reviewed version before any LinkedIn work', async () => {
  for (const metadata of [undefined, { effect: 'search', versionKey: 'search-v0', provenance: [] }]) {
    const h = await adapterHarness({ searchMemory: true, filtersSnapshot: { keywords: 'Go', memory_context: metadata },
      agent: { source: 'linkedin', account_id: 'own-account', api: 'recruiter' } });
    await assert.rejects(h.deps.eligibility(h.current, async () => {}), error => error.code === 'FILTERS_MEMORY_STALE');
    assert.equal(h.calls.requests.length, 0);
    assert.equal(h.calls.queries.some(call => call.table === 'member_linkedin_accounts'), false, 'stale query is blocked even before account metadata lookup');
  }
});
test('current filter memory provenance permits LinkedIn while personal pool needs no LinkedIn query', async () => {
  const matched = await adapterHarness({ searchMemory: true,
    filtersSnapshot: { keywords: 'Go', memory_context: { effect: 'search', versionKey: 'search-v1', provenance: [{ id: 'confirmed-rule' }] } },
    agent: { source: 'linkedin', account_id: 'own-account', api: 'recruiter' } });
  await matched.deps.eligibility(matched.current, async () => {});
  const pool = await adapterHarness({ searchMemory: true });
  await pool.deps.eligibility(pool.current, async () => {});
  assert.equal(pool.calls.queries.some(call => call.table === 'member_linkedin_accounts'), false);
});
test('removing a previously applied search rule also requires reviewing the old filters', () => {
  assert.throws(() => shared.assertContinuousSearchMemory({ memory_context: { effect: 'search', versionKey: 'old',
    provenance: [{ id: 'removed-rule' }] } }, { search_memory_version_key: 'new', search_memory_provenance: [] }),
  error => error.code === 'FILTERS_MEMORY_STALE');
});
test('control API exposes outdated filter memories and refuses calibration until they are reviewed', async () => {
  const h = await controlHarness({ searchMemory: true, agent: { source: 'linkedin', api: 'classic', account_id: 'own-account' } });
  const opened = await h.request({ action: 'get' });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.eligibility.allowed, false);
  assert.match(opened.body.eligibility.reasons.join(' '), /mémoires de recherche/);
  const start = await h.request({ action: 'start_calibration', expected_revision: 2, expected_context_key: h.contextKey });
  assert.equal(start.status, 409);
  assert.equal(start.body.error_code, 'FILTERS_MEMORY_STALE');
  assert.equal(h.calls.rpc.filter(call => call.name === 'mutate_sourcing_agent').length, 0);
});
test('a GDPR SQL race is mapped to privacy blocking instead of an automatic scoring retry', async () => {
  const h = await adapterHarness({ rpcError: { code: '42501', hint: 'SOURCING_AGENT_CANDIDATE_ERASED' } });
  await assert.rejects(h.deps.write(h.current, 'slug:ready', { state: 'discovered' }), error => error.code === 'PRIVACY_CHANGED');
});
test('privacy skips do not consume the five useful calibration samples', async () => {
  const h = harness({ agent: { status: 'calibrating', approved_context_key: null },
    candidates: [candidate('reviewed-one', { state: 'reviewed', decision: 'fit', result: { finalScore: 90 } }),
      candidate('reviewed-two', { state: 'reviewed', decision: 'reject', result: { finalScore: 40 } }),
      ...Array.from({ length: 3 }, (_, i) => candidate('privacy-' + i, { state: 'skipped' }))],
    profiles: [profile('replacement-one'), profile('replacement-two'), profile('replacement-three')] });
  const result = await h.run();
  assert.equal(result.phase, 'discover');
  assert.equal(result.added, 3);
  assert.equal(h.calls.limit, 3);
  assert.equal(h.calls.checkpoints[0].status, undefined);
});
test('a changed calibration context can re-evaluate old positive references while human rejects stay excluded', async () => {
  const h = harness({ agent: { status: 'calibrating', approved_context_key: null },
    candidates: [candidate('good-old', { context_key: 'previous-context', state: 'reviewed', decision: 'fit' }),
      candidate('reject-old', { context_key: 'previous-context', state: 'reviewed', decision: 'reject' })],
    profiles: [profile('good-old'), profile('reject-old')] });
  const result = await h.run();
  assert.equal(result.added, 1);
  assert.equal(h.calls.writes[0].key, 'slug:good-old');
  assert.equal(h.calls.writes[0].patch.context_key, 'context-a');
});
test('the fourth useful calibration score still waits for a fifth sample', async () => {
  const h = harness({ agent: { status: 'calibrating', approved_context_key: null },
    candidates: [candidate('ready'), ...Array.from({ length: 3 }, (_, i) => candidate('done-' + i,
      { state: 'proposed', result: { finalScore: 80 } }))] });
  assert.equal((await h.run()).phase, 'score');
  assert.equal(h.calls.checkpoints.at(-1).status, undefined);
});
test('account-provider errors are distinguished from an empty LinkedIn account list, even in pool mode', async () => {
  const h = await controlHarness({ accountReadError: true });
  const result = await h.request({ action: 'get' });
  assert.equal(result.status, 200);
  assert.equal(result.body.eligibility.allowed, true, 'pool can still run');
  assert.deepEqual(result.body.accounts, []);
  assert.match(result.body.accounts_error, /ne peuvent pas être vérifiés/);
});
test('interrupted-profile skip requires explicit consent, revision and a genuine uncertainty marker', async () => {
  const id = '77777777-7777-4777-8777-777777777777';
  const h = await controlHarness({ agent: { status: 'blocked' }, candidates: [candidate('ready', { id })] });
  const command = { action: 'skip_uncertain', candidate_id: id, expected_revision: 2, expected_context_key: h.contextKey };
  assert.equal((await h.request(command)).body.error_code, 'UNCERTAIN_CONSENT_REQUIRED');
  assert.equal((await h.request({ ...command, confirm_uncertain: true })).body.error_code, 'UNCERTAIN_PROFILE_REQUIRED');
  assert.equal(h.calls.rpc.filter(call => call.name === 'mutate_sourcing_agent').length, 0);
});
test('timeout, explicit skip and separate resume advance to the next profile without repeating the uncertain charge', async () => {
  const firstId = '77777777-7777-4777-8777-777777777777';
  const secondId = '88888888-8888-4888-8888-888888888888';
  const crashed = harness({ candidates: [candidate('first', { id: firstId }), candidate('second', { id: secondId })], scoringError: new Error('timeout') });
  await crashed.run();
  assert.equal(crashed.calls.evaluate, 1);
  const h = await controlHarness({ agent: { status: 'blocked', credits_reserved: 12 }, candidates: crashed.stored });
  const command = { action: 'skip_uncertain', candidate_id: firstId, confirm_uncertain: true,
    expected_revision: 2, expected_context_key: h.contextKey };
  const skipped = await h.request(command);
  assert.equal(skipped.status, 200);
  assert.equal(skipped.body.agent.status, 'paused');
  assert.equal(skipped.body.agent.credits_reserved, 0);
  assert.equal(skipped.body.agent.credits_used, 12);
  assert.equal(skipped.body.candidates.find(row => row.id === firstId).state, 'skipped');
  assert.equal((await h.request(command)).body.error_code, 'REVISION_CONFLICT');
  assert.equal((await h.request({ ...command, expected_revision: 3 })).body.error_code, 'UNCERTAIN_PROFILE_REQUIRED');
  assert.equal(h.agent.credits_used, 12, 'repeat clicks cannot consume the reservation twice');
  const resumed = await h.request({ action: 'resume', expected_revision: 3, expected_context_key: h.contextKey });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.agent.status, 'active');
  const next = harness({ agent: { ...resumed.body.agent, lease_token: 'lease-b', lease_until: new Date(now + 300_000).toISOString() },
    contextKey: h.contextKey, candidates: resumed.body.candidates });
  const processed = await next.run();
  assert.equal(processed.phase, 'score');
  assert.equal(processed.candidate_id, secondId);
  assert.equal(next.calls.evaluate, 1);
  assert.equal(next.calls.writes.some(call => call.key === 'slug:first'), false);
});
test('provider boundary context checks detect live brief, filter and memory edits even without changing the lease', async () => {
  for (const edit of ['brief', 'filter', 'memory']) {
    const options = {};
    const h = await adapterHarness(options);
    await h.module.assertContinuousOperationContext(h.admin, h.current);
    if (edit === 'brief') h.mission.job_details.remote_policy = 'full_remote';
    if (edit === 'filter') h.mission.filters_snapshot.keywords = 'Rust';
    if (edit === 'memory') options.memoryRevision = 2;
    await assert.rejects(h.module.assertContinuousOperationContext(h.admin, h.current), error => error.code === 'CONTEXT_CHANGED');
    assert.equal(h.calls.requests.length, 0);
    assert.equal(h.current.lease_token, 'lease-a');
  }
});
test('live context edits at the actual LinkedIn provider boundary block both search and profile visits', async () => {
  for (const action of ['search', 'get_profile']) {
    const h = linkedinHandlerHarness({ contextChanged: true });
    const result = await h.request(action);
    assert.equal(result.status, 409);
    assert.equal(result.body.error_code, 'CONTEXT_CHANGED');
    assert.equal(h.calls.requests.length, 0);
  }
});
test('approval references contain their durable suggestion ID and only a safe HTTPS LinkedIn URL', async () => {
  const rows = [candidate('fit', { id: '77777777-7777-4777-8777-777777777777', state: 'reviewed', decision: 'fit', reason: 'Très pertinent.',
    profile: { id: 'fit', name: 'Reference', profile_url: 'javascript:alert(1)' } }),
  candidate('no-one', { state: 'reviewed', decision: 'reject', reason: 'Expérience trop junior.' }),
  candidate('no-two', { state: 'reviewed', decision: 'reject', reason: 'Secteur trop éloigné.' })];
  const h = await controlHarness({ agent: { status: 'awaiting_review' }, candidates: rows });
  const result = await h.request({ action: 'approve_calibration', expected_revision: 2, expected_context_key: h.contextKey,
    save_calibration_profiles: true });
  assert.equal(result.status, 200);
  const reference = result.body.agent.context_snapshot.job_details.calibration_profiles[0];
  assert.equal(reference.linkedin_url, '');
  assert.equal(reference.sourcing_agent_candidate_id, rows[0].id);
  for (const url of ['javascript:alert(1)', 'https://evil.test/linkedin.com/in/fit', 'https://user:password@linkedin.com/in/fit', 'http://linkedin.com/in/fit']) {
    assert.equal(shared.continuousLinkedInUrl({ profile_url: url }), null);
  }
  assert.equal(shared.continuousLinkedInUrl(profile('fit')), 'https://www.linkedin.com/in/fit');
});
test('resume and recalibration cannot bypass an unresolved interrupted evaluation', async () => {
  const h = await controlHarness({ agent: { status: 'paused' }, candidates: [candidate('ready', { credits_reserved: 12 })] });
  for (const action of ['resume', 'start_calibration']) {
    const result = await h.request({ action, expected_revision: 2, expected_context_key: h.contextKey });
    assert.equal(result.status, 409);
    assert.equal(result.body.error_code, 'SCORING_UNCERTAIN');
  }
  assert.equal(h.calls.rpc.filter(call => call.name === 'mutate_sourcing_agent').length, 0);
});
test('an interrupted score from a previous brief blocks all activation paths and worker phases', async () => {
  const old = candidate('old', { credits_reserved: 12, provenance: { scoring_started_at: new Date(now).toISOString() } });
  const h = await controlHarness({ agent: { status: 'blocked', credits_reserved: 12 }, candidates: [old] });
  const durableContext = old.context_key;
  h.mission.job_details.title = 'Rust engineer';
  const current = await h.request({ action: 'get' });
  assert.notEqual(current.body.context_key, durableContext);
  for (const action of ['configure', 'start_calibration', 'resume', 'approve_calibration']) {
    const response = await h.request({ action, expected_revision: 2, expected_context_key: current.body.context_key });
    assert.equal(response.status, 409);
    assert.equal(response.body.error_code, 'SCORING_UNCERTAIN');
  }
  assert.equal(h.calls.rpc.some(call => call.name === 'mutate_sourcing_agent'), false);
  const tick = harness({ agent: { status: 'calibrating', approved_context_key: null },
    candidates: [candidate('old', { context_key: 'previous-context', provenance: { reservation_recovered: 'ESTIMATED_AFTER_LEASE' } })],
    profiles: [profile('old'), profile('new')] });
  assert.equal((await tick.run()).phase, 'uncertain');
  assert.equal(tick.calls.discover + tick.calls.prepare + tick.calls.reserve + tick.calls.evaluate + tick.calls.writes.length, 0);
});
test('free resolution uses the saved candidate context even after brief changes and memory/account outages', { timeout: 1000 }, async () => {
  const id = '77777777-7777-4777-8777-777777777777';
  const old = candidate('old', { id, credits_reserved: 12, provenance: { scoring_started_at: new Date(now).toISOString() } });
  const h = await controlHarness({ agent: { status: 'blocked', credits_reserved: 12 }, candidates: [old],
    memoryReadError: true, contextReadError: true, accountNeverResponds: true });
  const durableContext = old.context_key;
  h.mission.job_details.title = 'Rust engineer';
  const response = await h.request({ action: 'skip_uncertain', candidate_id: id, confirm_uncertain: true,
    expected_revision: 2, expected_context_key: 'new-live-context' });
  assert.equal(response.status, 200);
  assert.equal(response.body.agent.status, 'paused');
  assert.equal(response.body.candidates[0].state, 'skipped');
  assert.equal(response.body.agent.credits_used, 12);
  assert.equal(h.calls.projectReads + h.calls.contextReads + h.calls.accountReads, 0);
  const mutation = h.calls.rpc.find(call => call.name === 'mutate_sourcing_agent');
  assert.equal(mutation.args.p_payload.context_key, durableContext);
  assert.equal((await h.request({ action: 'skip_uncertain', candidate_id: id, confirm_uncertain: true, expected_revision: 3 })).body.error_code, 'UNCERTAIN_PROFILE_REQUIRED');
  assert.equal(h.agent.credits_used, 12);
  const next = harness({ agent: { status: 'calibrating', approved_context_key: null }, candidates: response.body.candidates,
    profiles: [profile('old'), profile('new')] });
  assert.equal((await next.run()).added, 1);
  assert.equal(next.calls.writes[0].key, 'slug:new', 'a resolved old-context uncertainty stays skipped after recalibration');
});
test('all interrupted operations remain visible and blocking beyond the bounded recent history', async () => {
  const id = '77777777-7777-4777-8777-777777777777';
  const interrupted = Array.from({ length: 201 }, (_, i) => candidate('old-' + i, { id: i === 200 ? id : 'old-' + i,
    updated_at: '2026-09-01T00:00:00.000Z', provenance: { scoring_started_at: '2026-09-01T00:00:00.000Z' } }));
  const recent = Array.from({ length: 220 }, (_, i) => candidate('done-' + i, { state: 'reviewed', decision: 'fit',
    updated_at: '2026-10-08T20:00:00.000Z' }));
  const h = await controlHarness({ agent: { status: 'blocked' }, candidates: [...recent, ...interrupted] });
  interrupted.forEach(row => { row.context_key = 'old-context'; });
  const snapshot = await h.request({ action: 'get' });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.candidates.filter(shared.isContinuousCandidateUncertain).length, 201);
  assert.equal(snapshot.body.candidates.find(row => row.id === id).context_key, 'old-context');
  assert.equal(snapshot.body.candidates.length, 401, 'recent history remains bounded independently of interrupted profiles');
  assert.ok(h.calls.queries.some(call => call.table === 'sourcing_agent_candidates' && call.range?.[0] === 200));
  const start = await h.request({ action: 'start_calibration', expected_revision: 2, expected_context_key: h.contextKey });
  assert.equal(start.body.error_code, 'SCORING_UNCERTAIN');
  const skipped = await h.request({ action: 'skip_uncertain', candidate_id: id, confirm_uncertain: true, expected_revision: 2 });
  assert.equal(skipped.status, 200);
  assert.equal(skipped.body.candidates.filter(shared.isContinuousCandidateUncertain).length, 200);
  assert.equal(h.calls.rpc.find(call => call.name === 'mutate_sourcing_agent').args.p_payload.context_key, 'old-context');
});
test('a pause acknowledged during the final live-context read fences search and profile providers', async () => {
  for (const action of ['search', 'get_profile']) {
    const h = linkedinHandlerHarness({ pauseDuringContext: true });
    const response = await h.request(action);
    assert.equal(response.status, 409);
    assert.equal(response.body.error_code, 'AGENT_LEASE_CHANGED');
    assert.equal(h.calls.requests.length, 0);
    assert.ok(h.calls.rpc.filter(call => call.name === 'sourcing_agent_assert_lease').length >= 2);
  }
});
test('readiness follows an increased model quote and explains the actual minimum target', async () => {
  const settings = { ...shared.CONTINUOUS_DEFAULTS, daily_credit_limit: 15 };
  const h = await controlHarness({ agent: { settings }, estimatedQuote: 17 });
  const response = await h.request({ action: 'get' });
  assert.equal(response.body.eligibility.allowed, false);
  assert.equal(response.body.credits_estimate.per_profile, 17);
  assert.match(response.body.eligibility.reasons.join(' '), /soit 17 crédits/);
  const adapter = await adapterHarness({ agent: { settings }, estimatedQuote: 17 });
  await assert.rejects(adapter.deps.eligibility(adapter.current, async () => {}), error => error.code === 'INVALID_SETTINGS' && /17 crédits/.test(error.message));
  assert.equal(adapter.deps.quote(adapter.current, {}), 17);
  assert.equal(adapter.calls.requests.length, 0);
});
test('a concurrent SQL uncertainty gate remains an actionable conflict rather than a generic outage', async () => {
  const h = await controlHarness({ mutationError: { code: '22023', hint: 'SOURCING_AGENT_SCORING_UNCERTAIN' } });
  const response = await h.request({ action: 'start_calibration', expected_revision: 2, expected_context_key: h.contextKey });
  assert.equal(response.status, 409);
  assert.equal(response.body.error_code, 'SCORING_UNCERTAIN');
  assert.match(response.body.error, /évaluations interrompues/);
  assert.equal(h.agent.revision, 2);
  assert.equal(h.calls.rpc.filter(call => call.name === 'mutate_sourcing_agent').length, 1);
});
test('pause and stop invalidate the lease without waiting for memory, account provider or rate-limit availability', { timeout: 1000 }, async () => {
  for (const action of ['pause', 'stop']) {
    const h = await controlHarness({ memoryReadError: true, contextReadError: true, accountNeverResponds: true,
      rateError: { code: 'RPC_UNAVAILABLE' }, agent: { lease_token: 'active-lease', lease_until: new Date(now + 300_000).toISOString() } });
    const result = await h.request({ action, expected_revision: 2 });
    assert.equal(result.status, 200);
    assert.equal(result.body.agent.status, action === 'pause' ? 'paused' : 'stopped');
    assert.equal(result.body.agent.lease_token, null);
    assert.equal(result.body.agent.revision, 3);
    assert.equal(result.body.eligibility.allowed, false);
    assert.equal(result.body.context_key, '', 'a fast response cannot claim it validated the live brief or memories');
    assert.equal(result.body.requires_refresh, true);
    assert.equal(h.calls.projectReads + h.calls.contextReads + h.calls.accountReads, 0);
    assert.equal(h.calls.rpc.filter(call => call.name === 'mutate_sourcing_agent').length, 1);
  }
});
