import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const forbidden = () => { throw new Error('Unexpected real provider/network call'); };
const boundary = new Map([
  ['react', 'export const useCallback = x => x; export const useLayoutEffect = () => {}; export const useRef = x => ({ current: x });'],
  ['@tanstack/react-query', 'export const useQueryClient = () => ({ invalidateQueries() {} });'],
  ['sonner', 'export const toast = { error() {}, info() {}, warning() {}, success() {} };'],
  ['@/integrations/supabase/client', 'export const supabase = new Proxy({}, { get() { throw new Error("Unexpected Supabase call"); } });'],
  ['@/lib/invokeUnipile', 'export const invokeUnipile = () => { throw new Error("Unexpected real Unipile call"); };'],
  ['@/lib/invokeCoresignal', 'export const invokeCoresignal = () => { throw new Error("Unexpected real Coresignal call"); };'],
  ['@/lib/invokeEdgeFunction', 'export const invokeEdgeFunction = () => { throw new Error("Unexpected edge function call"); };'],
  ['@/lib/invokeWithCredits', 'export const invokeWithCredits = () => { throw new Error("Unexpected paid generation call"); };'],
  ['@/lib/companyClassification', 'export const classifyFromProfile = () => ({ type: "other" });'],
  ['@/hooks/linkedin/preScoring', 'export const calculatePreScore = () => ({ score: 1 });'],
  ['@/hooks/useBaseKonekt', 'export const BASE_KONEKT_QUERY_KEY = "base";'],
]);

// Bundle complete production modules, rather than copies/extracted function
// bodies. Only provider/account boundaries are replaced; every unexpected
// database, network or credit-consuming call fails the test immediately.
const bundled = await build({
  stdin: { contents: `
    export { compileSearchRoles, roleTitleAlternatives, searchBooleanIssue } from './supabase/functions/_shared/search-boolean.ts';
    export { buildSearchParams } from './src/hooks/useLinkedInSearchActions.ts';
    export { mapGeneratedFilters } from './src/components/outreach/search/generateFiltersFromJob.ts';
    export { INITIAL_FILTERS } from './src/components/outreach/types.ts';
  `, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'silent',
  plugins: [{ name: 'isolated-sourcing-boundaries', setup(plugin) {
    plugin.onResolve({ filter: /.*/ }, args => boundary.has(args.path)
      ? { path: args.path, namespace: 'sourcing-boundary' } : undefined);
    plugin.onLoad({ filter: /.*/, namespace: 'sourcing-boundary' }, args => ({ contents: boundary.get(args.path), loader: 'js' }));
    plugin.onResolve({ filter: /^@\// }, args => ({ path: root + 'src/' + args.path.slice(2) + '.ts' }));
  } }],
});
const context = { module: { exports: {} }, exports: {}, fetch: forbidden, structuredClone,
  setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} } };
vm.runInNewContext(bundled.outputFiles[0].text, context, { filename: 'bundled-sourcing-role-licenses.cjs' });
const { compileSearchRoles: compile, roleTitleAlternatives: alternatives,
  buildSearchParams: buildParams, mapGeneratedFilters: mapGenerated, INITIAL_FILTERS } = context.module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const role = (keywords, priority = 'MUST_HAVE', scope = 'CURRENT') => ({ keywords, priority, scope });
const filters = patch => ({ ...plain(INITIAL_FILTERS), activity_messages: null, ...patch });
const request = patch => plain(buildParams(filters(patch), 'account-test'));
const invalid = action => assert.throws(action, error => error.code === 'filters_invalid');
const unsupported = action => assert.throws(action, error => error.code === 'filters_unsupported');

const titles = ['Cloud Engineer', 'Platform Engineer', 'DevOps Engineer', 'Site Reliability Engineer', 'Infrastructure Engineer', 'SRE'];
const titleExpression = titles.map(title => `"${title}"`).join(' OR ');

test('all six generated alternatives are preserved on each licence, without a four-title cap', () => {
  const classic = request({ api: 'classic', role: [role(titleExpression, 'MUST_HAVE', 'CURRENT_OR_PAST')] });
  assert.equal(classic.advanced_keywords.title, `(${titleExpression})`);
  assert.equal(classic.role, undefined);
  const sales = request({ api: 'sales_navigator', role: [role(titleExpression)] });
  assert.deepEqual(sales.job_title, titles.map(id => ({ id, priority: 'MUST_HAVE' })));
  assert.equal(sales.role, undefined);
  for (const api of ['recruiter', 'database']) {
    const rows = [role(titleExpression)];
    assert.deepEqual(request({ api, role: rows }).role, rows);
  }
});

test('title disjunction parser preserves phrases containing OR, AND, NOT and parentheses', () => {
  const text = '("Research OR Innovation" OR "Director (AND) NOT Sales") OR ("Cloud Engineer" OR SRE)';
  assert.deepEqual(plain(alternatives(text)), ['Research OR Innovation', 'Director (AND) NOT Sales', 'Cloud Engineer', 'SRE']);
  assert.deepEqual(plain(compile([role(text)], 'sales_navigator').salesTitles), [
    { id: 'Research OR Innovation', priority: 'MUST_HAVE' },
    { id: 'Director (AND) NOT Sales', priority: 'MUST_HAVE' },
    { id: 'Cloud Engineer', priority: 'MUST_HAVE' },
    { id: 'SRE', priority: 'MUST_HAVE' },
  ]);
  for (const expression of ['Engineer AND Manager', 'Engineer NOT Junior', 'NOT "Sales Manager"']) {
    assert.equal(alternatives(expression), null);
    unsupported(() => compile([role(expression)], 'sales_navigator'));
    assert.equal(compile([role(expression, 'MUST_HAVE', 'CURRENT_OR_PAST')], 'classic').classicTitle,
      `(${expression})`);
  }
});

test('multiple MUST_HAVE groups keep AND on Classic and Recruiter, and cannot silently become Sales OR', () => {
  const rows = [role('Engineer OR Architect', 'MUST_HAVE', 'CURRENT_OR_PAST'),
    role('Manager OR Director', 'MUST_HAVE', 'CURRENT_OR_PAST')];
  assert.equal(compile(rows, 'classic').classicTitle, '("Engineer" OR "Architect") AND ("Manager" OR "Director")');
  assert.deepEqual(plain(compile(rows, 'recruiter').role), rows);
  unsupported(() => compile(rows.map(row => ({ ...row, scope: 'CURRENT' })), 'sales_navigator'));
});

test('CAN_HAVE alternatives and title exclusions preserve priorities instead of disappearing', () => {
  const rows = [role('Engineer', 'CAN_HAVE'), role('Architect', 'CAN_HAVE'), role('Junior OR Intern', 'DOESNT_HAVE')];
  assert.deepEqual(plain(compile(rows, 'sales_navigator').salesTitles), [
    { id: 'Engineer', priority: 'MUST_HAVE' }, { id: 'Architect', priority: 'MUST_HAVE' },
    { id: 'Junior', priority: 'DOESNT_HAVE' }, { id: 'Intern', priority: 'DOESNT_HAVE' },
  ]);
  assert.equal(compile(rows.map(row => ({ ...row, scope: 'CURRENT_OR_PAST' })), 'classic').classicTitle,
    '(("Engineer") OR ("Architect")) AND NOT ("Junior" OR "Intern")');
  assert.deepEqual(plain(compile(rows, 'recruiter').role), rows);
  unsupported(() => compile([role('Engineer'), role('Architect', 'CAN_HAVE')], 'sales_navigator'));
});

test('CURRENT, PAST and CURRENT_OR_PAST either retain their period or explicitly reject the licence', () => {
  for (const scope of ['CURRENT', 'PAST', 'CURRENT_OR_PAST']) {
    for (const api of ['recruiter', 'database']) {
      assert.deepEqual(plain(compile([role('Engineer', 'MUST_HAVE', scope)], api).role), [role('Engineer', 'MUST_HAVE', scope)]);
    }
    if (scope === 'CURRENT_OR_PAST') assert.equal(compile([role('Engineer', 'MUST_HAVE', scope)], 'classic').classicTitle, '("Engineer")');
    else unsupported(() => compile([role('Engineer', 'MUST_HAVE', scope)], 'classic'));
    if (scope === 'CURRENT') assert.equal(compile([role('Engineer', 'MUST_HAVE', scope)], 'sales_navigator').salesTitles[0].id, 'Engineer');
    else unsupported(() => compile([role('Engineer', 'MUST_HAVE', scope)], 'sales_navigator'));
  }
});

test('Classic and Sales validate the final expression including quote, operator and manual-title overhead', () => {
  const classicExact = role('E'.repeat(196), 'MUST_HAVE', 'CURRENT_OR_PAST');
  assert.equal(compile([classicExact], 'classic').classicTitle.length, 200);
  invalid(() => compile([role('E'.repeat(197), 'MUST_HAVE', 'CURRENT_OR_PAST')], 'classic'));
  assert.equal(compile([role('E'.repeat(198))], 'sales_navigator').salesTitles[0].id.length, 198);
  invalid(() => compile([role('E'.repeat(199))], 'sales_navigator'));
  const compound = [role('E'.repeat(96), 'MUST_HAVE', 'CURRENT_OR_PAST'), role('A'.repeat(96), 'MUST_HAVE', 'CURRENT_OR_PAST')];
  assert.ok(compound.every(row => row.keywords.length < 200));
  invalid(() => compile(compound, 'classic'));
  invalid(() => compile([role(`${'E'.repeat(99)} OR ${'A'.repeat(99)}`)], 'sales_navigator'));
  invalid(() => compile([role('Engineer', 'MUST_HAVE', 'CURRENT_OR_PAST')], 'classic', { classicTitle: 'M'.repeat(186) }));
});

test('Recruiter preserves valid expressions longer than 330 characters without truncation', () => {
  const expression = Array.from({ length: 30 }, (_, i) => `"Long Role Title ${i}"`).join(' OR ');
  assert.ok(expression.length > 330);
  const rows = [role(expression, 'MUST_HAVE', 'PAST'), role('Junior', 'DOESNT_HAVE')];
  assert.deepEqual(plain(compile(rows, 'recruiter').role), rows);
  assert.deepEqual(request({ api: 'recruiter', role: rows }).role, rows);
  for (const api of ['classic', 'sales_navigator']) invalid(() => compile([role(expression)], api));
});

test('malformed title constraints fail rather than getting repaired, truncated or omitted', () => {
  for (const keywords of ['', 'Engineer AND', 'Engineer OR (AND Manager)', '"Engineer', '(Engineer OR Manager']) {
    for (const api of ['classic', 'sales_navigator', 'recruiter']) invalid(() => compile([role(keywords)], api));
  }
  invalid(() => compile([{ keywords: 'Engineer', priority: 'INVALID', scope: 'CURRENT' }], 'recruiter'));
  invalid(() => compile([{ keywords: 'Engineer', priority: 'MUST_HAVE', scope: 'ANY' }], 'recruiter'));
  invalid(() => compile([null], 'recruiter'));
});

test('Classic combines manual title_keywords with generated roles and preserves names and general keywords', () => {
  const manual = '"Principal" OR "Staff"';
  const result = request({ api: 'classic', keywords: 'Kubernetes', title_keywords: manual,
    first_name: 'Alice', last_name: 'Martin', role: [role('Engineer', 'MUST_HAVE', 'CURRENT_OR_PAST')] });
  assert.deepEqual(result.advanced_keywords, { first_name: 'Alice', last_name: 'Martin', title: `(${manual}) AND ("Engineer")` });
  assert.equal(result.keywords, 'Kubernetes');
  assert.equal(request({ api: 'classic', title_keywords: manual }).advanced_keywords.title, manual);
  assert.equal(request({ api: 'classic', title_keywords: 'M'.repeat(200) }).advanced_keywords.title.length, 200);
  assert.throws(() => request({ api: 'classic', title_keywords: 'M'.repeat(201) }), /200|tronqué/);
  assert.throws(() => request({ api: 'classic', title_keywords: 'Engineer AND' }), /mots-clés|opérateurs/);
  assert.throws(() => request({ api: 'classic', job_title: [{ id: '17', name: 'Architect', priority: 'MUST_HAVE' }] }), /Classic|intitulés|poste/i);
  for (const api of ['sales_navigator', 'recruiter']) {
    assert.throws(() => request({ api, title_keywords: manual, role: [role('Engineer')] }), /Classic|licence/i);
  }
});

test('manual native Sales titles stay intact or refuse incompatible generated positive groups', () => {
  const manual = [{ id: '17', name: 'Architect', priority: 'MUST_HAVE' }];
  assert.deepEqual(request({ api: 'sales_navigator', job_title: manual }).job_title, manual);
  unsupported(() => request({ api: 'sales_navigator', job_title: manual, role: [role('Engineer')] }));
  const onlyExclusion = request({ api: 'sales_navigator', job_title: manual, role: [role('Junior', 'DOESNT_HAVE')] });
  assert.deepEqual(onlyExclusion.job_title, [{ id: '17', priority: 'MUST_HAVE' }, { id: 'Junior', priority: 'DOESNT_HAVE' }]);
  const same = request({ api: 'sales_navigator', job_title: [{ id: 'Engineer', name: 'Engineer', priority: 'MUST_HAVE' }], role: [role('Engineer')] });
  assert.deepEqual(same.job_title, [{ id: 'Engineer', priority: 'MUST_HAVE' }]);
  const manualNegative = request({ api: 'sales_navigator', job_title: [{ id: 'Intern', name: 'Intern', priority: 'DOESNT_HAVE' }], role: [role('Engineer')] });
  assert.deepEqual(manualNegative.job_title, [{ id: 'Intern', priority: 'DOESNT_HAVE' }, { id: 'Engineer', priority: 'MUST_HAVE' }]);
  const recruiter = request({ api: 'recruiter', job_title: manual,
    role: [role('Engineer', 'MUST_HAVE', 'PAST'), role('Junior', 'DOESNT_HAVE', 'CURRENT_OR_PAST')] });
  assert.deepEqual(recruiter.job_title, manual);
  assert.deepEqual(recruiter.role, [role('Engineer', 'MUST_HAVE', 'PAST'), role('Junior', 'DOESNT_HAVE', 'CURRENT_OR_PAST')]);
});

test('native-only Sales title periods and priorities are validated before any request, without mutation', () => {
  for (const native of [
    { id: '17', name: 'Architect', priority: 'MUST_HAVE', scope: 'PAST' },
    { id: '17', name: 'Architect', priority: 'MUST_HAVE', scope: 'CURRENT_OR_PAST' },
    { id: '17', name: 'Architect', priority: 'CAN_HAVE', scope: 'CURRENT' },
  ]) {
    const state = filters({ api: 'sales_navigator', job_title: [native] });
    const before = plain(state);
    unsupported(() => compile([], 'sales_navigator', { salesTitles: state.job_title }));
    unsupported(() => buildParams(state, 'account-test'));
    assert.deepEqual(plain(state), before);
  }
  const sales = { id: '17', name: 'Architect', priority: 'MUST_HAVE', scope: 'CURRENT' };
  assert.deepEqual(request({ api: 'sales_navigator', job_title: [sales] }).job_title, [sales]);
  const recruiter = { ...sales, scope: 'PAST' };
  assert.deepEqual(request({ api: 'recruiter', job_title: [recruiter] }).job_title, [recruiter]);
});

test('native-only Sales titles enforce the text-length limit without dropping manual filters', () => {
  const exact = { id: 'E'.repeat(200), name: 'Manual title', priority: 'MUST_HAVE', scope: 'CURRENT' };
  assert.deepEqual(request({ api: 'sales_navigator', job_title: [exact] }).job_title, [exact]);
  const state = filters({ api: 'sales_navigator', job_title: [{ ...exact, id: 'E'.repeat(201) }] });
  const before = plain(state);
  invalid(() => buildParams(state, 'account-test'));
  assert.deepEqual(plain(state), before);
});

test('manual past-title filters retain their period and reject incompatible Classic or Sales criteria before search', () => {
  const valid = [{ id: '17', name: 'Architect', priority: 'MUST_HAVE', scope: 'PAST' },
    { id: '18', name: 'Intern', priority: 'DOESNT_HAVE', scope: 'PAST' }];
  for (const api of ['recruiter', 'sales_navigator']) {
    assert.deepEqual(request({ api, past_job_title: valid }).past_job_title, valid,
      'both builder mappings must preserve the reviewed period');
    const conflicting = filters({ api, past_job_title: [{ ...valid[0], scope: 'CURRENT' }] });
    const before = plain(conflicting);
    assert.throws(() => buildParams(conflicting, 'account-test'), /période passée/);
    assert.deepEqual(plain(conflicting), before);
  }
  for (const patch of [
    { api: 'classic', past_job_title: valid },
    { api: 'sales_navigator', past_job_title: [{ ...valid[0], priority: 'CAN_HAVE' }] },
    { api: 'sales_navigator', past_job_title: [{ ...valid[0], id: 'Architect' }] },
  ]) {
    const state = filters(patch);
    const before = plain(state);
    assert.throws(() => buildParams(state, 'account-test'), /licence|priorité|suggestions/);
    assert.deepEqual(plain(state), before);
  }
});

test('AI regeneration preserves existing manual roles once, including through repeated regeneration', async () => {
  for (const api of ['classic', 'sales_navigator', 'recruiter']) {
    const scope = api === 'classic' ? 'CURRENT_OR_PAST' : 'CURRENT';
    const excluded = role('Junior OR Intern', 'DOESNT_HAVE', scope);
    const currentRoles = [role('Old Engineer', 'MUST_HAVE', scope), excluded];
    const generated = { role: [role('Engineer OR Architect', 'MUST_HAVE', scope)] };
    const beforeGenerated = plain(generated), beforeCurrent = plain(currentRoles);
    const first = await mapGenerated(generated, { accountId: null, api, currentRoles });
    assert.deepEqual(plain(first.update.role), [generated.role[0], ...currentRoles]);
    assert.notEqual(first.update.role[2], excluded, 'the preserved row is copied rather than aliased');
    const second = await mapGenerated(generated, { accountId: null, api, currentRoles: first.update.role });
    assert.deepEqual(plain(second.update.role), [generated.role[0], ...currentRoles]);
    const returnedExclusion = await mapGenerated({ role: [...generated.role, excluded] }, { accountId: null, api, currentRoles });
    assert.deepEqual(plain(returnedExclusion.update.role), [generated.role[0], excluded, currentRoles[0]]);
    assert.deepEqual(plain(generated), beforeGenerated);
    assert.deepEqual(plain(currentRoles), beforeCurrent);
    if (api === 'sales_navigator') {
      unsupported(() => request({ api, ...plain(second.update) }));
    } else {
      const adapted = request({ api, ...plain(second.update) });
      if (api === 'classic') assert.equal(adapted.advanced_keywords.title,
        '("Engineer" OR "Architect") AND ("Old Engineer") AND NOT ("Junior" OR "Intern")');
      else assert.deepEqual(adapted.role, [generated.role[0], ...currentRoles]);
    }
  }
});

test('generation conjoins manual keywords and refuses ambiguous unions of manual title alternatives', async () => {
  for (const api of ['classic', 'sales_navigator', 'recruiter']) {
    const scope = api === 'classic' ? 'CURRENT_OR_PAST' : 'CURRENT';
    const generated = { keywords: 'Python OR Scala', role: [role('Engineer', 'MUST_HAVE', scope)] };
    const { update } = await mapGenerated(generated, { accountId: null, api, currentKeywords: 'AWS NOT Azure' });
    assert.equal(update.keywords, '(AWS NOT Azure) AND (Python OR Scala)');
    assert.equal(request({ api, ...plain(update) }).keywords, update.keywords);
    const same = await mapGenerated(generated, { accountId: null, api, currentKeywords: generated.keywords });
    assert.equal(same.update.keywords, generated.keywords);
    let repeated = update.keywords;
    for (let i = 0; i < 10; i++) {
      repeated = (await mapGenerated(generated, { accountId: null, api, currentKeywords: repeated })).update.keywords;
    }
    assert.equal(repeated, update.keywords, 'regeneration must not grow the same conjunction past its length limit');
    const withOr = await mapGenerated({ keywords: 'Python' }, {
      accountId: null, api, currentKeywords: '(AWS) OR (Scala) AND (Python)',
    });
    assert.equal(withOr.update.keywords, '((AWS) OR (Scala) AND (Python)) AND (Python)',
      'an AND suffix underneath an OR must still become mandatory');
    const quoted = await mapGenerated({ keywords: 'Python' }, {
      accountId: null, api, currentKeywords: '("Research (AND) OR Innovation") AND (Python)',
    });
    assert.equal(quoted.update.keywords, '("Research (AND) OR Innovation") AND (Python)');
    const current = [role('Architect', 'CAN_HAVE', scope)];
    await assert.rejects(() => mapGenerated({ role: [role('Engineer', 'CAN_HAVE', scope)] },
      { accountId: null, api, currentRoles: current }), /alternatives existantes et générées/);
    assert.deepEqual(plain(current), [role('Architect', 'CAN_HAVE', scope)]);
    const identical = await mapGenerated({ role: current }, { accountId: null, api, currentRoles: current });
    assert.deepEqual(plain(identical.update.role), current);
  }
});

test('canonical AI roles, calculated experience and manual filters survive generation and request adaptation', async () => {
  for (const api of ['classic', 'sales_navigator', 'recruiter']) {
    const generated = { role: [role(titleExpression, 'MUST_HAVE', api === 'classic' ? 'CURRENT_OR_PAST' : 'CURRENT')],
      years_of_experience_min: 4, years_of_experience_max: 9 };
    const before = plain(generated);
    const { update } = await mapGenerated(generated, { accountId: null, api });
    assert.deepEqual(plain(update.role), generated.role);
    assert.equal(update.title_keywords, undefined);
    assert.equal(update.job_title, undefined);
    assert.equal(update.calculated_experience_min, 4);
    assert.equal(update.calculated_experience_max, 9);
    assert.equal(update.years_of_experience_min, null);
    assert.equal(update.years_of_experience_max, null);
    const state = filters({ api, keywords: 'manual technical keyword', ...plain(update) });
    const beforeState = plain(state);
    const adapted = plain(buildParams(state, 'account-test'));
    assert.equal(adapted.keywords, 'manual technical keyword');
    assert.deepEqual(plain(generated), before);
    assert.deepEqual(plain(state), beforeState);
    assert.deepEqual(plain(state.role), generated.role);
  }
});

test('switching licences reuses canonical criteria, with no converted-field accumulation or input mutation', () => {
  const state = filters({ api: 'recruiter', role: [role('Engineer OR Architect')] });
  const before = plain(state);
  const recruiter = plain(buildParams(state, 'account-test'));
  const sales = plain(buildParams({ ...state, api: 'sales_navigator' }, 'account-test'));
  assert.deepEqual(sales.job_title, [{ id: 'Engineer', priority: 'MUST_HAVE' }, { id: 'Architect', priority: 'MUST_HAVE' }]);
  assert.deepEqual(plain(buildParams(state, 'account-test')), recruiter);
  unsupported(() => buildParams({ ...state, api: 'classic' }, 'account-test'));
  assert.deepEqual(plain(state), before);
  const reviewed = { ...state, api: 'classic', role: state.role.map(row => ({ ...row, scope: 'CURRENT_OR_PAST' })) };
  assert.equal(buildParams(reviewed, 'account-test').advanced_keywords.title, '("Engineer" OR "Architect")');
  assert.deepEqual(plain(state), before);
});
