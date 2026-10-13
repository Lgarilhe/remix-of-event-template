import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
function moduleAt(file, dependencies = {}) {
  const exports = {};
  const js = ts.transpileModule(readFileSync(new URL(file, root), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, { exports, require: name => {
    assert.ok(name in dependencies, `unexpected dependency ${name}`);
    return dependencies[name];
  }, console: { warn() {} } });
  return exports;
}
const { INITIAL_FILTERS } = moduleAt('src/components/outreach/types.ts');
const source = readFileSync(new URL('src/components/outreach/LinkedInSearch.tsx', root), 'utf8');
const ast = ts.createSourceFile('LinkedInSearch.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
    && ['applyPhrase', 'launchFlow'].includes(node.name.text)) {
    callbacks[node.name.text] = node.initializer.arguments[0].getText(ast);
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
    && node.arguments[0].getText(ast).includes('initialPhraseDoneRef.current = true')) {
    callbacks.initialLaunch = node.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
for (const name of ['applyPhrase', 'launchFlow', 'initialLaunch']) assert.ok(callbacks[name], `execute production ${name}`);
const callbackJs = ts.transpileModule(Object.entries(callbacks).map(([name, body]) => `exports.${name} = ${body};`).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Execute the real initial-launch effect, callbacks and filter generator. Only
// the model and LinkedIn parameter lookup are simulated at their boundaries.
async function run({ api = 'database', location = 'Paris', refine = false } = {}) {
  const modelCalls = [], lookups = [], searches = [];
  const job = { id: 'project:mission-a', title: 'Développeur', location, mustHave: [], targetCompanies: [] };
  const oldFilters = { ...plain(INITIAL_FILTERS), api,
    keywords: 'React', skills_keywords: ['React'], industry_keywords: ['Banking'],
    skills: [{ id: 'react', name: 'React', keywords: 'React', priority: 'MUST_HAVE' }],
    company: [{ id: '111', name: 'Ancienne entreprise', priority: 'MUST_HAVE' }],
    company_keywords: [{ keywords: 'Ancienne entreprise', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    school: [{ id: '222', name: 'Ancienne école', priority: 'MUST_HAVE' }],
    location: [{ id: api === 'database' ? 'database:Lyon' : '105015875', name: 'Lyon', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    calculated_experience_min: 5, calculated_experience_max: 10,
  };
  const generator = moduleAt('src/components/outreach/search/generateFiltersFromJob.ts', {
    '@/lib/invokeWithCredits': { invokeWithCredits: async (_function, _action, body) => {
      modelCalls.push(plain(body));
      return { data: { success: true, filters: { keywords: 'Développeur', role: [], seniority: [],
        location_keywords: location ? [location] : [], skills_keywords: [], company_keywords: [],
        school: [], industry_keywords: [], years_of_experience_min: null, years_of_experience_max: null,
      } } };
    } },
    '@/lib/invokeUnipile': { invokeUnipile: async ({ body }) => {
      lookups.push(plain(body));
      return { data: { success: true, items: [{ id: '105015001', title: 'Paris' }] } };
    } },
  });
  const search = { selectedJob: job, loading: false, filters: oldFilters, filtersRef: { current: oldFilters },
    setFilters: next => { search.filters = next; } };
  const scope = { organizationId: 'org-a', projectId: 'mission-a', searchMemoryVersionKey: 'no-memories' };
  let launch;
  const context = { exports: {}, search, INITIAL_FILTERS,
    selectedAccount: api === 'database' ? null : 'account-a', searchSource: api === 'database' ? 'database' : 'linkedin',
    organizationId: 'org-a', activeProject: { id: 'mission-a' }, memoryContextReady: true, searchMemoryCount: 0,
    liveMemoryScope: { current: scope }, liveBriefKey: { current: 'updated-brief' }, generationEpoch: { current: { version: 1 } },
    generateFiltersFromJob: generator.generateFiltersFromJob, buildAugmentedJob: generator.buildAugmentedJob,
    handleSearch: async () => { searches.push(plain(search.filtersRef.current)); },
    chipsFromUpdate: () => [], handleSuggestionsGenerated() {}, handleMemoryContextGenerated() {},
    setPlanChips() {}, setPlanStage() {}, setChipsDirty() {}, setFlowError() {}, setFlowQuery() {},
    setFlowMode() {}, hasSearchedRef: { current: true }, flowBusyRef: { current: false }, heroLaunchRef: { current: false },
    initialPhraseDoneRef: { current: false }, initialPhrase: 'Chercher selon le cadrage et les critères validés.', isV3: true,
    isInsufficientCreditsError: () => false, toast: { error() {} }, setTimeout: fn => { fn(); },
  };
  vm.runInNewContext(callbackJs, context);
  context.applyPhrase = context.exports.applyPhrase;
  context.launchFlow = (...args) => { launch = context.exports.launchFlow(...args); return launch; };
  if (refine) await context.exports.applyPhrase('Ajuster les mots-clés', false);
  else { context.exports.initialLaunch(); await launch; }
  return { filters: plain(search.filtersRef.current), searches, modelCalls, lookups };
}

test('validated brief replaces previous Lyon search and removed skills, companies and experience on both sources', async () => {
  for (const api of ['database', 'recruiter', 'classic', 'sales_navigator']) {
    const result = await run({ api });
    assert.equal(result.modelCalls.length, 1);
    assert.equal(result.modelCalls[0].job.location, 'Paris');
    assert.equal(result.searches.length, 1);
    assert.equal(result.searches[0].api, api);
    assert.deepEqual(result.searches[0].location.map(item => item.name), ['Paris']);
    for (const field of ['skills', 'skills_keywords', 'company', 'company_keywords', 'school', 'industry_keywords']) {
      assert.deepEqual(result.searches[0][field], [], `${api}: ${field} removed from the new brief`);
    }
    assert.equal(result.searches[0].calculated_experience_min, null);
    assert.equal(result.searches[0].calculated_experience_max, null);
    assert.equal(result.lookups.length, api === 'database' ? 0 : 1);
  }
});

test('removing location from a validated brief clears the previous place rather than silently searching Lyon', async () => {
  const result = await run({ location: '' });
  assert.deepEqual(result.searches[0].location, []);
  assert.equal(result.lookups.length, 0);
});

test('incremental generation keeps existing manually chosen constraints and waits for explicit relaunch', async () => {
  const result = await run({ refine: true });
  assert.equal(result.searches.length, 0);
  assert.deepEqual(result.filters.location.map(item => item.name), ['Lyon']);
  assert.deepEqual(result.filters.skills_keywords, ['React']);
  assert.equal(result.filters.company[0].name, 'Ancienne entreprise');
  assert.equal(result.filters.calculated_experience_min, 5);
});
