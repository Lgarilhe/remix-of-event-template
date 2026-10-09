import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the real context/cache/filter functions; HTTP is blocked unless a test supplies a model response.
const root = new URL('../../', import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
const compiledSources = new Map();
function compile(path, { prelude = '', suffix = '', globals = {}, transform = source => source } = {}) {
  const source = transform(readFileSync(new URL(path, root), 'utf8'))
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/await import\((["'])(\.\.\/_shared\/[^"']+)\1\)/g,
      (_match, _quote, path) => '__dynamic[' + JSON.stringify(path) + ']');
  const cacheKey = JSON.stringify([path, prelude, source, suffix]);
  let outputText = compiledSources.get(cacheKey);
  if (!outputText) {
    const compiled = ts.transpileModule(prelude + source + suffix, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: path, reportDiagnostics: true,
    });
    assert.equal(compiled.diagnostics?.length ?? 0, 0);
    outputText = compiled.outputText;
    compiledSources.set(cacheKey, outputText);
  }
  const context = { exports: {}, crypto: webcrypto, TextEncoder, Request, Response, AbortController,
    setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} },
    fetch() { throw new Error('Unexpected HTTP call'); },
    Deno: { env: { get: () => undefined }, serve() {} }, ...globals };
  vm.runInNewContext(outputText, context, { filename: path });
  return context.exports;
}

const client = compile('src/lib/sourcingScoringContext.ts');
const experience = compile('supabase/functions/_shared/profile-experience.ts');
const sourcing = compile('supabase/functions/_shared/sourcing-memory.ts');
const context = compile('supabase/functions/_shared/scoring-context.ts', {
  prelude: 'const { parseSourcingMemoryConflicts } = __sourcing;\n', globals: { __sourcing: sourcing },
});
const organizationId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const metadataOptions = { organizationId, projectId, requestModel: 'claude-sonnet-4-6' };
const memoryA = { id: '33333333-3333-4333-8333-333333333333', version: 2,
  content: 'Privilégier les expériences SaaS B2B récentes.', scope: 'project', project_id: projectId,
  kind: 'preference', effects: ['scoring'], status: 'active' };
const memoryContext = await sourcing.createSourcingMemoryContext([memoryA], 'scoring');
const emptyMemoryContext = await sourcing.createSourcingMemoryContext([], 'scoring');
const updatedMemoryContext = await sourcing.createSourcingMemoryContext([{ ...memoryA, version: 3,
  content: 'Exiger une expérience SaaS B2B récente.' }], 'scoring');
const job = { id: 'project:' + projectId, title: 'Account Manager', skills: ['SaaS'],
  description: 'Grands comptes B2B', originalBriefText: '8 à 12 ans, grands comptes, pas d’ESN.',
  seniority: 'senior', xpMin: 8, xpMax: 12, location: 'Paris', remote: 'hybrid', tjm: 700,
  evaluationCriteria: [{ label: 'Grands comptes', importance: 'must' }],
  transversalCriteria: { must: 'SaaS B2B', should: 'Français', niceToHave: '', context: 'Équipe commerciale' } };

test('frontend and server compare the same context regardless of object property order', () => {
  const first = { model: 'model-a', job: { title: 'Engineer', skills: ['Go', 'SQL'], xpMin: 8 }, instructions: 'Réserves explicites' };
  const reordered = { instructions: 'Réserves explicites', job: { xpMin: 8, skills: ['Go', 'SQL'], title: 'Engineer' }, model: 'model-a' };
  assert.equal(client.stableScoringContextKey(first), context.stableScoringContextKey(reordered));
  assert.equal(client.stableScoringContextKey(first), client.stableScoringContextKey(reordered));
});

test('single and batch payloads preserve the complete brief and structured criteria', () => {
  const payload = client.buildScoringJobPayload(job);
  assert.equal(payload.originalBriefText, job.originalBriefText);
  assert.deepEqual(plain(payload.evaluationCriteria), job.evaluationCriteria);
  assert.deepEqual(plain(payload.transversalCriteria), job.transversalCriteria);
  assert.equal(payload.description, job.description);
  assert.equal(payload.tjmMin, 700);
  assert.equal(payload.xpMin, 8);
  assert.equal(payload.xpMax, 12);
  assert.deepEqual(plain(client.buildScoringJobPayload({ ...job, skills: undefined }).skills), []);
});

test('private and assistant-only memories never enter a shared scoring version', () => {
  const initial = client.getScoringMemoryVersionKey([memoryA]);
  const unrelated = [
    { ...memoryA, id: 'private', scope: 'user', content: 'Je préfère les profils du secteur santé.' },
    { ...memoryA, id: 'assistant', effects: ['assistant', 'presentation'], content: 'Répondre de façon concise.' },
    { ...memoryA, id: 'search', effects: ['search'] },
  ];
  assert.equal(client.getScoringMemoryVersionKey([memoryA, ...unrelated]), initial);
  assert.equal(client.getSourcingMemoryVersionKey([memoryA], 'search'), client.getSourcingMemoryVersionKey([], 'search'));
});

test('a shared memory mutation invalidates the score while response formatting changes do not', () => {
  const initial = client.getScoringMemoryVersionKey([memoryA]);
  for (const patch of [ { version: 3 }, { content: 'Exiger une expérience SaaS B2B récente.' },
    { kind: 'constraint' }, { scope: 'organization', project_id: null }, { effects: ['search'] } ]) {
    assert.notEqual(client.getScoringMemoryVersionKey([{ ...memoryA, ...patch }]), initial);
  }
  const second = { ...memoryA, id: 'second', version: 1 };
  assert.equal(client.getScoringMemoryVersionKey([memoryA, second]), client.getScoringMemoryVersionKey([second, memoryA]));
  assert.equal(client.getScoringMemoryVersionKey([{ ...memoryA, effects: ['scoring', 'search'] }]),
    client.getScoringMemoryVersionKey([{ ...memoryA, effects: ['search', 'scoring', 'scoring'] }]));
});

test('notes from an older brief or memory stay hidden until evaluated again', async () => {
  const metadata = await context.createScoringContextMetadata(job, 'Réserves', 'claude-sonnet-4-6', memoryContext, metadataOptions);
  const previousBriefMetadata = await context.createScoringContextMetadata({ ...job, xpMin: 5 }, 'Réserves', 'claude-sonnet-4-6', memoryContext, metadataOptions);
  const previousMemoryMetadata = await context.createScoringContextMetadata(job, 'Réserves', 'claude-sonnet-4-6', updatedMemoryContext, metadataOptions);
  const current = { profile_name: 'Alice', clientContextKey: metadata.inputVersionKey, scoringContext: plain(metadata) };
  const scores = { current, previousBrief: { ...current, clientContextKey: previousBriefMetadata.inputVersionKey, scoringContext: plain(previousBriefMetadata) },
    previousMemory: { ...current, scoringContext: plain(previousMemoryMetadata) },
    legacy: { profile_name: 'Legacy' } };
  assert.deepEqual(Object.keys(client.getCurrentJobScores(scores, metadata.inputVersionKey, memoryContext.versionKey)), ['current']);
  assert.deepEqual(plain(client.getCurrentJobScores(scores, null, memoryContext.versionKey)), {});
  assert.deepEqual(plain(client.getCurrentJobScores(scores, previousBriefMetadata.inputVersionKey, updatedMemoryContext.versionKey)), {});
});

function currentInputVersionKey({ selectedJob = job, instructions = 'Réserves', requestModel = metadataOptions.requestModel,
  orgId = organizationId, missionId = projectId, memory = memoryContext } = {}) {
  return client.buildScoringInputVersionKey(selectedJob, instructions, { organizationId: orgId,
    projectId: missionId, requestModel, memoryVersionKey: memory.versionKey });
}

test('a fresh server-only note stays visible after reload when its exact input and memory still match', async () => {
  const metadata = await context.createScoringContextMetadata(job, 'Réserves', 'claude-sonnet-4-6', memoryContext, metadataOptions);
  const currentKey = currentInputVersionKey();
  assert.equal(metadata.inputVersionKey, currentKey);
  const reloaded = { profile_name: 'Camille', match_score: 84, scoringContext: plain(metadata) };
  assert.equal(reloaded.clientContextKey, undefined);
  assert.deepEqual(Object.keys(client.getCurrentJobScores({ reloaded }, currentKey, memoryContext.versionKey)), ['reloaded']);
  const payloadMetadata = await context.createScoringContextMetadata(client.buildScoringJobPayload(job),
    'Réserves', 'claude-sonnet-4-6', memoryContext, metadataOptions);
  assert.equal(payloadMetadata.inputVersionKey, currentKey, 'raw job and frontend payload must use the same normalization');
});

test('reloaded server notes hide after any brief, instruction, request model, organization, mission or memory mutation', async () => {
  const metadata = await context.createScoringContextMetadata(job, 'Réserves', 'claude-sonnet-4-6', memoryContext, metadataOptions);
  const reloaded = { profile_name: 'Camille', match_score: 84, scoringContext: plain(metadata) };
  const initial = currentInputVersionKey();
  for (const mutation of [
    { selectedJob: { ...job, originalBriefText: '5 ans, ESN acceptées.' } },
    { selectedJob: { ...job, xpMin: 5 } },
    { selectedJob: { ...job, evaluationCriteria: [{ label: 'PME', importance: 'should' }] } },
    { instructions: 'Prioriser le secteur public' },
    { requestModel: 'claude-opus-4-6' },
    { orgId: '44444444-4444-4444-8444-444444444444' },
    { missionId: '55555555-5555-4555-8555-555555555555' },
    { memory: updatedMemoryContext },
  ]) {
    const key = currentInputVersionKey(mutation);
    assert.notEqual(key, initial);
    assert.deepEqual(plain(client.getCurrentJobScores({ reloaded }, key, mutation.memory?.versionKey ?? memoryContext.versionKey)), {});
  }
  assert.deepEqual(plain(client.getCurrentJobScores({ reloaded }, initial, 'new-memory-version')), {});
  assert.deepEqual(plain(client.getCurrentJobScores({ incomplete: { ...reloaded, scoringContext: { memory: plain(metadata.memory) } } },
    initial, memoryContext.versionKey)), {});
});

test('a server input key preserves the requested model when the executed scoring model is mapped', async () => {
  const options = { ...metadataOptions, requestModel: 'gemini-request-model' };
  const metadata = await context.createScoringContextMetadata(job, 'Réserves', 'claude-sonnet-4-6', memoryContext, options);
  assert.equal(metadata.inputVersionKey, currentInputVersionKey({ requestModel: 'gemini-request-model' }));
  assert.notEqual(metadata.inputVersionKey, currentInputVersionKey());
});

test('client, worker and restored jobs share one key despite storage aliases and optional UI fields', () => {
  const options = { ...metadataOptions, memoryVersionKey: memoryContext.versionKey };
  const uiJob = { ...job, id: 'project:' + projectId, requirements: '', client: {
    id: 'client-ui-id', name: 'Client A', sector: 'SaaS', size: 'scale-up', website: 'https://client-a.test', linkedin: 'client-ui-url',
  }, clientCompetitors: [{ name: 'Concurrent A', relationKind: 'direct', country: 'France', domain: 'concurrent-a.test', linkedinCompanyId: 'company-ui-id' }] };
  const workerJob = { ...job, id: projectId, tjm: undefined, tjmMin: 700, client: {
    name: 'Client A', sector: 'SaaS', size: 'scale-up', website: 'https://another-ui-value.test',
  }, clientCompetitors: [{ name: 'Concurrent A', relationKind: 'direct' }] };
  const clientKey = client.buildScoringInputVersionKey(uiJob, undefined, options);
  assert.equal(clientKey, context.buildScoringInputVersionKey(workerJob, '', options));
  assert.equal(clientKey, client.buildScoringInputVersionKey(workerJob, null, options));
  assert.notEqual(clientKey, client.buildScoringInputVersionKey({ ...workerJob, client: { ...workerJob.client, sector: 'Industrie' } }, '', options));
  assert.notEqual(clientKey, client.buildScoringInputVersionKey({ ...workerJob, clientCompetitors: [{ name: 'Concurrent B', relationKind: 'direct' }] }, '', options));
  assert.notEqual(clientKey, client.buildScoringInputVersionKey({ ...workerJob, clientCompetitors: [{ name: 'Concurrent A', relationKind: 'indirect' }] }, '', options));
  assert.notEqual(clientKey, client.buildScoringInputVersionKey({ ...workerJob, originalBriefText: 'ESN acceptées' }, '', options));
  assert.equal(client.buildScoringInputVersionKey({ ...workerJob, description: '' }, '', options),
    context.buildScoringInputVersionKey({ ...workerJob, description: undefined }, '', options));
  const noMission = { ...options, organizationId: undefined, projectId: undefined };
  assert.equal(client.buildScoringInputVersionKey(job, undefined, noMission),
    context.buildScoringInputVersionKey(job, undefined, { ...noMission, organizationId: null, projectId: null }));
});

test('a browser key alone or incomplete shared provenance cannot make a restored score current', async () => {
  const metadata = plain(await context.createScoringContextMetadata(job, 'Réserves', 'claude-sonnet-4-6', memoryContext, metadataOptions));
  const key = metadata.inputVersionKey;
  const note = { profile_name: 'Camille', match_score: 84, clientContextKey: key, scoringContext: metadata };
  const invalidMetadata = [
    undefined,
    { memory: metadata.memory },
    { ...metadata, inputVersionKey: undefined },
    { ...metadata, inputVersionKey: 'older-brief' },
    { ...metadata, fingerprint: 'invalid' },
    { ...metadata, memory: { ...metadata.memory, fingerprint: 'invalid' } },
    { ...metadata, memory: { ...metadata.memory, versionKey: updatedMemoryContext.versionKey } },
    { ...metadata, memory: { ...metadata.memory, provenance: undefined } },
    { ...metadata, memory: { ...metadata.memory, provenance: [] } },
    { ...metadata, memory: { ...metadata.memory, provenance: [...metadata.memory.provenance, ...metadata.memory.provenance] } },
    ...[
      { version: 0 }, { version: 1.5 }, { content: 'Oui' }, { scope: 'user' },
      { effects: ['assistant'] }, { project_id: null }, { kind: 'invented' },
    ].map(patch => ({ ...metadata, memory: { ...metadata.memory,
      provenance: [{ ...metadata.memory.provenance[0], ...patch }] } })),
  ];
  for (const scoringContext of invalidMetadata) {
    assert.equal(client.isCurrentScoringContext(scoringContext, key, memoryContext.versionKey), false);
    assert.deepEqual(plain(client.getCurrentJobScores({ invalid: { ...note, scoringContext } }, key, memoryContext.versionKey)), {});
  }
  assert.equal(client.isCurrentScoringContext(metadata, key, memoryContext.versionKey), true);
  assert.deepEqual(plain(client.getCurrentJobScores({ invalid: null }, key, memoryContext.versionKey)), {});
});

test('stale AI notes cannot reappear through saved statuses while recruiter decisions survive', () => {
  const statuses = new Map([
    ['fresh', { status: 'scored', score: 45, recommendation: 'skip', scoring_details: { summary: 'Ancienne note' } }],
    ['stale', { status: 'scored', score: 92, recommendation: 'go', scoring_details: { summary: 'Ancien contexte' } }],
    ['contacted', { status: 'contacted', score: 80, recommendation: 'go', pipeline_stage: 'contacted' }],
    ['dismissed', { status: 'dismissed', score: 20, recommendation: 'skip', pipeline_stage: 'rejected', skip_reason: 'Disponibilité confirmée incompatible' }],
    ['interviewing', { status: 'interviewing', score: 80, recommendation: 'go', pipeline_stage: 'interviewing' }],
  ]);
  const current = { match_score: 84, recommendation: 'go', scoring_details: { skipReason: null }, summary: 'Contexte actuel' };
  const projected = client.getCurrentScoreStatuses(statuses, { fresh: current });
  assert.equal(projected.get('fresh').score, 84);
  assert.equal(projected.get('fresh').scoring_details, current);
  assert.equal(projected.get('stale').status, 'discovered');
  for (const id of ['stale', 'contacted', 'dismissed', 'interviewing']) {
    assert.equal(projected.get(id).score, null);
    assert.equal(projected.get(id).recommendation, null);
    assert.equal(projected.get(id).scoring_details, null);
    if (id !== 'stale') assert.equal(projected.get(id).status, statuses.get(id).status);
  }
  assert.equal(projected.get('dismissed').pipeline_stage, 'rejected');
  assert.equal(projected.get('dismissed').skip_reason, 'Disponibilité confirmée incompatible');
  assert.equal(statuses.get('stale').score, 92, 'display projection must not mutate saved recruiting data');
});

test('frontend and backend use the same effect-specific memory version', async () => {
  const memories = [memoryA, { ...memoryA, id: 'org-memory', scope: 'organization', project_id: null,
    kind: 'constraint', effects: ['search', 'scoring'] }, { ...memoryA, id: 'private', scope: 'user' }];
  for (const effect of ['search', 'scoring']) {
    const server = await sourcing.createSourcingMemoryContext(memories, effect);
    assert.equal(server.versionKey, client.getSourcingMemoryVersionKey(memories, effect));
    assert.equal(server.provenance.some(memory => memory.id === 'private'), false);
  }
});

test('server metadata carries the exact shared decision provenance and a stable fingerprint', async () => {
  const metadata = await context.createScoringContextMetadata(job, 'Consigner les réserves', 'claude-sonnet-4-6', memoryContext, metadataOptions);
  assert.match(metadata.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(plain(metadata.memory), { fingerprint: memoryContext.fingerprint,
    versionKey: memoryContext.versionKey, provenance: plain(memoryContext.provenance) });
  const reorderedJob = Object.fromEntries(Object.entries(job).reverse());
  const repeat = await context.createScoringContextMetadata(reorderedJob, 'Consigner les réserves', 'claude-sonnet-4-6', memoryContext, metadataOptions);
  assert.equal(repeat.fingerprint, metadata.fingerprint);
});

test('any brief, scoring instruction, model or confirmed decision change invalidates the server fingerprint', async () => {
  const fingerprint = (j = job, instructions = 'Réserves', model = 'model-a', m = memoryContext) =>
    context.createScoringContextMetadata(j, instructions, model, m, metadataOptions).then(value => value.fingerprint);
  const initial = await fingerprint();
  for (const updated of [
    fingerprint({ ...job, originalBriefText: '5 ans, ETI, ESN acceptées.' }),
    fingerprint({ ...job, xpMin: 5 }),
    fingerprint({ ...job, evaluationCriteria: [{ label: 'PME', importance: 'should' }] }),
    fingerprint(job, 'Valoriser les changements de secteur'),
    fingerprint(job, 'Réserves', 'model-b'),
    fingerprint(job, 'Réserves', 'model-a', updatedMemoryContext),
  ]) assert.notEqual(await updated, initial);
});

test('confirmed scoring memories require an explicit conflict review even when none are found', () => {
  for (const missing of [undefined, null, '[]', {}, false]) {
    assert.equal(context.parseScoringMemoryConflicts(missing, memoryContext).valid, false);
  }
  assert.deepEqual(plain(context.parseScoringMemoryConflicts([], memoryContext)), { valid: true, conflicts: [] });
  assert.deepEqual(plain(context.parseScoringMemoryConflicts(undefined, { ...memoryContext, memories: [] })),
    { valid: true, conflicts: [] });
});

test('conflict review rejects fabricated identities, malformed entries and unbounded reasons', () => {
  for (const raw of [
    [null], [[]], [{ memory_ids: [], reason: 'Conflit avec le brief' }],
    [{ memory_ids: ['unknown-memory'], reason: 'Conflit avec le brief' }],
    [{ memory_ids: [memoryA.id, 2], reason: 'Conflit avec le brief' }],
    [{ memory_ids: [memoryA.id], reason: '   ' }],
    [{ memory_ids: [memoryA.id], reason: 'x'.repeat(501) }],
  ]) assert.equal(context.parseScoringMemoryConflicts(raw, memoryContext).valid, false);
});

test('a real conflict preserves known identities and an actionable reason', () => {
  const parsed = context.parseScoringMemoryConflicts([
    { memory_ids: [memoryA.id, memoryA.id], reason: '  La mémoire privilégie SaaS et le brief impose le secteur public.  ' },
  ], memoryContext);
  assert.deepEqual(plain(parsed), { valid: true, conflicts: [{ memory_ids: [memoryA.id],
    reason: 'La mémoire privilégie SaaS et le brief impose le secteur public.' }] });
});

function scoringHelpers(globals = {}) {
  return compile('supabase/functions/score-profile-job/index.ts', {
    prelude: 'const { createScoringContextMetadata, parseScoringMemoryConflicts } = __context;\n',
    suffix: '\nexports.__helpers = { applyHardFilters, computeWeightedScore, getCachedScore, buildJobContext, buildProfileSection, callLLM, callLLMBatch };\n',
    globals: { __context: context, ...experience, ...globals },
  }).__helpers;
}

test('a missing must-have mention is uncertain evidence and never a keyword-only hard rejection', async () => {
  const helpers = scoringHelpers();
  const result = await helpers.applyHardFilters({ id: 'candidate-a', name: 'Camille', headline: 'Account Manager',
    summary: 'Accompagnement des grands comptes', skills: [] }, { ...job, mustHave: 'SaaS B2B', xpMin: undefined, remote: undefined });
  assert.equal(result.passed, true);
});

test('full_remote bypasses geographical hard rejection and marks the location compatible', async () => {
  const helpers = scoringHelpers();
  const profile = { id: 'candidate-a', name: 'Camille', location: 'United States', headline: 'Account Manager', yearsOfExperience: 10 };
  const remoteJob = { ...job, remote: 'full_remote', skills: [] };
  assert.equal((await helpers.applyHardFilters(profile, remoteJob)).passed, true);
  assert.equal(helpers.computeWeightedScore(profile, remoteJob).locationMatchKind, 'remote_ok');
  assert.equal(helpers.computeWeightedScore(profile, remoteJob).dimensions.location.score, 100);
});

test('explicit insufficient experience remains a genuine hard rejection', async () => {
  const helpers = scoringHelpers();
  const result = await helpers.applyHardFilters({ id: 'candidate-a', name: 'Camille', yearsOfExperience: 2 }, job);
  assert.equal(result.passed, false);
  assert.match(result.reason, /XP insuffisante/);
});

test('null or invalid experience stays unknown in filtering, dimensions, verdict and model input', async () => {
  const helpers = scoringHelpers();
  const preComputed = { weightedScore: 55, dimensions: {}, matchedSkills: [], missingSkills: [], semanticScore: null };
  for (const yearsOfExperience of [null, undefined, NaN, Infinity, -1]) {
    const profile = { id: 'candidate-a', name: 'Camille', headline: 'Account Manager', yearsOfExperience };
    assert.equal((await helpers.applyHardFilters(profile, job)).passed, true);
    const weighted = helpers.computeWeightedScore(profile, job);
    assert.equal(weighted.dimensions.seniority.score, 50);
    assert.equal(weighted.experienceMatchKind, 'incertain');
    assert.ok(weighted.missingDataPoints.includes('candidate_xp'));
    const prompt = helpers.buildProfileSection(profile, preComputed, 0);
    assert.match(prompt, /XP: à vérifier/);
    assert.doesNotMatch(prompt, /XP: 0 ans/);
  }
  assert.equal((await helpers.applyHardFilters({ id: 'candidate-a', name: 'Camille', yearsOfExperience: 0 }, job)).passed, false);
});

test('batch model responses only bind unique supplied identities; malformed entries stay missing for individual retry', async () => {
  const inputs = ['candidate-a', 'candidate-b', 'candidate-c'].map(id => ({
    profile: { id, name: id },
    preComputedData: { weightedScore: 50, dimensions: {}, matchedSkills: [], missingSkills: [], semanticScore: null },
  }));
  for (const [response, expected] of [
    [[{ id: 'candidate-b', overallScore: 92 }, { id: 'candidate-a', overallScore: 74 }], [['candidate-a', 74], ['candidate-b', 92]]],
    [[{ overallScore: 99 }, { id: 'foreign', overallScore: 98 }, { id: 'candidate-c', overallScore: 65 }], [['candidate-c', 65]]],
    [[null, { id: 'candidate-a', overallScore: 99 }, { id: 'candidate-a', overallScore: 42 }, { id: 'candidate-b', overallScore: 70 }], [['candidate-b', 70]]],
  ]) {
    let calls = 0;
    const helpers = scoringHelpers({
      Deno: { serve() {}, env: { get: key => key === 'ANTHROPIC_API_KEY' ? 'mock-api-key' : undefined } },
      fetch: async url => {
        calls++;
        assert.equal(url, 'https://api.anthropic.com/v1/messages');
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(response) }],
          usage: { input_tokens: 120, output_tokens: 30 } }), { status: 200 });
      },
    });
    const mapped = await helpers.callLLMBatch(inputs, job);
    assert.equal(calls, 1, 'only the mocked model is called');
    assert.deepEqual(plain([...mapped].map(([id, result]) => [id, result.overallScore])), expected);
    assert.ok(inputs.filter(input => !mapped.has(input.profile.id)).every(input =>
      ![...mapped.keys()].includes(input.profile.id)), 'missing or ambiguous identities cannot acquire another candidate’s note');
  }
});

function cacheClient(result, ageMs = 0) {
  const filters = {};
  const client = { from(table) {
    assert.equal(table, 'match_scores');
    const query = { select() { return query; }, eq(column, value) { filters[column] = value; return query; },
      maybeSingle: async () => ({ data: { created_at: new Date(Date.now() - ageMs).toISOString(), scoring_result: result }, error: null }) };
    return query;
  } };
  return { client, filters };
}

test('a server cache hit requires the same context and remains scoped to candidate, job and organization', async () => {
  const result = { finalScore: 84, hardFilterPassed: true, skippedLLM: false, scoringContext: { fingerprint: 'context-a' } };
  const h = cacheClient(result);
  const cached = await scoringHelpers().getCachedScore(h.client, 'candidate-a', job.id, organizationId, 'context-a');
  assert.equal(cached, result);
  assert.deepEqual(h.filters, { organization_id: organizationId, candidate_id: 'candidate-a', job_id: job.id });
});

test('legacy, stale-context, expired and degraded server notes all miss the cache', async () => {
  const helpers = scoringHelpers();
  const valid = { finalScore: 84, hardFilterPassed: true, skippedLLM: false, scoringContext: { fingerprint: 'context-a' } };
  for (const [result, ageMs] of [
    [{ ...valid, scoringContext: undefined }, 0],
    [{ ...valid, scoringContext: { fingerprint: 'context-b' } }, 0],
    [{ ...valid, skippedLLM: true }, 0],
    [valid, 49 * 60 * 60 * 1000],
  ]) {
    const h = cacheClient(result, ageMs);
    assert.equal(await helpers.getCachedScore(h.client, 'candidate-a', job.id, organizationId, 'context-a'), null);
  }
  const h = cacheClient(valid);
  assert.equal(await helpers.getCachedScore(h.client, 'candidate-a', job.id, null, 'context-a'), null);
  assert.deepEqual(h.filters, {});
});

function handlerHarness({ loadedMemory = memoryContext, memoryAfterModel = null, memoryError = null, authMethod = 'jwt',
  cache = null, modelResult = { overallScore: 84, summary: 'Expérience à vérifier', memory_conflicts: [] },
  creditAllowed = true, allowedOrganization = true, missingProject = false, projectOrganizationId = organizationId,
  modelId = 'claude-sonnet-4-6', autoRouted = false, creditRemaining = 100, leaseFailsAt = Infinity,
  leaseFailsAfterModel = false, pauseDuringContextAt = Infinity, liveContextFailsAt = Infinity } = {}) {
  let handler;
  let leaseCalls = 0;
  let liveContextCalls = 0;
  let pausedDuringContext = false;
  const events = [], requests = [], memoryRequests = [], creditCalls = [], modelCalls = [], writes = [], settlements = [];
  const authenticatedUser = authMethod === 'service_role' ? null : 'recruiter-a';
  const jwtHeader = authMethod === 'service_role' ? 'Bearer service-key' : 'Bearer recruiter-jwt';
  const dependencies = {
    createScoringContextMetadata: context.createScoringContextMetadata,
    parseScoringMemoryConflicts: context.parseScoringMemoryConflicts,
    assertContinuousOperationContext: async () => {
      events.push('live-context'); liveContextCalls++;
      if (liveContextCalls >= pauseDuringContextAt) pausedDuringContext = true;
      if (liveContextCalls >= liveContextFailsAt) throw Object.assign(new Error('Brief changed'), { code: 'CONTEXT_CHANGED' });
    },
    requireAuth: async () => ({ userId: authenticatedUser, method: authMethod }),
    verifyOrgMembership: async (_client, userId, orgId) => {
      assert.equal(userId, authenticatedUser ?? 'worker-owner');
      assert.equal(orgId, organizationId);
      return allowedOrganization;
    },
    createSourcingMemoryContext: sourcing.createSourcingMemoryContext,
    loadSourcingMemoryContext: async (client, options) => {
      events.push('memory'); memoryRequests.push({ client, options });
      if (memoryError) throw memoryError;
      if (memoryRequests.length > 1 && memoryAfterModel) {
        if (memoryAfterModel instanceof Error) throw memoryAfterModel;
        return memoryAfterModel;
      }
      return loadedMemory;
    },
    assertCredits: async params => {
      events.push('credits'); creditCalls.push(params);
      return { ok: creditAllowed, organizationId, remaining: creditRemaining, estimated: 1, body: { message: 'Crédits insuffisants' } };
    },
    creditGateResponse: (_gate, headers) => new Response(JSON.stringify({ error: 'Crédits insuffisants' }), { status: 402, headers }),
    recordUsageSignal: async () => { throw new Error('No LinkedIn usage in scoring tests'); },
    parseUsagePct: () => 0,
    createClient(_url, key, options) {
      const client = { key, options,
        rpc(name, params) {
          events.push(name);
          if (name === 'check_rate_limit') return Promise.resolve({ data: true, error: null });
          if (name === 'sourcing_agent_assert_lease') {
            leaseCalls++;
            assert.equal(params.p_agent_id, 'agent-test');
            assert.equal(params.p_lease_token, 'lease-test');
            return Promise.resolve(leaseCalls >= leaseFailsAt || pausedDuringContext || (leaseFailsAfterModel && modelCalls.length > 0)
              ? { data: null, error: { code: '40001' } }
              : { data: { organization_id: organizationId, created_by: 'worker-owner', project_id: projectId,
                context_snapshot: { context_key: 'context-test' } }, error: null });
          }
          assert.equal(name, 'cosine_similarity_match');
          return Promise.resolve({ data: null, error: null });
        },
        from(table) {
          events.push('read:' + table);
          const request = { table, key, options, filters: {} };
          requests.push(request);
          const query = {
            select() { return query; }, eq(column, value) { request.filters[column] = value; return query; },
            limit() { return query; }, in() { return query; }, not() { return query; },
            update(value) { events.push('write:' + table); writes.push({ table, value }); return query; },
            upsert(value) { events.push('write:' + table); writes.push({ table, value }); return query; },
            maybeSingle() {
              if (table === 'sourcing_projects') return Promise.resolve({ data: missingProject ? null : { organization_id: projectOrganizationId }, error: null });
              assert.equal(table, 'match_scores');
              const cached = typeof cache === 'function' ? cache(request.filters.candidate_id) : cache;
              return Promise.resolve({ data: cached ? { scoring_result: cached, created_at: new Date().toISOString() } : null, error: null });
            },
            then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); },
          };
          return query;
        },
      };
      return client;
    },
  };
  const { __helpers: helpers } = compile('supabase/functions/score-profile-job/index.ts', {
    prelude: 'const { ' + Object.keys(dependencies).join(', ') + ' } = __dependencies;\n',
    suffix: '\nexports.__helpers = { callLLM, callLLMBatch };\n',
    globals: { __dependencies: dependencies, ...experience,
      __dynamic: {
        '../_shared/settle-credits.ts': {
          extractAIParams: () => ({ aiAction: 'scoring', modelId, description: null, wasAutoRouted: autoRouted }),
          settleCredits: async (_client, usage) => { events.push('settle'); settlements.push(usage); return { success: true }; },
        },
        '../_shared/ai-config.ts': { getAnthropicModelId: model => model, MODEL_CATALOG: {} },
        '../_shared/resolve-org-credentials.ts': { resolveOrgIdFromUser: async () => organizationId,
          resolveUnipileCredentials: async () => null },
      },
      Deno: { env: { get: name => ({ SUPABASE_URL: 'http://local.test', SUPABASE_ANON_KEY: 'anon-key',
        SB_SECRET_KEY: 'service-key', ANTHROPIC_API_KEY: 'test-model-key' })[name] },
        serve(fn) { handler = fn; } },
      fetch(input, init) {
        assert.equal(input, 'https://api.anthropic.com/v1/messages');
        events.push('model');
        const request = JSON.parse(init.body); modelCalls.push(request);
        const batch = request.messages[0].content[1].text.includes('mode BATCH');
        const output = { id: 'candidate-a', ...(typeof modelResult === 'function' ? modelResult(request, modelCalls.length) : modelResult) };
        return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(batch ? [output] : output) }],
          usage: { input_tokens: 100, output_tokens: 25 }, stop_reason: 'end_turn' }), { status: 200 }));
      },
    },
  });
  const invoke = (overrides = {}) => handler(new Request('http://local.test/score-profile-job', {
    method: 'POST', headers: { authorization: jwtHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: { id: 'candidate-a', name: 'Camille', headline: 'Account Manager' },
      job, organization_id: organizationId, project_id: projectId,
      ...(authMethod === 'service_role' ? { user_id: 'worker-owner' } : { user_id: 'forged-other-user' }), ...overrides }),
  }));
  return { invoke, helpers, events, requests, memoryRequests, creditCalls, modelCalls, writes, settlements };
}

test('JWT identity and project load confirmed memories before a cache or paid operation', async () => {
  const h = handlerHarness({ creditAllowed: false });
  assert.equal((await h.invoke()).status, 402);
  const load = h.memoryRequests[0];
  assert.equal(load.client.key, 'anon-key');
  assert.equal(load.client.options.global.headers.Authorization, 'Bearer recruiter-jwt');
  assert.deepEqual(plain(load.options), { userId: 'recruiter-a', organizationId, projectId, effect: 'scoring', serviceRole: false });
  assert.ok(h.events.indexOf('memory') < h.events.indexOf('read:match_scores'));
  assert.ok(h.events.indexOf('memory') < h.events.indexOf('credits'));
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('a background worker loads memory as its trusted actor through the service client', async () => {
  const h = handlerHarness({ creditAllowed: false, authMethod: 'service_role' });
  assert.equal((await h.invoke()).status, 402);
  assert.equal(h.memoryRequests[0].client.key, 'service-key');
  assert.deepEqual(plain(h.memoryRequests[0].options), { userId: 'worker-owner', organizationId, projectId,
    effect: 'scoring', serviceRole: true });
  assert.equal(h.writes.length, 0);
});

test('unavailable memory prevents cached results, credits, paid model calls and persistence', async () => {
  const h = handlerHarness({ memoryError: new Error('RPC unavailable'), cache: { finalScore: 90 } });
  const response = await h.invoke();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error_code, 'MEMORY_CONTEXT_UNAVAILABLE');
  assert.equal(h.requests.filter(request => request.table === 'match_scores').length, 0);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('a memory permission refusal returns 403 before a cache, paid operation or write', async () => {
  const h = handlerHarness({ memoryError: { code: '42501', message: 'Forbidden context' } });
  const response = await h.invoke();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error_code, 'MEMORY_CONTEXT_UNAVAILABLE');
  assert.equal(h.requests.filter(request => request.table === 'match_scores').length, 0);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('a removed explicit project is refused while a legacy external UUID keeps only organization memory', async () => {
  const explicit = handlerHarness({ missingProject: true });
  assert.equal((await explicit.invoke()).status, 404);
  assert.equal(explicit.memoryRequests.length, 0);
  assert.equal(explicit.modelCalls.length, 0);
  assert.equal(explicit.writes.length, 0);
  const legacy = handlerHarness({ missingProject: true, creditAllowed: false,
    loadedMemory: emptyMemoryContext });
  assert.equal((await legacy.invoke({ job: { ...job, id: projectId }, project_id: null })).status, 402);
  assert.equal(legacy.memoryRequests[0].options.projectId, null);
  assert.equal(legacy.memoryRequests[0].options.organizationId, organizationId);
  assert.equal(legacy.modelCalls.length, 0);
  assert.equal(legacy.writes.length, 0);
});

test('a foreign mission with no team access cannot read memories or score candidates', async () => {
  const h = handlerHarness({ projectOrganizationId: 'foreign-organization' });
  assert.equal((await h.invoke()).status, 403);
  assert.equal(h.memoryRequests.length, 0);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('an organization refusal cannot read scoring memory or pay for scoring', async () => {
  const h = handlerHarness({ allowedOrganization: false });
  assert.equal((await h.invoke()).status, 403);
  assert.equal(h.memoryRequests.length, 0);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('a mission mismatch and changed memory version are refused before cache, credits or models', async () => {
  const h = handlerHarness();
  assert.equal((await h.invoke({ project_id: '44444444-4444-4444-8444-444444444444' })).status, 400);
  assert.equal(h.memoryRequests.length, 0);
  const response = await h.invoke({ expected_memory_version_key: 'old-memory-version' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error_code, 'MEMORY_CONTEXT_CHANGED');
  assert.equal(h.requests.filter(request => request.table === 'match_scores').length, 0);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

for (const [label, review, status, code] of [
  ['missing conflict review', undefined, 502, 'MEMORY_REVIEW_INCOMPLETE'],
  ['fabricated conflict identity', [{ memory_ids: ['fabricated'], reason: 'Conflit avec le brief' }], 502, 'MEMORY_REVIEW_INCOMPLETE'],
  ['confirmed conflicting decision', [{ memory_ids: [memoryA.id], reason: 'Le secteur demandé contredit la mémoire.' }], 409, 'MEMORY_CONFLICT'],
]) {
  test(label + ' blocks all notes while accounting for the model tokens already used', async () => {
    const modelResult = { overallScore: 84, summary: 'Expérience SaaS pertinente' };
    if (review !== undefined) modelResult.memory_conflicts = review;
    const h = handlerHarness({ modelResult });
    const response = await h.invoke();
    const result = await response.json();
    assert.equal(response.status, status);
    assert.equal(result.success, false);
    assert.equal(result.error_code, code);
    assert.equal(h.modelCalls.length, 1);
    assert.equal(h.writes.length, 0);
    assert.equal(h.settlements.length, 1);
    assert.equal(h.settlements[0].tokensInput, 100);
    assert.equal(h.settlements[0].tokensOutput, 25);
  });
}

test('a successful single evaluation includes the reviewed shared memory and persists its context', async () => {
  const h = handlerHarness({ modelResult: { overallScore: 84, summary: 'Expérience SaaS pertinente', memory_conflicts: [],
    confidenceScore: 76, criteriaEvaluations: [{ label: 'SaaS B2B', verdict: 'unknown', reason: 'Expérience à confirmer en entretien' }],
    pedigreeAssessment: { presetName: 'Équipe commerciale', strictMode: false, verdict: 'partial',
      matched: ['SaaS'], missed: ['Grands comptes'], capped: false, detail: 'À confirmer en entretien' },
  } });
  const response = await h.invoke({ expected_memory_version_key: memoryContext.versionKey });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.deepEqual(data.result.scoringContext.memory.provenance, plain(memoryContext.provenance));
  assert.equal(data.result.scoringContext.memory.versionKey, memoryContext.versionKey);
  const persisted = h.writes.find(write => write.table === 'match_scores');
  assert.ok(persisted);
  assert.equal(persisted.value.scoring_result.scoringContext.fingerprint, data.result.scoringContext.fingerprint);
  const pipelineNote = h.writes.find(write => write.table === 'job_candidate_status').value.scoring_details;
  const inputKey = client.buildScoringInputVersionKey(job, undefined, { ...metadataOptions, memoryVersionKey: memoryContext.versionKey });
  assert.equal(pipelineNote.match_score, data.result.finalScore);
  assert.equal(pipelineNote.clientContextKey, undefined);
  assert.ok(['go', 'maybe', 'skip'].includes(pipelineNote.recommendation));
  assert.deepEqual(plain(pipelineNote.dimensions), data.result.dimensions);
  assert.equal(pipelineNote.confidenceScore, data.result.confidenceScore);
  assert.equal(pipelineNote.llmConfidenceScore, 76);
  assert.deepEqual(plain(pipelineNote.criteriaEvaluations), data.result.criteriaEvaluations);
  assert.equal(pipelineNote.criteriaEvaluations[0].verdict, 'unknown');
  assert.deepEqual(plain(pipelineNote.pedigreeAssessment), data.result.pedigreeAssessment);
  assert.equal(pipelineNote.pedigreeAssessment.verdict, 'partial');
  assert.deepEqual(plain(pipelineNote.scoring_details.strengths), data.result.strengths);
  assert.deepEqual(plain(pipelineNote.scoring_details.concerns), data.result.concerns);
  assert.deepEqual(Object.keys(client.getCurrentJobScores({ restored: pipelineNote }, inputKey, memoryContext.versionKey)), ['restored']);
  assert.equal(h.settlements.length, 1);
  assert.equal(h.memoryRequests.length, 2);
  assert.ok(h.events.lastIndexOf('memory') > h.events.indexOf('model'));
  assert.ok(h.events.lastIndexOf('memory') < h.events.indexOf('write:match_scores'));
  assert.match(h.modelCalls[0].messages[0].content[0].text, /memory_conflicts/);
  assert.match(h.modelCalls[0].messages[0].content[0].text, /MÉMOIRES VALIDÉES/);
});

for (const [label, memoryAfterModel] of [
  ['archived decision', emptyMemoryContext],
  ['memory lookup failure', new Error('Memory RPC unavailable after the model')],
]) {
  test(label + ' during a paid evaluation discards its notes and accounts for consumed tokens', async () => {
    const h = handlerHarness({ memoryAfterModel });
    const response = await h.invoke();
    const data = await response.json();
    assert.equal(response.status, 409);
    assert.equal(data.success, false);
    assert.equal(data.error_code, 'MEMORY_CONTEXT_CHANGED');
    assert.equal(h.memoryRequests.length, 2);
    assert.equal(h.modelCalls.length, 1);
    assert.equal(h.writes.length, 0);
    assert.equal(h.settlements.length, 1);
    assert.equal(h.settlements[0].tokensInput, 100);
    assert.equal(h.settlements[0].tokensOutput, 25);
  });
}

test('SINGLE fallback JSON requires the same explicit memory review as a batch response', async () => {
  const preComputed = { weightedScore: 55, dimensions: {}, matchedSkills: [], missingSkills: [], semanticScore: null };
  for (const [review, valid] of [[undefined, false], [[], true], [[{ memory_ids: ['fabricated'], reason: 'Conflit avec le brief' }], false]]) {
    const modelResult = { overallScore: 84, summary: 'Expérience pertinente' };
    if (review !== undefined) modelResult.memory_conflicts = review;
    const h = handlerHarness({ modelResult });
    const result = await h.helpers.callLLM({ id: 'candidate-a', name: 'Camille' }, job,
      preComputed, undefined, 'claude-sonnet-4-6', memoryContext);
    assert.equal(result.memoryReview.valid, valid);
    assert.match(h.modelCalls[0].messages[0].content[0].text, /memory_conflicts/);
    assert.match(h.modelCalls[0].messages[0].content[1].text, /mode SINGLE/);
    assert.equal(h.writes.length, 0);
  }
});

test('an escalated evaluation cannot omit memory review and both model passes are accounted for', async () => {
  const h = handlerHarness({ modelId: 'claude-haiku-4-5-20251001', autoRouted: true,
    modelResult: (_request, call) => call === 1
      ? { overallScore: 60, summary: 'Profil à examiner', memory_conflicts: [] }
      : { overallScore: 80, summary: 'Profil pertinent après approfondissement' },
  });
  const response = await h.invoke();
  const data = await response.json();
  assert.equal(response.status, 502);
  assert.equal(data.error_code, 'MEMORY_REVIEW_INCOMPLETE');
  assert.equal(h.modelCalls.length, 2);
  assert.equal(h.modelCalls[0].model, 'claude-haiku-4-5-20251001');
  assert.equal(h.modelCalls[1].model, 'claude-sonnet-4-6');
  assert.equal(h.writes.length, 0);
  assert.equal(h.settlements.length, 2);
  assert.equal(h.settlements.reduce((sum, usage) => sum + usage.tokensInput, 0), 200);
  assert.equal(h.settlements.reduce((sum, usage) => sum + usage.tokensOutput, 0), 50);
});

test('batch evaluations apply the same complete brief, required review and provenance', async () => {
  const h = handlerHarness();
  const response = await h.invoke({ profile: undefined, profiles: [{ id: 'candidate-a', name: 'Camille', headline: 'Account Manager' }] });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.results.length, 1);
  assert.deepEqual(data.results[0].scoringContext.memory.provenance, plain(memoryContext.provenance));
  assert.match(h.modelCalls[0].messages[0].content[0].text, /pas d’ESN/);
  assert.match(h.modelCalls[0].messages[0].content[0].text, /memory_conflicts/);
});

test('a null experience from a sparse LinkedIn profile cannot produce a false junior verdict', async () => {
  const h = handlerHarness();
  const response = await h.invoke({ profile: { id: 'candidate-a', name: 'Camille', headline: 'Account Manager', yearsOfExperience: null } });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.result.hardFilterPassed, true);
  assert.equal(data.result.experienceMatchKind, 'incertain');
  assert.ok(data.result.missingDataPoints.includes('candidate_xp'));
  assert.ok(data.result.finalScore > 50, 'unknown XP must not trigger the explicit junior gap cap');
  assert.match(h.modelCalls[0].messages[0].content[1].text, /XP: à vérifier/);
});

test('a matching cached evaluation avoids model charges but still verifies current memory', async () => {
  const metadata = await context.createScoringContextMetadata(job, undefined, 'claude-sonnet-4-6', memoryContext, metadataOptions);
  const h = handlerHarness({ cache: { finalScore: 84, hardFilterPassed: true, skippedLLM: false, scoringContext: plain(metadata) } });
  const response = await h.invoke();
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.result.finalScore, 84);
  assert.equal(h.memoryRequests.length, 2);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.settlements.length, 0);
  assert.equal(h.writes.filter(write => write.table === 'match_scores').length, 0);
});

test('an archived memory after a cache read prevents returning the note or synchronizing the pipeline', async () => {
  const metadata = await context.createScoringContextMetadata(job, undefined, 'claude-sonnet-4-6', memoryContext, metadataOptions);
  const h = handlerHarness({ cache: { finalScore: 84, hardFilterPassed: true, skippedLLM: false, scoringContext: plain(metadata) },
    memoryAfterModel: emptyMemoryContext,
  });
  const response = await h.invoke();
  const data = await response.json();
  assert.equal(response.status, 409);
  assert.equal(data.error_code, 'MEMORY_CONTEXT_CHANGED');
  assert.equal(h.memoryRequests.length, 2);
  assert.ok(h.events.lastIndexOf('memory') > h.events.indexOf('read:match_scores'));
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.settlements.length, 0);
  assert.equal(h.writes.length, 0);
});

test('a memory change after a free hard rejection prevents both cache and pipeline writes', async () => {
  const h = handlerHarness({ loadedMemory: emptyMemoryContext, memoryAfterModel: memoryContext });
  const response = await h.invoke({ profile: { id: 'candidate-a', name: 'Camille', yearsOfExperience: 2 } });
  const data = await response.json();
  assert.equal(response.status, 409);
  assert.equal(data.error_code, 'MEMORY_CONTEXT_CHANGED');
  assert.equal(h.memoryRequests.length, 2);
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('a free hard rejection remains usable when the confirmed memory context stays unchanged', async () => {
  const h = handlerHarness({ loadedMemory: emptyMemoryContext });
  const response = await h.invoke({ profile: { id: 'candidate-a', name: 'Camille', yearsOfExperience: 2 } });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.result.hardFilterPassed, false);
  assert.equal(data.result.finalScore, 0);
  assert.equal(h.memoryRequests.length, 2);
  assert.ok(h.events.lastIndexOf('memory') < h.events.indexOf('write:match_scores'));
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.settlements.length, 0);
  assert.equal(h.writes.filter(write => write.table === 'match_scores').length, 1);
});

test('a privacy refusal never calls the model and also defers persistence until memory is rechecked', async () => {
  const h = handlerHarness({ memoryAfterModel: updatedMemoryContext });
  const response = await h.invoke({ profile: { id: 'candidate-a', name: 'Camille', noAiScoring: true } });
  const data = await response.json();
  assert.equal(response.status, 409);
  assert.equal(data.error_code, 'MEMORY_CONTEXT_CHANGED');
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.creditCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

for (const path of ['cache', 'hard-filter']) {
  test('insufficient credits with a ' + path + ' result still recheck memory before returning or persisting it', async () => {
    const loadedMemory = path === 'cache' ? memoryContext : emptyMemoryContext;
    const metadata = await context.createScoringContextMetadata(job, undefined, 'claude-sonnet-4-6', loadedMemory, metadataOptions);
    const h = handlerHarness({ creditAllowed: false, loadedMemory,
      cache: path === 'cache' ? candidateId => candidateId === 'candidate-a'
        ? { finalScore: 84, hardFilterPassed: true, skippedLLM: false, scoringContext: plain(metadata) } : null : null,
      memoryAfterModel: path === 'cache' ? emptyMemoryContext : memoryContext,
    });
    const response = await h.invoke({ profile: undefined, profiles: [
      { id: 'candidate-a', name: 'Camille', yearsOfExperience: path === 'hard-filter' ? 2 : 10 },
      { id: 'candidate-b', name: 'Alice', yearsOfExperience: 10 },
    ] });
    const data = await response.json();
    assert.equal(response.status, 409);
    assert.equal(data.error_code, 'MEMORY_CONTEXT_CHANGED');
    assert.equal(h.memoryRequests.length, 2);
    assert.equal(h.creditCalls.length, 1);
    assert.equal(h.modelCalls.length, 0);
    assert.equal(h.settlements.length, 0);
    assert.equal(h.writes.length, 0);
  });

  test('insufficient credits still return a current free ' + path + ' result without paying for unscored profiles', async () => {
    const loadedMemory = path === 'cache' ? memoryContext : emptyMemoryContext;
    const metadata = await context.createScoringContextMetadata(job, undefined, 'claude-sonnet-4-6', loadedMemory, metadataOptions);
    const h = handlerHarness({ creditAllowed: false, loadedMemory,
      cache: path === 'cache' ? candidateId => candidateId === 'candidate-a'
        ? { finalScore: 84, hardFilterPassed: true, skippedLLM: false, scoringContext: plain(metadata) } : null : null,
    });
    const response = await h.invoke({ profile: undefined, profiles: [
      { id: 'candidate-a', name: 'Camille', yearsOfExperience: path === 'hard-filter' ? 2 : 10 },
      { id: 'candidate-b', name: 'Alice', yearsOfExperience: 10 },
    ] });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].profile_id, 'candidate-a');
    assert.equal(data.credit_stop.profiles_scored, 1);
    assert.equal(data.credit_stop.profiles_skipped, 1);
    assert.equal(h.memoryRequests.length, 2);
    assert.ok(h.events.lastIndexOf('memory') < h.events.indexOf('write:job_candidate_status'));
    assert.equal(h.creditCalls.length, 1);
    assert.equal(h.modelCalls.length, 0);
    assert.equal(h.settlements.length, 0);
  });
}

const continuousRequest = {
  continuous_agent_run: true, continuous_agent_id: 'agent-test',
  continuous_lease_token: 'lease-test', continuous_context_key: 'context-test',
};

test('a JWT caller cannot opt out of pipeline persistence with the internal continuous flag', async () => {
  const h = handlerHarness();
  assert.equal((await h.invoke(continuousRequest)).status, 200);
  assert.ok(h.writes.some(write => write.table === 'match_scores'));
  assert.equal(h.events.filter(event => event === 'sourcing_agent_assert_lease').length, 0);
});

for (const branch of ['fresh', 'cache', 'hard-filter', 'must-have']) {
  test('continuous service scoring returns a ' + branch + ' evaluation without publishing cache or pipeline writes', async () => {
    const memory = branch === 'hard-filter' ? emptyMemoryContext : memoryContext;
    const metadata = await context.createScoringContextMetadata(job, undefined, 'claude-sonnet-4-6', memory, metadataOptions);
    const h = handlerHarness({ authMethod: 'service_role', loadedMemory: memory,
      cache: branch === 'cache' ? { finalScore: 84, hardFilterPassed: true, skippedLLM: false, scoringContext: plain(metadata) } : null,
      modelResult: { overallScore: 84, summary: 'Expérience SaaS pertinente', memory_conflicts: [],
        mustHavePassed: branch === 'must-have' ? 'failed' : 'passed', mustHaveDetails: 'La certification demandée est absente' },
    });
    const response = await h.invoke({ ...continuousRequest,
      ...(branch === 'hard-filter' ? { profile: { id: 'candidate-a', name: 'Camille', yearsOfExperience: 2 } } : {}),
      ...(branch === 'must-have' ? { job: { ...job, mustHave: 'Certification Salesforce' } } : {}),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.success, true);
    assert.equal(h.writes.length, 0);
    assert.ok(h.events.filter(event => event === 'sourcing_agent_assert_lease').length >= 2);
    if (branch === 'fresh' || branch === 'must-have') {
      assert.equal(h.modelCalls.length, 1);
      assert.equal(h.settlements.length, 1);
    } else {
      assert.equal(h.modelCalls.length, 0);
      assert.equal(h.settlements.length, 0);
    }
    if (branch === 'must-have') assert.equal(data.result.finalScore, 0);
  });
}

test('an expired continuous lease prevents a paid call', async () => {
  const h = handlerHarness({ authMethod: 'service_role', leaseFailsAt: 2 });
  const response = await h.invoke(continuousRequest);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error_code, 'AGENT_LEASE_CHANGED');
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('pause during a paid continuous evaluation suppresses its result but still settles consumed tokens', async () => {
  const h = handlerHarness({ authMethod: 'service_role', leaseFailsAfterModel: true });
  const response = await h.invoke(continuousRequest);
  const data = await response.json();
  assert.equal(response.status, 409);
  assert.equal(data.error_code, 'AGENT_LEASE_CHANGED');
  assert.equal(data.result, undefined);
  assert.equal(h.modelCalls.length, 1);
  assert.equal(h.writes.length, 0);
  assert.equal(h.settlements.length, 1);
  assert.equal(h.settlements[0].tokensInput, 100);
});

test('a pause confirmed during live context reads prevents the following paid call', async () => {
  for (const pauseDuringContextAt of [1, 2]) {
    const h = handlerHarness({ authMethod: 'service_role', pauseDuringContextAt });
    const response = await h.invoke(continuousRequest);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error_code, 'AGENT_LEASE_CHANGED');
    assert.equal(h.modelCalls.length, 0);
    assert.equal(h.writes.length, 0);
    assert.equal(h.settlements.length, 0);
  }
});

test('an unreadable credit balance stops continuous scoring before any paid operation', async () => {
  const h = handlerHarness({ authMethod: 'service_role', creditRemaining: null });
  const response = await h.invoke(continuousRequest);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error_code, 'CREDITS_UNAVAILABLE');
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('a brief changed after preprocessing prevents the continuous model call even with a valid lease', async () => {
  const h = handlerHarness({ authMethod: 'service_role', liveContextFailsAt: 2 });
  const response = await h.invoke(continuousRequest);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error_code, 'CONTEXT_CHANGED');
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.settlements.length, 0);
});

// Execute each production mapper, including the closure inside the React hook.
// AST extraction preserves its actual body; React and HTTP are not involved.
const briefMapper = compile('supabase/functions/_shared/profile-data.ts').buildJobFromBrief;
const missionMapper = compile('src/hooks/useMissionJobs.ts', { suffix: '\nexports.__missionToJob = missionToJob;\n' }).__missionToJob;
const searchMapper = compile('src/hooks/useLinkedInSearch.ts', {
  transform(source) {
    const file = ts.createSourceFile('useLinkedInSearch.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const matches = [];
    function visit(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'buildJobFromBrief') matches.push(node);
      ts.forEachChild(node, visit);
    }
    visit(file);
    assert.equal(matches.length, 1, 'extract the actual nested mapper, not a copied fixture');
    assert.ok(ts.isArrowFunction(matches[0].initializer));
    return 'export function mapSearchBrief(jd: any, base: Record<string, any>) {\nconst enabledCompetitors = [];\nconst buildJobFromBrief = '
      + matches[0].initializer.getText(file) + ';\nreturn buildJobFromBrief(base);\n}';
  },
}).mapSearchBrief;
const lineageId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const alternateLineageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const calibrationReference = { name: 'Camille', headline: 'Lead Backend Engineer', linkedin_url: 'https://www.linkedin.com/in/camille',
  why_good_fit: ['Expérience SaaS et pratique approfondie de Go.'], areas_of_improvement: 'Valider la mobilité.', sourcing_agent_candidate_id: lineageId };
function mappedCalibrationJobs(reference = calibrationReference) {
  const jd = { title: 'Lead Backend Engineer', skills_must_have: ['Go'], calibration_profiles: [reference] };
  const base = { id: 'project:' + projectId, title: jd.title, description: '' };
  return [briefMapper(jd, base), missionMapper({ id: projectId, name: jd.title, description: '', client_name: null, job_details: jd }), searchMapper(jd, base)];
}
function calibrationInputKey(mapped) {
  return client.buildScoringInputVersionKey(mapped, undefined, { ...metadataOptions, memoryVersionKey: memoryContext.versionKey });
}

test('all three actual brief mappers preserve calibration lineage in the same frontend/server canonical scoring input', async () => {
  const mapped = mappedCalibrationJobs();
  const expected = calibrationInputKey(mapped[0]);
  for (const job of mapped) {
    assert.equal(job.calibrationProfiles[0].sourcing_agent_candidate_id, lineageId);
    const clientKey = calibrationInputKey(job);
    const serverKey = context.buildScoringInputVersionKey(job, undefined, { ...metadataOptions, memoryVersionKey: memoryContext.versionKey });
    assert.equal(clientKey, serverKey);
    assert.equal(clientKey, expected, 'search, mission selector and background worker use the same calibration snapshot');
    assert.ok(clientKey.includes(lineageId));
    const metadata = await context.createScoringContextMetadata(job, undefined, 'claude-sonnet-4-6', memoryContext, metadataOptions);
    assert.equal(metadata.inputVersionKey, clientKey);
  }
});

test('all actual brief mappers omit malformed calibration lineage instead of persisting an invented identity', () => {
  const absent = { ...calibrationReference };
  delete absent.sourcing_agent_candidate_id;
  const withoutLineage = calibrationInputKey(mappedCalibrationJobs(absent)[0]);
  for (const invalid of [undefined, null, '', 'candidate-provider-id', lineageId + 'x', 123]) {
    for (const mapped of mappedCalibrationJobs({ ...calibrationReference, sourcing_agent_candidate_id: invalid })) {
      assert.equal(Object.hasOwn(mapped.calibrationProfiles[0], 'sourcing_agent_candidate_id'), false);
      assert.equal(calibrationInputKey(mapped), withoutLineage);
    }
  }
});

test('replacing a linked calibration suggestion invalidates the input version even when its display text is unchanged', () => {
  for (let index = 0; index < 3; index++) {
    const initial = mappedCalibrationJobs()[index];
    const replaced = mappedCalibrationJobs({ ...calibrationReference, sourcing_agent_candidate_id: alternateLineageId })[index];
    assert.notEqual(calibrationInputKey(initial), calibrationInputKey(replaced));
    const reordered = { ...initial, calibrationProfiles: [{ ...initial.calibrationProfiles[0], sourcing_agent_candidate_id: lineageId }] };
    assert.equal(calibrationInputKey(initial), calibrationInputKey(reordered));
  }
});

test('calibration linkage remains internal and is absent from the real model job prompt', () => {
  const helpers = scoringHelpers();
  for (const mapped of mappedCalibrationJobs()) {
    const prompt = helpers.buildJobContext(mapped);
    assert.match(prompt, /Camille/);
    assert.match(prompt, /Expérience SaaS/);
    assert.match(prompt, /Valider la mobilité/);
    assert.equal(prompt.includes(lineageId), false);
    assert.equal(prompt.includes('sourcing_agent_candidate_id'), false);
  }
});
