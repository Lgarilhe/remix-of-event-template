import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual helpers and hook. The lifecycle/query stubs only schedule
// local renders and responses; there is no remote client, model or network.
const root = new URL('../../', import.meta.url);
function compile(path, globals = {}) {
  const source = readFileSync(new URL(path, root), 'utf8').replace(/^import[\s\S]*?;\r?\n/gm, '');
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path, reportDiagnostics: true,
  });
  assert.equal(diagnostics?.length ?? 0, 0);
  const context = { exports: {}, URL, Intl, Error, fetch() { throw new Error('No network in this test'); }, ...globals };
  vm.runInNewContext(outputText, context, { filename: path });
  return context.exports;
}
const helpers = compile('src/types/sourcingAgent.ts');
const copy = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const candidate = (id, overrides = {}) => ({
  id, agent_id: 'agent-a', organization_id: 'org-a', project_id: 'mission-a', created_by: 'user-a',
  person_key: `linkedin:${id}`, candidate_id: null, context_key: 'criteria-a',
  decision: null, reason: null, state: 'proposed', score: 82,
  profile: { name: 'Camille Martin', headline: 'Responsable investissement', profile_url: 'https://www.linkedin.com/in/camille' },
  result: { score: 82, summary: 'Expérience pertinente' }, provenance: { source: 'linkedin' },
  source_aliases: [], credits_reserved: 0, credits_used: 4,
  created_at: '2026-10-08T12:00:00Z', updated_at: '2026-10-08T12:00:00Z', ...overrides,
});
const snapshot = (overrides = {}) => ({
  agent: {
    id: 'agent-a', organization_id: 'org-a', project_id: 'mission-a', created_by: 'user-a', revision: 6,
    status: 'draft', source: 'linkedin', account_id: 'linkedin-me', api: 'recruiter',
    settings: copy(helpers.DEFAULT_SOURCING_AGENT_SETTINGS),
    approved_context_key: null, context_snapshot: { title: 'Responsable investissement' },
    search_filters_snapshot: { keywords: 'investissement' }, checkpoint: {},
    next_run_at: null, last_run_at: null, lease_token: null, lease_until: null,
    last_reason: null, last_error: null, daily_date: '2026-10-08', profiles_used: 0,
    credits_reserved: 0, credits_used: 0, created_at: '2026-10-08T12:00:00Z', updated_at: '2026-10-08T12:00:00Z',
  },
  candidates: [], context_key: 'criteria-a', eligibility: { allowed: true, reasons: [] },
  accounts: [{ id: 'linkedin-me', name: 'Mon compte', apis: ['recruiter'], status: 'OK' }],
  credits_estimate: { per_profile: 4, daily_limit: helpers.DEFAULT_SOURCING_AGENT_SETTINGS.daily_credit_limit, reserved: 0, used: 0, remaining: helpers.DEFAULT_SOURCING_AGENT_SETTINGS.daily_credit_limit },
  ...overrides,
});
const reply = data => ({ data, error: null });
const queryKey = scope => ['sourcing-agent', scope.organizationId, scope.userId, scope.projectId];
const interruptedId = 'b613ea70-8543-4cfb-bc24-f4ab914c8131';
const skipCommand = { action: 'skip_uncertain', candidate_id: interruptedId, reason: 'Ignorer cette évaluation interrompue', confirm_uncertain: true };

function harness(initial = {}) {
  let scope = { organizationId: 'org-a', userId: 'user-a', projectId: 'mission-a', isReady: true, enabled: true, pollWhileOpen: false, ...initial };
  let cursor = 0;
  let stateWrites = 0;
  let latestQuery;
  const slots = [];
  const effects = [];
  const responses = [];
  const requests = [];
  const cache = new Map();
  const writes = [];
  const invalidations = [];
  const refreshes = [];
  const sameDeps = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]));
  const useState = initialValue => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue };
    return [slots[index].value, value => {
      stateWrites += 1;
      slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;
    }];
  };
  const useRef = initialValue => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { value: { current: initialValue } };
    return slots[index].value;
  };
  const useEffect = (setup, deps) => {
    const index = cursor++;
    const previous = slots[index];
    if (previous && sameDeps(previous.deps, deps)) return;
    const next = { deps, setup, cleanup: previous?.cleanup };
    slots[index] = next;
    effects.push(() => { next.cleanup?.(); next.cleanup = setup(); });
  };
  const client = {
    getQueryData(key) { return cache.get(JSON.stringify(key)); },
    setQueryData(key, value) { writes.push({ key: copy(key), value }); cache.set(JSON.stringify(key), value); },
    invalidateQueries(options) { invalidations.push(copy(options)); return Promise.resolve(); },
  };
  const runQuery = async (options, signal = new AbortController().signal) => {
    const value = await options.queryFn({ signal });
    cache.set(JSON.stringify(options.queryKey), value);
    return value;
  };
  // Tanstack's observer refetch function is stable across unrelated renders.
  // Effects can request refresh without starting an unscripted remote read.
  const refetch = () => {
    refreshes.push({ queryKey: copy(latestQuery.queryKey), enabled: latestQuery.enabled });
    return Promise.resolve({ data: cache.get(JSON.stringify(latestQuery.queryKey)) });
  };
  const useQuery = options => {
    latestQuery = options;
    const data = cache.get(JSON.stringify(options.queryKey));
    return { data, isLoading: data === undefined && options.enabled, error: null, refetch };
  };
  const hook = compile('src/hooks/useSourcingAgent.ts', {
    useState, useRef, useEffect, useQuery, useQueryClient: () => client,
    useOrganization: () => ({ organizationId: scope.organizationId }),
    useAuthReady: () => ({ user: scope.userId ? { id: scope.userId } : null, isReady: scope.isReady }),
    readSourcingAgentSnapshot: helpers.readSourcingAgentSnapshot,
    invokeEdgeFunction(name, body) {
      requests.push({ name, body: copy(body) });
      assert.equal(name, 'sourcing-agent');
      if (!responses.length) throw new Error('Unscripted local request');
      const response = responses.shift();
      return Promise.resolve(typeof response === 'function' ? response(body) : response);
    },
  });
  const render = (next = {}) => {
    scope = { ...scope, ...next };
    cursor = 0;
    const view = hook.useSourcingAgent(scope.projectId, { enabled: scope.enabled, pollWhileOpen: scope.pollWhileOpen });
    while (effects.length) effects.shift()();
    return view;
  };
  render();
  return {
    render, view: () => render(), responses, requests, writes, invalidations, refreshes,
    query: () => latestQuery, read: signal => runQuery(latestQuery, signal),
    seed: value => cache.set(JSON.stringify(queryKey(scope)), value),
    cached: () => cache.get(JSON.stringify(queryKey(scope))),
    stateWrites: () => stateWrites,
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); },
    setupEffects: () => { for (const slot of slots) if (slot?.setup) slot.cleanup = slot.setup(); },
    replayEffects: () => {
      for (const slot of slots) slot?.cleanup?.();
      for (const slot of slots) if (slot?.setup) slot.cleanup = slot.setup();
    },
  };
}

test('settings accept supported cadences and each published limit boundary', () => {
  const defaults = helpers.DEFAULT_SOURCING_AGENT_SETTINGS;
  assert.equal(helpers.validSourcingAgentSettings(defaults), true);
  for (const cadence_hours of [2, 6, 12, 24]) assert.equal(helpers.validSourcingAgentSettings({ ...defaults, cadence_hours }), true);
  for (const [field, bounds] of Object.entries({ daily_profile_limit: [5, 100], daily_credit_limit: [12, 500], max_pending: [5, 50], min_score: [0, 100] })) {
    for (const value of bounds) assert.equal(helpers.validSourcingAgentSettings({ ...defaults, [field]: value }), true, `${field}: ${value}`);
  }
});

test('settings reject out-of-range, non-finite and fractional limits before submission', () => {
  const defaults = helpers.DEFAULT_SOURCING_AGENT_SETTINGS;
  for (const cadence_hours of [0, 1, 4, 25, '6', null]) assert.equal(helpers.validSourcingAgentSettings({ ...defaults, cadence_hours }), false);
  for (const [field, [min, max]] of Object.entries({ daily_profile_limit: [5, 100], daily_credit_limit: [12, 500], max_pending: [5, 50], min_score: [0, 100] })) {
    for (const value of [min - 1, max + 1, min + 0.5, NaN, Infinity, '20', null]) {
      assert.equal(helpers.validSourcingAgentSettings({ ...defaults, [field]: value }), false, `${field}: ${value}`);
    }
  }
  for (let daily_credit_limit = 1; daily_credit_limit < 12; daily_credit_limit += 1) {
    assert.equal(helpers.validSourcingAgentSettings({ ...defaults, daily_credit_limit }), false, `daily_credit_limit: ${daily_credit_limit}`);
  }
});

test('profile links accept only HTTPS LinkedIn domains without embedded credentials', () => {
  for (const url of ['https://www.linkedin.com/in/camille', 'https://linkedin.com/in/camille', 'https://fr.linkedin.com/in/camille']) {
    assert.equal(helpers.sourcingLinkedInUrl({ profile_url: url }), url);
  }
  for (const url of ['http://linkedin.com/in/a', 'javascript:alert(1)', 'https://linkedin.com.evil.example/in/a', 'https://evillinkedin.com/in/a', 'https://linkedin.com@evil.example/in/a', 'https://person:password@linkedin.com/in/a', '//linkedin.com/in/a', 'not a URL', null, 42]) {
    assert.equal(helpers.sourcingLinkedInUrl({ profile_url: url }), null, String(url));
  }
});

test('profile disclosure reads recorded snake_case fields and mixed readable list entries', () => {
  const details = helpers.sourcingProfileDetails(candidate('snake', {
    profile: {
      summary: '  Financement et investissement  ', location: { name: 'Paris' },
      skills: ['M&A', { name: 'Finance' }, null, 42, { label: 'Internal data' }],
      work_experience: [
        { role: 'Analyste', company: { name: 'Banque' }, start: { year: 2018 }, end: { year: 2021 }, description: 'Conseil M&A' },
        { position: 'Associate', company_name: 'Fonds', start: '2021-01', current: true },
        'Consultant indépendant',
      ],
      education: ['Certification CFA', { school: { name: 'HEC' }, degree_name: 'Master', field_of_study: 'Finance', end: { year: 2017 } }],
    },
    result: { strengths: ['Expérience marché', { name: 'Analyse financière' }], concerns: [{ name: 'Mobilité à confirmer' }], confidenceScore: 87.7 },
  }));
  assert.deepEqual(copy(details), {
    summary: 'Financement et investissement', location: 'Paris', skills: ['M&A', 'Finance'],
    experience: [
      { title: 'Analyste', company: 'Banque', period: '2018 → 2021', description: 'Conseil M&A' },
      { title: 'Associate', company: 'Fonds', period: '2021-01 → Aujourd’hui', description: '' },
      { title: 'Consultant indépendant', company: '', period: '', description: '' },
    ],
    education: ['Certification CFA', 'HEC · Master · Finance · 2017'],
    strengths: ['Expérience marché', 'Analyse financière'], concerns: ['Mobilité à confirmer'], confidence: 88,
  });
});

test('profile disclosure supports camelCase and current/past experience aliases', () => {
  const camel = helpers.sourcingProfileDetails(candidate('camel', { profile: {
    about: 'Parcours international', location: 'Londres',
    workExperience: [
      { title: 'Associate', company: 'Acme', startDate: '2019', endDate: '2022' },
      { title: 'Directrice', company: { name: 'Fonds' }, startDate: '2022-04-01', isCurrent: true },
    ],
    education: [{ school_name: 'Université', degree: 'Master' }, { school_details: { name: 'École' }, field: 'Économie' }],
  } }));
  assert.equal(camel.summary, 'Parcours international');
  assert.equal(camel.location, 'Londres');
  assert.deepEqual(copy(camel.experience), [
    { title: 'Associate', company: 'Acme', period: '2019 → 2022', description: '' },
    { title: 'Directrice', company: 'Fonds', period: '2022-04-01 → Aujourd’hui', description: '' },
  ]);
  assert.deepEqual(copy(camel.education), ['Université · Master', 'École · Économie']);
  const historical = helpers.sourcingProfileDetails(candidate('positions', { profile: {
    current_positions: [{ position: 'Actuel', company: 'Fonds', duration: 'Depuis 2023' }],
    past_positions: [{ role: 'Ancien', company: 'Banque', duration: '2019–2023' }],
  } }));
  assert.deepEqual(copy(historical.experience.map(item => item.title)), ['Actuel', 'Ancien']);
  assert.equal(historical.experience[0].period, 'Depuis 2023');
  assert.equal(helpers.sourcingProfileDetails(candidate('alias', { profile: { experiences: [{ title: 'Consultant' }] } })).experience[0].title, 'Consultant');
  for (const year of [1899, 2301, 2020.5, NaN, Infinity, '2020']) {
    const invalidDate = helpers.sourcingProfileDetails(candidate('year', { profile: { experiences: [{ title: 'Poste enregistré', start: { year } }] } }));
    assert.equal(invalidDate.experience[0].period, '', String(year));
  }
});

test('profile disclosure bounds experience, education, skills and scoring explanations', () => {
  const details = helpers.sourcingProfileDetails(candidate('long', {
    profile: {
      work_experience: Array.from({ length: 30 }, (_, i) => ({ role: `Poste ${i}` })),
      education: Array.from({ length: 30 }, (_, i) => ({ school: `École ${i}` })),
      skills: Array.from({ length: 30 }, (_, i) => ({ name: `Compétence ${i}` })),
    },
    result: {
      strengths: Array.from({ length: 30 }, (_, i) => `Force ${i}`),
      concerns: Array.from({ length: 30 }, (_, i) => ({ name: `Point ${i}` })),
    },
  }));
  assert.equal(details.experience.length, 8);
  assert.equal(details.education.length, 6);
  assert.equal(details.skills.length, 20);
  assert.equal(details.strengths.length, 5);
  assert.equal(details.concerns.length, 5);
});

test('profile disclosure ignores malformed nested values instead of showing serialized raw data', () => {
  const details = helpers.sourcingProfileDetails(candidate('bad', {
    profile: {
      summary: { secret: 'raw payload' }, about: ['unreadable'], location: { name: [] },
      skills: [null, 42, true, [], { name: { secret: 'raw payload' } }],
      work_experience: [null, [], 42, { title: {}, company: { name: {} }, start: { year: 'bad' }, end: { year: 9000 }, description: ['raw payload'] }],
      education: [null, [], 42, { school: {}, degree: {}, end: { year: Infinity } }],
    },
    result: { strengths: [null, { name: {} }], concerns: { name: 'raw payload' }, confidenceScore: NaN },
  }));
  assert.deepEqual(copy(details), { summary: '', location: '', skills: [], experience: [], education: [], strengths: [], concerns: [], confidence: null });
});

test('profile confidence accepts only finite numbers from zero to one hundred', () => {
  for (const [confidenceScore, expected] of [[0, 0], [100, 100], [82.4, 82], [82.5, 83], [99.9, 100]]) {
    assert.equal(helpers.sourcingProfileDetails(candidate('confidence', { result: { confidenceScore } })).confidence, expected);
  }
  for (const confidenceScore of [-1, 101, NaN, Infinity, -Infinity, '80', null, {}, []]) {
    assert.equal(helpers.sourcingProfileDetails(candidate('confidence', { result: { confidenceScore } })).confidence, null, String(confidenceScore));
  }
});

test('calibration requires three reasoned decisions and a fit for the current criteria', () => {
  const rows = [candidate('a', { state: 'reviewed', decision: 'fit', reason: 'Bonne expérience' }), candidate('b', { state: 'reviewed', decision: 'reject', reason: 'Périmètre insuffisant' }), candidate('c', { state: 'reviewed', decision: 'reject', reason: '   ' })];
  assert.equal(helpers.sourcingCalibration(snapshot({ candidates: rows })).canApprove, false);
  rows.push(candidate('old', { state: 'reviewed', decision: 'fit', reason: 'Ancien cadrage', context_key: 'old-criteria' }));
  assert.equal(helpers.sourcingCalibration(snapshot({ candidates: rows })).reviewed, 2);
  rows.push(candidate('d', { state: 'reviewed', decision: 'reject', reason: 'Pas le bon marché' }));
  const ready = helpers.sourcingCalibration(snapshot({ candidates: rows }));
  assert.equal(ready.canApprove, true);
  assert.equal(ready.reviewed, 3);
  assert.deepEqual(copy(ready.fits.map(row => row.id)), ['a']);
  assert.equal(helpers.sourcingCalibration(snapshot({ candidates: rows.map(row => ({ ...row, decision: 'reject' })) })).canApprove, false);
  assert.equal(helpers.sourcingCalibration(undefined).canApprove, false);
  assert.equal(helpers.sourcingCalibration(snapshot({ candidates: Array.from({ length: 8 }, (_, i) => candidate(String(i), { state: 'reviewed', decision: 'fit', reason: 'Validé' })) })).fits.length, 5);
});

test('calibration rejects reasons shorter than five trimmed characters', () => {
  const decisions = [candidate('a', { state: 'reviewed', decision: 'fit', reason: 'Très bon parcours' }), candidate('b', { state: 'reviewed', decision: 'reject', reason: 'Marché différent' })];
  for (const reason of ['', '   ', 'oui', ' non ', 'bien', '  abcd  ']) {
    const review = helpers.sourcingCalibration(snapshot({ candidates: [...decisions, candidate('c', { state: 'reviewed', decision: 'reject', reason })] }));
    assert.equal(review.reviewed, 2, JSON.stringify(reason));
    assert.equal(review.canApprove, false, JSON.stringify(reason));
  }
  assert.equal(helpers.sourcingCalibration(snapshot({ candidates: [...decisions, candidate('c', { state: 'reviewed', decision: 'reject', reason: '  abcde  ' })] })).canApprove, true);
});

test('calibration ignores decisions on profiles that have not reached the reviewed state', () => {
  const reviewed = [candidate('a', { state: 'reviewed', decision: 'fit', reason: 'Très bon parcours' }), candidate('b', { state: 'reviewed', decision: 'reject', reason: 'Marché différent' })];
  for (const state of ['discovered', 'scored', 'proposed', 'skipped']) {
    const result = helpers.sourcingCalibration(snapshot({ candidates: [...reviewed, candidate('not-reviewed', { state, decision: 'reject', reason: 'Décision sans validation' })] }));
    assert.equal(result.reviewed, 2, state);
    assert.equal(result.canApprove, false, state);
  }
  const rejectedOnly = reviewed.map(row => ({ ...row, decision: 'reject' }));
  assert.equal(helpers.sourcingCalibration(snapshot({ candidates: [...rejectedOnly, candidate('proposed-fit', { decision: 'fit', reason: 'Non validé' })] })).fits.length, 0);
});

test('interrupted evaluations include discovered rows from older criteria with reserved credits or a start marker', () => {
  const rows = [
    candidate('reserved', { state: 'discovered', credits_reserved: 4 }),
    candidate('started', { state: 'discovered', provenance: { scoring_started_at: '2026-10-08T12:00:00Z' } }),
    candidate('recovered', { state: 'discovered', credits_reserved: 0, provenance: { reservation_recovered: true } }),
    candidate('estimated-after-lease', { state: 'discovered', credits_reserved: 0, provenance: { reservation_recovered: 'ESTIMATED_AFTER_LEASE' } }),
    candidate('not-started', { state: 'discovered', credits_reserved: 0 }),
    candidate('empty-marker', { state: 'discovered', provenance: { scoring_started_at: '' } }),
    candidate('old-criteria', { state: 'discovered', context_key: 'old-criteria', credits_reserved: 4 }),
    ...['scored', 'proposed', 'reviewed', 'skipped'].map(state => candidate(state, { state, credits_reserved: 4, provenance: { scoring_started_at: '2026-10-08T12:00:00Z' } })),
  ];
  const current = snapshot({ candidates: rows, agent: { ...snapshot().agent, last_reason: 'SCORING_UNCERTAIN' } });
  assert.deepEqual(copy(helpers.sourcingUncertainCandidates(current).map(row => row.id)), ['reserved', 'started', 'recovered', 'estimated-after-lease', 'old-criteria']);
  assert.deepEqual(copy(helpers.sourcingUncertainCandidates(undefined)), []);
  assert.deepEqual(copy(helpers.sourcingUncertainCandidates(snapshot({ candidates: [] }))), []);
});

test('interrupted rows are visible only while paused, blocked or stopped without an active lease', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const rows = [candidate(interruptedId, { state: 'discovered', context_key: 'old-criteria', credits_reserved: 4 })];
  for (const status of ['paused', 'blocked', 'stopped']) {
    const agent = { ...snapshot().agent, status, last_reason: 'USER_PAUSED' };
    for (const lease_until of [null, '2026-10-08T11:59:59Z', '2026-10-08T12:00:00Z']) {
      const parsed = helpers.readSourcingAgentSnapshot(snapshot({ agent: { ...agent, lease_until }, candidates: rows }), 'org-a', 'mission-a');
      assert.deepEqual(copy(helpers.sourcingVisibleUncertainCandidates(parsed, now).map(row => row.id)), [interruptedId], `${status}: ${lease_until}`);
    }
    assert.equal(helpers.sourcingVisibleUncertainCandidates(snapshot({ agent: { ...agent, lease_until: '2026-10-08T12:00:01Z' }, candidates: rows }), now).length, 0, 'an outstanding execution must not offer manual resolution');
  }
  for (const status of ['draft', 'calibrating', 'active', 'awaiting_review']) {
    assert.equal(helpers.sourcingVisibleUncertainCandidates(snapshot({ agent: { ...snapshot().agent, status, last_reason: 'SCORING_UNCERTAIN' }, candidates: rows }), now).length, 0, status);
  }
  assert.deepEqual(copy(helpers.sourcingVisibleUncertainCandidates(undefined, now)), []);
  assert.deepEqual(copy(helpers.sourcingVisibleUncertainCandidates(snapshot({ agent: null, candidates: rows }), now)), []);
});

test('manual resume requires approved current criteria, eligibility and a resumable state', () => {
  const agent = { ...snapshot().agent, approved_context_key: 'criteria-a', status: 'paused' };
  for (const status of ['paused', 'blocked', 'awaiting_review']) {
    assert.equal(helpers.sourcingCanResume(snapshot({ agent: { ...agent, status } })), true, status);
  }
  for (const status of ['draft', 'calibrating', 'active', 'stopped']) {
    assert.equal(helpers.sourcingCanResume(snapshot({ agent: { ...agent, status } })), false, status);
  }
  assert.equal(helpers.sourcingCanResume(snapshot({ agent: { ...agent, approved_context_key: 'old-criteria' } })), false);
  assert.equal(helpers.sourcingCanResume(snapshot({ agent, eligibility: { allowed: false, reasons: ['Compte à reconnecter'] } })), false);
  assert.equal(helpers.sourcingCanResume(snapshot({ agent, requires_refresh: true })), false, 'an accidentally allowed eligibility cannot bypass pending prerequisite refresh');
  assert.equal(helpers.sourcingCanResume(snapshot({ agent, requires_refresh: false })), true);
  assert.equal(helpers.sourcingCanResume(snapshot({ agent: null })), false);
  assert.equal(helpers.sourcingCanResume(undefined), false);
  assert.equal(helpers.sourcingCanResume(snapshot({ agent, accounts_error: 'La lecture des licences a échoué.' })), false);
  assert.equal(helpers.sourcingCanResume(snapshot({ agent, accounts_error: null })), true);
  assert.equal(helpers.sourcingCanResume(snapshot({ agent: { ...agent, source: 'pool', account_id: null, api: null }, accounts_error: 'La lecture des licences a échoué.' })), true, 'a LinkedIn read failure does not block the internal candidate pool');
});

test('unresolved scoring blocks resume independently of the visible pause reason', () => {
  const agent = { ...snapshot().agent, approved_context_key: 'criteria-a', status: 'paused' };
  for (const last_reason of ['SCORING_UNCERTAIN', 'USER_PAUSED', 'RETRY_LATER', null]) {
    for (const patch of [{ credits_reserved: 4 }, { credits_reserved: 0, provenance: { scoring_started_at: '2026-10-08T12:00:00Z' } }, { credits_reserved: 0, provenance: { reservation_recovered: true } }, { credits_reserved: 0, provenance: { reservation_recovered: 'ESTIMATED_AFTER_LEASE' } }]) {
      assert.equal(helpers.sourcingCanResume(snapshot({ agent: { ...agent, last_reason }, candidates: [candidate(interruptedId, { state: 'discovered', ...patch })] })), false, String(last_reason));
    }
  }
  assert.equal(helpers.sourcingCanResume(snapshot({ agent, candidates: [candidate(interruptedId, { state: 'discovered', credits_reserved: 4, context_key: 'old-criteria' })] })), false, 'an unresolved evaluation still blocks resume after the criteria have changed');
  assert.equal(helpers.sourcingCanResume(snapshot({ agent, candidates: [candidate(interruptedId, { state: 'skipped', credits_reserved: 4, provenance: { scoring_started_at: '2026-10-08T12:00:00Z' } })] })), true, 'the explicit skipped state resolves the interruption');
});

test('snapshot verification rejects foreign rows and caps received candidates without modifying the response', () => {
  const data = snapshot({ candidates: Array.from({ length: 60 }, (_, i) => candidate(String(i))) });
  const parsed = helpers.readSourcingAgentSnapshot(data, 'org-a', 'mission-a');
  assert.equal(parsed.candidates.length, 50);
  assert.equal(data.candidates.length, 60);
  for (const invalid of [null, {}, snapshot({ agent: undefined }), snapshot({ context_key: null }), snapshot({ agent: { ...data.agent, revision: 1.5 } }), snapshot({ agent: { ...data.agent, organization_id: 'org-b' } }), snapshot({ candidates: [candidate('foreign', { project_id: 'mission-b' })] }), snapshot({ eligibility: { reasons: [] } })]) {
    assert.throws(() => helpers.readSourcingAgentSnapshot(invalid, 'org-a', 'mission-a'), /n’a pas pu être vérifiée/);
  }
  assert.throws(() => helpers.readSourcingAgentSnapshot(snapshot({ candidates: [...data.candidates, candidate('foreign-after-cap', { organization_id: 'org-b' })] }), 'org-a', 'mission-a'), /n’a pas pu être vérifiée/, 'foreign data is validated even beyond the display cap');
});

test('a historical interrupted row beyond fifty ordinary results is retained first by parsing and the GET hook', async () => {
  const agent = { ...snapshot().agent, status: 'paused', approved_context_key: 'criteria-a' };
  const history = Array.from({ length: 60 }, (_, i) => candidate(`history-${i}`));
  const interrupted = candidate(interruptedId, {
    state: 'discovered', context_key: 'earlier-criteria', credits_reserved: 4,
    provenance: { scoring_started_at: '2026-10-08T12:00:00Z' },
  });
  assert.equal(helpers.sourcingCanResume(snapshot({ agent, candidates: history })), true);
  const data = snapshot({ agent, candidates: [...history, interrupted] });
  const parsed = helpers.readSourcingAgentSnapshot(data, 'org-a', 'mission-a');
  assert.equal(parsed.candidates.length, 50);
  assert.equal(parsed.candidates[0].id, interruptedId);
  assert.equal(helpers.sourcingCanResume(parsed), false);
  assert.equal(data.candidates.length, 61, 'prioritization never mutates the received response');
  const h = harness();
  h.responses.push(reply(data));
  await h.read();
  assert.equal(h.cached().candidates[0].id, interruptedId);
  assert.equal(h.view().data.candidates.length, 50);
  assert.equal(helpers.sourcingCanResume(h.view().data), false);
});

test('more than fifty interrupted rows remain available in full and ordinary history is excluded', async () => {
  const uncertain = Array.from({ length: 65 }, (_, i) => candidate(`uncertain-${i}`, {
    state: 'discovered', context_key: `earlier-criteria-${i}`,
    ...(i % 3 === 0 ? { credits_reserved: 4 }
      : { provenance: i % 3 === 1 ? { scoring_started_at: '2026-10-08T12:00:00Z' } : { reservation_recovered: 'ESTIMATED_AFTER_LEASE' } }),
  }));
  const data = snapshot({
    agent: { ...snapshot().agent, status: 'paused', approved_context_key: 'criteria-a' },
    candidates: [...Array.from({ length: 60 }, (_, i) => candidate(`history-${i}`)), ...uncertain],
  });
  const parsed = helpers.readSourcingAgentSnapshot(data, 'org-a', 'mission-a');
  assert.deepEqual(copy(parsed.candidates.map(row => row.id)), uncertain.map(row => row.id));
  assert.equal(helpers.sourcingUncertainCandidates(parsed).length, 65);
  assert.equal(helpers.sourcingCanResume(parsed), false);
  const h = harness();
  h.responses.push(reply(data));
  await h.read();
  assert.equal(h.view().data.candidates.length, 65);
  assert.equal(h.view().data.candidates.some(row => row.id.startsWith('history-')), false);
  assert.equal(helpers.sourcingUncertainCandidates(h.cached()).length, 65);
});

test('malformed agent settings, sources and nested records produce the verified-response error', () => {
  const defaults = snapshot().agent;
  for (const patch of [
    { settings: null }, { settings: [] }, { settings: 'unknown' },
    { settings: { ...defaults.settings, daily_profile_limit: '20' } },
    { settings: { ...defaults.settings, daily_credit_limit: 1.5 } },
    { settings: { ...defaults.settings, cadence_hours: 4 } },
    { settings: { ...defaults.settings, model_id: null } },
    { source: 'other' }, { status: 'unknown' }, { revision: -1 },
    { context_snapshot: null }, { context_snapshot: [] }, { context_snapshot: 'brief' },
  ]) {
    assert.throws(() => helpers.readSourcingAgentSnapshot(snapshot({ agent: { ...defaults, ...patch } }), 'org-a', 'mission-a'), /La réponse de l’agent n’a pas pu être vérifiée/, JSON.stringify(patch));
  }
});

test('malformed candidate profiles, results, provenance, states and scores cannot enter the UI', () => {
  for (const patch of [
    { profile: null }, { profile: [] }, { profile: 'profile' },
    { result: null }, { result: [] }, { result: 'evaluation' },
    { provenance: null }, { provenance: [] }, { provenance: 'linkedin' },
    { state: 'unknown' }, { score: '82' }, { score: NaN }, { score: Infinity }, { score: -1 }, { score: 101 },
    { decision: 'maybe' }, { reason: { text: 'Validé' } }, { context_key: 42 }, { id: null },
  ]) {
    assert.throws(() => helpers.readSourcingAgentSnapshot(snapshot({ candidates: [candidate('bad', patch)] }), 'org-a', 'mission-a'), /La réponse de l’agent n’a pas pu être vérifiée/, JSON.stringify(patch));
  }
  const unscored = helpers.readSourcingAgentSnapshot(snapshot({ candidates: [candidate('discovered', { score: null, state: 'discovered', result: {} })] }), 'org-a', 'mission-a');
  assert.equal(unscored.candidates[0].score, null);
});

test('malformed account fields and eligibility reasons are rejected before the settings render', () => {
  const account = snapshot().accounts[0];
  for (const patch of [{ id: null }, { name: {} }, { status: null }, { apis: 'recruiter' }, { apis: ['unknown'] }]) {
    assert.throws(() => helpers.readSourcingAgentSnapshot(snapshot({ accounts: [{ ...account, ...patch }] }), 'org-a', 'mission-a'), /La réponse de l’agent n’a pas pu être vérifiée/, JSON.stringify(patch));
  }
  for (const eligibility of [null, [], { allowed: 'yes', reasons: [] }, { allowed: true, reasons: [null] }, { allowed: true, reasons: [{}] }, { allowed: false, reasons: [42] }]) {
    assert.throws(() => helpers.readSourcingAgentSnapshot(snapshot({ eligibility }), 'org-a', 'mission-a'), /La réponse de l’agent n’a pas pu être vérifiée/, JSON.stringify(eligibility));
  }
  for (const requires_refresh of [null, 'true', 1, {}, []]) {
    assert.throws(() => helpers.readSourcingAgentSnapshot(snapshot({ requires_refresh }), 'org-a', 'mission-a'), /La réponse de l’agent n’a pas pu être vérifiée/, JSON.stringify(requires_refresh));
  }
  assert.equal(helpers.readSourcingAgentSnapshot(snapshot({ requires_refresh: true }), 'org-a', 'mission-a').requires_refresh, true);
  assert.equal(helpers.readSourcingAgentSnapshot(snapshot({ requires_refresh: false }), 'org-a', 'mission-a').requires_refresh, false);
  assert.equal(helpers.readSourcingAgentSnapshot(snapshot({ agent: null, accounts: [], eligibility: { allowed: false, reasons: ['Relier LinkedIn'] } }), 'org-a', 'mission-a').agent, null);
});

test('account read errors stay distinct from an empty list and accept optional nullable messages', () => {
  const missing = helpers.readSourcingAgentSnapshot(snapshot({ accounts: [] }), 'org-a', 'mission-a');
  assert.equal(missing.accounts_error, undefined);
  const nullable = helpers.readSourcingAgentSnapshot(snapshot({ accounts: [], accounts_error: null }), 'org-a', 'mission-a');
  assert.equal(nullable.accounts_error, null);
  const unavailable = helpers.readSourcingAgentSnapshot(snapshot({ accounts: [], accounts_error: 'Impossible de lire les licences LinkedIn.' }), 'org-a', 'mission-a');
  assert.equal(unavailable.accounts.length, 0);
  assert.equal(unavailable.accounts_error, 'Impossible de lire les licences LinkedIn.');
  for (const accounts_error of [false, 42, {}, [], { message: 'Internal raw error' }]) {
    assert.throws(() => helpers.readSourcingAgentSnapshot(snapshot({ accounts_error }), 'org-a', 'mission-a'), /La réponse de l’agent n’a pas pu être vérifiée/, JSON.stringify(accounts_error));
  }
});

test('missing, negative or non-finite credit numbers produce the verified-response error', () => {
  for (const field of ['per_profile', 'daily_limit', 'reserved', 'used', 'remaining']) {
    for (const value of [undefined, null, '30', NaN, Infinity, -1]) {
      assert.throws(() => helpers.readSourcingAgentSnapshot(snapshot({ credits_estimate: { ...snapshot().credits_estimate, [field]: value } }), 'org-a', 'mission-a'), /La réponse de l’agent n’a pas pu être vérifiée/, `${field}: ${String(value)}`);
    }
  }
});

test('polling runs only while the settings are open or an agent is active/calibrating', () => {
  const h = harness();
  assert.equal(h.query().refetchIntervalInBackground, false);
  assert.equal(h.query().retry, false);
  for (const status of ['draft', 'paused', 'blocked', 'awaiting_review', 'stopped', undefined]) {
    assert.equal(h.query().refetchInterval({ state: { data: snapshot({ agent: status ? { ...snapshot().agent, status } : null }) } }), false, String(status));
  }
  for (const status of ['active', 'calibrating']) assert.equal(h.query().refetchInterval({ state: { data: snapshot({ agent: { ...snapshot().agent, status } }) } }), 15_000);
  h.render({ pollWhileOpen: true });
  assert.equal(h.query().refetchInterval({ state: { data: undefined } }), 15_000);
  h.render({ enabled: false });
  assert.equal(h.query().refetchInterval({ state: { data: snapshot({ agent: { ...snapshot().agent, status: 'active' } }) } }), false);
});

test('closing and reopening requests a refresh even when a verified snapshot is still cached', () => {
  const h = harness();
  assert.equal(h.refreshes.length, 1);
  h.seed(snapshot());
  h.render({ enabled: false });
  assert.equal(h.refreshes.length, 1, 'closing cannot request an unavailable read');
  h.render({ enabled: true });
  assert.equal(h.refreshes.length, 2);
  assert.deepEqual(h.refreshes[1], { queryKey: ['sourcing-agent', 'org-a', 'user-a', 'mission-a'], enabled: true });
  assert.equal(h.requests.length, 0, 'refresh scheduling remains separate from the scripted query execution');
});

test('returning A→B→A refreshes both scopes despite fresh cache and unrelated rerenders do not refetch', () => {
  const h = harness();
  h.seed(snapshot());
  h.render({ projectId: 'mission-b' });
  h.seed(snapshot({ agent: { ...snapshot().agent, project_id: 'mission-b' } }));
  h.render({ projectId: 'mission-a' });
  assert.equal(h.view().data.agent.project_id, 'mission-a');
  assert.deepEqual(h.refreshes.map(item => item.queryKey), [
    ['sourcing-agent', 'org-a', 'user-a', 'mission-a'],
    ['sourcing-agent', 'org-a', 'user-a', 'mission-b'],
    ['sourcing-agent', 'org-a', 'user-a', 'mission-a'],
  ]);
  const before = h.refreshes.length;
  h.render();
  h.view();
  h.render({ pollWhileOpen: true });
  assert.equal(h.refreshes.length, before);
});

for (const action of ['configure', 'start_calibration', 'pause', 'skip_uncertain']) {
  test(`${action}: suppresses double submissions and sends expected revision, criteria and organization`, async () => {
    const h = harness();
    const baseline = snapshot(action === 'skip_uncertain' ? {
      agent: { ...snapshot().agent, status: 'blocked', last_reason: 'SCORING_UNCERTAIN', approved_context_key: 'criteria-a' },
      candidates: [candidate(interruptedId, { state: 'discovered', credits_reserved: 4, provenance: { scoring_started_at: '2026-10-08T12:00:00Z' } })],
    } : {});
    h.seed(baseline);
    const pending = deferred();
    h.responses.push(pending.promise);
    const command = { action, ...(action === 'configure' ? { settings: copy(helpers.DEFAULT_SOURCING_AGENT_SETTINGS), source: 'linkedin', account_id: 'linkedin-me', api: 'recruiter' } : action === 'skip_uncertain' ? skipCommand : {}) };
    const first = h.view().mutate(command);
    assert.equal(h.view().isSaving, true);
    assert.equal(h.view().pendingAction, action);
    await assert.rejects(h.view().mutate(command), error => error.code === 'BUSY');
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.requests[0].body, { ...command, expected_revision: 6, expected_context_key: 'criteria-a', organization_id: 'org-a', project_id: 'mission-a' });
    pending.resolve(reply(snapshot({
      agent: { ...baseline.agent, revision: 7, ...(action === 'skip_uncertain' ? { status: 'paused', last_reason: 'USER_PAUSED' } : {}) },
      candidates: action === 'skip_uncertain' ? baseline.candidates.map(row => ({ ...row, state: 'skipped', credits_reserved: 0 })) : [],
    })));
    await first;
    assert.equal(h.view().isSaving, false);
    assert.equal(h.view().actionError, null);
    assert.equal(h.view().actionErrorCode, null);
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.writes[0].key, ['sourcing-agent', 'org-a', 'user-a', 'mission-a']);
    assert.equal(h.cached().agent.revision, 7);
    if (action === 'skip_uncertain') {
      assert.equal(h.requests[0].body.confirm_uncertain, true);
      assert.equal(h.cached().agent.status, 'paused');
      assert.equal(h.cached().candidates[0].state, 'skipped');
      assert.equal(helpers.sourcingCanResume(h.cached()), true, 'the resolved candidate permits a separate manual resume');
      assert.equal(h.requests.length, 1, 'resolving the interruption never triggers an automatic resume');
    }
  });
}

for (const action of ['pause', 'stop', 'skip_uncertain']) {
  test(`${action}: retains the confirmed fast-response status and immediately refreshes the exact query`, async () => {
    const h = harness();
    const previous = candidate('previous-reviewed', { state: 'reviewed', decision: 'fit', reason: 'Expérience pertinente' });
    const rows = [previous, ...(action === 'skip_uncertain' ? [candidate(interruptedId, { state: 'discovered', credits_reserved: 4 })] : [])];
    const baseline = snapshot({ agent: { ...snapshot().agent, status: action === 'skip_uncertain' ? 'blocked' : 'active', approved_context_key: 'criteria-a' }, candidates: rows });
    h.seed(baseline);
    const resolvedRows = rows.map(row => row.id === interruptedId ? { ...row, state: 'skipped', credits_reserved: 0 } : row);
    const confirmedStatus = action === 'stop' ? 'stopped' : 'paused';
    const fast = snapshot({
      agent: { ...baseline.agent, status: confirmedStatus, revision: 7 },
      candidates: resolvedRows, accounts: [], context_key: '', eligibility: { allowed: false, reasons: [] }, requires_refresh: true,
    });
    h.responses.push(reply(fast));
    const result = await h.view().mutate(action === 'skip_uncertain' ? skipCommand : { action });
    assert.equal(h.cached(), result, 'the confirmed response remains in cache while its prerequisites refresh');
    assert.equal(h.view().data.agent.status, confirmedStatus);
    assert.equal(h.view().data.agent.revision, 7);
    assert.equal(h.view().data.requires_refresh, true);
    assert.equal(helpers.sourcingCanResume(h.view().data), false);
    assert.equal(helpers.sourcingCalibration(h.view().data).reviewed, 0, 'old decisions cannot be presented as approved for an unverified live context');
    assert.deepEqual(h.invalidations, [{ queryKey: ['sourcing-agent', 'org-a', 'user-a', 'mission-a'], exact: true }]);
    assert.deepEqual(h.requests.map(request => request.body.action), [action], 'the management command never starts a paid operation');
    h.responses.push(reply(snapshot({ agent: fast.agent, candidates: resolvedRows })));
    await h.read();
    assert.equal(h.view().data.context_key, 'criteria-a');
    assert.equal(h.view().data.eligibility.allowed, true);
    assert.equal(h.view().data.requires_refresh, undefined, 'the verified GET replaces the fast-response refresh flag');
    assert.equal(h.view().data.agent.status, confirmedStatus);
    assert.deepEqual(h.requests.map(request => request.body.action), [action, 'get']);
  });
}

test('a stopped agent resolves an older-context interruption, stays paused and starts calibration only explicitly', async () => {
  const h = harness();
  const interrupted = candidate(interruptedId, {
    state: 'discovered', context_key: 'earlier-criteria', credits_reserved: 4,
    provenance: { scoring_started_at: '2026-10-08T12:00:00Z' },
  });
  const stopped = snapshot({
    agent: { ...snapshot().agent, status: 'stopped', approved_context_key: 'earlier-criteria' },
    candidates: [interrupted], eligibility: { allowed: false, reasons: ['Les critères doivent être recalibrés.'] },
  });
  h.seed(stopped);
  assert.equal(helpers.sourcingUncertainCandidates(h.view().data).length, 1);
  const paused = snapshot({
    agent: { ...stopped.agent, status: 'paused', revision: 7, last_reason: 'USER_PAUSED' },
    candidates: [{ ...interrupted, state: 'skipped', credits_reserved: 0 }],
    eligibility: stopped.eligibility,
  });
  h.responses.push(reply(paused));
  await h.view().mutate({ ...skipCommand, expected_context_key: interrupted.context_key });
  assert.deepEqual(h.requests[0].body, {
    ...skipCommand, expected_revision: 6, expected_context_key: 'earlier-criteria', organization_id: 'org-a', project_id: 'mission-a',
  });
  assert.equal(h.view().data.agent.status, 'paused');
  assert.equal(helpers.sourcingUncertainCandidates(h.view().data).length, 0);
  assert.equal(helpers.sourcingCanResume(h.view().data), false, 'changed criteria still require calibration after the interruption is resolved');
  assert.deepEqual(h.requests.map(request => request.body.action), ['skip_uncertain']);
  h.responses.push(reply(snapshot({ agent: { ...paused.agent, status: 'calibrating', revision: 8, approved_context_key: null }, candidates: paused.candidates })));
  await h.view().mutate({ action: 'start_calibration' });
  assert.deepEqual(h.requests.map(request => request.body.action), ['skip_uncertain', 'start_calibration']);
  assert.equal(h.requests[1].body.expected_revision, 7);
  assert.equal(h.requests[1].body.expected_context_key, 'criteria-a');
  assert.equal(h.view().data.agent.status, 'calibrating');
});

for (const [code, concept] of [['FILTERS_MEMORY_STALE', /règles|mémoires|filtres/i], ['PRIVACY_CHANGED', /droits|données|accès|profil/i], ['SCORING_UNCERTAIN', /évaluation|scoring|interromp/i], ['AGENT_LEASE_CHANGED', /exécution|agent|recherche|passage/i]]) {
  test(`${code}: the command error and status reason explain the specific next step in French`, async () => {
    const h = harness();
    h.seed(snapshot());
    h.responses.push({ data: { error: 'Internal provider failure', error_code: code }, error: null });
    await assert.rejects(h.view().mutate({ action: 'resume' }), error => error.code === code && concept.test(error.message));
    assert.equal(h.view().actionErrorCode, code);
    assert.equal(h.view().isSaving, false);
    assert.doesNotMatch(h.view().actionError, /Internal provider failure/);
    assert.match(helpers.sourcingAgentReason(code), concept);
    assert.equal(h.writes.length, 0);
    const conflict = ['FILTERS_MEMORY_STALE', 'PRIVACY_CHANGED', 'AGENT_LEASE_CHANGED'].includes(code);
    assert.equal(h.invalidations.length, conflict ? 1 : 0);
    if (conflict) assert.deepEqual(h.invalidations[0], { queryKey: ['sourcing-agent', 'org-a', 'user-a', 'mission-a'], exact: true });
  });
}

for (const code of ['CALIBRATION_REQUIRED', 'AGENT_NOT_READY']) {
  test(`${code}: the command reports the missing preparation step and remains retryable`, async () => {
    const h = harness();
    h.seed(snapshot());
    h.responses.push({ data: { error: 'Internal provider failure', error_code: code }, error: null });
    await assert.rejects(h.view().mutate({ action: 'resume' }), error => error.code === code && /calibr|avis|prêt|prépar|configur|démarr/i.test(error.message));
    assert.equal(h.view().actionErrorCode, code);
    assert.equal(h.view().isSaving, false);
    assert.doesNotMatch(h.view().actionError, /Internal provider failure|L’agent n’a pas pu être actualisé/);
    assert.equal(h.writes.length, 0);
    h.responses.push(reply(snapshot()));
    await h.view().mutate({ action: 'start_calibration' });
    assert.equal(h.view().actionErrorCode, null);
  });
}

test('explicit revision/context override cached values and draft configuration defaults revision to zero', async () => {
  const h = harness();
  h.seed(snapshot());
  h.responses.push(reply(snapshot()));
  await h.view().mutate({ action: 'pause', expected_revision: 0, expected_context_key: 'explicit-context' });
  assert.equal(h.requests[0].body.expected_revision, 0);
  assert.equal(h.requests[0].body.expected_context_key, 'explicit-context');
  const fresh = harness();
  fresh.responses.push(reply(snapshot({ agent: null })));
  await fresh.view().mutate({ action: 'configure' });
  assert.equal(fresh.requests[0].body.expected_revision, 0);
});

for (const code of ['CONTEXT_CHANGED', 'REVISION_CONFLICT', 'MEMORY_CONFLICT', 'AGENT_FORBIDDEN', 'ACCOUNT_FORBIDDEN', 'INSUFFICIENT_CREDITS', 'REQUEST_FAILED']) {
  test(`${code}: exposes a translated action error, refreshes only conflicts and permits retry`, async () => {
    const h = harness();
    h.seed(snapshot());
    h.responses.push({ data: { error: 'Internal raw provider error', error_code: code }, error: null });
    await assert.rejects(h.view().mutate({ action: 'pause' }), error => error.code === code);
    assert.equal(h.view().isSaving, false);
    assert.ok(h.view().actionError);
    assert.equal(h.view().actionErrorCode, code);
    assert.equal(h.view().actionError.includes(code), false, 'the internal code is separate from the user-facing text');
    assert.doesNotMatch(h.view().actionError, /Internal raw provider error|REQUEST_FAILED|ACCOUNT_FORBIDDEN|AGENT_FORBIDDEN/);
    const conflict = ['CONTEXT_CHANGED', 'REVISION_CONFLICT', 'MEMORY_CONFLICT'].includes(code);
    assert.equal(h.invalidations.length, conflict ? 1 : 0);
    if (conflict) assert.deepEqual(h.invalidations[0], { queryKey: ['sourcing-agent', 'org-a', 'user-a', 'mission-a'], exact: true });
    h.view().clearActionError();
    assert.equal(h.view().actionError, null);
    assert.equal(h.view().actionErrorCode, null);
    h.responses.push(reply(snapshot()));
    await h.view().mutate({ action: 'pause' });
    assert.equal(h.writes.length, 1);
    assert.equal(h.view().actionErrorCode, null);
  });
}

test('transport error codes use the same conflict handling and a network failure leaves retry available', async () => {
  const h = harness();
  h.seed(snapshot());
  h.responses.push({ data: null, error: { code: 'REVISION_CONFLICT', message: 'Internal provider error' } });
  await assert.rejects(h.view().mutate({ action: 'pause' }), error => error.code === 'REVISION_CONFLICT');
  assert.equal(h.invalidations.length, 1);
  assert.doesNotMatch(h.view().actionError, /Internal provider error/);
  const failure = deferred();
  h.responses.push(failure.promise);
  const pending = h.view().mutate({ action: 'pause' });
  const rejected = assert.rejects(pending, /Local connection failed/);
  failure.reject(new Error('Local connection failed'));
  await rejected;
  assert.equal(h.view().isSaving, false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.invalidations.length, 1);
  h.responses.push(reply(snapshot()));
  await h.view().mutate({ action: 'pause' });
  assert.equal(h.view().actionError, null);
});

test('approving calibration refreshes the mission only after a verified successful response', async () => {
  const h = harness();
  h.seed(snapshot());
  h.responses.push(reply(snapshot()));
  await h.view().mutate({ action: 'approve_calibration', save_calibration_profiles: true });
  assert.deepEqual(h.invalidations, [{ queryKey: ['mission-jobs', 'org-a'] }, { queryKey: ['project', 'mission-a'] }]);
  const invalid = harness();
  invalid.seed(snapshot());
  invalid.responses.push(reply(snapshot({ agent: { ...snapshot().agent, project_id: 'foreign' } })));
  await assert.rejects(invalid.view().mutate({ action: 'approve_calibration' }), /n’a pas pu être vérifiée/);
  assert.equal(invalid.writes.length, 0);
  assert.equal(invalid.invalidations.length, 0);
});

test('malformed successful reads and commands retain the last verified cache and expose a French error', async () => {
  const h = harness();
  const valid = snapshot();
  h.seed(valid);
  h.responses.push(reply(snapshot({ agent: { ...valid.agent, settings: null } })));
  await assert.rejects(h.read(), /La réponse de l’agent n’a pas pu être vérifiée/);
  assert.equal(h.cached(), valid);
  h.responses.push(reply(snapshot({ candidates: [candidate('bad', { result: [] })] })));
  await assert.rejects(h.view().mutate({ action: 'pause' }), /La réponse de l’agent n’a pas pu être vérifiée/);
  assert.equal(h.cached(), valid);
  assert.equal(h.writes.length, 0);
  assert.equal(h.invalidations.length, 0);
  assert.equal(h.view().isSaving, false);
  assert.match(h.view().actionError, /La réponse de l’agent n’a pas pu être vérifiée/);
  assert.equal(h.view().actionErrorCode, 'REQUEST_FAILED');
});

for (const [action, outcome] of [
  ['approve_calibration', 'success'], ['approve_calibration', 'conflict'],
  ['skip_uncertain', 'success'], ['skip_uncertain', 'conflict'],
  ['pause', 'success'], ['pause', 'conflict'],
  ['stop', 'success'], ['stop', 'conflict'],
]) {
  test(`late ${action} ${outcome} after A→B→A cannot change cache, errors, invalidations or a new pending command`, async () => {
    const h = harness();
    h.seed(snapshot());
    const old = deferred();
    h.responses.push(old.promise);
    const first = h.view().mutate(action === 'skip_uncertain' ? skipCommand : { action });
    const firstRejected = assert.rejects(first, error => outcome === 'success' ? error.code === 'STALE_CONTEXT' : error.code === 'CONTEXT_CHANGED');
    const initialIdentity = h.view().contextIdentity;
    h.render({ projectId: 'mission-b' });
    assert.equal(h.view().isSaving, false);
    h.render({ projectId: 'mission-a' });
    assert.notEqual(h.view().contextIdentity, initialIdentity);
    const current = deferred();
    h.responses.push(current.promise);
    const second = h.view().mutate({ action: 'pause' });
    const before = h.stateWrites();
    old.resolve(outcome === 'success' ? reply(snapshot()) : { data: { error: 'stale conflict', error_code: 'CONTEXT_CHANGED' }, error: null });
    await firstRejected;
    assert.equal(h.stateWrites(), before);
    assert.equal(h.writes.length, 0);
    assert.equal(h.invalidations.length, 0);
    assert.equal(h.view().actionError, null);
    assert.equal(h.view().actionErrorCode, null);
    assert.equal(h.view().isSaving, true);
    assert.equal(h.view().pendingAction, 'pause');
    await assert.rejects(h.view().mutate({ action: 'pause' }), error => error.code === 'BUSY');
    current.resolve(reply(snapshot()));
    await second;
    assert.equal(h.view().isSaving, false);
    assert.equal(h.writes.length, 1);
  });
}

for (const transition of ['mission', 'organization', 'user', 'disabled', 'unmount', 'return-to-a']) {
  test(`a query response from a stale ${transition} generation is rejected before entering the cache`, async () => {
    const h = harness();
    const old = deferred();
    h.responses.push(old.promise);
    const pending = h.read();
    const rejected = assert.rejects(pending, error => error.code === 'STALE_CONTEXT');
    assert.deepEqual(h.requests[0].body, { action: 'get', organization_id: 'org-a', project_id: 'mission-a' });
    if (transition === 'unmount') h.unmount();
    else if (transition === 'organization') h.render({ organizationId: 'org-b' });
    else if (transition === 'user') h.render({ userId: 'user-b' });
    else if (transition === 'disabled') h.render({ enabled: false });
    else h.render({ projectId: 'mission-b' });
    if (transition === 'return-to-a') h.render({ projectId: 'mission-a' });
    old.resolve(reply(snapshot()));
    await rejected;
    assert.equal(h.cached(), undefined);
    assert.equal(h.writes.length, 0);
  });
}

test('an old query function cannot issue a new request after the mission has changed', async () => {
  const h = harness();
  const oldQuery = h.query();
  h.render({ projectId: 'mission-b' });
  await assert.rejects(oldQuery.queryFn({ signal: new AbortController().signal }), error => error.code === 'STALE_CONTEXT');
  assert.equal(h.requests.length, 0);
});

test('the current query validates and caps candidates before writing its result to the cache', async () => {
  const h = harness();
  h.responses.push(reply(snapshot({ candidates: Array.from({ length: 65 }, (_, i) => candidate(String(i))) })));
  await h.read();
  assert.equal(h.view().data.candidates.length, 50);
  assert.equal(h.cached().candidates.length, 50);
});

test('an aborted query cannot start a request or cache an outstanding response', async () => {
  const h = harness();
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(h.read(aborted.signal), error => error.code === 'STALE_CONTEXT');
  assert.equal(h.requests.length, 0);
  const current = new AbortController();
  const pending = deferred();
  h.responses.push(pending.promise);
  const request = h.read(current.signal);
  const rejected = assert.rejects(request, error => error.code === 'STALE_CONTEXT');
  current.abort();
  pending.resolve(reply(snapshot()));
  await rejected;
  assert.equal(h.cached(), undefined);
});

test('StrictMode can start its replacement read after cleanup before the lifecycle setup', async () => {
  const h = harness();
  const old = deferred();
  const oldController = new AbortController();
  h.responses.push(old.promise);
  const first = h.read(oldController.signal);
  const rejected = assert.rejects(first, error => error.code === 'STALE_CONTEXT');
  h.unmount();
  oldController.abort();
  const replacement = deferred();
  h.responses.push(replacement.promise);
  const second = h.read(new AbortController().signal);
  assert.equal(h.requests.length, 2, 'the replacement observation starts before the hook effect runs');
  h.setupEffects();
  h.render();
  old.resolve(reply(snapshot()));
  await rejected;
  assert.equal(h.cached(), undefined);
  replacement.resolve(reply(snapshot({ agent: { ...snapshot().agent, revision: 7 } })));
  await second;
  assert.equal(h.view().data.agent.revision, 7);
});

test('an old GET cannot replace a newer successful configuration already written to the cache', async () => {
  const h = harness();
  h.seed(snapshot());
  const old = deferred();
  h.responses.push(old.promise);
  const read = h.read();
  const latest = snapshot({ agent: { ...snapshot().agent, revision: 7 }, context_key: 'new-criteria' });
  h.responses.push(reply(latest));
  await h.view().mutate({ action: 'configure', settings: copy(helpers.DEFAULT_SOURCING_AGENT_SETTINGS) });
  old.resolve(reply(snapshot()));
  const result = await read;
  assert.equal(result.agent.revision, 7);
  assert.equal(h.view().data.agent.revision, 7);
  assert.equal(h.cached().context_key, 'new-criteria');
  assert.equal(h.writes.length, 1);
});

test('disabled or unauthenticated contexts hide cached results and cannot submit a command', async () => {
  for (const state of [{ enabled: false }, { isReady: false }, { userId: null }, { organizationId: null }, { projectId: '' }]) {
    const h = harness();
    h.seed(snapshot());
    h.render(state);
    assert.equal(h.view().data, undefined);
    assert.equal(h.query().enabled, false);
    await assert.rejects(h.view().mutate({ action: 'pause' }), error => error.code === 'STALE_CONTEXT');
    assert.equal(h.requests.length, 0);
  }
});

test('unmount ignores an outstanding command without setters, writes or invalidations', async () => {
  const h = harness();
  h.seed(snapshot());
  const pending = deferred();
  h.responses.push(pending.promise);
  const request = h.view().mutate({ action: 'approve_calibration' });
  const rejected = assert.rejects(request, error => error.code === 'STALE_CONTEXT');
  h.unmount();
  const before = h.stateWrites();
  pending.resolve(reply(snapshot()));
  await rejected;
  assert.equal(h.stateWrites(), before);
  assert.equal(h.writes.length, 0);
  assert.equal(h.invalidations.length, 0);
});

test('StrictMode effect replay does not revive a request started before cleanup or block a fresh action', async () => {
  const h = harness();
  h.seed(snapshot());
  const old = deferred();
  h.responses.push(old.promise);
  const first = h.view().mutate({ action: 'pause' });
  const rejected = assert.rejects(first, error => error.code === 'STALE_CONTEXT');
  h.replayEffects();
  h.render();
  const current = deferred();
  h.responses.push(current.promise);
  const second = h.view().mutate({ action: 'pause' });
  const before = h.stateWrites();
  old.resolve(reply(snapshot()));
  await rejected;
  assert.equal(h.stateWrites(), before);
  assert.equal(h.writes.length, 0);
  assert.equal(h.view().isSaving, true);
  current.resolve(reply(snapshot()));
  await second;
  assert.equal(h.view().isSaving, false);
});
